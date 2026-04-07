"""
Minimal LlamaParse HTTP client.

Uses the raw Llama Cloud parsing API instead of the Python SDK because the
current SDK stack is not compatible with Python 3.14 in this environment.
"""

from __future__ import annotations

import json
import os
from typing import Any

import httpx


class LlamaParseError(Exception):
    pass


class LlamaParseClient:
    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: int = 300,
    ) -> None:
        self.api_key = (api_key or os.getenv("LLAMA_CLOUD_API_KEY", "")).strip()
        if not self.api_key:
            raise LlamaParseError(
                "LLAMA_CLOUD_API_KEY not set. Add it to your backend .env file."
            )
        self.base_url = (base_url or os.getenv("LLAMA_CLOUD_BASE_URL", "https://api.cloud.llamaindex.ai")).rstrip("/")
        self.timeout = timeout
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(timeout),
            headers={"Authorization": f"Bearer {self.api_key}"},
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def parse_markdown(
        self,
        *,
        file_bytes: bytes,
        filename: str,
        mime_type: str,
        check_interval: float = 1.0,
        max_polls: int = 180,
    ) -> str:
        files = {"file": (filename, file_bytes, mime_type)}
        data = {"from_python_package": "false"}
        upload = await self._client.post(f"{self.base_url}/api/parsing/upload", files=files, data=data)
        if upload.status_code >= 400:
            raise LlamaParseError(
                f"LlamaParse upload failed ({upload.status_code}): {upload.text}"
            )
        job_id = upload.json().get("id")
        if not job_id:
            raise LlamaParseError("LlamaParse upload succeeded but no job id was returned.")

        for _ in range(max_polls):
            status_resp = await self._client.get(f"{self.base_url}/api/parsing/job/{job_id}")
            if status_resp.status_code >= 400:
                raise LlamaParseError(
                    f"LlamaParse status check failed ({status_resp.status_code}): {status_resp.text}"
                )
            status_payload = status_resp.json()
            status = str(status_payload.get("status", "")).upper()
            if status == "SUCCESS":
                result_resp = await self._client.get(
                    f"{self.base_url}/api/parsing/job/{job_id}/result/markdown"
                )
                if result_resp.status_code >= 400:
                    raise LlamaParseError(
                        f"LlamaParse result fetch failed ({result_resp.status_code}): {result_resp.text}"
                    )
                return result_resp.text
            if status in {"ERROR", "FAILED", "CANCELED"}:
                error_message = status_payload.get("error_message") or status_payload.get("error") or status_resp.text
                raise LlamaParseError(f"LlamaParse job failed: {error_message}")
            await __import__("asyncio").sleep(check_interval)

        raise LlamaParseError("LlamaParse job timed out before completion.")
