"""
PerformanceCardAgent
--------------------
Generates performance card metadata and image assets using Sarvam APIs with
MongoDB-backed storage.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

from tenacity import (
    before_sleep_log,
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_random_exponential,
)

from agents.config import (
    MONGODB_ASSET_COLLECTION as _ASSET_COLLECTION,
    MONGODB_FEEDBACK_COLLECTION as _COL_FEEDBACK,
    MONGODB_PERFORMANCE_CARD_COLLECTION as _COL_PERFORMANCE_CARDS,
    MONGODB_SESSION_COLLECTION as _COL_SESSIONS,
)
from lib.mongo import get_binary_asset, get_collection, save_binary_asset, strip_mongo_id
from lib.sarvam_client import SarvamAPIError, SarvamRateLimitError, get_sarvam_client

logger = logging.getLogger(__name__)

_IMAGE_GEN_ENABLED = (os.getenv("IMAGEN_MODEL", "disabled").strip().lower() not in {"", "0", "false", "off", "none", "disabled"})

_CARD_ASSET_PREFIX = "performance-card"

_PERSONA_VISUAL: dict[str, str] = {
    "neutral": "elegant minimalist corporate office with clean lines",
    "startup_founder": "vibrant startup workspace with creative energy",
    "investment_banker": "luxurious high-contrast finance environment",
    "tech_lead": "futuristic engineering workspace with glowing circuitry",
    "hr_manager": "warm inviting office space with soft textures",
    "product_manager": "sleek product launch environment with spotlight beams",
    "vp_engineering": "executive technology leadership environment",
    "management_consultant": "polished boardroom with strategic visual structure",
    "cto": "cutting-edge technology lab with architectural depth",
    "recruiter": "modern networking event space with elegant lighting",
    "algorithm_guru": "abstract mathematical landscape with flowing geometry",
    "system_designer": "architectural blueprint environment with layered systems",
    "prompt_wizard": "mystical neural network visualization with glowing nodes",
}


def _score_mood(score: int) -> dict[str, str]:
    if score >= 85:
        return {"mood": "triumphant, radiant, premium", "palette": "gold, amber, soft white"}
    if score >= 70:
        return {"mood": "confident, bright, optimistic", "palette": "teal, sky blue, silver"}
    if score >= 50:
        return {"mood": "determined, rebuilding, hopeful", "palette": "amber, orange, muted navy"}
    return {"mood": "dramatic, resilient, intense", "palette": "deep blue, violet, silver"}


def _build_card_prompt(
    persona: str,
    job_role: str,
    score: int,
    decision: str,
    motivational_line: str,
) -> str:
    score_info = _score_mood(score)
    visual = _PERSONA_VISUAL.get(persona, _PERSONA_VISUAL["neutral"])
    return (
        f"Abstract cinematic wide-format artwork. Visual DNA: {visual}. "
        f"Job role motif: {job_role}. Mood: {score_info['mood']}. Palette: {score_info['palette']}. "
        f"Decision tone: {'achievement-forward' if decision == 'offer' else 'constructive and determined'}. "
        f"Emotional undertone: {motivational_line}. "
        "No people, no faces, no text, no logos, no letters, no numbers. "
        "Premium editorial finish, rich depth, pure abstract art only."
    )


def _asset_id_for_card_image(session_id: str) -> str:
    return f"{_CARD_ASSET_PREFIX}:{session_id}"


class PerformanceCardAgent:
    def __init__(self) -> None:
        self._sarvam_client = get_sarvam_client()
        self._sessions = get_collection(_COL_SESSIONS)
        self._feedback = get_collection(_COL_FEEDBACK)
        self._cards = get_collection(_COL_PERFORMANCE_CARDS)

    async def _generate_motivational_line(
        self,
        score: int,
        decision: str,
        job_role: str,
        persona: str,
        strengths: list[str],
    ) -> str:
        prompt = (
            "Write one short motivational sentence, max 15 words, for a candidate.\n"
            f"Score: {score}/100\n"
            f"Decision: {decision}\n"
            f"Job role: {job_role}\n"
            f"Persona: {persona}\n"
            f"Strengths: {', '.join(strengths[:3]) if strengths else 'N/A'}\n"
            "Return only the sentence."
        )

        @retry(
            retry=retry_if_exception_type(SarvamRateLimitError),
            wait=wait_random_exponential(multiplier=1, max=30),
            stop=stop_after_attempt(4),
            before_sleep=before_sleep_log(logger, logging.WARNING),
            reraise=True,
        )
        async def _generate_with_retry() -> str:
            return await self._sarvam_client.generate_text(
                prompt=prompt,
                system_instruction="You write concise motivational one-liners. Return only the sentence.",
                temperature=0.7,
                max_tokens=80,
            )

        try:
            return (await _generate_with_retry()).strip().strip('"').strip("'")
        except Exception as exc:
            logger.warning("Motivational line generation failed: %s", exc)
            return (
                "Your preparation is paying off."
                if score >= 70
                else "Each round is building stronger interview instincts."
            )

    async def _generate_background(
        self,
        session_id: str,
        persona: str,
        job_role: str,
        score: int,
        decision: str,
        motivational_line: str,
        force_regenerate: bool = False,
    ) -> Optional[bytes]:
        if not _IMAGE_GEN_ENABLED:
            logger.info("Performance card image generation disabled (IMAGEN_MODEL=%s)", os.getenv("IMAGEN_MODEL", "disabled"))
            return None

        asset_id = _asset_id_for_card_image(session_id)
        if not force_regenerate:
            cached = await get_binary_asset(asset_id, collection=_ASSET_COLLECTION)
            if cached:
                payload, _content_type, _meta = cached
                return payload

        prompt = _build_card_prompt(persona, job_role, score, decision, motivational_line)

        @retry(
            retry=retry_if_exception_type(SarvamRateLimitError),
            wait=wait_random_exponential(multiplier=1, max=60),
            stop=stop_after_attempt(5),
            before_sleep=before_sleep_log(logger, logging.WARNING),
            reraise=True,
        )
        async def _generate_with_retry():
            return await self._sarvam_client.generate_image(
                prompt=prompt,
                width=1920,
                height=1080,
                num_images=1,
            )

        try:
            images = await _generate_with_retry()
            if not images:
                return None
            image_bytes = images[0]
            await save_binary_asset(
                asset_id=asset_id,
                data=image_bytes,
                content_type="image/jpeg",
                collection=_ASSET_COLLECTION,
                filename=f"{session_id}.jpg",
                metadata={"kind": "performance_card", "session_id": session_id},
            )
            return image_bytes
        except SarvamAPIError as exc:
            logger.warning("Performance card image generation unavailable — session=%s error=%s", session_id, exc)
            return None
        except Exception:
            logger.exception("Performance card image generation failed — session=%s", session_id)
            return None

    async def generate(
        self,
        session_id: str,
        force_regenerate: bool = False,
    ) -> dict[str, Any] | None:
        existing = await self.get_card_metadata(session_id)
        if existing and existing.get("has_background") and not force_regenerate:
            return existing

        feedback_doc = await self._feedback.find_one({"_id": session_id})
        session_doc = await self._sessions.find_one({"_id": session_id})
        if not feedback_doc or not session_doc:
            return None

        feedback = strip_mongo_id(feedback_doc)
        session = strip_mongo_id(session_doc)
        score = int(feedback.get("overall_score") or 0)
        decision = str(feedback.get("decision") or "rejection")
        job_role = str(session.get("job_role") or "Software Engineer")
        persona = str(session.get("persona") or "neutral")
        interviewer_name = str(session.get("interviewer_name") or "Interviewer")
        strengths = list(feedback.get("strengths") or [])

        motivational_line = str(existing.get("motivational_line") if existing else "").strip()
        if not motivational_line or force_regenerate:
            motivational_line = await self._generate_motivational_line(
                score,
                decision,
                job_role,
                persona,
                strengths,
            )

        image_bytes = await self._generate_background(
            session_id,
            persona,
            job_role,
            score,
            decision,
            motivational_line,
            force_regenerate=force_regenerate,
        )
        if image_bytes is None:
            return None

        card_meta = {
            "_id": session_id,
            "session_id": session_id,
            "score": score,
            "decision": decision,
            "decision_reason": feedback.get("decision_reason"),
            "dimension_scores": feedback.get("dimension_scores"),
            "job_role": job_role,
            "persona": persona,
            "interviewer_name": interviewer_name,
            "motivational_line": motivational_line,
            "feedback_compiled_at": feedback.get("compiled_at"),
            "has_background": True,
            "image_url": f"/performance-card/{session_id}/image",
        }
        await self._cards.replace_one({"_id": session_id}, card_meta, upsert=True)
        return strip_mongo_id(card_meta)

    async def refresh_metadata(self, session_id: str) -> dict[str, Any] | None:
        existing = await self.get_card_metadata(session_id)
        if not existing:
            return await self.generate(session_id)

        feedback_doc = await self._feedback.find_one({"_id": session_id})
        session_doc = await self._sessions.find_one({"_id": session_id})
        if not feedback_doc or not session_doc:
            return existing

        cached = await get_binary_asset(_asset_id_for_card_image(session_id), collection=_ASSET_COLLECTION)
        feedback = strip_mongo_id(feedback_doc)
        session = strip_mongo_id(session_doc)
        card_meta = {
            "_id": session_id,
            "session_id": session_id,
            "score": int(feedback.get("overall_score") or 0),
            "decision": feedback.get("decision", "rejection"),
            "decision_reason": feedback.get("decision_reason"),
            "dimension_scores": feedback.get("dimension_scores"),
            "job_role": session.get("job_role", "Software Engineer"),
            "persona": session.get("persona", "neutral"),
            "interviewer_name": session.get("interviewer_name", "Interviewer"),
            "motivational_line": existing.get("motivational_line")
            or "Keep going — each practice round makes you interview-ready.",
            "feedback_compiled_at": feedback.get("compiled_at"),
            "has_background": cached is not None,
            "image_url": f"/performance-card/{session_id}/image",
        }
        await self._cards.replace_one({"_id": session_id}, card_meta, upsert=True)
        return strip_mongo_id(card_meta)

    async def get_card_metadata(self, session_id: str) -> dict[str, Any] | None:
        document = await self._cards.find_one({"_id": session_id})
        return strip_mongo_id(document) if document else None

    async def get_card_image(self, session_id: str) -> Optional[bytes]:
        asset = await get_binary_asset(_asset_id_for_card_image(session_id), collection=_ASSET_COLLECTION)
        if asset:
            payload, _content_type, _meta = asset
            return payload
        generated = await self.generate(session_id)
        if not generated:
            return None
        asset = await get_binary_asset(_asset_id_for_card_image(session_id), collection=_ASSET_COLLECTION)
        if not asset:
            return None
        payload, _content_type, _meta = asset
        return payload
