"""
ResumeParserAgent
-----------------
Uses LlamaParse to extract structured data from an uploaded resume and stores
both the raw file and parsed JSON in MongoDB.
"""

from __future__ import annotations

import logging
import os
import re
import uuid
from io import BytesIO
from datetime import datetime, timezone
from typing import Any

from agents.config import (
    MONGODB_ASSET_COLLECTION as _ASSET_COLLECTION,
    MONGODB_RESUME_COLLECTION as _COLLECTION,
)
from lib.mongo import ensure_user_record, get_binary_asset, get_collection, save_binary_asset, strip_mongo_id
from lib.llamaparse_client import LlamaParseClient, LlamaParseError

from PyPDF2 import PdfReader
from docx import Document

logger = logging.getLogger(__name__)

_MIME_MAP = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".txt": "text/plain",
}

_SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".doc", ".txt"}


def _mime_for(filename: str) -> str:
    return _MIME_MAP.get(os.path.splitext(filename.lower())[1], "application/octet-stream")


def _ext_of(filename: str) -> str:
    return os.path.splitext(filename.lower())[1]


def _asset_id_for_resume_file(user_id: str) -> str:
    return f"resume_file:{user_id}"


class ResumeParserAgent:
    def __init__(self) -> None:
        try:
            self._llamaparse_client: LlamaParseClient | None = LlamaParseClient()
        except Exception as exc:
            self._llamaparse_client = None
            logger.warning(
                "LlamaParse disabled for this run (%s). Resume parsing will use local extraction.",
                exc,
            )
        self._resumes = get_collection(_COLLECTION)

    async def parse(
        self,
        file_bytes: bytes,
        filename: str,
        user_id: str,
    ) -> dict[str, Any]:
        ext = _ext_of(filename)
        if ext not in _SUPPORTED_EXTENSIONS:
            raise ValueError(
                f"Unsupported file type '{ext}'. "
                f"Accepted: {', '.join(sorted(_SUPPORTED_EXTENSIONS))}"
            )

        resume_id = str(uuid.uuid4())
        content_type = _mime_for(filename)
        asset_id = _asset_id_for_resume_file(user_id)

        await save_binary_asset(
            asset_id=asset_id,
            data=file_bytes,
            content_type=content_type,
            filename=filename,
            collection=_ASSET_COLLECTION,
            metadata={
                "user_id": user_id,
                "resume_id": resume_id,
                "kind": "resume_file",
            },
        )

        structured = await self._parse_with_llamaparse(file_bytes, filename, content_type)
        parsed_at = datetime.now(timezone.utc).isoformat()
        structured.update(
            {
                "resume_id": resume_id,
                "user_id": user_id,
                "filename": filename,
                "content_type": content_type,
                "file_asset_id": asset_id,
                "parsed_at": parsed_at,
            }
        )

        await self._persist(user_id, resume_id, structured)
        await ensure_user_record(user_id, latest_resume_id=resume_id, latest_resume_at=parsed_at)
        return structured

    async def get_resume(self, user_id: str) -> dict[str, Any] | None:
        document = await self._resumes.find_one({"_id": user_id}, {"history": 0})
        return strip_mongo_id(document) if document else None

    async def get_resume_file(self, user_id: str) -> tuple[bytes, str] | None:
        asset = await get_binary_asset(
            _asset_id_for_resume_file(user_id),
            collection=_ASSET_COLLECTION,
        )
        if not asset:
            return None
        payload, content_type, _meta = asset
        return payload, content_type

    async def _parse_with_llamaparse(
        self,
        file_bytes: bytes,
        filename: str,
        content_type: str,
    ) -> dict[str, Any]:
        ext = _ext_of(filename)
        if ext == ".txt":
            return self._parse_text_resume(file_bytes.decode("utf-8", errors="ignore"))

        if self._llamaparse_client is not None:
            try:
                markdown = await self._llamaparse_client.parse_markdown(
                    file_bytes=file_bytes,
                    filename=filename,
                    mime_type=content_type,
                )
                return self._parse_markdown_resume(markdown)
            except (LlamaParseError, Exception) as exc:
                logger.warning("LlamaParse failed for '%s': %s", filename, exc)

        extracted = self._extract_text_locally(file_bytes, ext)
        if extracted.strip():
            return self._parse_text_resume(extracted)

        logger.warning("Local resume extraction produced no text for '%s'", filename)
        return self._parse_text_resume("")

    @staticmethod
    def _extract_text_locally(file_bytes: bytes, ext: str) -> str:
        ext = (ext or "").lower()
        if ext == ".txt":
            return file_bytes.decode("utf-8", errors="ignore")

        if ext == ".pdf":
            try:
                reader = PdfReader(BytesIO(file_bytes))
                parts: list[str] = []
                for page in reader.pages:
                    try:
                        parts.append(page.extract_text() or "")
                    except Exception:
                        continue
                return "\n".join(p for p in parts if p.strip())
            except Exception:
                return ""

        if ext == ".docx":
            try:
                doc = Document(BytesIO(file_bytes))
                return "\n".join(p.text for p in doc.paragraphs if (p.text or "").strip())
            except Exception:
                return ""

        if ext == ".doc":
            # Best-effort only; real .doc parsing requires extra native deps.
            return file_bytes.decode("latin-1", errors="ignore")

        return ""

    @staticmethod
    def _parse_markdown_resume(markdown: str) -> dict[str, Any]:
        text = re.sub(r"`{3,}.*?`{3,}", " ", markdown, flags=re.S)
        lines = [line.strip(" -*\t") for line in text.splitlines()]
        lines = [line.strip() for line in lines if line.strip()]

        email_match = re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", markdown, re.I)
        phone_match = re.search(r"(\+?\d[\d\-\s()]{7,}\d)", markdown)

        name = ""
        for line in lines[:8]:
            if email_match and email_match.group(0) in line:
                continue
            if phone_match and phone_match.group(1) in line:
                continue
            if re.search(r"(linkedin|github|portfolio|resume|curriculum vitae)", line, re.I):
                continue
            if 1 <= len(line.split()) <= 5:
                name = line.replace("#", "").strip()
                break

        def collect_section(*section_names: str) -> list[str]:
            section_headers = {name.lower() for name in section_names}
            collected: list[str] = []
            active = False
            for line in lines:
                header = re.sub(r"^#+\s*", "", line).strip().lower()
                if header in section_headers:
                    active = True
                    continue
                if active and (
                    re.match(r"^#+\s*", line)
                    or header in {
                        "experience",
                        "work experience",
                        "professional experience",
                        "education",
                        "skills",
                        "technical skills",
                        "core skills",
                        "certifications",
                        "projects",
                        "summary",
                        "profile",
                    }
                ):
                    break
                if active:
                    collected.append(line)
            return collected

        summary_lines = collect_section("summary", "professional summary", "profile", "about")
        if not summary_lines:
            summary_candidates = []
            for line in lines[1:10]:
                lower = line.lower()
                if email_match and email_match.group(0).lower() in lower:
                    continue
                if any(token in lower for token in ["linkedin", "github", "portfolio", "@"]):
                    continue
                if len(line.split()) >= 6:
                    summary_candidates.append(line)
                if len(" ".join(summary_candidates)) > 400:
                    break
            summary_lines = summary_candidates[:3]
        summary = " ".join(summary_lines)[:800]

        skills_lines = collect_section("skills", "technical skills", "core skills", "technologies")
        skills_blob = " | ".join(skills_lines)
        skills = []
        for chunk in re.split(r"[,\|/•·]", skills_blob):
            skill = chunk.strip()
            if 1 < len(skill) <= 40 and not re.search(r"^(skills?|technologies)$", skill, re.I):
                skills.append(skill)
        deduped_skills: list[str] = []
        seen_skills = set()
        for skill in skills:
            key = skill.lower()
            if key not in seen_skills:
                seen_skills.add(key)
                deduped_skills.append(skill)

        certifications = []
        for line in collect_section("certifications", "licenses"):
            if line:
                certifications.append(line)

        education = []
        for line in collect_section("education", "academic background"):
            year_match = re.search(r"(19|20)\d{2}", line)
            parts = [part.strip() for part in re.split(r"\||,|-", line) if part.strip()]
            degree = parts[0] if parts else line
            institution = parts[1] if len(parts) > 1 else ""
            education.append(
                {
                    "degree": degree[:160],
                    "institution": institution[:160],
                    "year": year_match.group(0) if year_match else "",
                }
            )

        experience = []
        exp_lines = collect_section("experience", "work experience", "professional experience")
        current: dict[str, Any] | None = None
        for line in exp_lines:
            if re.match(r"^(?:[A-Z].{2,80})\s+\|\s+(?:[A-Z].{1,80})", line):
                if current:
                    experience.append(current)
                parts = [part.strip() for part in line.split("|")]
                title = parts[0] if parts else line
                company = parts[1] if len(parts) > 1 else ""
                duration = parts[2] if len(parts) > 2 else ""
                current = {
                    "title": title[:160],
                    "company": company[:160],
                    "duration": duration[:120],
                    "highlights": [],
                }
                continue
            if current is None and len(line.split()) <= 14:
                current = {
                    "title": line[:160],
                    "company": "",
                    "duration": "",
                    "highlights": [],
                }
                continue
            if current is not None:
                if len(current["highlights"]) < 6:
                    current["highlights"].append(line[:280])
        if current:
            experience.append(current)

        bold_claims = []
        for line in exp_lines:
            if re.search(r"\b(\d+%|\d+x|\$\d+|\d+\+)\b", line):
                bold_claims.append(line[:220])
        suggested_job_titles = []
        for item in experience[:5]:
            title = str(item.get("title") or "").strip()
            if title:
                suggested_job_titles.append(title)

        def dedupe(items: list[str]) -> list[str]:
            out: list[str] = []
            seen = set()
            for item in items:
                key = item.lower()
                if item and key not in seen:
                    seen.add(key)
                    out.append(item)
            return out

        return {
            "name": name,
            "email": email_match.group(0) if email_match else "",
            "phone": phone_match.group(1).strip() if phone_match else "",
            "summary": summary,
            "skills": dedupe(deduped_skills)[:30],
            "experience": experience[:8],
            "education": education[:5],
            "certifications": dedupe(certifications)[:10],
            "bold_claims": dedupe(bold_claims)[:10],
            "suggested_job_titles": dedupe(suggested_job_titles)[:10],
        }

    @staticmethod
    def _parse_text_resume(text: str) -> dict[str, Any]:
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        email_match = re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", text, re.I)
        phone_match = re.search(r"(\+?\d[\d\-\s()]{7,}\d)", text)
        name = lines[0] if lines else ""
        summary = " ".join(lines[1:4])[:600] if len(lines) > 1 else ""
        skills = []
        for line in lines:
            if ":" in line and any(word in line.lower() for word in ["skills", "technologies", "tools"]):
                skills = [part.strip() for part in line.split(":", 1)[1].split(",") if part.strip()]
                break
        return {
            "name": name,
            "email": email_match.group(0) if email_match else "",
            "phone": phone_match.group(1).strip() if phone_match else "",
            "summary": summary,
            "skills": skills,
            "experience": [],
            "education": [],
            "certifications": [],
            "bold_claims": [],
            "suggested_job_titles": [],
        }

    async def _persist(self, user_id: str, resume_id: str, data: dict[str, Any]) -> None:
        history_entry = {
            "resume_id": resume_id,
            "parsed_at": data.get("parsed_at"),
            "filename": data.get("filename"),
        }
        await self._resumes.update_one(
            {"_id": user_id},
            {
                "$set": {
                    "_id": user_id,
                    **data,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
                "$push": {
                    "history": {
                        "$each": [history_entry],
                        "$slice": -10,
                    }
                },
            },
            upsert=True,
        )
