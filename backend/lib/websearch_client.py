"""Web search client(s) for enriching prompts with fresh context.

Currently supports Google Custom Search JSON API (CSE).
Designed to be optional: when disabled or misconfigured, returns no results.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Any

import httpx

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class WebSearchResult:
    title: str
    snippet: str
    link: str


class WebSearchClient:
    async def search(self, query: str, max_results: int = 3) -> list[WebSearchResult]:
        raise NotImplementedError


class GoogleCSEClient(WebSearchClient):
    def __init__(
        self,
        api_key: str,
        cx: str,
        timeout_s: float = 5.0,
    ) -> None:
        self._api_key = api_key
        self._cx = cx
        self._timeout_s = timeout_s

    async def search(self, query: str, max_results: int = 3) -> list[WebSearchResult]:
        query = (query or "").strip()
        if not query:
            return []

        max_results = max(1, min(int(max_results or 3), 10))
        url = "https://www.googleapis.com/customsearch/v1"
        params = {
            "key": self._api_key,
            "cx": self._cx,
            "q": query,
            "num": str(max_results),
        }

        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(self._timeout_s)) as client:
                resp = await client.get(url, params=params)
                resp.raise_for_status()
                data = resp.json()
        except Exception as exc:
            logger.warning("Websearch failed (%s): %s", type(exc).__name__, exc)
            return []

        items = data.get("items") or []
        results: list[WebSearchResult] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or "").strip()
            snippet = str(item.get("snippet") or "").strip()
            link = str(item.get("link") or "").strip()
            if not link:
                continue
            results.append(WebSearchResult(title=title[:200], snippet=snippet[:400], link=link[:500]))
        return results


def _env_truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on", "enabled"}


def get_websearch_client() -> WebSearchClient | None:
    if not _env_truthy(os.getenv("WEBSEARCH_ENABLED", "")):
        return None

    provider = (os.getenv("WEBSEARCH_PROVIDER", "google_cse") or "google_cse").strip().lower()
    if provider not in {"google_cse", "google", "cse"}:
        logger.warning("Unsupported WEBSEARCH_PROVIDER=%s; disabling websearch", provider)
        return None

    api_key = (os.getenv("GOOGLE_CSE_API_KEY") or "").strip()
    cx = (os.getenv("GOOGLE_CSE_CX") or "").strip()
    if not api_key or not cx:
        logger.warning("Websearch enabled but GOOGLE_CSE_API_KEY/GOOGLE_CSE_CX not set; disabling")
        return None

    timeout_s = float(os.getenv("WEBSEARCH_TIMEOUT_S", "5") or "5")
    return GoogleCSEClient(api_key=api_key, cx=cx, timeout_s=timeout_s)


def build_web_context(
    *,
    query: str,
    results: list[WebSearchResult],
    max_chars: int = 1500,
) -> str:
    """Serialize results into a compact context blob safe for prompts."""

    payload: dict[str, Any] = {
        "query": query,
        "results": [
            {"title": r.title, "snippet": r.snippet, "link": r.link}
            for r in results
        ],
    }
    text = json.dumps(payload, ensure_ascii=False)
    if len(text) <= max_chars:
        return text
    return text[: max(0, max_chars - 3)] + "..."
