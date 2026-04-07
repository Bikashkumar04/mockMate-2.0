"""
QuestionGeneratorAgent
----------------------
Generates personalized interview questions using Sarvam AI and resume data
stored in MongoDB.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from tenacity import (
    before_sleep_log,
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_random_exponential,
)

from agents.config import (
    MONGODB_RESUME_COLLECTION as _COLLECTION_RESUMES,
    MONGODB_SESSION_COLLECTION as _COLLECTION_SESSIONS,
    SARVAM_LLM_MODEL as _MODEL,
)
from lib.mongo import get_collection, strip_mongo_id
from lib.sarvam_client import SarvamAPIError, SarvamRateLimitError, get_sarvam_client

logger = logging.getLogger(__name__)

PERSONA_DESCRIPTIONS: dict[str, str] = {
    "neutral": "A professional, balanced interviewer who is thorough but fair.",
    "startup_founder": "An energetic startup founder focused on ownership and speed.",
    "investment_banker": "A high-pressure interviewer who values precision and structured thinking.",
    "tech_lead": "A senior engineering lead focused on technical depth and trade-offs.",
    "hr_manager": "An HR manager focused on collaboration, communication, and behavior.",
    "product_manager": "A product interviewer focused on prioritization and decision making.",
    "vp_engineering": "A VP of Engineering focused on leadership and architectural judgment.",
    "management_consultant": "A consultant who expects structured reasoning and quantitative thinking.",
    "cto": "A CTO focused on technology strategy and architecture.",
    "recruiter": "A recruiter focused on narrative, motivations, and soft skills.",
    "algorithm_guru": "An algorithms specialist focused on complexity and problem solving.",
    "system_designer": "A system design interviewer focused on scalability and reliability.",
    "prompt_wizard": "An AI interviewer focused on prompt engineering and production AI systems.",
}

_VALID_DIFFICULTIES = {"easy", "medium", "hard"}

_PERSONA_QUESTION_POLICY: dict[str, str] = {
    "neutral": "Use a balanced mix of behavioral, technical, situational, and curveball questions.",
    "startup_founder": "Prioritize ownership, execution, ambiguity, and bias-to-action.",
    "investment_banker": "Prioritize numbers, structure, composure, and measurable outcomes.",
    "tech_lead": "Prioritize technical depth, debugging, trade-offs, and architecture.",
    "hr_manager": "Ask only behavioral and situational questions.",
    "product_manager": "Prioritize prioritization, metrics, user empathy, and stakeholder management.",
    "vp_engineering": "Prioritize leadership, architecture at scale, and engineering management.",
    "management_consultant": "Prioritize case-like questions, structure, and quantitative reasoning.",
    "cto": "Mix technical strategy and leadership questions.",
    "recruiter": "Ask only behavioral and situational questions focused on narrative and fit.",
    "algorithm_guru": "Prioritize algorithmic problem solving and complexity trade-offs.",
    "system_designer": "Prioritize distributed systems, reliability, and scale.",
    "prompt_wizard": "Prioritize AI/ML fundamentals, prompting, evaluation, and safety.",
}

GENERATION_PROMPT = """\
You are an expert interview coach designing a mock interview question set.
Return ONLY a valid JSON array with exactly 6 questions.

Candidate resume data:
{resume_json}

Interviewer persona: {persona_name}
Persona description: {persona_desc}
Question policy: {question_type_policy}
Target job role: {job_role}
Difficulty: {difficulty}

Each question object must have:
{{
  "id": <1-based integer>,
  "type": "behavioural" | "technical" | "situational" | "curveball",
  "question": "<question text>",
  "intent": "<why this is being asked>",
  "follow_ups": ["<follow-up 1>", "<follow-up 2>"]
}}

Rules:
- The majority of questions must be role-specific.
- Use resume evidence when relevant, but do not force irrelevant details.
- Escalate difficulty from question 1 to 6.
- Keep wording natural and persona-appropriate.
- Return JSON only.
"""


class QuestionGeneratorAgent:
    def __init__(self) -> None:
        self._sarvam_client = get_sarvam_client()
        self._resumes = get_collection(_COLLECTION_RESUMES)
        self._sessions = get_collection(_COLLECTION_SESSIONS)

    async def generate(
        self,
        user_id: str,
        persona: str,
        job_role: str,
        difficulty: str,
        session_id: str | None = None,
        web_context: str | None = None,
    ) -> list[dict[str, Any]]:
        self._validate_inputs(persona, difficulty, job_role)
        resume_data = await self._fetch_resume(user_id)
        return await self._call_sarvam(resume_data, persona, job_role, difficulty, web_context=web_context)

    async def get_questions(self, session_id: str) -> list[dict[str, Any]] | None:
        document = await self._sessions.find_one({"_id": session_id})
        if not document:
            return None
        return strip_mongo_id(document).get("questions")

    async def get_question(self, session_id: str, question_id: int) -> dict[str, Any] | None:
        questions = await self.get_questions(session_id)
        if questions is None:
            return None
        for question in questions:
            if question.get("id") == question_id:
                return question
        return None

    @staticmethod
    def _validate_inputs(persona: str, difficulty: str, job_role: str) -> None:
        if persona not in PERSONA_DESCRIPTIONS:
            raise ValueError(f"Unknown persona '{persona}'.")
        if difficulty not in _VALID_DIFFICULTIES:
            raise ValueError(f"Invalid difficulty '{difficulty}'.")
        if not job_role or not job_role.strip():
            raise ValueError("job_role must not be empty.")

    async def _fetch_resume(self, user_id: str) -> dict[str, Any]:
        document = await self._resumes.find_one({"_id": user_id})
        if not document:
            raise ValueError(
                f"No resume found for user '{user_id}'. "
                "Please upload and parse a resume before starting an interview."
            )
        return strip_mongo_id(document)

    async def _call_sarvam(
        self,
        resume_data: dict[str, Any],
        persona: str,
        job_role: str,
        difficulty: str,
        web_context: str | None = None,
    ) -> list[dict[str, Any]]:
        prompt = GENERATION_PROMPT.format(
            resume_json=json.dumps(resume_data, indent=2),
            persona_name=persona,
            persona_desc=PERSONA_DESCRIPTIONS[persona],
            question_type_policy=_PERSONA_QUESTION_POLICY.get(persona, _PERSONA_QUESTION_POLICY["neutral"]),
            job_role=job_role,
            difficulty=difficulty,
        )
        if web_context and web_context.strip():
            prompt = f"{prompt}\n\nOptional web context (may be stale; use only if relevant):\n{web_context.strip()}\n"

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
                system_instruction="You generate interview questions. Return only valid JSON.",
                temperature=0.3,
                max_tokens=4096,
            )

        try:
            raw_text = (await _generate_with_retry()).strip()
            raw_text = re.sub(r"^```(?:json)?\s*", "", raw_text)
            raw_text = re.sub(r"\s*```$", "", raw_text)
            questions = json.loads(raw_text)
            if not isinstance(questions, list):
                raise ValueError(f"Expected a JSON array, got {type(questions).__name__}.")
            return self._normalize_questions(questions)
        except Exception as exc:
            logger.warning(
                "Falling back to local question generation for role '%s' persona '%s': %s",
                job_role,
                persona,
                exc,
            )
            return self._build_fallback_questions(resume_data, persona, job_role, difficulty)

    def _build_fallback_questions(
        self,
        resume_data: dict[str, Any],
        persona: str,
        job_role: str,
        difficulty: str,
    ) -> list[dict[str, Any]]:
        persona_label = PERSONA_DESCRIPTIONS.get(persona, PERSONA_DESCRIPTIONS["neutral"])
        skills = [str(item).strip() for item in (resume_data.get("skills") or []) if str(item).strip()]
        experience = resume_data.get("experience") or []
        latest_exp = experience[0] if isinstance(experience, list) and experience else {}
        latest_title = str(latest_exp.get("title") or job_role).strip() or job_role
        latest_company = str(latest_exp.get("company") or "your recent team").strip()
        top_skill = skills[0] if skills else "one of your strongest skills"
        second_skill = skills[1] if len(skills) > 1 else top_skill

        difficulty_suffix = {
            "easy": "Keep the example focused and practical.",
            "medium": "Be specific about trade-offs, constraints, and measurable outcomes.",
            "hard": "Go deep on trade-offs, edge cases, and what you would do differently under pressure.",
        }[difficulty]

        templates: list[dict[str, Any]] = [
            {
                "type": "behavioural",
                "question": f"You've worked as {latest_title} at {latest_company}. Walk me through one project that best prepares you for a {job_role} role. {difficulty_suffix}",
                "intent": "Assess relevance of past experience and clarity of storytelling.",
                "follow_ups": [
                    "What was the toughest constraint and how did you handle it?",
                    "What measurable result came out of that work?",
                ],
            },
            {
                "type": "technical",
                "question": f"Your resume highlights {top_skill}. Explain how you would apply it in a real {job_role} interview scenario.",
                "intent": "Test technical depth and ability to connect skills to the target role.",
                "follow_ups": [
                    "What trade-offs would you consider first?",
                    "How would you validate that your approach is correct?",
                ],
            },
            {
                "type": "situational",
                "question": f"Imagine you're starting a new {job_role} project and discover midway that the initial assumptions were wrong. How would you reset expectations and execution?",
                "intent": "Evaluate structured problem solving and stakeholder communication.",
                "follow_ups": [
                    "How would you prioritize what to fix first?",
                    "How would you communicate the risk to stakeholders?",
                ],
            },
            {
                "type": "technical",
                "question": f"Compare {top_skill} with {second_skill} in a situation where both could solve the same problem. Which would you choose and why?",
                "intent": "Assess trade-off reasoning and practical engineering judgment.",
                "follow_ups": [
                    "What would make you reverse that decision later?",
                    "What failure mode would you monitor most closely?",
                ],
            },
            {
                "type": "behavioural",
                "question": f"As a {persona_label.lower()}, I care about how you handle pressure. Tell me about a time you had to defend a decision that others disagreed with.",
                "intent": "Measure confidence, communication, and ownership under pressure.",
                "follow_ups": [
                    "How did you know your position was the right one?",
                    "What did you learn from the pushback?",
                ],
            },
            {
                "type": "curveball",
                "question": f"If you joined tomorrow as a {job_role}, what is the first thing you would audit or improve in the team, and how would you avoid making the wrong call too early?",
                "intent": "Evaluate judgment, prioritization, and strategic thinking.",
                "follow_ups": [
                    "What signal would convince you that your first instinct was wrong?",
                    "How would you balance speed with credibility in the first 30 days?",
                ],
            },
        ]
        return self._normalize_questions(
            [{**item, "id": idx} for idx, item in enumerate(templates, start=1)]
        )

    @staticmethod
    def _normalize_questions(questions: list[Any]) -> list[dict[str, Any]]:
        normalized: list[dict[str, Any]] = []
        for index, raw in enumerate(questions[:6], start=1):
            if not isinstance(raw, dict):
                continue
            question_text = str(raw.get("question") or "").strip()
            if not question_text:
                continue
            question_type = str(raw.get("type") or "behavioural").strip().lower()
            if question_type not in {"behavioural", "technical", "situational", "curveball"}:
                question_type = "behavioural"
            intent = str(raw.get("intent") or "Assess role fit.").strip()
            follow_ups = [
                str(item).strip()
                for item in (raw.get("follow_ups") or [])
                if str(item).strip()
            ][:2]
            while len(follow_ups) < 2:
                follow_ups.append(
                    "Can you share one concrete example from your experience?"
                    if len(follow_ups) == 0
                    else "What was the measurable outcome of that decision?"
                )
            normalized.append(
                {
                    "id": index,
                    "type": question_type,
                    "question": question_text,
                    "intent": intent,
                    "follow_ups": follow_ups,
                }
            )

        if len(normalized) < 6:
            raise ValueError(
                f"Question generator returned only {len(normalized)} usable questions; expected 6."
            )
        return normalized
