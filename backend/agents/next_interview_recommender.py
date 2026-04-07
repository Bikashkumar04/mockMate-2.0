"""
NextInterviewRecommenderAgent
-----------------------------
Builds a short dashboard recommendation from recent feedback-ready sessions
stored in MongoDB.
"""

from __future__ import annotations

import json
import logging
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
    MONGODB_SESSION_COLLECTION as _COL_SESSIONS,
    SARVAM_LLM_MODEL as _MODEL,
)
from lib.mongo import get_collection, strip_mongo_id
from lib.sarvam_client import SarvamAPIError, SarvamRateLimitError, get_sarvam_client

logger = logging.getLogger(__name__)

_DIM_KEYS = [
    "communication",
    "confidence",
    "structure",
    "technical_depth",
    "domain_vocabulary",
    "posture_presence",
]

_VALID_PERSONAS = {
    "neutral",
    "startup_founder",
    "investment_banker",
    "tech_lead",
    "hr_manager",
    "product_manager",
    "vp_engineering",
    "management_consultant",
    "cto",
    "recruiter",
    "algorithm_guru",
    "system_designer",
    "prompt_wizard",
}

_TECH_PERSONAS = {
    "tech_lead",
    "cto",
    "algorithm_guru",
    "system_designer",
    "prompt_wizard",
    "vp_engineering",
    "startup_founder",
    "neutral",
}

_PERSONA_BY_FOCUS = {
    "technical_depth": "cto",
    "domain_vocabulary": "tech_lead",
    "structure": "management_consultant",
    "communication": "hr_manager",
    "confidence": "startup_founder",
    "posture_presence": "recruiter",
}

_PROMPT = """\
You are MockMate's recommendation engine.
Given the user's recent mock interview summary, return concise UI-ready JSON.

Rules:
- Return JSON only.
- Be specific and data-grounded.
- Avoid recommending a recently repeated persona + role combination.

Input:
{input_json}

Schema:
{{
  "headline": "<short title>",
  "insight": "<one sentence with numbers>",
  "practice_focus": "<specific focus area>",
  "recommended_persona": "<persona key>",
  "recommended_job_role": "<job role>",
  "cta": "<short call to action>"
}}
"""


class NextInterviewRecommenderAgent:
    def __init__(self) -> None:
        self._sarvam_client = get_sarvam_client()
        self._sessions = get_collection(_COL_SESSIONS)
        self._feedback = get_collection(_COL_FEEDBACK)

    async def recommend(self, user_id: str, lookback: int = 5) -> dict[str, Any] | None:
        sessions = await self._fetch_recent_feedback_ready_sessions(user_id, max(3, lookback))
        if len(sessions) < 3:
            return None

        scored_sessions: list[dict[str, Any]] = []
        for session in sessions:
            feedback_doc = await self._feedback.find_one({"_id": session["session_id"]})
            if not feedback_doc:
                continue
            feedback = strip_mongo_id(feedback_doc)
            scored_sessions.append(
                {
                    "session_id": session["session_id"],
                    "created_at": session.get("created_at"),
                    "job_role": session.get("job_role"),
                    "persona": session.get("persona"),
                    "overall_score": session.get("overall_score"),
                    "dimension_scores": feedback.get("dimension_scores", {}),
                }
            )

        if len(scored_sessions) < 3:
            return None

        summary = self._build_summary(scored_sessions)
        try:
            payload = await self._call_sarvam(summary)
        except Exception as exc:
            logger.warning("Next interview recommendation fallback used: %s", exc)
            payload = self._fallback(summary)
        return {
            "user_id": user_id,
            "sessions_analyzed": len(scored_sessions),
            **payload,
        }

    async def _fetch_recent_feedback_ready_sessions(
        self,
        user_id: str,
        lookback: int,
    ) -> list[dict[str, Any]]:
        cursor = self._sessions.find(
            {
                "user_id": user_id,
                "feedback_ready": True,
                "overall_score": {"$ne": None},
            }
        )
        rows = [strip_mongo_id(doc) async for doc in cursor]
        rows.sort(
            key=lambda item: item.get("last_retried_at") or item.get("created_at") or "",
            reverse=True,
        )
        return rows[:lookback]

    @staticmethod
    def _is_technical_role(job_role: str | None) -> bool:
        role = (job_role or "").lower()
        keywords = (
            "software engineer",
            "sde",
            "developer",
            "backend",
            "frontend",
            "front end",
            "full stack",
            "devops",
            "site reliability",
            "data engineer",
            "machine learning",
            "ai engineer",
            "architect",
            "security engineer",
        )
        return any(keyword in role for keyword in keywords)

    def _allowed_personas_for_role(self, job_role: str | None) -> set[str]:
        return _TECH_PERSONAS if self._is_technical_role(job_role) else _VALID_PERSONAS

    def _rule_persona_for(self, weakest_dimension: str | None, job_role: str | None) -> str:
        fallback = _PERSONA_BY_FOCUS.get(weakest_dimension or "", "neutral")
        if fallback in self._allowed_personas_for_role(job_role):
            return fallback
        return "tech_lead" if self._is_technical_role(job_role) else "neutral"

    def _normalize_persona(self, persona: str | None, job_role: str | None, fallback: str) -> str:
        candidate = (persona or "").strip()
        if candidate not in _VALID_PERSONAS:
            return fallback
        if candidate not in self._allowed_personas_for_role(job_role):
            return fallback
        return candidate

    def _build_summary(self, sessions: list[dict[str, Any]]) -> dict[str, Any]:
        ordered = list(reversed(sessions))
        overall_series = [float(item["overall_score"]) for item in ordered if isinstance(item.get("overall_score"), (int, float))]

        trends: dict[str, Any] = {}
        for key in _DIM_KEYS:
            series = [
                float((item.get("dimension_scores") or {}).get(key))
                for item in ordered
                if isinstance((item.get("dimension_scores") or {}).get(key), (int, float))
            ]
            if len(series) >= 2:
                trends[key] = {
                    "first": round(series[0], 1),
                    "last": round(series[-1], 1),
                    "delta": round(series[-1] - series[0], 1),
                    "avg": round(sum(series) / len(series), 1),
                }

        weakest_key = None
        weakest_avg = None
        for key, trend in trends.items():
            avg = trend.get("avg")
            if weakest_avg is None or avg < weakest_avg:
                weakest_avg = avg
                weakest_key = key

        suggested_job_role = ordered[-1].get("job_role") if ordered else "Software Engineer"
        suggested_persona = self._rule_persona_for(weakest_key, suggested_job_role)
        return {
            "recent_sessions": [
                {
                    "session_id": item.get("session_id"),
                    "job_role": item.get("job_role"),
                    "persona": item.get("persona"),
                    "overall_score": item.get("overall_score"),
                }
                for item in ordered
            ],
            "completed_combos": list({
                f"{item.get('persona', 'unknown')} + {item.get('job_role', 'unknown')}"
                for item in ordered
            }),
            "overall_score_trend": {
                "first": overall_series[0] if overall_series else None,
                "last": overall_series[-1] if overall_series else None,
                "delta": round(overall_series[-1] - overall_series[0], 1) if len(overall_series) >= 2 else None,
                "avg": round(sum(overall_series) / len(overall_series), 1) if overall_series else None,
            },
            "dimension_trends": trends,
            "weakest_dimension": weakest_key,
            "suggested_persona_from_rule": suggested_persona,
            "suggested_job_role_from_rule": suggested_job_role,
        }

    @retry(
        retry=retry_if_exception_type((SarvamRateLimitError, SarvamAPIError)),
        wait=wait_random_exponential(multiplier=1, max=30),
        stop=stop_after_attempt(4),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True,
    )
    async def _call_sarvam(self, summary: dict[str, Any]) -> dict[str, Any]:
        raw_text = await self._sarvam_client.generate_text(
            prompt=_PROMPT.format(input_json=json.dumps(summary, indent=2)),
            system_instruction="You are MockMate's recommendation engine. Return only valid JSON.",
            temperature=0.4,
            max_tokens=800,
        )
        payload = json.loads((raw_text or "{}").strip())
        recommended_job_role = str(payload.get("recommended_job_role") or summary.get("suggested_job_role_from_rule") or "Software Engineer")
        fallback_persona = str(summary.get("suggested_persona_from_rule") or "neutral")
        normalized_persona = self._normalize_persona(
            str(payload.get("recommended_persona") or ""),
            recommended_job_role,
            fallback_persona,
        )
        return {
            "headline": str(payload.get("headline") or "Your Next Interview"),
            "insight": str(payload.get("insight") or "Let's keep improving your consistency."),
            "practice_focus": str(payload.get("practice_focus") or "Practice your weakest recent dimension."),
            "recommended_persona": normalized_persona,
            "recommended_job_role": recommended_job_role,
            "cta": str(payload.get("cta") or "Run a focused practice session now."),
        }

    def _fallback(self, summary: dict[str, Any]) -> dict[str, Any]:
        weak = summary.get("weakest_dimension") or "technical_depth"
        dim = weak.replace("_", " ")
        trend = (summary.get("dimension_trends") or {}).get(weak, {})
        delta = trend.get("delta", 0)
        magnitude = abs(float(delta)) if isinstance(delta, (int, float)) else 0.0
        direction = "dropped" if isinstance(delta, (int, float)) and delta < 0 else "is flat"
        persona = summary.get("suggested_persona_from_rule") or "neutral"
        job_role = summary.get("suggested_job_role_from_rule") or "Software Engineer"
        return {
            "headline": "Your Next Interview",
            "insight": f"Your {dim} {direction} by {round(magnitude, 1)} points across recent sessions.",
            "practice_focus": f"Focus on improving {dim} with concrete, role-specific examples.",
            "recommended_persona": persona,
            "recommended_job_role": job_role,
            "cta": f"Try a {persona.replace('_', ' ')} interview for {job_role} next.",
        }
