"use client";

import Image from "next/image";
import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import AppHeader from "@/components/AppHeader";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { API_BASE, PERSONA_LABELS } from "@/constants/common";
import PerformanceCard, {
  PerformanceCardSkeleton,
  type PerformanceCardData,
} from "@/components/PerformanceCard";

const FEEDBACK_RETRY_COOLDOWN_MS = 8000;
const FEEDBACK_RETRY_MAX_ATTEMPTS = 3;

/* ── Data fetchers ─────────────────────────────────────────────────────── */

async function fetchSessionMeta(sessionId: string): Promise<SessionMeta> {
  const res = await fetch(`${API_BASE}/session/${sessionId}`);
  if (!res.ok) throw new Error("Session not found");
  return res.json();
}

async function fetchOrGenerateFeedback(sessionId: string): Promise<FeedbackReport> {
  // Try fetching previously generated feedback first
  const getRes = await fetch(`${API_BASE}/feedback/${sessionId}`);
  if (getRes.ok) return getRes.json();

  // Not found — generate it
  const res = await fetch(`${API_BASE}/feedback/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body?.detail ?? detail;
    } catch { /* ignore */ }
    throw new Error(detail);
  }
  return res.json();
}

async function regenerateFeedback(sessionId: string): Promise<FeedbackReport> {
  const res = await fetch(`${API_BASE}/feedback/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ session_id: sessionId, refresh_card_values: true }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body?.detail ?? detail;
    } catch { /* ignore */ }
    throw new Error(detail);
  }
  return res.json();
}

async function fetchTranscript(sessionId: string): Promise<TranscriptData> {
  const res = await fetch(`${API_BASE}/transcript/${sessionId}`);
  if (!res.ok) throw new Error("Transcript not available");
  return res.json();
}

/**
 * Mirror of the backend's low-signal filter — hides ASR artifacts (non-Latin
 * script noise, single-word gibberish, filler-only turns) from the transcript
 * panel so they don't distract from the real conversation.
 */
const LOW_SIGNAL_SINGLETONS = new Set([
  "hi","hello","hey","hmm","hm","uh","uhh","um","umm",
  "ok","okay","yes","yeah","yep","no","nope","nah","alo","huh",
]);

function isLowSignalTurn(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return true;

  // Non-Latin script: if more than half the alphabetic chars are non-ASCII,
  // it's almost certainly an ASR mis-transcription.
  const alphas = [...t].filter((c) => /\p{L}/u.test(c));
  if (alphas.length > 0) {
    const latinCount = alphas.filter((c) => /[a-zA-Z]/.test(c)).length;
    if (latinCount / alphas.length < 0.5) return true;
  }

  const words = t.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;

  // Filler-only turns
  if (words.length <= 2 && words.every((w) => LOW_SIGNAL_SINGLETONS.has(w.replace(/[.,!?;:]/g, "")))) return true;

  // Single ultra-short word
  if (words.length === 1 && words[0].replace(/[.,!?;:]/g, "").length <= 2) return true;

  // Repeated-token gibberish
  const unique = new Set(words.map((w) => w.replace(/[.,!?;:]/g, "")));
  if (words.length >= 3 && unique.size === 1) return true;

  return false;
}

/* ── Types ─────────────────────────────────────────────────────────────── */

interface FeedbackReport {
  overall_score: number;
  dimension_scores: {
    communication: number;
    confidence: number;
    structure: number;
    technical_depth: number;
    domain_vocabulary: number;
    posture_presence?: number;
  };
  strengths: string[];
  improvement_areas: string[];
  filler_words: { total_count: number; words: { word: string; count: number }[] };
  vocabulary_calibration: string;
  tone_analysis: string;
  technical_depth_analysis: string;
  posture_summary?: string;
  decision: "offer" | "rejection";
  decision_reason?: string;
  decision_letter: string;
  posture_data_used?: boolean;
  posture_frames_analysed?: number;
  session_id: string;
  compiled_at: string;
}

interface TranscriptTurn {
  speaker: "user" | "interviewer";
  text: string;
  ts?: string;
}

interface TranscriptData {
  session_id: string;
  turns: TranscriptTurn[];
  saved_at?: string;
}

interface SessionMeta {
  session_id: string;
  user_id?: string;
  persona: string;
  job_role: string;
  difficulty?: string;
  interviewer_name: string;
  interviewer_avatar_url?: string;
  status: string;
  ended_by: string | null;
  created_at: string;
  ended_at: string | null;
  question_count: number;
  overall_score: number | null;
  feedback_ready: boolean;
}

/* ── Small components ──────────────────────────────────────────────────── */

function ScoreRing({ score }: { score: number }) {
  const color =
    score >= 70 ? "text-emerald-400" : score >= 40 ? "text-amber-400" : "text-red-400";
  return (
    <span className={`text-4xl font-bold tabular-nums ${color}`}>
      {score}
      <span className="text-lg font-normal text-white/40">/100</span>
    </span>
  );
}

function DimensionBar({ label, value }: { label: string; value: number }) {
  const color =
    value >= 70 ? "bg-emerald-500" : value >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-3">
      <span className="w-36 shrink-0 text-xs text-white/60 capitalize">
        {label.replace(/_/g, " ")}
      </span>
      <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="w-8 text-right text-xs font-mono text-white/70">{value}</span>
    </div>
  );
}

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={`rounded-2xl border border-white/10 bg-white/5 ${className}`}>
      <CardContent className="p-5">
        <h2 className="text-sm font-semibold text-white/50 underline underline-offset-6 uppercase tracking-widest mb-4">
          {title}
        </h2>
        {children}
      </CardContent>
    </Card>
  );
}
/* Stateful avatar component: shows the AI photo or falls back to initial. */
function InterviewerAvatarImg({
  src,
  label,
  initial,
}: {
  src?: string;
  label: string;
  initial: string;
}) {
  const [err, setErr] = useState(false);
  if (src && !err) {
    return (
      <Image
        src={src}
        alt={label}
        width={24}
        height={24}
        unoptimized
        onError={() => setErr(true)}
        className="h-6 w-6 rounded-full object-cover"
      />
    );
  }
  return (
    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-white/70 text-[10px] font-bold">
      {initial}
    </div>
  );
}
/* Stateful user avatar: shows Google photo or falls back to initials. */
function UserAvatarImg({ src, name, email }: { src?: string | null; name?: string | null; email?: string | null }) {
  const [err, setErr] = useState(false);
  const initials = name
    ? name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()
    : (email?.[0]?.toUpperCase() ?? "U");

  if (src && !err) {
    return (
      <Image
        src={src}
        alt="You"
        width={24}
        height={24}
        unoptimized
        onError={() => setErr(true)}
        className="h-6 w-6 rounded-full object-cover"
      />
    );
  }
  return (
    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-orange text-white text-[10px] font-bold">
      {initials}
    </div>
  );
}

/* ── Transcript list (shared between sidebar and sheet) ────────────────── */

function TranscriptList({
  turns,
  interviewerName,
  interviewerAvatarUrl,
  userImage,
  userName,
  userEmail,
}: {
  turns: TranscriptTurn[];
  interviewerName?: string;
  interviewerAvatarUrl?: string;
  userImage?: string | null;
  userName?: string | null;
  userEmail?: string | null;
}) {
  if (turns.length === 0) {
    return <p className="text-xs text-white/30 italic px-1">No transcript turns recorded.</p>;
  }

  const interviewerInitial = (interviewerName ?? "I").trim()[0].toUpperCase();
  const interviewerLabel = interviewerName ?? "Interviewer";

  return (
    <div className="flex flex-col gap-3">
      {turns.map((turn, i) => {
        const isUser = turn.speaker === "user";
        return (
          <div key={i} className={`flex gap-2.5 ${isUser ? "" : ""}`}>
            <div className="mt-0.5 shrink-0">
              {isUser ? (
                <UserAvatarImg src={userImage} name={userName} email={userEmail} />
              ) : (
                <InterviewerAvatarImg
                  src={interviewerAvatarUrl}
                  label={interviewerLabel}
                  initial={interviewerInitial}
                />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-white/40 mb-0.5">
                {isUser ? "You" : interviewerLabel}
              </p>
              <p className="text-sm leading-relaxed text-white/80">{turn.text}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Main content ──────────────────────────────────────────────────────── */

function FeedbackContent() {
  const params = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session, isPending: sessionPending } = useSession();
  const sessionId = params.get("session_id") ?? "";
  const [sheetOpen, setSheetOpen] = useState(false);
  const [retryAttempts, setRetryAttempts] = useState(0);
  const [lastRetryAt, setLastRetryAt] = useState(0);
  const [nowMs, setNowMs] = useState(0);

  // ── Auth guard ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionPending && !session) {
      router.replace(`/login?next=/interview/feedback?session_id=${sessionId}`);
    }
  }, [session, sessionPending, router, sessionId]);

  // ── Ownership guard — runs once sessionMeta loads ─────────────────────────
  const { data: sessionMeta } = useQuery({
    queryKey: ["session-meta", sessionId],
    queryFn: () => fetchSessionMeta(sessionId),
    enabled: !!sessionId,
    retry: 2,
    retryDelay: 1500,
  });

  useEffect(() => {
    if (sessionMeta?.user_id && session?.user?.id && sessionMeta.user_id !== session.user.id) {
      router.replace("/dashboard");
    }
  }, [sessionMeta, session, router]);

  const { data: report, isLoading: loading, error: queryError } = useQuery({
    queryKey: ["feedback", sessionId],
    queryFn: () => fetchOrGenerateFeedback(sessionId),
    enabled: !!sessionId,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: 3,
    retryDelay: (attempt) => Math.min(2000 * 2 ** attempt, 10000),
  });

  const { data: transcript, isLoading: transcriptLoading } = useQuery({
    queryKey: ["transcript", sessionId],
    queryFn: () => fetchTranscript(sessionId),
    enabled: !!sessionId,
    retry: 6,
    retryDelay: (attempt) => Math.min(2000 * 2 ** attempt, 8000),
    // Keep polling every 3 s until transcript data arrives — covers the
    // race window where the backend hasn't finished persisting yet.
    refetchInterval: (query) => (query.state.data ? false : 3000),
  });

  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  const retryCooldownLeft = Math.max(
    0,
    FEEDBACK_RETRY_COOLDOWN_MS - (nowMs - lastRetryAt),
  );
  const retryLimitReached = retryAttempts >= FEEDBACK_RETRY_MAX_ATTEMPTS;

  const retryFeedbackMutation = useMutation({
    mutationFn: () => regenerateFeedback(sessionId),
    onSuccess: async (newReport) => {
      queryClient.setQueryData(["feedback", sessionId], newReport);
      try {
        const refreshedCard = await fetch(
          `${API_BASE}/performance-card/${sessionId}?refresh_values=true&force_regenerate=false`,
          { cache: "no-store" },
        ).then((r) => (r.ok ? r.json() : null));
        if (refreshedCard) {
          queryClient.setQueryData(["performance-card", sessionId], refreshedCard);
        } else {
          queryClient.invalidateQueries({ queryKey: ["performance-card", sessionId] });
        }
      } catch {
        queryClient.invalidateQueries({ queryKey: ["performance-card", sessionId] });
      }
      setRetryAttempts((prev) => prev + 1);
      setLastRetryAt(Date.now());
      toast.success("Feedback has been regenerated.");
    },
    onError: () => {
      setRetryAttempts((prev) => prev + 1);
      setLastRetryAt(Date.now());
    },
  });

  const retryDisabled =
    !sessionId ||
    retryFeedbackMutation.isPending ||
    retryLimitReached ||
    retryCooldownLeft > 0;

  // sessionMeta already declared above for the ownership guard

  const turns = (transcript?.turns ?? []).filter(
    (t) => t.speaker !== "user" || !isLowSignalTurn(t.text),
  );
  const expectedCardVersion = report?.compiled_at;
  // Build the interviewer avatar URL from the stored path (backend-relative)
  const interviewerAvatarUrl = sessionMeta?.interviewer_avatar_url
    ? `${API_BASE}${sessionMeta.interviewer_avatar_url}`
    : undefined;

  // Fetch performance card data (available after feedback is compiled)
  const { data: performanceCard, isLoading: loadingCard } =
    useQuery<PerformanceCardData | null>({
      queryKey: ["performance-card", sessionId],
      queryFn: () =>
        fetch(`${API_BASE}/performance-card/${sessionId}`, { cache: "no-store" }).then((r) =>
          r.ok ? r.json() : null,
        ),
      enabled: !!sessionId && !!report,
      // Keep polling until card metadata matches the latest feedback version.
      refetchInterval: (query) => {
        const card = query.state.data as PerformanceCardData | null | undefined;
        if (!expectedCardVersion) return 3000;
        if (!card) return 3000;
        return card.feedback_compiled_at === expectedCardVersion ? false : 3000;
      },
    });

  const error = !sessionId
    ? "Missing session_id. Please start a new interview."
    : queryError instanceof Error ? queryError.message : queryError ? "Failed to generate feedback." : null;

  return (
    <div className="dark min-h-screen bg-dark text-white pb-12 lg:pb-0">
      <AppHeader
        homeHref="/dashboard"
        name={session?.user?.name}
        email={session?.user?.email}
        image={session?.user?.image}
      />

      {/* Desktop: side-by-side | Mobile: stacked with sheet */}
      <div className="flex justify-center gap-6 px-4 sm:px-6 py-10">
        {/* ── Feedback column ──────────────────────────────────────────── */}
        <div className="flex-1 max-w-3xl min-w-0 flex flex-col gap-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold">Interview Feedback</h1>
            {sessionMeta ? (
              <div className="flex flex-wrap items-center gap-1.5 mt-2 text-white/40 text-sm capitalize">
                {/* <p className="text-white/40 text-xs md:text-sm"> */}
                <span className="text-primary">Job role </span>{sessionMeta.job_role}
                {" | "}
                <span className="text-primary">Difficulty </span>{sessionMeta.difficulty}
                {" | "}
                <span className="text-primary">Persona </span>{PERSONA_LABELS[sessionMeta.persona] ?? sessionMeta.persona}
                {" | "}
                <span className="text-primary">Interviewer </span>{sessionMeta.interviewer_name}
                {/* </p> */}
                {interviewerAvatarUrl && (
                  <InterviewerAvatarImg
                    src={interviewerAvatarUrl}
                    label={sessionMeta.interviewer_name}
                    initial={sessionMeta.interviewer_name.trim()[0].toUpperCase()}
                  />
                )}
              </div>
            ) : (
              <p className="text-white/40 text-sm mt-2">Loading interview info…</p>
            )}
          </div>

          {loading && (
            <>
              <Skeleton className="h-28 w-full rounded-2xl bg-white/10" />
              <Skeleton className="h-40 w-full rounded-2xl bg-white/10" />
              <Skeleton className="h-32 w-full rounded-2xl bg-white/10" />
              <Skeleton className="h-24 w-full rounded-2xl bg-white/10" />
            </>
          )}

          {!loading && error && (
            <Alert variant="destructive" className="rounded-xl border-red-500/25 bg-red-500/10 text-red-300">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {retryFeedbackMutation.isError && (
            <Alert variant="destructive" className="rounded-xl border-red-500/25 bg-red-500/10 text-red-300">
              <AlertDescription>
                {retryFeedbackMutation.error instanceof Error
                  ? retryFeedbackMutation.error.message
                  : "Retry failed. Please try again."}
              </AlertDescription>
            </Alert>
          )}

          {!loading && !error && report && (
            <>
              {/* Overall score + decision */}
              <Section title="Overall">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <ScoreRing score={report.overall_score} />
                  <Badge
                    className={`text-sm px-4 py-1 rounded-full font-semibold ${report.decision === "offer"
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : "bg-red-500/20 text-red-400 border border-red-500/30"
                      }`}
                  >
                    {report.decision === "offer" ? "✓ Would Hire" : "✗ Rejection"}
                  </Badge>
                </div>
              </Section>

              {/* Dimension scores */}
              <Section title="Score Breakdown">
                <div className="flex flex-col gap-3">
                  {Object.entries(report.dimension_scores).map(([key, val]) => (
                    <DimensionBar key={key} label={key} value={val} />
                  ))}
                </div>
              </Section>

              {/* Tone & vocabulary */}
              <Section title="Tone & Communication">
                <div className="flex flex-col gap-4">
                  <div>
                    <p className="text-xs text-white/40 mb-1">Tone Analysis</p>
                    <p className="text-sm text-white/85 leading-relaxed">{report.tone_analysis}</p>
                  </div>
                  <div>
                    <p className="text-xs text-white/40 mb-1">Vocabulary Calibration</p>
                    <p className="text-sm text-white/85 leading-relaxed">{report.vocabulary_calibration}</p>
                  </div>
                  {report.filler_words.total_count > 0 && (
                    <div>
                      <p className="text-xs text-white/40 mb-1">
                        Filler Words — <span className="text-amber-400">{report.filler_words.total_count} detected</span>
                      </p>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {report.filler_words.words.map(({ word, count }) => (
                          <span key={word} className="text-xs bg-white/10 px-2.5 py-0.5 rounded-full text-white/60">
                            {word} <span className="text-amber-400 font-medium">×{count}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </Section>

              {/* Strengths & improvements */}
              <div className="grid sm:grid-cols-2 gap-5">
                <Section title="Strengths">
                  <ul className="flex flex-col gap-2">
                    {report.strengths.map((s, i) => (
                      <li key={i} className="flex gap-2 text-sm text-white/80">
                        <span className="text-emerald-400 mt-0.5">✓</span> {s}
                      </li>
                    ))}
                  </ul>
                </Section>
                <Section title="Areas to Improve">
                  <ul className="flex flex-col gap-2">
                    {report.improvement_areas.map((s, i) => (
                      <li key={i} className="flex gap-2 text-sm text-white/80">
                        <span className="text-amber-400 mt-0.5">→</span> {s}
                      </li>
                    ))}
                  </ul>
                </Section>
              </div>

              {/* Posture — only shown when camera was enabled */}
              {report.posture_summary && (
                <Section title="Posture & Presence">
                  <p className="text-sm text-white/80 leading-relaxed">{report.posture_summary}</p>
                </Section>
              )}

              {/* Technical depth analysis */}
              {report.technical_depth_analysis && (
                <Section title="Technical Depth">
                  <p className="text-sm text-white/80 leading-relaxed">{report.technical_depth_analysis}</p>
                </Section>
              )}

              {/* Decision letter */}
              {report.decision_reason && (
                <Section
                  title={report.decision === "offer" ? "Why Offer" : "Why Rejection"}
                  className={report.decision === "offer"
                    ? "border-emerald-500/40 bg-emerald-500/10"
                    : "border-red-500/40 bg-red-500/10"
                  }
                >
                  <p className="text-sm text-white/85 leading-relaxed">{report.decision_reason}</p>
                </Section>
              )}

              {/* Decision letter */}
              <Section title={report.decision === "offer" ? "Offer Letter" : "Rejection Letter"} className="border-orange bg-orange-500/20">
                <p className="text-sm text-white/75 leading-relaxed whitespace-pre-wrap">
                  {report.decision_letter}
                </p>
              </Section>

              {/* AI Performance Card — download / share to LinkedIn */}
              <div className="mt-2">
                <h2 className="text-sm font-semibold text-white/50 uppercase tracking-widest mb-4">
                  Your Performance Card
                </h2>
                {loadingCard ? (
                  <PerformanceCardSkeleton />
                ) : performanceCard ? (
                  <PerformanceCard
                    card={performanceCard}
                    userName={session?.user?.name ?? undefined}
                  />
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-sm text-white/40">
                    Generating your performance card…
                  </div>
                )}
              </div>
            </>
          )}

          <div className="flex justify-center gap-2">
            <Button
              onClick={() => router.push('/dashboard')}
              className="hidden lg:flex rounded-full bg-orange text-white hover:opacity-90 hover:bg-orange px-5"
            >
              Go home
            </Button>

            {!loading && !!sessionId && (
              <div className="flex flex-col items-center gap-2 pb-12 lg:pb-0">
                <Button
                  onClick={() => retryFeedbackMutation.mutate()}
                  disabled={retryDisabled}
                  variant="outline"
                  className="rounded-full"
                >
                  {retryFeedbackMutation.isPending ? "Regenerating…" : "Retry feedback generation"}
                </Button>
                {!retryFeedbackMutation.isPending && retryCooldownLeft > 0 && !retryLimitReached && (
                  <span className="text-xs text-white/40">
                    Retry in {Math.ceil(retryCooldownLeft / 1000)}s
                  </span>
                )}
                {retryLimitReached && (
                  <span className="text-xs text-white/40">
                    Retry limit reached
                  </span>
                )}
              </div>
            )}
          </div>
        </div>


        {/* ── Desktop transcript sidebar (hidden on <lg) ───────────────── */}
        <aside className="hidden lg:flex w-85 xl:w-95 shrink-0 flex-col sticky top-20 max-h-[calc(100vh-8rem)]">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquareText className="h-4 w-4 text-white/40" />
            <h2 className="text-sm font-semibold text-white/50 uppercase tracking-widest">
              Transcript
            </h2>
            {turns.length > 0 && (
              <span className="text-sm text-white/30 ml-auto">{turns.length} turns</span>
            )}
          </div>
          <Card className="flex-1 overflow-hidden rounded-2xl border border-white/10 bg-white/5">
            <ScrollArea className="h-full">
              <div className="p-4">
                {transcriptLoading ? (
                  <div className="flex flex-col gap-3">
                    <Skeleton className="h-10 w-full rounded-lg bg-white/10" />
                    <Skeleton className="h-14 w-full rounded-lg bg-white/10" />
                    <Skeleton className="h-10 w-full rounded-lg bg-white/10" />
                  </div>
                ) : (
                  <TranscriptList
                    turns={turns}
                    interviewerName={sessionMeta?.interviewer_name}
                    interviewerAvatarUrl={interviewerAvatarUrl}
                    userImage={session?.user?.image}
                    userName={session?.user?.name}
                    userEmail={session?.user?.email}
                  />
                )}
              </div>
            </ScrollArea>
          </Card>
        </aside>
      </div>

      {/* ── Mobile transcript bottom button + sheet (visible on <lg) ───── */}
      <div className="lg:hidden fixed bottom-6 left-0 right-0 flex gap-2 justify-center z-50">
        <Button
          onClick={() => router.push('/dashboard')}
          className="rounded-full bg-orange text-white hover:opacity-90 hover:bg-orange px-5"
        >
          Go home
        </Button>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button
              className="rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-white shadow-lg hover:bg-white/20 gap-2 px-5"
            >
              <MessageSquareText className="h-4 w-4" />
              Transcript
              {turns.length > 0 && (
                <Badge variant="secondary" className="ml-1 bg-white/15 text-white/70 text-[10px] px-1.5 py-0">
                  {turns.length}
                </Badge>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            className="bg-dark border-white/10 text-white rounded-t-2xl max-h-[75vh] flex flex-col overflow-auto p-0"
          >
            <SheetHeader className="shrink-0 border-b border-white/10">
              <SheetTitle className="text-white flex items-center gap-2 pr-8">
                <MessageSquareText className="h-4 w-4 text-white/40" />
                Transcript
                {/* {turns.length > 0 && (
                  <span className="text-[10px] text-white/30 font-normal ml-auto">
                    {turns.length} turns
                  </span>
                )} */}
              </SheetTitle>
            </SheetHeader>
            <ScrollArea className="flex-1 min-h-0">
              <div className="px-4 pb-6">
                {transcriptLoading ? (
                  <div className="flex flex-col gap-3">
                    <Skeleton className="h-10 w-full rounded-lg bg-white/10" />
                    <Skeleton className="h-14 w-full rounded-lg bg-white/10" />
                    <Skeleton className="h-10 w-full rounded-lg bg-white/10" />
                  </div>
                ) : (
                  <TranscriptList
                    turns={turns}
                    interviewerName={sessionMeta?.interviewer_name}
                    interviewerAvatarUrl={interviewerAvatarUrl}
                    userImage={session?.user?.image}
                    userName={session?.user?.name}
                    userEmail={session?.user?.email}
                  />
                )}
              </div>
            </ScrollArea>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}

export default function FeedbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-dark text-white flex items-center justify-center">
          Loading feedback…
        </div>
      }
    >
      <FeedbackContent />
    </Suspense>
  );
}
