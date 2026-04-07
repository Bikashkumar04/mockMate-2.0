"""
MockMate — Cloud Run entrypoint
FastAPI backend that wires together all ADK agents and exposes
REST + WebSocket endpoints consumed by the Next.js frontend.
"""

from __future__ import annotations

# Load .env FIRST — before any module-level os.getenv() calls in agent files.
from dotenv import load_dotenv
load_dotenv(override=True)

import json
import logging
import os
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import quote

from fastapi import FastAPI, UploadFile, File, HTTPException, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse, Response
from pydantic import BaseModel

logger = logging.getLogger(__name__)


def _feature_enabled(raw_value: str | None) -> bool:
    value = (raw_value or "").strip().lower()
    return value not in {"", "0", "false", "off", "none", "disabled"}


_POSTURE_ENABLED = _feature_enabled(os.getenv("POSTURE_MODEL", "disabled"))
_AVATAR_IMAGE_ENABLED = _feature_enabled(os.getenv("IMAGEN_MODEL", "disabled"))


def _build_avatar_placeholder_svg(name: str) -> bytes:
    initials = "".join(part[:1].upper() for part in name.split() if part)[:2] or "MM"
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">'
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
        '<stop offset="0%" stop-color="#1f2937"/><stop offset="100%" stop-color="#111827"/>'
        '</linearGradient></defs>'
        '<rect width="512" height="512" fill="url(#g)"/>'
        '<circle cx="256" cy="210" r="100" fill="#4b5563"/>'
        '<rect x="106" y="322" width="300" height="140" rx="70" fill="#374151"/>'
        f'<text x="256" y="278" text-anchor="middle" fill="#e5e7eb" font-size="92" font-family="Arial, sans-serif">{initials}</text>'
        '</svg>'
    )
    return svg.encode("utf-8")

# Enable DEBUG logging for our agents when LOG_LEVEL=DEBUG (default: INFO)
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logging.getLogger("agents").setLevel(os.getenv("LOG_LEVEL", "DEBUG").upper())

from agents.resume_parser import ResumeParserAgent
from agents.question_generator import QuestionGeneratorAgent
from agents.interview_engine import InterviewEngineAgent
from agents.posture_analyzer import PostureAnalyzerAgent
from agents.feedback_compiler import FeedbackCompilerAgent
from agents.interviewer_avatar import InterviewerAvatarAgent
from agents.performance_card import PerformanceCardAgent
from agents.next_interview_recommender import NextInterviewRecommenderAgent

from agents.config import MONGODB_RESUME_COLLECTION as _COLLECTION_RESUMES
from lib.mongo import get_collection, strip_mongo_id
from lib.websearch_client import build_web_context, get_websearch_client

# ---------------------------------------------------------------------------
# Lifespan — initialise/teardown shared resources
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialise agents once at startup and store them on app.state
    app.state.resume_parser = ResumeParserAgent()
    app.state.question_generator = QuestionGeneratorAgent()
    app.state.interview_engine = InterviewEngineAgent()
    app.state.posture_analyzer = PostureAnalyzerAgent()
    app.state.feedback_compiler = FeedbackCompilerAgent()
    app.state.avatar_agent = InterviewerAvatarAgent()
    app.state.performance_card = PerformanceCardAgent()
    app.state.next_interview_recommender = NextInterviewRecommenderAgent()
    yield
    # Teardown (if needed) goes here


# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="MockMate API",
    description="AI-powered mock interview platform backend.",
    version="1.0.0",
    lifespan=lifespan,
)

_raw_origins = os.getenv("ALLOWED_ORIGINS", "").strip()
_allow_origins: list[str] = (
    [o.strip() for o in _raw_origins.split(",") if o.strip()]
    if _raw_origins
    else ["*"]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class SessionConfig(BaseModel):
    user_id: str
    persona: str = "neutral"          # e.g. "startup_founder", "investment_banker"
    job_role: str = "Software Engineer"
    difficulty: str = "medium"        # "easy" | "medium" | "hard"


class FeedbackRequest(BaseModel):
    session_id: str
    refresh_card_values: bool = False
    regenerate_performance_card: bool = False


class SessionEndRequest(BaseModel):
    ended_by: str | None = None
    transcript: list[dict[str, Any]] | None = None


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health", tags=["ops"])
async def health_check():
    return {"status": "ok", "service": "mockmate-backend"}


# ---------------------------------------------------------------------------
# Resume
# ---------------------------------------------------------------------------

_ACCEPTED_CONTENT_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "text/plain",
}
_ACCEPTED_EXTENSIONS = {".pdf", ".docx", ".doc", ".txt"}


@app.post("/resume/upload", tags=["resume"], status_code=201)
async def upload_resume(user_id: str, file: UploadFile = File(...)):
    """
    Upload a résumé (PDF / DOCX) and return structured JSON.

    **Flow**
    1. Validate file type.
    2. Store raw bytes in MongoDB-backed asset storage.
    3. Extract text and parse it with Sarvam AI.
    4. Persist the structured result in MongoDB (keyed by *user_id*).
    5. Return structured JSON.

    **Query params**
    - `user_id` — authenticated user's ID (required).

    **Form data**
    - `file` — the résumé file (PDF, DOCX, DOC, or TXT).
    """
    if not user_id or not user_id.strip():
        raise HTTPException(status_code=400, detail="user_id must not be empty.")

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in _ACCEPTED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=(
                f"Unsupported file type '{ext}'. "
                f"Accepted extensions: {', '.join(sorted(_ACCEPTED_EXTENSIONS))}"
            ),
        )

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(content) > 10 * 1024 * 1024:  # 10 MB guard
        raise HTTPException(status_code=413, detail="File exceeds the 10 MB size limit.")

    try:
        result = await app.state.resume_parser.parse(
            file_bytes=content,
            filename=file.filename,
            user_id=user_id.strip(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Resume parsing failed for user %s", user_id)
        raise HTTPException(status_code=500, detail=f"Resume parsing failed: {exc}") from exc

    return JSONResponse(
        status_code=201,
        content={
            "user_id":     user_id,
            "resume_id":   result.get("resume_id"),
            "file_asset_id": result.get("file_asset_id"),
            "parsed_at":   result.get("parsed_at"),
            "resume_data": result,
        },
    )


@app.get("/resume/{user_id}", tags=["resume"])
async def get_resume(user_id: str):
    """
    Retrieve the most-recently parsed résumé for *user_id* from MongoDB.

    Returns 404 if no résumé has been parsed for this user yet.
    """
    try:
        data = await app.state.resume_parser.get_resume(user_id)
    except Exception as exc:
        logger.exception("Resume read failed for user %s", user_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if data is None:
        raise HTTPException(
            status_code=404,
            detail=f"No parsed résumé found for user '{user_id}'.",
        )

    return {"user_id": user_id, "resume_data": data}


@app.get("/resume/{user_id}/file", tags=["resume"])
async def get_resume_file(user_id: str):
    """
    Stream the raw uploaded résumé file (PDF / DOCX) from MongoDB-backed asset storage.
    Returns 404 if no résumé exists for this user.
    """
    try:
        result = await app.state.resume_parser.get_resume_file(user_id)
    except Exception as exc:
        logger.exception("Resume file download failed for user %s", user_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"No résumé file found for user '{user_id}'.",
        )
    file_bytes, content_type = result
    return StreamingResponse(
        iter([file_bytes]),
        media_type=content_type,
        headers={"Content-Disposition": "inline"},
    )

@app.post("/session/start", tags=["session"])
async def start_session(config: SessionConfig, background_tasks: BackgroundTasks):
    """Generate personalised interview questions and create a session."""
    web_context: str | None = None
    try:
        search_client = get_websearch_client()
        if search_client is not None:
            resumes = get_collection(_COLLECTION_RESUMES)
            resume_doc = await resumes.find_one({"_id": config.user_id})
            resume_data = strip_mongo_id(resume_doc) if resume_doc else {}

            skills = resume_data.get("skills") or []
            top_skills = [str(s).strip() for s in skills if str(s).strip()][:5]
            query_parts = [
                f"{config.job_role} interview",
                str(config.persona),
            ]
            if top_skills:
                query_parts.append("skills: " + ", ".join(top_skills))
            query = " | ".join([p for p in query_parts if p])[:300]

            max_results = int(os.getenv("WEBSEARCH_MAX_RESULTS", "3") or "3")
            results = await search_client.search(query=query, max_results=max_results)
            web_context = build_web_context(query=query, results=results)
    except Exception as exc:
        logger.warning("Websearch context generation failed; continuing without it: %s", exc)

    questions = await app.state.question_generator.generate(
        user_id=config.user_id,
        persona=config.persona,
        job_role=config.job_role,
        difficulty=config.difficulty,
        web_context=web_context,
    )
    session_meta = await app.state.interview_engine.create_session(
        user_id=config.user_id,
        questions=questions,
        persona=config.persona,
        job_role=config.job_role,
        difficulty=config.difficulty,
        web_context=web_context,
    )
    # Eagerly warm up avatar cache only when image generation is enabled.
    if _AVATAR_IMAGE_ENABLED:
        background_tasks.add_task(
            app.state.avatar_agent.get_or_generate,
            session_meta["interviewer_name"],
            config.persona,
            session_meta.get("interviewer_gender_hint"),
        )

    avatar_url = session_meta.get("interviewer_avatar_url")
    if not _AVATAR_IMAGE_ENABLED:
        safe_name = quote(str(session_meta["interviewer_name"]), safe="")
        avatar_url = f"/interviewer-avatar/{safe_name}"

    return {
        "session_id":             session_meta["session_id"],
        "interviewer_name":       session_meta["interviewer_name"],
        "interviewer_avatar_url": avatar_url,
        "voice":                  session_meta["voice"],
        "question_count":         len(questions),
        "questions":              questions,
        "persona":                config.persona,
        "job_role":       config.job_role,
        "difficulty":     config.difficulty,
    }


# ---------------------------------------------------------------------------
# Interviewer avatars
# ---------------------------------------------------------------------------

@app.get("/interviewer-avatar/{name}", tags=["assets"])
async def get_interviewer_avatar(
    name: str,
    persona: str = "neutral",
    gender_hint: str | None = None,
):
    """
    Serve the AI-generated profile picture for an interviewer.

    - Returns a cached JPEG from MongoDB-backed asset storage if one exists.
    - Otherwise generates a new portrait with Sarvam Image Generation,
      caches it, and streams it back.
    - Responses are cache-controlled for 7 days so the browser/CDN rarely
      needs to re-fetch (interviewer avatars are immutable once generated).
    """
    if not _AVATAR_IMAGE_ENABLED:
        return Response(
            content=_build_avatar_placeholder_svg(name),
            media_type="image/svg+xml",
            headers={
                "Cache-Control": "public, max-age=604800, immutable",
            },
        )

    img_bytes = await app.state.avatar_agent.get_or_generate(name, persona, gender_hint)
    if not img_bytes:
        raise HTTPException(
            status_code=404,
            detail=f"Avatar not available for interviewer '{name}'.",
        )
    return Response(
        content=img_bytes,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "public, max-age=604800, immutable",  # 7 days
        },
    )


@app.get("/session/{session_id}/questions", tags=["session"])
async def get_session_questions(session_id: str):
    """Retrieve the generated question set for an existing session."""
    questions = await app.state.question_generator.get_questions(session_id)
    if questions is None:
        raise HTTPException(
            status_code=404,
            detail=f"No questions found for session '{session_id}'.",
        )
    return {"session_id": session_id, "questions": questions, "question_count": len(questions)}


@app.get("/session/{session_id}", tags=["session"])
async def get_session(session_id: str):
    """Return lightweight metadata for a single session."""
    data = await app.state.interview_engine.get_session(session_id)
    if data is None:
        raise HTTPException(
            status_code=404,
            detail=f"Session '{session_id}' not found.",
        )
    return data


@app.post("/session/{session_id}/end", tags=["session"])
async def end_session(session_id: str, req: SessionEndRequest | None = None):
    """Mark a session as complete."""
    await app.state.interview_engine.end_session(
        session_id,
        ended_by=req.ended_by if req else None,
        transcript=req.transcript if req else None,
    )
    return {"session_id": session_id, "status": "ended"}


@app.get("/sessions/user/{user_id}", tags=["session"])
async def list_user_sessions(user_id: str, limit: int = 10, offset: int = 0):
    """Return the most-recent sessions for a user (lightweight — no full transcript)."""
    sessions, stats = await app.state.interview_engine.get_user_sessions(
        user_id, limit=limit, offset=offset,
    )
    return {
        "user_id": user_id,
        "sessions": sessions,
        "count": len(sessions),
        "has_more": offset + limit < stats.get("total", 0),
        **stats,
    }


@app.get("/analytics/dashboard/{user_id}", tags=["session"])
async def get_dashboard_analytics(user_id: str, limit: int = 7):
    """Return progression + benchmark analytics for dashboard charts."""
    data = await app.state.interview_engine.get_user_dashboard_analytics(
        user_id=user_id,
        limit=limit,
    )
    return data


@app.get("/analytics/next-interview/{user_id}", tags=["session"])
async def get_next_interview_recommendation(user_id: str, lookback: int = 5):
    """Return AI recommendation for what the user should practice next."""
    data = await app.state.next_interview_recommender.recommend(
        user_id=user_id,
        lookback=max(3, min(lookback, 5)),
    )
    if data is None:
        raise HTTPException(
            status_code=404,
            detail="Not enough completed sessions to generate recommendation yet.",
        )
    return data


@app.get("/transcript/{session_id}", tags=["session"])
async def get_transcript(session_id: str):
    """Return the full transcript (list of turns) for a session."""
    data = await app.state.interview_engine.get_transcript(session_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Transcript not found.")
    return data


# ---------------------------------------------------------------------------
# Feedback
# ---------------------------------------------------------------------------

@app.get("/feedback/{session_id}", tags=["feedback"])
async def read_feedback(session_id: str):
    """Return a previously compiled feedback report (does NOT regenerate)."""
    report = await app.state.feedback_compiler.get_feedback(session_id)
    if report is None:
        raise HTTPException(
            status_code=404,
            detail=f"No feedback found for session '{session_id}'.",
        )
    return report

@app.post("/feedback/generate", tags=["feedback"])
async def generate_feedback(req: FeedbackRequest, background_tasks: BackgroundTasks):
    """Compile full multimodal feedback and mock hiring decision letter."""
    try:
        report = await app.state.feedback_compiler.compile(req.session_id)
        # Kick off performance-card generation in the background so
        # it's ready by the time the user visits the dashboard.
        if req.refresh_card_values:
            background_tasks.add_task(
                app.state.performance_card.refresh_metadata, req.session_id,
            )
        elif req.regenerate_performance_card:
            background_tasks.add_task(
                app.state.performance_card.generate, req.session_id, True,
            )
        else:
            background_tasks.add_task(
                app.state.performance_card.generate, req.session_id,
            )
        return report
    except ValueError as exc:
        # Session not found
        raise HTTPException(status_code=404, detail=str(exc))
    except RuntimeError as exc:
        # Timeout, model error, or JSON parse failure
        logger.error(
            "Feedback generation failed for session '%s' — %s",
            req.session_id, exc,
        )
        raise HTTPException(status_code=502, detail=str(exc))
    except Exception as exc:
        logger.error(
            "Unexpected error generating feedback for session '%s' — %s: %s",
            req.session_id, type(exc).__name__, exc,
        )
        raise HTTPException(
            status_code=500,
            detail=f"Internal error generating feedback: {type(exc).__name__}",
        )


# ---------------------------------------------------------------------------
# Performance cards (AI-generated session achievement images)
# ---------------------------------------------------------------------------

@app.get("/performance-card/{session_id}", tags=["performance-card"])
async def get_performance_card(
    session_id: str,
    refresh_values: bool = False,
    force_regenerate: bool = False,
):
    """
    Return card metadata (score, motivational line, persona, job role, …).
    Generates the card on-the-fly if feedback exists but the card hasn't been
    created yet (idempotent).
    """
    if force_regenerate:
        card = await app.state.performance_card.generate(
            session_id, force_regenerate=True,
        )
    elif refresh_values:
        card = await app.state.performance_card.refresh_metadata(session_id)
    else:
        card = await app.state.performance_card.generate(
            session_id, force_regenerate=force_regenerate,
        )
    if card is None:
        raise HTTPException(
            status_code=404,
            detail=f"Performance card not available for session '{session_id}'. "
                   "Feedback may not have been generated yet.",
        )
    return card


@app.get("/performance-card/{session_id}/image", tags=["performance-card"])
async def get_performance_card_image(session_id: str):
    """Stream the AI-generated card background JPEG."""
    img_bytes = await app.state.performance_card.get_card_image(session_id)
    if not img_bytes:
        raise HTTPException(
            status_code=404,
            detail=f"Performance card image not available for session '{session_id}'.",
        )
    return Response(
        content=img_bytes,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "public, max-age=604800, immutable",
        },
    )


# ---------------------------------------------------------------------------
# WebSocket — live interview audio stream
# ---------------------------------------------------------------------------

@app.websocket("/ws/interview/{session_id}")
async def websocket_interview(websocket: WebSocket, session_id: str, user_id: str | None = None):
    """
    Streams audio chunks from the browser and returns AI interviewer responses
    in real time using Sarvam speech + text generation.
    run_live_session() manages the live websocket loop and transcript
    persistence. Session completion is still finalized via /session/{id}/end.
    """
    await websocket.accept()
    engine: InterviewEngineAgent = websocket.app.state.interview_engine
    analyzer: PostureAnalyzerAgent | None = websocket.app.state.posture_analyzer if _POSTURE_ENABLED else None
    try:
        await engine.run_live_session(
            websocket,
            session_id,
            caller_user_id=user_id,
            posture_analyzer=analyzer,
        )
    except WebSocketDisconnect:
        logger.debug("Browser disconnected from /ws/interview/%s", session_id)
    except Exception as exc:
        logger.error(
            "Unhandled error in /ws/interview/%s — %s: %s",
            session_id, type(exc).__name__, exc,
        )


# ---------------------------------------------------------------------------
# WebSocket — posture / vision stream
# ---------------------------------------------------------------------------

@app.websocket("/ws/vision/{session_id}")
async def websocket_vision(websocket: WebSocket, session_id: str):
    """
    Receives base-64 encoded video frames from the browser and returns
    real-time posture & presence scores.
    """
    await websocket.accept()
    if not _POSTURE_ENABLED:
        await websocket.send_text(json.dumps({"type": "error", "detail": "Posture analysis is disabled."}))
        await websocket.close(code=4403)
        return

    analyzer: PostureAnalyzerAgent = websocket.app.state.posture_analyzer
    try:
        await analyzer.run_live_analysis(websocket, session_id)
    except WebSocketDisconnect:
        pass


# ---------------------------------------------------------------------------
# Entrypoint (local dev)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8080)),
        reload=True,
        # Only watch the agents package — main.py is always watched automatically.
        # Do NOT include "." here; it would pull in .venv and trigger constant reloads.
        reload_dirs=["agents"],
    )
