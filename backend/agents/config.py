"""
Shared configuration for all MockMate agents.
Centralises environment-variable reads, MongoDB collection names,
and Sarvam model identifiers.
"""

from __future__ import annotations

import os


def require_env(var: str) -> str:
    """Return env var value or raise a clear error if it is missing/empty."""
    val = os.getenv(var, "").strip()
    if not val:
        raise EnvironmentError(
            f"Required environment variable '{var}' is not set. "
            f"Add it to your .env file and restart the server."
        )
    return val


# ── MongoDB ────────────────────────────────────────────────────────────────
MONGODB_URI = require_env("MONGODB_URI")
MONGODB_DATABASE = require_env("MONGODB_DATABASE")
MONGODB_USER_COLLECTION = os.getenv("MONGODB_USER_COLLECTION", "users")
MONGODB_RESUME_COLLECTION = os.getenv("MONGODB_RESUME_COLLECTION", "resumes")
MONGODB_SESSION_COLLECTION = os.getenv("MONGODB_SESSION_COLLECTION", "sessions")
MONGODB_TRANSCRIPT_COLLECTION = os.getenv("MONGODB_TRANSCRIPT_COLLECTION", "transcripts")
MONGODB_POSTURE_COLLECTION = os.getenv("MONGODB_POSTURE_COLLECTION", "posture_scores")
MONGODB_FEEDBACK_COLLECTION = os.getenv("MONGODB_FEEDBACK_COLLECTION", "feedback")
MONGODB_ASSET_COLLECTION = os.getenv("MONGODB_ASSET_COLLECTION", "assets")
MONGODB_PERFORMANCE_CARD_COLLECTION = os.getenv(
    "MONGODB_PERFORMANCE_CARD_COLLECTION", "performance_cards",
)

# ── Sarvam AI ─────────────────────────────────────────────────────────────
SARVAM_API_KEY         = require_env("SARVAM_API_KEY")
SARVAM_LLM_MODEL       = os.getenv("SARVAM_LLM_MODEL", "sarvam-m")
SARVAM_STT_MODEL       = os.getenv("SARVAM_STT_MODEL", "saarika:v2.5")
SARVAM_TTS_MODEL       = os.getenv("SARVAM_TTS_MODEL", "bulbul:v3")
SARVAM_STT_ENDPOINT    = os.getenv("SARVAM_STT_ENDPOINT", "https://api.sarvam.ai/speech-to-text")
SARVAM_TTS_ENDPOINT    = os.getenv("SARVAM_TTS_ENDPOINT", "https://api.sarvam.ai/text-to-speech")
SARVAM_VISION_ENDPOINT = os.getenv("SARVAM_VISION_ENDPOINT", "https://api.sarvam.ai/vision")
SARVAM_IMAGE_GEN_ENDPOINT = os.getenv("SARVAM_IMAGE_GEN_ENDPOINT", "https://api.sarvam.ai/image-generation")

# ── Feature toggles ────────────────────────────────────────────────────────
# Set these to "disabled" for environments without Vision/Image access.
POSTURE_MODEL = os.getenv("POSTURE_MODEL", "disabled")
IMAGEN_MODEL = os.getenv("IMAGEN_MODEL", "disabled")

# ── LlamaParse ────────────────────────────────────────────────────────────
LLAMA_CLOUD_API_KEY = os.getenv("LLAMA_CLOUD_API_KEY", "").strip()
LLAMA_CLOUD_BASE_URL = os.getenv("LLAMA_CLOUD_BASE_URL", "https://api.cloud.llamaindex.ai")

