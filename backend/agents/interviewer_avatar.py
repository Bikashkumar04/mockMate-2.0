"""
InterviewerAvatarAgent
----------------------
Generates and caches interviewer profile images in MongoDB-backed asset storage.
"""

from __future__ import annotations

import logging
import re
from typing import Optional

from tenacity import (
    before_sleep_log,
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_random_exponential,
)

from agents.config import MONGODB_ASSET_COLLECTION as _ASSET_COLLECTION
from lib.mongo import get_binary_asset, save_binary_asset
from lib.sarvam_client import SarvamAPIError, SarvamRateLimitError, get_sarvam_client

logger = logging.getLogger(__name__)

_AVATAR_PREFIX = "interviewer-avatars"
_AVATAR_CACHE_VERSION = "v2"

_PERSONA_STYLE: dict[str, dict[str, str]] = {
    "neutral": {
        "descriptor": "professional corporate interviewer",
        "setting": "clean neutral studio background",
        "attire": "business attire",
        "lighting": "soft professional studio lighting",
        "expression": "confident and approachable expression",
        "vibe": "LinkedIn-style headshot portrait photograph",
    },
    "startup_founder": {
        "descriptor": "tech startup founder",
        "setting": "modern coworking space or trendy cafe background, slightly blurred",
        "attire": "smart casual",
        "lighting": "warm natural window light",
        "expression": "energetic grin",
        "vibe": "candid startup portrait photograph",
    },
    "investment_banker": {
        "descriptor": "senior investment banker",
        "setting": "sleek corporate office skyline background",
        "attire": "sharp tailored dark suit",
        "lighting": "dramatic side lighting",
        "expression": "composed, measured expression",
        "vibe": "formal corporate portrait photograph",
    },
    "tech_lead": {
        "descriptor": "senior software engineer and tech lead",
        "setting": "engineering workspace background, softly blurred",
        "attire": "casual tech attire",
        "lighting": "soft ambient indoor lighting",
        "expression": "thoughtful half-smile",
        "vibe": "developer aesthetic portrait photograph",
    },
    "hr_manager": {
        "descriptor": "friendly HR professional",
        "setting": "bright modern office background",
        "attire": "smart business casual",
        "lighting": "bright even lighting",
        "expression": "warm genuine smile",
        "vibe": "friendly corporate portrait photograph",
    },
}


def _name_to_slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")


def _build_prompt(name: str, persona: str, gender_hint: str | None = None) -> str:
    style = _PERSONA_STYLE.get(persona, _PERSONA_STYLE["neutral"])
    gender_clause = ""
    if gender_hint:
        gender_clause = f" presenting as {gender_hint.strip().lower()}."
    return (
        f"{style['vibe']} of {name}, a {style['descriptor']}.{gender_clause} "
        f"{style['setting']}, {style['attire']}, {style['lighting']}, "
        f"looking directly at camera with a {style['expression']}, "
        "photorealistic, shoulders and face clearly visible, no text, no watermarks."
    )


class InterviewerAvatarAgent:
    def __init__(self) -> None:
        self._sarvam_client = get_sarvam_client()

    def _asset_id(self, name: str, persona: str, gender_hint: str | None = None) -> str:
        gender_slug = _name_to_slug((gender_hint or "unspecified").replace("-", "_")) or "unspecified"
        return (
            f"{_AVATAR_PREFIX}:{_AVATAR_CACHE_VERSION}:"
            f"{_name_to_slug(name)}:{_name_to_slug(persona)}:{gender_slug}"
        )

    async def get_or_generate(
        self,
        name: str,
        persona: str = "neutral",
        gender_hint: str | None = None,
    ) -> Optional[bytes]:
        asset_id = self._asset_id(name, persona, gender_hint)
        cached = await get_binary_asset(asset_id, collection=_ASSET_COLLECTION)
        if cached:
            payload, _content_type, _meta = cached
            return payload

        prompt = _build_prompt(name, persona, gender_hint)

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
                width=1024,
                height=1024,
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
                filename=f"{_name_to_slug(name)}.jpg",
                metadata={
                    "kind": "interviewer_avatar",
                    "name": name,
                    "persona": persona,
                    "gender_hint": gender_hint,
                },
            )
            return image_bytes
        except SarvamAPIError as exc:
            logger.warning("Avatar generation unavailable for '%s': %s", name, exc)
            return None
        except Exception:
            logger.exception("Avatar get/generate failed for '%s'", name)
            return None
