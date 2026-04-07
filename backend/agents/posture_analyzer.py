"""
PostureAnalyzerAgent
--------------------
Analyzes webcam frames using Sarvam Vision API and stores posture scores in
MongoDB.
"""

from __future__ import annotations

import base64
import json
import logging
import traceback
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_random_exponential,
    before_sleep_log,
)

# Sarvam AI client
from lib.sarvam_client import get_sarvam_client, SarvamAPIError, SarvamRateLimitError

logger = logging.getLogger(__name__)

from agents.config import MONGODB_POSTURE_COLLECTION as _COLLECTION
from lib.mongo import get_collection

ANALYSIS_PROMPT = """
You are a professional interview coach analysing a single video frame from a
live mock interview.

Evaluate the candidate on the following dimensions and return ONLY a JSON object:
{
  "posture_score": <0-100>,
  "eye_contact_score": <0-100>,
  "facial_confidence_score": <0-100>,
  "overall_presence_score": <0-100>,
  "observations": ["<short observation 1>", "<short observation 2>"]
}

Scoring rubric:
- posture_score: upright (100) → slouched (0)
- eye_contact_score: looking at camera (100) → looking away (0)
- facial_confidence_score: calm/engaged expression (100) → nervous/blank (0)
- overall_presence_score: weighted average of the above + professional appearance

Keep observations concise (≤10 words each).
"""


class PostureAnalyzerAgent:
    """Analyses candidate webcam frames for posture & presence scoring."""

    def __init__(self) -> None:
        self._sarvam_client = get_sarvam_client()
        self._collection = get_collection(_COLLECTION)
        self._vision_disabled = False

    # ------------------------------------------------------------------
    # Public API — inline analysis (used by InterviewEngineAgent)
    # ------------------------------------------------------------------

    async def analyse_frame(self, frame_bytes: bytes) -> dict[str, Any]:
        """Analyse a single JPEG frame and return the score dict.

        Returns an empty dict on failure so as not to crash the caller.
        """
        if self._vision_disabled:
            return {}

        try:
            @retry(
                retry=retry_if_exception_type(SarvamRateLimitError),
                wait=wait_random_exponential(multiplier=1, max=30),
                stop=stop_after_attempt(3),
                before_sleep=before_sleep_log(logger, logging.WARNING),
                reraise=True,
            )
            async def _analyze_with_retry():
                return await self._sarvam_client.analyze_image(
                    image_data=frame_bytes,
                    prompt=ANALYSIS_PROMPT,
                    image_format="jpeg",
                )

            response_text = await _analyze_with_retry()
            return json.loads(response_text)
        except SarvamAPIError as exc:
            message = str(exc)
            if "vision_beta_access_required" in message or "API error (403)" in message:
                self._vision_disabled = True
                logger.warning("Vision API not available for this key. Disabling posture analysis for this server run.")
                return {}
            logger.warning("Posture analysis failed for frame: %s", message)
            return {}
        except Exception as exc:
            logger.warning(
                "Posture analysis failed for frame: %s: %s\n%s",
                type(exc).__name__, exc, traceback.format_exc(),
            )
            return {}

    async def persist_score(
        self, session_id: str, frame_index: int, score: dict[str, Any],
    ) -> None:
        """Append a frame score to the single per-session MongoDB document."""
        try:
            score["recorded_at"] = datetime.now(timezone.utc).isoformat()
            await self._collection.update_one(
                {"_id": session_id},
                {
                    "$set": {
                        "session_id": session_id,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    },
                    "$push": {"frames": score},
                },
                upsert=True,
            )
        except Exception as exc:
            logger.warning(
                "Failed to persist posture score — session=%s frame=%d: %s",
                session_id, frame_index, exc,
            )

    # ------------------------------------------------------------------
    # Legacy WebSocket mode (standalone /ws/vision endpoint)
    # ------------------------------------------------------------------

    async def run_live_analysis(self, websocket: WebSocket, session_id: str) -> None:
        """
        Each incoming message from the browser is expected to be a JSON string:
          { "frame": "<base64-encoded JPEG>", "timestamp_ms": <int> }

        For each frame, this method:
          1. Decodes the JPEG bytes.
          2. Sends the frame to Sarvam Vision API for analysis.
          3. Persists the scored result in Firestore.
          4. Sends the score JSON back to the browser.
        """
        frame_count = 0
        async for raw_message in websocket.iter_text():
            payload: dict[str, Any] = json.loads(raw_message)
            frame_b64: str = payload.get("frame", "")
            timestamp_ms: int = payload.get("timestamp_ms", 0)

            if not frame_b64:
                continue

            frame_bytes = base64.b64decode(frame_b64)
            score = await self.analyse_frame(frame_bytes)
            if not score:
                continue
            score["frame_index"] = frame_count
            score["timestamp_ms"] = timestamp_ms
            score["session_id"] = session_id

            await self.persist_score(session_id, frame_count, score)
            await websocket.send_text(json.dumps(score))
            frame_count += 1
