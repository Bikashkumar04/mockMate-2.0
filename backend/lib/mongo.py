"""
Shared MongoDB helpers for MockMate.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from bson import Binary, ObjectId
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorCollection, AsyncIOMotorDatabase


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


_MONGODB_URI = os.getenv("MONGODB_URI", "").strip()
_MONGODB_DATABASE = os.getenv("MONGODB_DATABASE", "").strip()

_client: AsyncIOMotorClient | None = None


def get_mongo_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        if not _MONGODB_URI:
            raise EnvironmentError(
                "Required environment variable 'MONGODB_URI' is not set. "
                "Add it to your .env file and restart the server."
            )
        _client = AsyncIOMotorClient(_MONGODB_URI)
    return _client


def get_database() -> AsyncIOMotorDatabase:
    if not _MONGODB_DATABASE:
        raise EnvironmentError(
            "Required environment variable 'MONGODB_DATABASE' is not set. "
            "Add it to your .env file and restart the server."
        )
    return get_mongo_client()[_MONGODB_DATABASE]


def get_collection(name: str) -> AsyncIOMotorCollection:
    return get_database()[name]


def strip_mongo_id(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: strip_mongo_id(val)
            for key, val in value.items()
            if key != "_id"
        }
    if isinstance(value, list):
        return [strip_mongo_id(item) for item in value]
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, Binary):
        return bytes(value)
    return value


async def save_binary_asset(
    *,
    asset_id: str,
    data: bytes,
    content_type: str,
    collection: str = "assets",
    filename: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    document: dict[str, Any] = {
        "_id": asset_id,
        "content_type": content_type,
        "data": Binary(data),
        "updated_at": _utc_now(),
    }
    if filename:
        document["filename"] = filename
    if metadata:
        document["metadata"] = metadata

    await get_collection(collection).replace_one(
        {"_id": asset_id},
        document,
        upsert=True,
    )
    return strip_mongo_id(document)


async def get_binary_asset(
    asset_id: str,
    *,
    collection: str = "assets",
) -> tuple[bytes, str, dict[str, Any]] | None:
    document = await get_collection(collection).find_one({"_id": asset_id})
    if not document:
        return None
    payload = bytes(document.get("data", b""))
    content_type = str(document.get("content_type") or "application/octet-stream")
    return payload, content_type, strip_mongo_id(document)


async def ensure_user_record(user_id: str, **fields: Any) -> None:
    update_fields = {
        **fields,
        "updated_at": _utc_now(),
    }
    await get_collection("users").update_one(
        {"_id": user_id},
        {
            "$set": update_fields,
            "$setOnInsert": {
                "user_id": user_id,
                "created_at": _utc_now(),
            },
        },
        upsert=True,
    )
