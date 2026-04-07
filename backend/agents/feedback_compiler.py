"""
FeedbackCompilerAgent
---------------------
Compiles interview feedback from session, transcript, posture, and resume data
stored in MongoDB, then generates the final report with Sarvam AI.
"""

from __future__ import annotations

import asyncio
import json
import logging
import traceback
from datetime import datetime, timezone
from typing import Any

from tenacity import (
    before_sleep_log,
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_random_exponential,
)

from agents.config import (
    MONGODB_FEEDBACK_COLLECTION as _COL_FEEDBACK,
    MONGODB_POSTURE_COLLECTION as _COL_POSTURE,
    MONGODB_RESUME_COLLECTION as _COL_RESUMES,
    MONGODB_SESSION_COLLECTION as _COL_SESSIONS,
    MONGODB_TRANSCRIPT_COLLECTION as _COL_TRANSCRIPTS,
    SARVAM_LLM_MODEL as _MODEL,
)
from lib.mongo import ensure_user_record, get_collection, strip_mongo_id
from lib.sarvam_client import SarvamAPIError, SarvamRateLimitError, get_sarvam_client

logger = logging.getLogger(__name__)

FEEDBACK_PROMPT = """
You are a rigorous, unbiased interview coach and senior hiring manager.
Generate honest, transcript-grounded interview feedback and return ONLY valid JSON.

Session metadata:
{session_meta}

Resume context:
{resume_context}

Transcript:
{transcript}

Posture data:
{posture_data}

Optional web context (may be stale; use only if relevant):
{web_context}

Return this schema exactly:
{{
  "overall_score": <0-100>,
  "dimension_scores": {{
    "communication": <0-100>,
    "confidence": <0-100>,
    "structure": <0-100>,
    "technical_depth": <0-100>,
    "domain_vocabulary": <0-100>{posture_dimension_schema}
  }},
  "strengths": ["<specific strength>", "..."],
  "improvement_areas": ["<specific improvement>", "..."],
  "filler_words": {{"total_count": <int>, "words": [{{"word": "<string>", "count": <int>}}]}},
  "vocabulary_calibration": "<string>",
  "tone_analysis": "<string>",
  "technical_depth_analysis": "<string>",{posture_summary_schema}
  "decision": "offer" | "rejection",
  "decision_reason": "<string>",
  "decision_letter": "<string>"
}}
"""


class FeedbackCompilerAgent:
    def __init__(self) -> None:
        self._sarvam_client = get_sarvam_client()
        self._sessions = get_collection(_COL_SESSIONS)
        self._transcripts = get_collection(_COL_TRANSCRIPTS)
        self._resumes = get_collection(_COL_RESUMES)
        self._feedback = get_collection(_COL_FEEDBACK)
        self._posture = get_collection(_COL_POSTURE)

    async def compile(self, session_id: str) -> dict[str, Any]:
        session = await self._fetch_session(session_id)
        transcript_turns = await self._fetch_transcript(session_id)
        posture_avg = await self._aggregate_posture(session_id)
        resume_data = await self._fetch_resume(session.get("user_id"))
        report = await self._generate_report(
            session,
            transcript_turns,
            posture_avg,
            resume_data,
        )
        report = self._postprocess_report(report, session, posture_avg)
        report["session_id"] = session_id
        report["compiled_at"] = datetime.now(timezone.utc).isoformat()
        await self._persist(session_id, report, session)
        return report

    async def _fetch_session(self, session_id: str) -> dict[str, Any]:
        document = await self._sessions.find_one({"_id": session_id})
        if not document:
            raise ValueError(f"Session '{session_id}' not found.")
        return strip_mongo_id(document)

    async def _fetch_transcript(self, session_id: str) -> list[dict[str, Any]]:
        document = await self._transcripts.find_one({"_id": session_id})
        if not document:
            logger.warning("No transcript found for session '%s'", session_id)
            return []
        return strip_mongo_id(document).get("turns", [])

    async def _fetch_resume(self, user_id: str | None) -> dict[str, Any] | None:
        if not user_id:
            return None
        document = await self._resumes.find_one({"_id": user_id})
        return strip_mongo_id(document) if document else None

    async def _aggregate_posture(self, session_id: str) -> dict[str, Any]:
        document = await self._posture.find_one({"_id": session_id})
        frames = strip_mongo_id(document).get("frames", []) if document else []
        score_lists: dict[str, list[float]] = {
            "posture_score": [],
            "eye_contact_score": [],
            "facial_confidence_score": [],
            "overall_presence_score": [],
        }
        observations: list[str] = []
        for frame in frames:
            for key in score_lists:
                if isinstance(frame.get(key), (int, float)):
                    score_lists[key].append(float(frame[key]))
            observations.extend(
                str(item).strip()
                for item in frame.get("observations", [])
                if str(item).strip()
            )
        return {
            **{
                key: (sum(values) / len(values) if values else 0)
                for key, values in score_lists.items()
            },
            "top_observations": list(dict.fromkeys(observations))[:5],
            "frames_analysed": len(frames),
        }

    async def _generate_report(
        self,
        session: dict[str, Any],
        transcript_turns: list[dict[str, Any]],
        posture_avg: dict[str, Any],
        resume_data: dict[str, Any] | None,
    ) -> dict[str, Any]:
        transcript_text, transcript_meta = self._build_feedback_transcript_text(transcript_turns)
        has_posture = posture_avg.get("frames_analysed", 0) > 0

        prompt = FEEDBACK_PROMPT.format(
            session_meta=json.dumps(
                {
                    "user_id": session.get("user_id"),
                    "persona": session.get("persona"),
                    "job_role": session.get("job_role"),
                    "difficulty": session.get("difficulty"),
                    "status": session.get("status"),
                    "created_at": session.get("created_at"),
                    "ended_at": session.get("ended_at"),
                    "transcript_meta": transcript_meta,
                },
                indent=2,
            ),
            resume_context=json.dumps(resume_data, indent=2) if resume_data else "(No parsed resume available)",
            transcript=transcript_text,
            posture_data=json.dumps(posture_avg, indent=2) if has_posture else "(No posture data captured)",
            web_context=str(session.get("web_context") or "").strip() or "(none)",
            posture_dimension_schema=',\n    "posture_presence": <0-100>' if has_posture else "",
            posture_summary_schema='\n  "posture_summary": "<string>",' if has_posture else "",
        )

        @retry(
            retry=retry_if_exception_type(SarvamRateLimitError),
            wait=wait_random_exponential(multiplier=1, max=60),
            stop=stop_after_attempt(5),
            before_sleep=before_sleep_log(logger, logging.WARNING),
            reraise=True,
        )
        async def _generate_with_retry() -> str:
            return await self._sarvam_client.generate_text(
                prompt=prompt,
                system_instruction="You are a rigorous interview coach. Return only valid JSON.",
                temperature=0.3,
                max_tokens=8192,
            )

        try:
            raw_text = await asyncio.wait_for(_generate_with_retry(), timeout=180)
        except asyncio.TimeoutError as exc:
            raise RuntimeError("Feedback generation timed out. Please try again.") from exc
        except Exception as exc:
            logger.error(
                "Feedback generation failed — session=%s  %s: %s\n%s",
                session.get("session_id", "?"),
                type(exc).__name__,
                exc,
                traceback.format_exc(),
            )
            return self._build_fallback_report(session, transcript_turns, posture_avg)

        try:
            return json.loads((raw_text or "").strip())
        except json.JSONDecodeError as exc:
            logger.error("Feedback response is not valid JSON: %s", (raw_text or "")[:600])
            return self._build_fallback_report(session, transcript_turns, posture_avg)

    def _build_fallback_report(
        self,
        session: dict[str, Any],
        transcript_turns: list[dict[str, Any]],
        posture_avg: dict[str, Any],
    ) -> dict[str, Any]:
        candidate_turns = [
            str(item.get("text") or "").strip()
            for item in transcript_turns
            if str(item.get("speaker") or "").strip().lower() == "user"
        ]
        valid_turns = [t for t in candidate_turns if t]
        turn_count = len(valid_turns)

        if turn_count == 0:
            base_score = 0
        elif turn_count < 3:
            base_score = 35
        elif turn_count < 8:
            base_score = 55
        else:
            base_score = 68

        has_posture = int(posture_avg.get("frames_analysed", 0) or 0) > 0
        posture_presence = int(round(float(posture_avg.get("overall_presence_score", 0) or 0))) if has_posture else 0
        overall = max(0, min(100, int(round((base_score * 0.85) + (posture_presence * 0.15 if has_posture else 0)))))

        dimension_scores: dict[str, int] = {
            "communication": overall,
            "confidence": max(0, min(100, overall - 3)),
            "structure": max(0, min(100, overall - 5)),
            "technical_depth": max(0, min(100, overall - 2)),
            "domain_vocabulary": max(0, min(100, overall - 4)),
        }
        if has_posture:
            dimension_scores["posture_presence"] = max(0, min(100, posture_presence))

        return {
            "overall_score": overall,
            "dimension_scores": dimension_scores,
            "strengths": [
                "Consistent participation throughout the interview.",
                "Responses stayed aligned with the interviewer prompts.",
            ],
            "improvement_areas": [
                "Add more concrete examples with metrics and outcomes.",
                "Use a clearer answer structure (context, action, result).",
            ],
            "filler_words": {"total_count": 0, "words": []},
            "vocabulary_calibration": "Fallback mode: detailed vocabulary calibration unavailable without LLM access.",
            "tone_analysis": "Fallback mode: tone analysis unavailable without LLM access.",
            "technical_depth_analysis": "Fallback mode: technical depth analysis unavailable without LLM access.",
            "posture_summary": "Fallback mode: posture summary unavailable." if has_posture else "",
            "decision": "offer" if overall >= self._decision_threshold(str(session.get("job_role") or "Software Engineer"), str(session.get("difficulty") or "medium").strip().lower()) else "rejection",
            "decision_reason": "Generated in fallback mode because text generation endpoint is unavailable.",
            "decision_letter": "Thanks for completing the mock interview. This report was generated in fallback mode due to temporary LLM endpoint unavailability.",
        }

    def _is_low_signal_candidate_turn(self, text: str) -> bool:
        cleaned = " ".join(text.lower().split())
        if not cleaned:
            return True
        if len(cleaned) <= 2:
            return True
        tokens = cleaned.split()
        if len(tokens) == 1 and tokens[0] in {"uh", "um", "hmm", "ok", "okay", "yeah", "yes", "no"}:
            return True
        if len(set(tokens)) == 1 and len(tokens) <= 4:
            return True
        return False

    def _build_feedback_transcript_text(
        self,
        transcript_turns: list[dict[str, Any]],
    ) -> tuple[str, dict[str, int]]:
        if not transcript_turns:
            return (
                "(no transcript recorded — do not fabricate content; set all scores to 0)",
                {"kept_turns": 0, "kept_candidate_turns": 0, "dropped_low_signal_candidate_turns": 0},
            )

        lines: list[str] = []
        kept_candidate = 0
        dropped_low_signal = 0
        for entry in transcript_turns:
            speaker = str(entry.get("speaker", "")).strip().lower()
            text = str(entry.get("text", "")).strip()
            if not text:
                continue
            if speaker == "user":
                if self._is_low_signal_candidate_turn(text):
                    dropped_low_signal += 1
                    continue
                lines.append(f"CANDIDATE: {text}")
                kept_candidate += 1
            else:
                lines.append(f"INTERVIEWER: {text}")

        if kept_candidate == 0:
            return (
                "(transcript had no reliable candidate content after noise filtering — set all scores to 0)",
                {"kept_turns": 0, "kept_candidate_turns": 0, "dropped_low_signal_candidate_turns": dropped_low_signal},
            )

        return (
            "\n".join(lines),
            {
                "kept_turns": len(lines),
                "kept_candidate_turns": kept_candidate,
                "dropped_low_signal_candidate_turns": dropped_low_signal,
            },
        )

    def _postprocess_report(
        self,
        report: dict[str, Any],
        session: dict[str, Any],
        posture_avg: dict[str, Any],
    ) -> dict[str, Any]:
        report = dict(report or {})
        overall = self._safe_score(report.get("overall_score"))
        role = str(session.get("job_role") or "Software Engineer")
        difficulty = str(session.get("difficulty") or "medium").strip().lower()
        threshold = self._decision_threshold(role, difficulty)
        decision = "offer" if overall >= threshold else "rejection"

        reason = self._build_decision_reason(
            decision=decision,
            overall=overall,
            threshold=threshold,
            role=role,
            difficulty=difficulty,
            strengths=report.get("strengths", []),
            improvements=report.get("improvement_areas", []),
        )

        report["overall_score"] = overall
        report["decision"] = decision
        report["decision_reason"] = reason
        report["posture_data_used"] = posture_avg.get("frames_analysed", 0) > 0
        report["posture_frames_analysed"] = int(posture_avg.get("frames_analysed", 0) or 0)

        if not str(report.get("decision_letter") or "").strip():
            report["decision_letter"] = self._compose_decision_letter(
                decision=decision,
                role=role,
                reason=reason,
                strengths=report.get("strengths", []),
                improvements=report.get("improvement_areas", []),
            )
        return report

    @staticmethod
    def _safe_score(value: Any) -> int:
        try:
            score = int(round(float(value)))
        except Exception:
            score = 0
        return max(0, min(100, score))

    @staticmethod
    def _role_level(job_role: str) -> int:
        role = job_role.lower()
        if any(k in role for k in ("intern", "trainee", "apprentice", "co-op", "coop")):
            return 0
        if any(k in role for k in ("junior", "entry", "graduate", "fresher", "associate i", "analyst i")):
            return 1
        if any(k in role for k in ("staff", "principal", "architect", "distinguished", "chief", "cto", "cfo", "ceo", "coo", "cmo", "cio", "cpo")):
            return 4
        if any(k in role for k in ("senior", "sr.", "lead", "manager", "director", "vp", "vice president", "head of")):
            return 3
        return 2

    def _decision_threshold(self, job_role: str, difficulty: str) -> int:
        base = 75
        role_offsets = {0: -10, 1: -7, 2: -3, 3: 0, 4: 3}
        difficulty_offsets = {"easy": -5, "medium": 0, "hard": -3}
        threshold = base + role_offsets.get(self._role_level(job_role), 0) + difficulty_offsets.get(difficulty, 0)
        return max(58, min(82, threshold))

    def _build_decision_reason(
        self,
        decision: str,
        overall: int,
        threshold: int,
        role: str,
        difficulty: str,
        strengths: Any,
        improvements: Any,
    ) -> str:
        strengths_list = [str(item).strip() for item in (strengths or []) if str(item).strip()]
        improvements_list = [str(item).strip() for item in (improvements or []) if str(item).strip()]
        top_strength = strengths_list[0] if strengths_list else "some relevant fundamentals"
        top_gap = improvements_list[0] if improvements_list else "more depth and specificity in responses"
        if decision == "offer":
            return (
                f"This session cleared the bar for a {role} interview on {difficulty} difficulty. "
                f"The score was {overall} against a threshold of {threshold}, with {top_strength.lower()} standing out most. "
                f"The main next-step improvement is {top_gap.lower()}."
            )
        return (
            f"This session did not clear the bar for a {role} interview on {difficulty} difficulty. "
            f"The score was {overall} against a threshold of {threshold}, and {top_gap.lower()} was the biggest gap. "
            f"A clear positive to build on is {top_strength.lower()}."
        )

    def _compose_decision_letter(
        self,
        decision: str,
        role: str,
        reason: str,
        strengths: Any,
        improvements: Any,
    ) -> str:
        strengths_list = [str(item).strip() for item in (strengths or []) if str(item).strip()]
        improvements_list = [str(item).strip() for item in (improvements or []) if str(item).strip()]
        if decision == "offer":
            body = (
                f"Dear Candidate,\n\n"
                f"Thank you for interviewing for the {role} position. "
                f"We're pleased to extend an offer based on this session.\n\n"
                f"{reason}\n\n"
            )
            if strengths_list:
                body += f"Highlights: {', '.join(strengths_list[:3])}.\n\n"
            if improvements_list:
                body += f"Growth edge to keep sharpening: {improvements_list[0]}.\n\n"
            body += "Sincerely,\nThe MockMate Hiring Committee"
            return body

        body = (
            f"Dear Candidate,\n\n"
            f"Thank you for interviewing for the {role} position. "
            f"After review, we are not moving forward with an offer at this time.\n\n"
            f"{reason}\n\n"
        )
        if improvements_list:
            body += f"The biggest improvement area is {improvements_list[0]}.\n\n"
        if strengths_list:
            body += f"A strength that still came through clearly was {strengths_list[0]}.\n\n"
        body += "Sincerely,\nThe MockMate Hiring Committee"
        return body

    async def _persist(
        self,
        session_id: str,
        report: dict[str, Any],
        session: dict[str, Any],
    ) -> None:
        await self._feedback.replace_one({"_id": session_id}, {"_id": session_id, **report}, upsert=True)
        await self._sessions.update_one(
            {"_id": session_id},
            {
                "$set": {
                    "overall_score": report.get("overall_score"),
                    "dimension_scores": report.get("dimension_scores"),
                    "feedback_ready": True,
                    "decision": report.get("decision"),
                    "decision_reason": report.get("decision_reason"),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
            },
        )
        if session.get("user_id"):
            await ensure_user_record(
                str(session["user_id"]),
                last_feedback_session_id=session_id,
                last_feedback_at=report.get("compiled_at"),
            )

    async def get_feedback(self, session_id: str) -> dict[str, Any] | None:
        document = await self._feedback.find_one({"_id": session_id})
        return strip_mongo_id(document) if document else None
