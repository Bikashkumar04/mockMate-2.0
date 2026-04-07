"""
InterviewEngineAgent
--------------------
Manages interview sessions with MongoDB persistence and a Sarvam-backed live
loop. The websocket contract remains compatible with the frontend:
  - sends `session_meta`, `input_transcription`, `output_transcription`,
    `control`, `ping`, and binary interviewer audio
  - stores sessions, transcripts, and analytics in MongoDB
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import math
import pathlib
import random
import wave
from datetime import datetime, timezone
from typing import Any, TYPE_CHECKING

from fastapi import WebSocket, WebSocketDisconnect

from agents.config import (
    MONGODB_FEEDBACK_COLLECTION as _FEEDBACK_COLLECTION,
    MONGODB_RESUME_COLLECTION as _RESUME_COLLECTION,
    MONGODB_SESSION_COLLECTION as _SESSION_COLLECTION,
    MONGODB_TRANSCRIPT_COLLECTION as _TRANSCRIPT_COLLECTION,
)
from lib.mongo import ensure_user_record, get_collection, strip_mongo_id
from lib.sarvam_client import SarvamAPIError, SarvamRateLimitError, get_sarvam_client

if TYPE_CHECKING:
    from agents.posture_analyzer import PostureAnalyzerAgent

logger = logging.getLogger(__name__)

_PERSONAS_JSON = pathlib.Path(__file__).with_name("personas.json")
_TRANSCRIPTION_LANGUAGE = "en-IN"
_DEFAULT_TTS_VOICE = "en-IN-default"
_HEARTBEAT_INTERVAL = 20
_SILENCE_MS = 900
_MIN_SPEECH_MS = 500
_MAX_UTTERANCE_MS = 18_000
_RMS_THRESHOLD = 180
_POSTURE_MIN_INTERVAL_MS = 30_000


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_personas() -> dict[str, Any]:
    with _PERSONAS_JSON.open(encoding="utf-8") as handle:
        return json.load(handle)["personas"]


_PERSONAS = _load_personas()

PERSONA_INTERVIEWER_PROFILES: dict[str, list[dict[str, str]]] = {
    key: value["interviewer_profiles"]
    for key, value in _PERSONAS.items()
}
PERSONA_PERSONALITY_GUIDANCE: dict[str, str] = {
    key: value["personality_guidance"]
    for key, value in _PERSONAS.items()
}
PERSONA_CONVERSATION_GUIDANCE: dict[str, str] = {
    key: value["conversation_guidance"]
    for key, value in _PERSONAS.items()
}

_DEFAULT_INTERVIEWER_PROFILE = {
    "name": "Alex",
    "voice": _DEFAULT_TTS_VOICE,
    "accent_hint": "Indian English",
}


def _normalize_wav_or_pcm(audio_bytes: bytes) -> bytes:
    if audio_bytes[:4] != b"RIFF":
        return audio_bytes
    with wave.open(io.BytesIO(audio_bytes), "rb") as wav_file:
        return wav_file.readframes(wav_file.getnframes())


def _duration_ms_for_pcm(chunk: bytes, sample_rate: int = 16000) -> int:
    if not chunk:
        return 0
    return int((len(chunk) / 2 / sample_rate) * 1000)


def _rms_for_pcm16le(chunk: bytes) -> int:
    """Compute RMS for 16-bit little-endian PCM without audioop."""
    if not chunk:
        return 0

    usable_len = len(chunk) - (len(chunk) % 2)
    if usable_len <= 0:
        return 0

    sample_count = usable_len // 2
    sum_squares = 0
    for idx in range(0, usable_len, 2):
        sample = int.from_bytes(chunk[idx:idx + 2], byteorder="little", signed=True)
        sum_squares += sample * sample

    return math.isqrt(sum_squares // sample_count)


def _next_prompt_from_state(
    session: dict[str, Any],
) -> tuple[str | None, dict[str, Any]]:
    state = dict(session.get("interview_state") or {})
    questions = list(session.get("questions") or [])
    index = int(state.get("question_index", 0) or 0)
    follow_up_index = int(state.get("follow_up_index", -1) or -1)

    if index >= len(questions):
        return None, {"question_index": index, "follow_up_index": -1, "completed": True}

    current_question = questions[index]
    follow_ups = list(current_question.get("follow_ups") or [])

    if follow_up_index == -1:
        return str(current_question.get("question") or ""), {
            "question_index": index,
            "follow_up_index": 0 if follow_ups else -2,
            "completed": False,
        }

    if follow_up_index >= 0 and follow_up_index < len(follow_ups):
        return str(follow_ups[follow_up_index] or ""), {
            "question_index": index,
            "follow_up_index": follow_up_index + 1 if follow_up_index + 1 < len(follow_ups) else -2,
            "completed": False,
        }

    next_index = index + 1
    if next_index >= len(questions):
        return None, {"question_index": next_index, "follow_up_index": -1, "completed": True}

    next_question = questions[next_index]
    next_follow_ups = list(next_question.get("follow_ups") or [])
    return str(next_question.get("question") or ""), {
        "question_index": next_index,
        "follow_up_index": 0 if next_follow_ups else -2,
        "completed": False,
    }


class InterviewEngineAgent:
    def __init__(self) -> None:
        self._sarvam_client = get_sarvam_client()
        self._sessions = get_collection(_SESSION_COLLECTION)
        self._resumes = get_collection(_RESUME_COLLECTION)
        self._transcripts = get_collection(_TRANSCRIPT_COLLECTION)
        self._feedback = get_collection(_FEEDBACK_COLLECTION)

    async def _abandon_stale_sessions(self, user_id: str) -> None:
        await self._sessions.update_many(
            {"user_id": user_id, "status": {"$in": ["created", "active"]}},
            {
                "$set": {
                    "status": "abandoned",
                    "ended_at": _utc_now(),
                    "updated_at": _utc_now(),
                }
            },
        )

    async def create_session(
        self,
        user_id: str,
        questions: list[dict[str, Any]],
        persona: str,
        job_role: str = "Software Engineer",
        difficulty: str = "medium",
        web_context: str | None = None,
    ) -> dict[str, Any]:
        await self._abandon_stale_sessions(user_id)

        session_id = str(__import__("uuid").uuid4())
        profile = random.choice(PERSONA_INTERVIEWER_PROFILES.get(persona, [_DEFAULT_INTERVIEWER_PROFILE]))
        interviewer_name = profile.get("name", _DEFAULT_INTERVIEWER_PROFILE["name"])
        voice = profile.get("voice", _DEFAULT_TTS_VOICE)
        accent_hint = profile.get("accent_hint", "Indian English")
        interviewer_gender_hint = profile.get("gender_hint")

        candidate_name = "MockMate user"
        try:
            resume_doc = await self._resumes.find_one({"_id": user_id})
            if resume_doc:
                resume_data = strip_mongo_id(resume_doc)
                name_value = str(resume_data.get("name") or "").strip()
                if name_value:
                    candidate_name = name_value.split()[0]
        except Exception:
            logger.warning("Could not fetch candidate name for user %s", user_id)

        avatar_query = [f"persona={persona}"]
        if interviewer_gender_hint:
            avatar_query.append(f"gender_hint={interviewer_gender_hint}")
        interviewer_avatar_url = f"/interviewer-avatar/{interviewer_name}?{'&'.join(avatar_query)}"

        document = {
            "_id": session_id,
            "session_id": session_id,
            "user_id": user_id,
            "persona": persona,
            "job_role": job_role,
            "difficulty": difficulty,
            "voice": voice,
            "interviewer_name": interviewer_name,
            "interviewer_avatar_url": interviewer_avatar_url,
            "interviewer_gender_hint": interviewer_gender_hint,
            "accent_hint": accent_hint,
            "candidate_name": candidate_name,
            "questions": questions,
            "question_count": len(questions),
            "web_context": (web_context.strip() if isinstance(web_context, str) and web_context.strip() else None),
            "interview_state": {
                "question_index": 0,
                "follow_up_index": -1,
                "completed": False,
            },
            "status": "created",
            "feedback_ready": False,
            "created_at": _utc_now(),
            "updated_at": _utc_now(),
        }
        await self._sessions.replace_one({"_id": session_id}, document, upsert=True)
        await ensure_user_record(user_id, last_session_id=session_id, last_session_at=document["created_at"])
        return {
            "session_id": session_id,
            "interviewer_name": interviewer_name,
            "interviewer_avatar_url": interviewer_avatar_url,
            "interviewer_gender_hint": interviewer_gender_hint,
            "voice": voice,
            "persona": persona,
        }

    def _normalize_turns(self, turns: list[dict[str, Any]]) -> list[dict[str, Any]]:
        normalized: list[dict[str, Any]] = []
        for turn in turns or []:
            if not isinstance(turn, dict):
                continue
            raw_speaker = str(turn.get("speaker", "")).strip().lower()
            speaker = (
                "user"
                if raw_speaker in {"user", "candidate", "you"}
                else "interviewer"
                if raw_speaker in {"interviewer", "assistant", "ai"}
                else None
            )
            if not speaker:
                continue
            text = str(turn.get("text", "")).strip()
            if not text:
                continue
            normalized.append(
                {
                    "speaker": speaker,
                    "text": text,
                    "ts": str(turn.get("ts") or _utc_now()),
                }
            )
        return normalized

    def _merge_turn_sequences(
        self,
        existing: list[dict[str, Any]],
        incoming: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        if not existing:
            return incoming
        if not incoming:
            return existing

        def signature(turn: dict[str, Any]) -> tuple[str, str]:
            return (str(turn.get("speaker", "")), str(turn.get("text", "")))

        existing_sig = [signature(turn) for turn in existing]
        incoming_sig = [signature(turn) for turn in incoming]

        lcp = 0
        for left, right in zip(existing_sig, incoming_sig):
            if left != right:
                break
            lcp += 1
        if lcp == len(existing):
            return incoming
        if lcp == len(incoming):
            return existing
        return existing + incoming[lcp:]

    async def _save_transcript(self, session_id: str, turns: list[dict[str, Any]]) -> None:
        incoming = self._normalize_turns(turns)
        existing_doc = await self._transcripts.find_one({"_id": session_id})
        existing_turns = self._normalize_turns(strip_mongo_id(existing_doc).get("turns", [])) if existing_doc else []
        merged = self._merge_turn_sequences(existing_turns, incoming)
        await self._transcripts.replace_one(
            {"_id": session_id},
            {
                "_id": session_id,
                "session_id": session_id,
                "turns": merged,
                "saved_at": _utc_now(),
            },
            upsert=True,
        )

    async def end_session(
        self,
        session_id: str,
        ended_by: str | None = None,
        transcript: list[dict[str, Any]] | None = None,
    ) -> None:
        if transcript:
            await self._save_transcript(session_id, transcript)
        update_doc: dict[str, Any] = {
            "status": "ended",
            "ended_at": _utc_now(),
            "updated_at": _utc_now(),
        }
        if ended_by:
            update_doc["ended_by"] = ended_by
        await self._sessions.update_one({"_id": session_id}, {"$set": update_doc})

    async def get_user_sessions(
        self,
        user_id: str,
        limit: int = 10,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        rows = [strip_mongo_id(item) async for item in self._sessions.find({"user_id": user_id})]
        results = [
            {
                "session_id": item.get("session_id"),
                "persona": item.get("persona"),
                "job_role": item.get("job_role"),
                "difficulty": item.get("difficulty", "medium"),
                "interviewer_name": item.get("interviewer_name"),
                "status": item.get("status"),
                "ended_by": item.get("ended_by"),
                "created_at": item.get("created_at"),
                "ended_at": item.get("ended_at"),
                "live_started_at": item.get("live_started_at"),
                "question_count": len(item.get("questions", [])),
                "overall_score": item.get("overall_score"),
                "dimension_scores": item.get("dimension_scores"),
                "feedback_ready": item.get("feedback_ready", False),
                "decision": item.get("decision"),
                "decision_reason": item.get("decision_reason"),
                "last_retried_at": item.get("last_retried_at"),
                "interviewer_avatar_url": item.get("interviewer_avatar_url"),
            }
            for item in rows
        ]
        total = len(results)
        scored = [item["overall_score"] for item in results if isinstance(item.get("overall_score"), (int, float))]
        avg_score = round(sum(scored) / len(scored)) if scored else None
        now = datetime.now(timezone.utc)
        this_month = 0
        for item in results:
            created_at = item.get("created_at")
            if not created_at:
                continue
            try:
                created_dt = datetime.fromisoformat(str(created_at))
            except Exception:
                continue
            if created_dt.month == now.month and created_dt.year == now.year:
                this_month += 1
        results.sort(key=lambda item: item.get("last_retried_at") or item.get("created_at") or "", reverse=True)
        return results[offset:offset + limit], {
            "total": total,
            "avg_score": avg_score,
            "this_month": this_month,
        }

    async def get_transcript(self, session_id: str) -> dict[str, Any] | None:
        document = await self._transcripts.find_one({"_id": session_id})
        return strip_mongo_id(document) if document else None

    async def get_user_dashboard_analytics(
        self,
        user_id: str,
        limit: int = 7,
    ) -> dict[str, Any]:
        sessions = [strip_mongo_id(item) async for item in self._sessions.find({"feedback_ready": True})]
        scored_sessions = [item for item in sessions if isinstance(item.get("overall_score"), (int, float))]
        user_sessions = [item for item in scored_sessions if item.get("user_id") == user_id]

        user_sessions.sort(key=lambda item: item.get("last_retried_at") or item.get("created_at") or "", reverse=True)
        progression = [
            {
                "session_id": item.get("session_id"),
                "overall_score": int(round(float(item["overall_score"]))),
                "created_at": item.get("created_at"),
            }
            for item in reversed(user_sessions[: max(1, limit)])
        ]

        dim_keys = [
            "communication",
            "confidence",
            "structure",
            "technical_depth",
            "domain_vocabulary",
            "posture_presence",
        ]

        def averages(rows: list[dict[str, Any]]) -> dict[str, float | None]:
            result: dict[str, float | None] = {}
            for key in dim_keys:
                values = [
                    float((item.get("dimension_scores") or {}).get(key))
                    for item in rows
                    if isinstance((item.get("dimension_scores") or {}).get(key), (int, float))
                ]
                result[key] = round(sum(values) / len(values), 1) if values else None
            return result

        return {
            "user_id": user_id,
            "progression": progression,
            "user_average_dimensions": averages(user_sessions),
            "global_average_dimensions": averages(scored_sessions),
            "sample_sizes": {
                "user_sessions": len(user_sessions),
                "global_feedback_reports": len(scored_sessions),
            },
            "source": "mongodb",
        }

    async def get_session(self, session_id: str) -> dict[str, Any] | None:
        document = await self._sessions.find_one({"_id": session_id})
        if not document:
            return None
        item = strip_mongo_id(document)
        return {
            "session_id": item.get("session_id"),
            "persona": item.get("persona"),
            "job_role": item.get("job_role"),
            "difficulty": item.get("difficulty", "medium"),
            "interviewer_name": item.get("interviewer_name"),
            "status": item.get("status"),
            "ended_by": item.get("ended_by"),
            "user_id": item.get("user_id"),
            "created_at": item.get("created_at"),
            "ended_at": item.get("ended_at"),
            "question_count": len(item.get("questions", [])),
            "overall_score": item.get("overall_score"),
            "feedback_ready": item.get("feedback_ready", False),
            "interviewer_avatar_url": item.get("interviewer_avatar_url"),
        }

    async def _generate_interviewer_reply(
        self,
        session: dict[str, Any],
        transcript_turns: list[dict[str, Any]],
        candidate_text: str | None,
        next_prompt: str | None,
        closing: bool = False,
        reconnecting: bool = False,
    ) -> str:
        interviewer_name = str(session.get("interviewer_name") or "Alex")
        candidate_name = str(session.get("candidate_name") or "there")
        persona = str(session.get("persona") or "neutral")
        accent_hint = str(session.get("accent_hint") or "Indian English")
        job_role = str(session.get("job_role") or "Software Engineer")
        web_context = str(session.get("web_context") or "").strip()
        recent_context = "\n".join(
            f"{'CANDIDATE' if turn.get('speaker') == 'user' else 'INTERVIEWER'}: {turn.get('text')}"
            for turn in transcript_turns[-10:]
        )
        system_prompt = (
            f"You are {interviewer_name}, conducting a live mock interview for a {job_role} role. "
            f"Your persona guidance: {PERSONA_PERSONALITY_GUIDANCE.get(persona, '')} "
            f"Conversation guidance: {PERSONA_CONVERSATION_GUIDANCE.get(persona, '')} "
            f"Speak naturally and concisely, with a {accent_hint} flavor in wording. "
            "Keep responses to 1-3 spoken sentences and no markdown. "
            "If web context is provided, use it only when relevant and do not invent facts beyond it."
        )

        if closing:
            prompt = (
                f"Candidate name: {candidate_name}\n"
                f"Recent context:\n{recent_context}\n\n"
                "Wrap up the interview politely. You must include the phrase "
                "\"That covers everything from my side. Thanks for your time today.\""
            )
        elif reconnecting:
            prompt = (
                f"Candidate name: {candidate_name}\n"
                f"Recent context:\n{recent_context}\n\n"
                "Welcome the candidate back briefly after a reconnect, then continue naturally with the interview."
            )
        elif candidate_text is None:
            prompt = (
                f"Candidate name: {candidate_name}\n"
                f"Ask this interview question naturally and briefly: {next_prompt}"
            )
        else:
            prompt = (
                f"Candidate latest answer:\n{candidate_text}\n\n"
                f"Recent context:\n{recent_context}\n\n"
                f"Briefly acknowledge the answer, then ask this next prompt naturally:\n{next_prompt}"
            )

        if web_context:
            prompt = f"{prompt}\n\nOptional web context (may be stale; use only if relevant):\n{web_context}\n"

        try:
            reply = await self._sarvam_client.generate_text(
                prompt=prompt,
                system_instruction=system_prompt,
                temperature=0.5,
                max_tokens=220,
            )
            return (reply or "").strip()
        except (SarvamAPIError, SarvamRateLimitError):
            if closing:
                return "That covers everything from my side. Thanks for your time today."
            if reconnecting:
                return "Welcome back. Let's continue from where we left off."
            return str(next_prompt or "Let's continue.")

    async def _send_interviewer_turn(
        self,
        websocket: WebSocket,
        text: str,
        transcript_turns: list[dict[str, Any]],
        session_id: str,
    ) -> None:
        if not text.strip():
            return
        transcript_turns.append({"speaker": "interviewer", "text": text.strip(), "ts": _utc_now()})
        await websocket.send_text(json.dumps({"type": "output_transcription", "text": text.strip(), "finished": True}))
        try:
            audio = await self._sarvam_client.text_to_speech(
                text=text.strip(),
                voice=_DEFAULT_TTS_VOICE,
                language=_TRANSCRIPTION_LANGUAGE,
            )
            pcm_audio = _normalize_wav_or_pcm(audio)
            if pcm_audio:
                await websocket.send_bytes(pcm_audio)
        except Exception as exc:
            logger.warning("TTS generation failed for session %s: %s", session_id, exc)
        await self._save_transcript(session_id, transcript_turns)
        await websocket.send_text(json.dumps({"type": "control", "turn_complete": True, "interrupted": False}))

    async def run_live_session(
        self,
        websocket: WebSocket,
        session_id: str,
        caller_user_id: str | None = None,
        posture_analyzer: PostureAnalyzerAgent | None = None,
    ) -> None:
        session_doc = await self._sessions.find_one({"_id": session_id})
        if not session_doc:
            await websocket.close(code=4404)
            return

        session = strip_mongo_id(session_doc)
        if caller_user_id and str(session.get("user_id") or "") != caller_user_id:
            await websocket.close(code=4403)
            return
        if session.get("status") == "ended":
            await websocket.close(code=4409)
            return

        transcript_doc = await self._transcripts.find_one({"_id": session_id})
        transcript_turns = strip_mongo_id(transcript_doc).get("turns", []) if transcript_doc else []
        resumed = bool(transcript_turns) or session.get("status") == "active"

        await self._sessions.update_one(
            {"_id": session_id},
            {
                "$set": {
                    "status": "active",
                    "live_started_at": session.get("live_started_at") or _utc_now(),
                    "updated_at": _utc_now(),
                }
            },
        )

        await websocket.send_text(
            json.dumps(
                {
                    "type": "session_meta",
                    "resume": resumed,
                    "prior_turns": len(transcript_turns),
                    "transcript": transcript_turns,
                }
            )
        )

        utterance_queue: asyncio.Queue[tuple[str, str | bytes]] = asyncio.Queue()
        websocket_open = True
        last_posture_ts = 0
        audio_buffer = bytearray()
        speech_detected = False
        speech_ms = 0
        silence_ms = 0

        async def _heartbeat() -> None:
            try:
                while websocket_open:
                    await asyncio.sleep(_HEARTBEAT_INTERVAL)
                    await websocket.send_text(json.dumps({"type": "ping"}))
            except Exception:
                return

        async def _handle_posture_frame(frame_bytes: bytes, timestamp_ms: int) -> None:
            if not posture_analyzer:
                return
            score = await posture_analyzer.analyse_frame(frame_bytes)
            if not score:
                return
            score["frame_index"] = len(transcript_turns)
            score["session_id"] = session_id
            score["timestamp_ms"] = int(timestamp_ms)
            await posture_analyzer.persist_score(session_id, len(transcript_turns), score)

        async def _reader() -> None:
            nonlocal websocket_open, last_posture_ts, speech_detected, speech_ms, silence_ms, audio_buffer
            try:
                while True:
                    message = await websocket.receive()
                    msg_type = message.get("type")
                    if msg_type == "websocket.disconnect":
                        break

                    text_data = message.get("text")
                    if text_data is not None:
                        try:
                            payload = json.loads(text_data)
                        except json.JSONDecodeError:
                            continue

                        payload_type = payload.get("type")
                        if payload_type == "end":
                            break
                        if payload_type == "pong":
                            continue
                        if payload_type == "video_frame":
                            frame_b64 = payload.get("data", "")
                            timestamp_ms = int(payload.get("timestamp_ms") or 0)
                            if frame_b64 and posture_analyzer and timestamp_ms - last_posture_ts >= _POSTURE_MIN_INTERVAL_MS:
                                last_posture_ts = timestamp_ms
                                try:
                                    frame_bytes = base64.b64decode(frame_b64)
                                    asyncio.create_task(_handle_posture_frame(frame_bytes, timestamp_ms))
                                except Exception:
                                    pass
                            continue
                        if payload_type == "text":
                            await utterance_queue.put(("text", str(payload.get("text") or "")))
                            continue
                        continue

                    chunk = message.get("bytes")
                    if not chunk:
                        continue

                    chunk_duration = _duration_ms_for_pcm(chunk)
                    rms = _rms_for_pcm16le(chunk)
                    if rms >= _RMS_THRESHOLD:
                        speech_detected = True
                        silence_ms = 0
                        speech_ms += chunk_duration
                        audio_buffer.extend(chunk)
                        if speech_ms >= _MAX_UTTERANCE_MS:
                            await utterance_queue.put(("audio", bytes(audio_buffer)))
                            audio_buffer = bytearray()
                            speech_detected = False
                            speech_ms = 0
                            silence_ms = 0
                    elif speech_detected:
                        audio_buffer.extend(chunk)
                        silence_ms += chunk_duration
                        speech_ms += chunk_duration
                        if silence_ms >= _SILENCE_MS and speech_ms >= _MIN_SPEECH_MS:
                            await utterance_queue.put(("audio", bytes(audio_buffer)))
                            audio_buffer = bytearray()
                            speech_detected = False
                            speech_ms = 0
                            silence_ms = 0
            except WebSocketDisconnect:
                logger.debug("Browser disconnected from /ws/interview/%s", session_id)
            finally:
                websocket_open = False

        async def _processor() -> None:
            nonlocal session
            while websocket_open:
                kind, payload = await utterance_queue.get()
                if kind == "text":
                    text_payload = str(payload).strip()
                    if not text_payload:
                        continue
                    if text_payload.startswith("[CONNECTION RESUME CONTEXT]"):
                        continue
                    if "candidate has reconnected" in text_payload.lower():
                        response_text = await self._generate_interviewer_reply(
                            session,
                            transcript_turns,
                            None,
                            None,
                            reconnecting=True,
                        )
                        await self._send_interviewer_turn(websocket, response_text, transcript_turns, session_id)
                        continue
                    if "candidate has joined the interview" in text_payload.lower():
                        next_prompt, next_state = _next_prompt_from_state(session)
                        response_text = await self._generate_interviewer_reply(
                            session,
                            transcript_turns,
                            None,
                            next_prompt,
                        )
                        session["interview_state"] = next_state
                        await self._sessions.update_one(
                            {"_id": session_id},
                            {"$set": {"interview_state": next_state, "updated_at": _utc_now()}},
                        )
                        await self._send_interviewer_turn(websocket, response_text, transcript_turns, session_id)
                        continue
                    continue

                audio_payload = bytes(payload)
                try:
                    transcribed_text = (await self._sarvam_client.speech_to_text(
                        audio_payload,
                        language=_TRANSCRIPTION_LANGUAGE,
                        audio_format="pcm",
                    )).strip()
                except Exception as exc:
                    logger.warning("STT failed for session %s: %s", session_id, exc)
                    continue
                if not transcribed_text:
                    continue

                transcript_turns.append({"speaker": "user", "text": transcribed_text, "ts": _utc_now()})
                await websocket.send_text(
                    json.dumps({"type": "input_transcription", "text": transcribed_text, "finished": True})
                )
                await self._save_transcript(session_id, transcript_turns)

                next_prompt, next_state = _next_prompt_from_state(session)
                closing = next_prompt is None or bool(next_state.get("completed"))
                response_text = await self._generate_interviewer_reply(
                    session,
                    transcript_turns,
                    transcribed_text,
                    next_prompt,
                    closing=closing,
                )
                session["interview_state"] = next_state
                await self._sessions.update_one(
                    {"_id": session_id},
                    {"$set": {"interview_state": next_state, "updated_at": _utc_now()}},
                )
                await self._send_interviewer_turn(websocket, response_text, transcript_turns, session_id)

        tasks = [
            asyncio.create_task(_reader()),
            asyncio.create_task(_processor()),
            asyncio.create_task(_heartbeat()),
        ]
        try:
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            websocket_open = False
            for task in tasks:
                task.cancel()
            await self._save_transcript(session_id, transcript_turns)
