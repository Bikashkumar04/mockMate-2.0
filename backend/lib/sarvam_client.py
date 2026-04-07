"""
Sarvam AI API Client
Centralized wrapper for all Sarvam AI API interactions.
Handles authentication, error handling, retries, and exponential backoff.
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import os
import wave
from typing import Any, Dict, List, Optional, Union

import httpx
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)

logger = logging.getLogger(__name__)

_VALID_LLM_MODELS = {"sarvam-m", "sarvam-30b", "sarvam-105b"}
_VALID_STT_MODELS = {"saarika:v2.5", "saaras:v3", "saaras:v3-realtime", "saarika:v1", "saarika:v2", "saarika:flash"}
_VALID_TTS_MODELS = {"bulbul:v2", "bulbul:v3-beta", "bulbul:v3"}

_MODEL_ALIASES = {
    "sarvam-2b": "sarvam-m",
    "sarvam-stt": "saarika:v2.5",
    "sarvam-tts": "bulbul:v3",
}


class SarvamAPIError(Exception):
    """Base exception for Sarvam API errors."""
    pass


class SarvamRateLimitError(SarvamAPIError):
    """Raised when Sarvam API rate limit is hit."""
    pass


class SarvamAuthenticationError(SarvamAPIError):
    """Raised when Sarvam API authentication fails."""
    pass


class SarvamClient:
    """
    Unified client for Sarvam AI APIs.
    
    Provides methods for:
    - LLM text generation
    - Speech-to-Text (STT)
    - Text-to-Speech (TTS)
    - Vision/image understanding
    - Image generation
    """
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = "https://api.sarvam.ai",
        timeout: int = 60,
    ):
        """
        Initialize Sarvam client.
        
        Args:
            api_key: Sarvam API key (defaults to SARVAM_API_KEY env var)
            base_url: Base URL for Sarvam API
            timeout: Request timeout in seconds
        """
        self.api_key = api_key or os.getenv("SARVAM_API_KEY", "").strip()
        if not self.api_key:
            raise SarvamAuthenticationError(
                "SARVAM_API_KEY not set. Add it to your .env file."
            )
        
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

        def _normalize_model(raw_model: str, valid_models: set[str], fallback: str, kind: str) -> str:
            candidate = _MODEL_ALIASES.get(raw_model, raw_model)
            if candidate in valid_models:
                return candidate
            logger.warning("Invalid %s model '%s'; using fallback '%s'", kind, raw_model, fallback)
            return fallback
        
        # Model configurations from environment
        self.llm_model = _normalize_model(
            os.getenv("SARVAM_LLM_MODEL", "sarvam-m").strip(),
            _VALID_LLM_MODELS,
            "sarvam-m",
            "LLM",
        )
        self.stt_model = _normalize_model(
            os.getenv("SARVAM_STT_MODEL", "saarika:v2.5").strip(),
            _VALID_STT_MODELS,
            "saarika:v2.5",
            "STT",
        )
        self.tts_model = _normalize_model(
            os.getenv("SARVAM_TTS_MODEL", "bulbul:v3").strip(),
            _VALID_TTS_MODELS,
            "bulbul:v3",
            "TTS",
        )
        llm_endpoint = os.getenv("SARVAM_LLM_ENDPOINT", "").strip()
        llm_endpoints = os.getenv("SARVAM_LLM_ENDPOINTS", "").strip()
        if llm_endpoints:
            self.llm_endpoints = [item.strip() for item in llm_endpoints.split(",") if item.strip()]
        elif llm_endpoint:
            self.llm_endpoints = [llm_endpoint]
        else:
            self.llm_endpoints = [
                f"{self.base_url}/chat/completions",
                f"{self.base_url}/v1/chat/completions",
            ]
        self.stt_endpoint = os.getenv("SARVAM_STT_ENDPOINT", f"{self.base_url}/speech-to-text")
        self.tts_endpoint = os.getenv("SARVAM_TTS_ENDPOINT", f"{self.base_url}/text-to-speech")
        self.vision_endpoint = os.getenv("SARVAM_VISION_ENDPOINT", f"{self.base_url}/vision")
        self.image_gen_endpoint = os.getenv("SARVAM_IMAGE_GEN_ENDPOINT", f"{self.base_url}/image-generation")
        
        self._client: Optional[httpx.AsyncClient] = None
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create async HTTP client."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(self.timeout),
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                },
            )
        return self._client

    @staticmethod
    def _pcm16le_to_wav_bytes(
        pcm_bytes: bytes,
        sample_rate: int = 16000,
        channels: int = 1,
        sample_width: int = 2,
    ) -> bytes:
        """Wrap raw PCM bytes into a WAV container for STT file uploads."""
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav_file:
            wav_file.setnchannels(channels)
            wav_file.setsampwidth(sample_width)
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(pcm_bytes)
        return buffer.getvalue()
    
    async def close(self):
        """Close the HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
    
    async def __aenter__(self):
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()
    
    def _handle_response_error(self, response: httpx.Response):
        """Parse and raise appropriate errors for failed responses."""
        try:
            error_data = response.json()
            error_msg = error_data.get("error", {}).get("message", response.text)
        except Exception:
            error_msg = response.text
        
        if response.status_code == 401:
            raise SarvamAuthenticationError(f"Authentication failed: {error_msg}")
        elif response.status_code == 429:
            raise SarvamRateLimitError(f"Rate limit exceeded: {error_msg}")
        else:
            raise SarvamAPIError(f"API error ({response.status_code}): {error_msg}")
    
    @retry(
        retry=retry_if_exception_type((SarvamRateLimitError, httpx.TimeoutException)),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        stop=stop_after_attempt(5),
    )
    async def generate_text(
        self,
        prompt: str,
        system_instruction: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 2048,
        **kwargs,
    ) -> str:
        """
        Generate text using Sarvam LLM.
        
        Args:
            prompt: User prompt/query
            system_instruction: System instruction for model behavior
            temperature: Sampling temperature (0.0 to 1.0)
            max_tokens: Maximum tokens to generate
            **kwargs: Additional model parameters
        
        Returns:
            Generated text response
        """
        client = await self._get_client()
        
        payload = {
            "model": self.llm_model,
            "messages": [],
            "temperature": temperature,
            "max_tokens": max_tokens,
            **kwargs,
        }
        
        if system_instruction:
            payload["messages"].append({
                "role": "system",
                "content": system_instruction,
            })
        
        payload["messages"].append({
            "role": "user",
            "content": prompt,
        })
        
        logger.debug(f"Sarvam LLM request: {prompt[:100]}...")
        
        try:
            last_404: httpx.Response | None = None
            for endpoint in self.llm_endpoints:
                response = await client.post(endpoint, json=payload)
                if response.status_code == 404:
                    last_404 = response
                    continue
                if response.status_code != 200:
                    self._handle_response_error(response)

                result = response.json()
                generated_text = result["choices"][0]["message"]["content"]
                logger.debug(f"Sarvam LLM response: {generated_text[:100]}...")
                return generated_text

            if last_404 is not None:
                raise SarvamAPIError(
                    "LLM endpoint returned 404 for all configured routes. "
                    "Set SARVAM_LLM_ENDPOINT to your account-supported text endpoint."
                )
            raise SarvamAPIError("LLM endpoint request failed without a valid response.")
        
        except httpx.HTTPError as e:
            logger.error(f"Sarvam LLM HTTP error: {e}")
            raise SarvamAPIError(f"HTTP error during text generation: {e}")
    
    @retry(
        retry=retry_if_exception_type((SarvamRateLimitError, httpx.TimeoutException)),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        stop=stop_after_attempt(5),
    )
    async def speech_to_text(
        self,
        audio_data: bytes,
        language: str = "en-IN",
        audio_format: str = "pcm",
        **kwargs,
    ) -> str:
        """
        Convert speech to text using Sarvam STT.
        
        Args:
            audio_data: Raw audio bytes (PCM format)
            language: Language code (e.g., 'en-IN', 'hi-IN')
            audio_format: Audio format ('pcm', 'wav', 'mp3')
            **kwargs: Additional STT parameters
        
        Returns:
            Transcribed text
        """
        client = await self._get_client()

        fmt = (audio_format or "pcm").lower()
        sample_rate = int(kwargs.pop("sample_rate", 16000))
        channels = int(kwargs.pop("channels", 1))
        sample_width = int(kwargs.pop("sample_width", 2))

        upload_bytes = audio_data
        filename = f"audio.{fmt}"
        content_type = "application/octet-stream"

        if fmt == "pcm":
            upload_bytes = self._pcm16le_to_wav_bytes(
                audio_data,
                sample_rate=sample_rate,
                channels=channels,
                sample_width=sample_width,
            )
            filename = "audio.wav"
            content_type = "audio/wav"
        elif fmt == "wav":
            filename = "audio.wav"
            content_type = "audio/wav"
        elif fmt == "mp3":
            filename = "audio.mp3"
            content_type = "audio/mpeg"

        payload_format = "wav" if fmt == "pcm" else fmt
        form_data = {
            "model": kwargs.pop("model", self.stt_model),
            "language": language,
            "format": payload_format,
            **{k: str(v) for k, v in kwargs.items() if v is not None},
        }
        files = {"file": (filename, upload_bytes, content_type)}
        
        logger.debug(f"Sarvam STT request: {len(audio_data)} bytes, language={language}")
        
        try:
            response = await client.post(self.stt_endpoint, data=form_data, files=files)
            
            if response.status_code != 200:
                self._handle_response_error(response)
            
            result = response.json()
            transcribed_text = (
                result.get("transcript")
                or result.get("text")
                or result.get("output", {}).get("transcript", "")
            )
            
            logger.debug(f"Sarvam STT response: {transcribed_text}")
            return transcribed_text
        
        except httpx.HTTPError as e:
            logger.error(f"Sarvam STT HTTP error: {e}")
            raise SarvamAPIError(f"HTTP error during speech-to-text: {e}")
    
    @retry(
        retry=retry_if_exception_type((SarvamRateLimitError, httpx.TimeoutException)),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        stop=stop_after_attempt(5),
    )
    async def text_to_speech(
        self,
        text: str,
        voice: Optional[str] = None,
        speed: float = 1.0,
        pitch: float = 0.0,
        language: str = "en-IN",
        **kwargs,
    ) -> bytes:
        """
        Convert text to speech using Sarvam TTS.
        
        Args:
            text: Text to synthesize
            voice: Voice ID/name
            speed: Speech speed (0.5 to 2.0)
            pitch: Pitch adjustment (-20.0 to 20.0)
            language: Language code
            **kwargs: Additional TTS parameters
        
        Returns:
            Audio bytes (PCM or WAV format)
        """
        client = await self._get_client()
        
        payload = {
            "model": kwargs.pop("model", self.tts_model),
            "text": text,
            "language": language,
            **kwargs,
        }
        if voice and voice != "en-IN-default":
            payload["voice"] = voice
        if speed != 1.0:
            payload["speed"] = speed
        if pitch != 0.0:
            payload["pitch"] = pitch
        
        logger.debug(f"Sarvam TTS request: {text[:100]}...")
        
        try:
            response = await client.post(self.tts_endpoint, json=payload)
            
            if response.status_code == 400 and payload.get("voice"):
                # Fallback for legacy/unsupported voice names from old configs.
                fallback_payload = dict(payload)
                fallback_payload.pop("voice", None)
                response = await client.post(self.tts_endpoint, json=fallback_payload)

            if response.status_code != 200:
                self._handle_response_error(response)
            
            result = response.json()
            
            # Assuming Sarvam returns base64-encoded audio
            audio_b64 = result.get("audio", "")
            audio_bytes = base64.b64decode(audio_b64)
            
            logger.debug(f"Sarvam TTS response: {len(audio_bytes)} bytes")
            return audio_bytes
        
        except httpx.HTTPError as e:
            logger.error(f"Sarvam TTS HTTP error: {e}")
            raise SarvamAPIError(f"HTTP error during text-to-speech: {e}")
    
    @retry(
        retry=retry_if_exception_type((SarvamRateLimitError, httpx.TimeoutException)),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        stop=stop_after_attempt(5),
    )
    async def analyze_image(
        self,
        image_data: bytes,
        prompt: str,
        image_format: str = "jpeg",
        **kwargs,
    ) -> str:
        """
        Analyze image using Sarvam Vision API.
        
        Args:
            image_data: Image bytes
            prompt: Question/instruction about the image
            image_format: Image format ('jpeg', 'png')
            **kwargs: Additional vision parameters
        
        Returns:
            Analysis result text
        """
        client = await self._get_client()
        
        # Base64 encode image
        image_b64 = base64.b64encode(image_data).decode("utf-8")
        
        payload = {
            "image": image_b64,
            "prompt": prompt,
            "format": image_format,
            **kwargs,
        }
        
        logger.debug(f"Sarvam Vision request: {len(image_data)} bytes, prompt={prompt[:50]}...")
        
        try:
            response = await client.post(self.vision_endpoint, json=payload)
            
            if response.status_code != 200:
                self._handle_response_error(response)
            
            result = response.json()
            analysis = result.get("analysis", "")
            
            logger.debug(f"Sarvam Vision response: {analysis[:100]}...")
            return analysis
        
        except httpx.HTTPError as e:
            logger.error(f"Sarvam Vision HTTP error: {e}")
            raise SarvamAPIError(f"HTTP error during image analysis: {e}")
    
    @retry(
        retry=retry_if_exception_type((SarvamRateLimitError, httpx.TimeoutException)),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        stop=stop_after_attempt(5),
    )
    async def generate_image(
        self,
        prompt: str,
        width: int = 1024,
        height: int = 1024,
        num_images: int = 1,
        **kwargs,
    ) -> List[bytes]:
        """
        Generate images using Sarvam Image Generation API.
        
        Args:
            prompt: Image generation prompt
            width: Image width in pixels
            height: Image height in pixels
            num_images: Number of images to generate
            **kwargs: Additional generation parameters
        
        Returns:
            List of image bytes
        """
        client = await self._get_client()
        
        payload = {
            "prompt": prompt,
            "width": width,
            "height": height,
            "num_images": num_images,
            **kwargs,
        }
        
        logger.debug(f"Sarvam Image Gen request: {prompt[:100]}...")
        
        try:
            response = await client.post(self.image_gen_endpoint, json=payload)
            
            if response.status_code != 200:
                self._handle_response_error(response)
            
            result = response.json()
            
            # Decode base64-encoded images
            images = []
            for img_b64 in result.get("images", []):
                images.append(base64.b64decode(img_b64))
            
            logger.debug(f"Sarvam Image Gen response: {len(images)} image(s)")
            return images
        
        except httpx.HTTPError as e:
            logger.error(f"Sarvam Image Gen HTTP error: {e}")
            raise SarvamAPIError(f"HTTP error during image generation: {e}")


# Singleton instance for reuse across agents
_sarvam_client: Optional[SarvamClient] = None


def get_sarvam_client() -> SarvamClient:
    """Get or create singleton Sarvam client instance."""
    global _sarvam_client
    if _sarvam_client is None:
        _sarvam_client = SarvamClient()
    return _sarvam_client
