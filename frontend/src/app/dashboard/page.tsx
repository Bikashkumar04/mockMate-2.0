"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useSession } from "@/lib/auth-client";
import { useQuery } from "@tanstack/react-query";
import AppHeader from "@/components/AppHeader";
import {
  Mic,
  FileText,
  BarChart2,
  ChevronRight,
  Calendar,
  Award,
  Clock,
  User,
  Briefcase,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SessionStatusPill, canRetry } from "@/components/SessionStatusPill";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  CartesianGrid,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  YAxis,
} from "recharts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  API_BASE,
  personaLabel,
  personaColor,
  scorePillClass,
  fmtDate,
} from "@/constants/common";
import PerformanceCard, {
  PerformanceCardSkeleton,
  type PerformanceCardData,
} from "@/components/PerformanceCard";
import { Separator } from "@/components/ui/separator";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionSummary {
  session_id: string;
  persona: string;
  job_role: string;
  interviewer_name: string;
  status: string;
  ended_by: string | null;
  created_at: string;
  ended_at: string | null;
  question_count: number;
  overall_score: number | null;
  feedback_ready: boolean;
  last_retried_at?: string | null;
  live_started_at?: string | null;
  interviewer_avatar_url?: string | null;
}

interface ResumeExperience {
  title: string;
  company: string;
  duration: string;
  highlights?: string[];
}

interface ResumeData {
  name: string;
  email: string;
  phone?: string;
  summary?: string;
  skills?: string[];
  experience?: ResumeExperience[];
}

interface ProgressionPoint {
  session_id: string;
  overall_score: number;
  created_at: string;
}

interface DimensionAverages {
  communication: number | null;
  confidence: number | null;
  structure: number | null;
  technical_depth: number | null;
  domain_vocabulary: number | null;
  posture_presence: number | null;
}

interface DashboardAnalytics {
  user_id: string;
  progression: ProgressionPoint[];
  user_average_dimensions: DimensionAverages;
  global_average_dimensions: DimensionAverages;
  sample_sizes: {
    user_sessions: number;
    global_feedback_reports: number;
  };
}

interface NextInterviewRecommendation {
  user_id: string;
  sessions_analyzed: number;
  headline: string;
  insight: string;
  practice_focus: string;
  recommended_persona: string;
  recommended_job_role: string;
  cta: string;
}

// ─── Score helpers ─────────────────────────────────────────────────────────────

function scoreTextColor(score: number | null) {
  if (score === null) return "text-muted-foreground";
  if (score >= 85) return "text-green-600";
  if (score >= 70) return "text-yellow-600";
  if (score >= 50) return "text-orange";
  return "text-red-500";
}

// ─── Date helpers ──────────────────────────────────────────────────────────────

function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

// ─── Page shell ───────────────────────────────────────────────────────────────

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-surface flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-orange border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}

// ─── Main content ─────────────────────────────────────────────────────────────

function DashboardContent() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const uid = session?.user?.id;

  const { data: sessionsData, isLoading: loadingSessions } = useQuery({
    queryKey: ["sessions", uid],
    queryFn: () =>
      fetch(`${API_BASE}/sessions/user/${uid}?limit=5`).then((r) =>
        r.ok ? r.json() : null,
      ),
    enabled: !!uid,
  });

  const { data: resumeData, isLoading: loadingResume } = useQuery({
    queryKey: ["resume", uid],
    queryFn: () =>
      fetch(`${API_BASE}/resume/${uid}`).then((r) => (r.ok ? r.json() : null)),
    enabled: !!uid,
  });

  const { data: analyticsData, isLoading: loadingAnalytics } = useQuery<DashboardAnalytics | null>({
    queryKey: ["dashboard-analytics", uid],
    queryFn: () =>
      fetch(`${API_BASE}/analytics/dashboard/${uid}?limit=7`).then((r) =>
        r.ok ? r.json() : null,
      ),
    enabled: !!uid,
  });

  const { data: nextRecommendation } = useQuery<NextInterviewRecommendation | null>({
    queryKey: ["next-interview-recommendation", uid],
    queryFn: () =>
      fetch(`${API_BASE}/analytics/next-interview/${uid}?lookback=5`).then((r) =>
        r.ok ? r.json() : null,
      ),
    enabled: !!uid,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  const sessions: SessionSummary[] = sessionsData?.sessions ?? [];
  const resume: ResumeData | null = resumeData?.resume_data ?? null;

  // Find the latest session that has feedback for the performance card
  const latestFeedbackSession = sessions.find(
    (s) => s.feedback_ready && s.overall_score !== null,
  );

  const { data: performanceCard, isLoading: loadingCard } =
    useQuery<PerformanceCardData | null>({
      queryKey: ["performance-card", latestFeedbackSession?.session_id],
      queryFn: () =>
        fetch(
          `${API_BASE}/performance-card/${latestFeedbackSession!.session_id}`,
        ).then((r) => (r.ok ? r.json() : null)),
      enabled: !!latestFeedbackSession,
      retry: 2,
      retryDelay: 3000,
      // Poll every 6s until the card arrives (covers background generation)
      refetchInterval: (query) => (query.state.data ? false : 6000),
    });

  // Use useEffect to avoid calling router.replace() during render
  useEffect(() => {
    if (!isPending && !session) {
      router.replace("/login");
    }
  }, [isPending, session, router]);

  if (isPending) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-orange border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) return null;

  const isNewUser = searchParams.get("newuser") === "1";
  const firstName = session.user.name?.split(" ")[0] ?? "there";

  // Derived stats — use server-computed aggregates (from ALL sessions, not
  // just the limited slice) so dashboard cards are always accurate.
  const totalSessionCount = sessionsData?.total ?? sessions.length;
  const avgScore: number | null = sessionsData?.avg_score ?? null;
  const lastSession = sessions[0] ?? null;
  const thisMonth: number = sessionsData?.this_month ?? 0;
  const recommendedPersonaId = nextRecommendation?.recommended_persona ?? "";
  const recommendedPersonaLabel = recommendedPersonaId
    ? personaLabel(recommendedPersonaId)
    : "";
  const recommendationCtaRaw = nextRecommendation?.cta?.replace(/\.+\s*$/, "") ?? "";
  const recommendationCta = recommendedPersonaId
    ? recommendationCtaRaw.split(recommendedPersonaId).join(recommendedPersonaLabel)
    : recommendationCtaRaw;

  return (
    <div className="min-h-screen bg-surface flex flex-col overflow-x-clip">
      <AppHeader
        homeHref="/"
        name={session.user.name}
        email={session.user.email}
        image={session.user.image}
      />

      {/* ── Main ── */}
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 sm:px-6 py-12">
        {/* New-user banner */}
        {isNewUser && (
          <Alert className="mb-6 border-orange/30 bg-orange/10 rounded-xl">
            <AlertDescription className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <p className="font-semibold text-foreground">
                  Welcome to MockMate! 🎉
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Get started by uploading your résumé and running your first
                  mock interview.
                </p>
              </div>
              <Button
                asChild
                className="shrink-0 rounded-full bg-orange text-light hover:opacity-90 hover:bg-orange"
              >
                <Link href="/resume/upload?from=dashboard">
                  Start onboarding
                </Link>
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Greeting + primary CTA */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">
              Hi, {firstName} 👋
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Get ready for your next interview
            </p>
          </div>
          <Button
            asChild
            className="shrink-0 rounded-full bg-orange text-light hover:opacity-90 hover:bg-orange gap-2 hidden sm:inline-flex"
            disabled={loadingResume}
          >
            <Link
              href={
                !loadingResume && !resume
                  ? "/resume/upload?from=dashboard"
                  : "/interview/setup?from=dashboard"
              }
            >
              {!loadingResume && !resume ? (
                <FileText size={15} />
              ) : (
                <Mic size={15} />
              )}
              {!loadingResume && !resume ? "Upload résumé" : "Start interview"}
            </Link>
          </Button>
        </div>

        {/* ── Mobile quick actions (shown only below lg) ── */}
        <div className="mt-6 flex flex-col gap-2 lg:hidden">
          <Button
            asChild
            className="w-full rounded-xl bg-orange text-light hover:opacity-90 hover:bg-orange gap-2"
          >
            <Link
              href={
                !loadingResume && !resume
                  ? "/resume/upload?from=dashboard"
                  : "/interview/setup?from=dashboard"
              }
            >
              {!loadingResume && !resume ? (
                <FileText size={15} />
              ) : (
                <Mic size={15} />
              )}
              {!loadingResume && !resume
                ? "Upload résumé to start"
                : "Start Interview"}
            </Link>
          </Button>
          <QuickLink
            href="/resume/upload?from=dashboard"
            icon={<FileText size={15} className="text-orange" />}
            label="Upload / update résumé"
          />
          <QuickLink
            href="/sessions"
            icon={<BarChart2 size={15} className="text-orange" />}
            label="View all sessions"
          />
        </div>

        {/* ── AI recommendation strip ── */}
        {nextRecommendation && (
          <Card className="mt-8 rounded-xl border border-orange/30 bg-orange/5">
            <CardContent className="p-4">
                <div className="min-w-0 flex flex-col gap-2">
                  <p className="text-xs font-semibold text-orange uppercase tracking-wide inline-flex items-center gap-1.5">
                    <Sparkles size={13} /> Your Next Interview
                  </p>
                  <p className="text-sm font-semibold text-foreground">
                    {nextRecommendation.headline}
                  </p>
                  <p className="text-sm/relaxed text-muted-foreground">
                    {nextRecommendation.insight}
                  </p>
                  <p className="text-sm/relaxed text-foreground italic">
                    <span className="font-medium">Practice focus:</span>{" "}
                    {nextRecommendation.practice_focus}
                  </p>
                  <Separator className="my-1" />
                  <p className="text-sm/relaxed text-foreground">
                    <span className="font-medium">Next step:</span>{" "}
                    <span className="text-muted-foreground">{recommendationCta}</span>
                  </p>
                  <Button
                  asChild
                  size="sm"
                  className="my-1 w-fit rounded-full bg-orange text-light hover:opacity-90 hover:bg-orange gap-1.5"
                >
                  <Link
                    href={`/interview/setup?from=dashboard&persona=${encodeURIComponent(nextRecommendation.recommended_persona)}&job_role=${encodeURIComponent(nextRecommendation.recommended_job_role)}`}
                  >
                    Let&apos;s Go <ChevronRight size={14} />
                  </Link>
                </Button>
                <p className="self-end text-xs text-muted-foreground mt-2">
                  AI generated, based on your last {nextRecommendation.sessions_analyzed} sessions
                </p>
                </div>
            </CardContent>
          </Card>
        )}

        {/* ── Stats bar ── */}
        <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={<BarChart2 size={18} className="text-orange" />}
            label="Total sessions"
            value={totalSessionCount === 0 ? "—" : String(totalSessionCount)}
          />
          <StatCard
            icon={<Award size={18} className="text-orange" />}
            label="Avg. score"
            value={avgScore !== null ? String(avgScore) : "—"}
            unit={avgScore !== null ? "/ 100" : undefined}
            valueClass={
              avgScore !== null ? scoreTextColor(avgScore) : undefined
            }
          />
          <StatCard
            icon={<Calendar size={18} className="text-orange" />}
            label="This month"
            value={thisMonth === 0 ? "—" : String(thisMonth)}
            unit={
              thisMonth > 0
                ? "session" + (thisMonth !== 1 ? "s" : "")
                : undefined
            }
          />
          <StatCard
            icon={<Clock size={18} className="text-orange" />}
            label="Last interview"
            value={
              lastSession
                ? daysSince(
                    lastSession.last_retried_at ??
                      lastSession.live_started_at ??
                      lastSession.created_at,
                  ) === 0
                  ? "Today"
                  : `${daysSince(lastSession.last_retried_at ?? lastSession.live_started_at ?? lastSession.created_at)}d ago`
                : "—"
            }
          />
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Card className="rounded-xl border border-border min-w-0 overflow-hidden">
            <CardContent className="p-4 min-w-0">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-foreground">Score progression</p>
                <p className="text-xs text-muted-foreground">Last 7 interviews</p>
              </div>
              {loadingAnalytics ? (
                <Skeleton className="h-64 w-full rounded-lg" />
              ) : (
                <ProgressionLineChart points={analyticsData?.progression ?? []} />
              )}
            </CardContent>
          </Card>

          <Card className="rounded-xl border border-border min-w-0 overflow-hidden">
            <CardContent className="p-4 min-w-0">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-foreground">Skill Benchmark</p>
                <p className="text-xs text-muted-foreground">You vs all users</p>
              </div>
              {loadingAnalytics ? (
                <Skeleton className="h-64 w-full rounded-lg" />
              ) : (
                <RadarComparisonChart
                  userAvg={analyticsData?.user_average_dimensions ?? null}
                  globalAvg={analyticsData?.global_average_dimensions ?? null}
                />
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Main grid ── */}
        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          {/* Recent sessions — 2/3 width */}
          <div className="lg:col-span-2 flex flex-col gap-4 overflow-hidden">
            <SectionHeader title="Recent sessions" href="/sessions" />

            <Card className="rounded-xl border border-border overflow-hidden">
              {loadingSessions ? (
                <div className="p-6 flex flex-col gap-3">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full rounded-lg" />
                  ))}
                </div>
              ) : sessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center gap-3 px-6">
                  <Mic size={32} className="text-muted-foreground opacity-40" />
                  <p className="text-sm text-muted-foreground">No interviews yet. Start your first one!</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-surface/50">
                      <TableHead className="text-xs font-medium text-muted-foreground">
                        Job role & Persona
                      </TableHead>
                      <TableHead className="text-xs font-medium text-muted-foreground hidden sm:table-cell">
                        Last active
                      </TableHead>
                      <TableHead className="text-xs font-medium text-muted-foreground text-center">
                        Score
                      </TableHead>
                      <TableHead className="text-xs font-medium text-muted-foreground text-right"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessions.map((s) => (
                      <TableRow
                        key={s.session_id}
                        className="hover:bg-surface/60"
                      >
                        <TableCell className="py-3.5 max-w-64">
                          <p className="mx-0.5 text-xs text-muted-foreground truncate w-full">
                            {s.job_role}
                          </p>
                          <Badge
                            variant="secondary"
                            className={`mt-2 text-xs font-medium ${personaColor(s.persona)}`}
                          >
                            {personaLabel(s.persona)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground hidden sm:table-cell whitespace-nowrap">
                          {fmtDate(
                            s.last_retried_at ??
                              s.live_started_at ??
                              s.created_at,
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {s.overall_score !== null ? (
                            <Badge
                              className={`text-xs font-semibold ${scorePillClass(s.overall_score)}`}
                            >
                              {s.overall_score}
                            </Badge>
                          ) : (
                            <SessionStatusPill
                              status={s.status}
                              ended_by={s.ended_by}
                              feedback_ready={s.feedback_ready}
                            />
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {s.feedback_ready ? (
                            <Link
                              href={`/interview/feedback?session_id=${s.session_id}`}
                              className="text-xs text-orange hover:underline whitespace-nowrap inline-flex items-center gap-1"
                            >
                              Feedback <ChevronRight size={12} />
                            </Link>
                          ) : s.status === "active" ? (
                            <span className="text-xs text-muted-foreground italic">
                              In progress
                            </span>
                          ) : canRetry(s) ? (
                            <Link
                              href={`/interview/live?session_id=${s.session_id}&persona=${encodeURIComponent(s.persona)}&job_role=${encodeURIComponent(s.job_role)}&interviewer_name=${encodeURIComponent(s.interviewer_name)}${s.interviewer_avatar_url ? `&avatar_url=${encodeURIComponent(s.interviewer_avatar_url)}` : ""}`}
                              className="text-xs text-orange hover:underline whitespace-nowrap inline-flex items-center gap-1"
                            >
                              <RotateCcw size={12} /> Retry
                            </Link>
                          ) : (
                            <span className="text-xs text-muted-foreground/40">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          </div>

          {/* Right sidebar */}
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-1">
            {/* Performance card */}
            {latestFeedbackSession && performanceCard && (
              <div className="flex flex-col gap-3">
                <SectionHeader title="Latest performance card" />
                {loadingCard ? (
                  <PerformanceCardSkeleton />
                ) : (
                  <PerformanceCard
                    card={performanceCard}
                    compact
                    onCardClick={() =>
                      router.push(
                        `/interview/feedback?session_id=${performanceCard.session_id}`,
                      )
                    }
                  />
                )}
              </div>
            )}

            {/* Résumé card */}
            <div className="flex flex-col gap-3">
              <SectionHeader title="Your résumé" />
              <Card className="rounded-xl border border-border">
                <CardContent className="p-4">
                  {loadingResume ? (
                    <div className="flex flex-col gap-3 py-3">
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-9 w-9 rounded-full" />
                        <div className="flex flex-col gap-1.5 flex-1">
                          <Skeleton className="h-4 w-3/4 rounded" />
                          <Skeleton className="h-3 w-1/2 rounded" />
                        </div>
                      </div>
                      <Skeleton className="h-6 w-full rounded" />
                      <Skeleton className="h-6 w-full rounded" />
                    </div>
                  ) : resume ? (
                    <div className="flex flex-col gap-4">
                      {/* Identity */}
                      <div className="flex items-start gap-3">
                        <div className="h-9 w-9 shrink-0 flex items-center justify-center rounded-full bg-orange/10">
                          <User size={16} className="text-orange" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground text-sm truncate">
                            {resume.name}
                          </p>
                          {resume.experience?.[0] && (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">
                              {resume.experience[0].title} |{" "}
                              {resume.experience[0].company}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Skills */}
                      {resume.skills && resume.skills.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-2">
                            Top skills
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {resume.skills.slice(0, 8).map((skill) => (
                              <Badge
                                key={skill}
                                variant="outline"
                                className="px-2 py-0.5 text-xs text-foreground border-border bg-surface rounded-md"
                              >
                                {skill}
                              </Badge>
                            ))}
                            {resume.skills.length > 8 && (
                              <Badge
                                variant="outline"
                                className="px-2 py-0.5 text-xs text-muted-foreground border-border bg-surface rounded-md"
                              >
                                +{resume.skills.length - 8} more
                              </Badge>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Experience */}
                      {resume.experience && resume.experience.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-2">
                            Experience
                          </p>
                          <div className="flex flex-col gap-3">
                            {resume.experience.slice(0, 2).map((exp, i) => (
                              <div key={i} className="flex items-start gap-2.5">
                                <Briefcase
                                  size={12}
                                  className="text-muted-foreground mt-0.5 shrink-0"
                                />
                                <div className="min-w-0">
                                  <p className="text-xs font-medium text-foreground truncate">
                                    {exp.title}
                                  </p>
                                  <p className="text-xs text-muted-foreground truncate">
                                    {exp.company} | {exp.duration}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <Link
                        href="/resume?from=dashboard"
                        className="text-xs text-orange hover:underline inline-flex items-center gap-1 w-fit"
                      >
                        View résumé <ChevronRight size={12} />
                      </Link>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3 py-6 text-center">
                      <FileText size={28} className="text-muted-foreground opacity-40" />
                      <p className="text-sm text-muted-foreground">
                        No résumé uploaded yet
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Quick actions — desktop only */}
            <div className="hidden lg:flex flex-col gap-3">
              <p className="text-sm font-semibold text-foreground">Quick actions</p>
              <div className="flex flex-col gap-2">
                <QuickLink
                  href="/resume/upload?from=dashboard"
                  icon={<FileText size={15} className="text-orange" />}
                  label="Upload / update résumé"
                />
                <QuickLink
                  href="/sessions"
                  icon={<BarChart2 size={15} className="text-orange" />}
                  label="View all sessions"
                />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  unit,
  valueClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
  valueClass?: string;
}) {
  return (
    <Card className="rounded-xl border border-border">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground mb-2">
          {icon}
          <span className="text-xs font-medium">{label}</span>
        </div>
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span
            className={`text-xl sm:text-2xl font-bold tracking-tight ${valueClass ?? "text-foreground"}`}
          >
            {value}
          </span>
          {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function SectionHeader({ title, href }: { title: string; href?: string }) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {href && (
        <Link
          href={href}
          className="text-xs text-orange hover:underline inline-flex items-center gap-0.5"
        >
          View all <ChevronRight size={12} />
        </Link>
      )}
    </div>
  );
}

function QuickLink({
  href,
  icon,
  label,
  disabled,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <Button
        asChild
        variant="outline"
        className="w-full justify-start gap-3 rounded-lg border-border opacity-50 hover:opacity-70 h-auto px-4 py-3"
        title="Upload your résumé first"
      >
        <Link href="/resume/upload?from=dashboard">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-orange/10 shrink-0">
            {icon}
          </span>
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className="ml-auto text-xs text-muted-foreground">
            Upload résumé first
          </span>
        </Link>
      </Button>
    );
  }
  return (
    <Button
      asChild
      variant="outline"
      className="w-full justify-start gap-3 rounded-lg border-border hover:border-orange/50 h-auto px-4 py-3 group"
    >
      <Link href={href}>
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-orange/10 shrink-0">
          {icon}
        </span>
        <span className="text-sm text-foreground group-hover:text-orange transition-colors">
          {label}
        </span>
        <ChevronRight
          size={14}
          className="ml-auto text-muted-foreground group-hover:text-orange transition-colors"
        />
      </Link>
    </Button>
  );
}

function ProgressionLineChart({ points }: { points: ProgressionPoint[] }) {
  if (!points.length) {
    return (
      <div className="h-64 rounded-lg border border-border bg-surface/40 flex items-center justify-center text-sm text-muted-foreground">
        Complete interviews to see your trend
      </div>
    );
  }

  const chartData = points.map((point) => ({
    score: point.overall_score,
  }));

  const chartConfig: ChartConfig = {
    score: {
      label: "Score",
      color: "var(--color-primary)",
    },
  };

  return (
    <div className="h-64 rounded-lg border border-border bg-surface/40 p-2">
      <ChartContainer config={chartConfig} className="h-full w-full min-w-0 aspect-auto">
        <LineChart data={chartData} margin={{ top: 12, right: 12, left: 6, bottom: 12 }}>
          <CartesianGrid vertical={false} />
          <YAxis
            domain={[0, 100]}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            width={34}
          />
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          <Line
            dataKey="score"
            type="monotone"
            stroke="var(--color-score)"
            strokeWidth={2.5}
            dot={{ r: 3, fill: "var(--color-score)" }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ChartContainer>
    </div>
  );
}

function RadarComparisonChart({
  userAvg,
  globalAvg,
}: {
  userAvg: DimensionAverages | null;
  globalAvg: DimensionAverages | null;
}) {
  if (!userAvg || !globalAvg) {
    return (
      <div className="h-64 rounded-lg border border-border bg-surface/40 flex items-center justify-center text-sm text-muted-foreground">
        Not enough data for benchmark yet
      </div>
    );
  }

  const dims: Array<keyof DimensionAverages> = [
    "structure",
    "technical_depth",
    "communication",
    "confidence",
    "domain_vocabulary",
  ];
  const labels: Record<keyof DimensionAverages, string> = {
    structure: "Structure",
    technical_depth: "Technical",
    communication: "Communication",
    confidence: "Confidence",
    domain_vocabulary: "Vocabulary",
    posture_presence: "Posture",
  };

  const chartData = dims.map((dimension) => ({
    dimension: labels[dimension],
    user: userAvg[dimension] ?? 0,
    global: globalAvg[dimension] ?? 0,
  }));

  const chartConfig: ChartConfig = {
    user: {
      label: "You",
      color: "var(--color-primary)",
    },
    global: {
      label: "All users",
      color: "var(--color-chart-4)",
    },
  };

  return (
    <div className="h-64 rounded-lg border border-border bg-surface/40 p-2">
      <ChartContainer config={chartConfig} className="h-full w-full min-w-0 aspect-auto">
        <RadarChart data={chartData} outerRadius="80%">
          <PolarGrid />
          <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 11 }} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Radar
            name="global"
            dataKey="global"
            stroke="var(--color-global)"
            fill="var(--color-global)"
            fillOpacity={0.2}
            strokeWidth={2}
          />
          <Radar
            name="user"
            dataKey="user"
            stroke="var(--color-user)"
            fill="var(--color-user)"
            fillOpacity={0.25}
            strokeWidth={2}
          />
        </RadarChart>
      </ChartContainer>
    </div>
  );
}
