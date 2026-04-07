/**
 * MockMate API client
 * Thin wrapper around fetch for all backend endpoints.
 */

import { API_BASE as BASE_URL } from "@/constants/common";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedResume {
  name: string;
  email: string;
  phone: string;
  summary: string;
  skills: string[];
  experience: {
    title: string;
    company: string;
    duration: string;
    highlights: string[];
  }[];
  education: {
    degree: string;
    institution: string;
    year: string;
  }[];
  certifications: string[];
  bold_claims: string[];
  suggested_job_titles?: string[];
  resume_id: string;
  user_id: string;
  file_asset_id: string;
  filename: string;
  parsed_at: string;
}

export interface UploadResumeResponse {
  user_id: string;
  resume_id: string;
  file_asset_id: string;
  parsed_at: string;
  resume_data: ParsedResume;
}

export interface Question {
  id: number;
  type: "behavioural" | "technical" | "situational" | "curveball";
  question: string;
  intent: string;
  follow_ups: string[];
}

export interface StartSessionResponse {
  session_id: string;
  question_count: number;
  interviewer_name?: string;
  interviewer_avatar_url?: string;
  voice?: string;
  questions?: Question[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...init?.headers,
    },
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body?.detail ?? detail;
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(detail);
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Resume endpoints
// ---------------------------------------------------------------------------

export async function uploadResume(
  userId: string,
  file: File,
): Promise<UploadResumeResponse> {
  const form = new FormData();
  form.append("file", file);
  return request<UploadResumeResponse>(
    `/resume/upload?user_id=${encodeURIComponent(userId)}`,
    { method: "POST", body: form },
  );
}

export async function getResume(userId: string): Promise<ParsedResume | null> {
  try {
    const res = await request<{ user_id: string; resume_data: ParsedResume }>(
      `/resume/${encodeURIComponent(userId)}`,
    );
    return res.resume_data;
  } catch (err) {
    if (err instanceof Error && /404|No parsed résumé found/i.test(err.message)) return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Session endpoints
// ---------------------------------------------------------------------------

export async function startSession(payload: {
  user_id: string;
  persona: string;
  job_role: string;
  difficulty: string;
}): Promise<StartSessionResponse> {
  return request<StartSessionResponse>("/session/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
