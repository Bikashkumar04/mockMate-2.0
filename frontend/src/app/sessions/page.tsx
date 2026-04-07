"use client";

import React, { Suspense, useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "@/lib/auth-client";
import { useInfiniteQuery } from "@tanstack/react-query";
import AppHeader from "@/components/AppHeader";
import {
  ChevronRight, Award, ArrowLeft,
  Search, BarChart2, Loader2, RotateCcw,
  ChevronDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SessionStatusPill, canRetry } from "@/components/SessionStatusPill";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
  fmtDuration,
} from "@/constants/common";

const PAGE_SIZE = 10;

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
  live_started_at?: string | null;
  question_count: number;
  overall_score: number | null;
  dimension_scores?: Record<string, number> | null;
  feedback_ready: boolean;
  decision?: "offer" | "rejection" | null;
  decision_reason?: string | null;
  last_retried_at?: string | null;
  interviewer_avatar_url?: string | null;
}

interface SessionsPage {
  sessions: SessionSummary[];
  count: number;
  has_more: boolean;
  total: number;
  avg_score: number | null;
  this_month: number;
}

// ─── Page shell ───────────────────────────────────────────────────────────────

export default function SessionsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-orange border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <SessionsContent />
    </Suspense>
  );
}

function SessionsContent() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const uid = session?.user?.id;

  const {
    data,
    isLoading: loading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<SessionsPage>({
    queryKey: ["sessions-all", uid],
    queryFn: ({ pageParam }) =>
      fetch(`${API_BASE}/sessions/user/${uid}?limit=${PAGE_SIZE}&offset=${pageParam}`)
        .then(r => {
          if (!r.ok) throw new Error("Failed to load sessions");
          return r.json();
        }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.has_more ? (lastPageParam as number) + PAGE_SIZE : undefined,
    enabled: !!uid,
    staleTime: 5 * 60 * 1000,
  });

  // Flatten all pages into a single array
  const sessions: SessionSummary[] = data?.pages.flatMap(p => p.sessions) ?? [];
  const firstPage = data?.pages[0];

  // ── IntersectionObserver sentinel ──
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries;
      if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage],
  );

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(handleObserver, {
      root: null,
      rootMargin: "200px",
      threshold: 0,
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleObserver]);

  if (isPending || (!session && !loading)) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-orange border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!session) { router.replace("/login"); return null; }

  const filtered = sessions.filter(s => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      s.job_role?.toLowerCase().includes(q) ||
      s.persona?.toLowerCase().includes(q) ||
      s.interviewer_name?.toLowerCase().includes(q)
    );
  });

  const totalSessionCount = firstPage?.total ?? sessions.length;
  const avgScore: number | null = firstPage?.avg_score ?? null;

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <AppHeader
        homeHref="/dashboard"
        name={session.user.name}
        email={session.user.email}
        image={session.user.image}
      />

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 sm:px-6 py-10 flex flex-col gap-8">
        {/* Breadcrumb */}
        <Link href="/dashboard" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit">
          <ArrowLeft size={14} /> Back to dashboard
        </Link>

        {/* Title + stats */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">All sessions</h1>
            {!loading && <p className="mt-1 text-sm text-muted-foreground">{totalSessionCount} total interviews recorded</p>}
          </div>
          <div className="flex gap-3">
            {totalSessionCount > 0 && (
              <Card className="rounded-xl border border-border">
                <CardContent className="py-3 px-4 flex items-center gap-2.5">
                  <Award size={16} className="text-orange" />
                  <div>
                    <p className="text-xs text-muted-foreground">Avg score</p>
                    <p className="text-lg font-bold text-foreground leading-tight">
                      {avgScore !== null ? avgScore : "—"}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
            {/* <Button asChild className="rounded-xl bg-orange text-light hover:opacity-90 hover:bg-orange gap-2">
              <Link href="/interview/setup?from=sessions">
                <Mic size={15} /> New interview
              </Link>
            </Button> */}
          </div>
        </div>

        {/* Search */}
        {sessions.length > 0 && (
          <div className="relative max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by role, persona, interviewer"
              className="pl-9 rounded-xl border-border bg-background focus:ring-orange/40 focus:border-orange"
            />
          </div>
        )}

        {/* Table */}
        <Card className="rounded-xl border border-border overflow-hidden">
          {loading ? (
            <div className="p-6 flex flex-col gap-3">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-4 px-6">
              {sessions.length === 0 ? (
                <>
                  <BarChart2 size={36} className="text-muted-foreground opacity-30" />
                  <p className="text-sm text-muted-foreground">No interviews yet. Start your first one!</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No sessions match your search.</p>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-surface/50">
                    <TableHead className="text-xs font-medium text-muted-foreground">Job role & Persona</TableHead>
                    <TableHead className="text-xs font-medium text-muted-foreground">Interviewer</TableHead>
                    <TableHead className="text-xs font-medium text-muted-foreground">Last active</TableHead>
                    <TableHead className="text-xs font-medium text-muted-foreground">Duration</TableHead>
                    {/* <TableHead className="text-xs font-medium text-muted-foreground text-center hidden sm:table-cell">Questions</TableHead> */}
                    <TableHead className="text-xs font-medium text-muted-foreground text-center">Score</TableHead>
                    <TableHead className="text-xs font-medium text-muted-foreground">Status</TableHead>
                    <TableHead className="text-xs font-medium text-muted-foreground text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(s => (
                    <React.Fragment key={s.session_id}>
                    <TableRow className="hover:bg-surface/60">
                      <TableCell className="py-3.5 max-w-64">
                        <p className="mx-0.5 text-xs text-muted-foreground truncate w-full">{s.job_role}</p>
                        <Badge variant="secondary" className={`mt-2 text-xs font-medium ${personaColor(s.persona)}`}>
                          {personaLabel(s.persona)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {s.interviewer_name ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {fmtDate(s.last_retried_at ?? s.live_started_at ?? s.created_at)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {fmtDuration(s.live_started_at ?? s.created_at, s.ended_at)}
                      </TableCell>
                      {/* <TableCell className="text-xs text-center text-muted-foreground hidden sm:table-cell">
                        {s.question_count > 0 ? s.question_count : "—"}
                      </TableCell> */}
                      <TableCell className="text-center">
                        {s.overall_score !== null ? (
                          <button
                            onClick={() => setExpandedId(expandedId === s.session_id ? null : s.session_id)}
                            className="inline-flex items-center gap-1 cursor-pointer"
                            title={s.dimension_scores ? "Click to see score breakdown" : undefined}
                          >
                            <Badge className={`text-xs font-semibold ${scorePillClass(s.overall_score)}`}>
                              {s.overall_score}
                            </Badge>
                            {s.dimension_scores && (
                              <ChevronDown
                                size={12}
                                className={`text-muted-foreground transition-transform ${expandedId === s.session_id ? "rotate-180" : ""}`}
                              />
                            )}
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground/40">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <SessionStatusPill
                          status={s.status}
                          ended_by={s.ended_by}
                          feedback_ready={s.feedback_ready}
                          decision={s.decision}
                        />
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
                          <span className="text-xs text-muted-foreground italic">In progress</span>
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
                    {expandedId === s.session_id && s.dimension_scores && (
                      <TableRow className="bg-surface/30">
                        <TableCell colSpan={7} className="py-4 px-6">
                          <div className="flex flex-col gap-4 max-w-2xl">
                            {/* Dimension score bars */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5">
                              {Object.entries(s.dimension_scores).map(([key, val]) => (
                                <div key={key} className="flex items-center gap-3">
                                  <span className="text-xs text-muted-foreground w-32 capitalize shrink-0">
                                    {key.replace(/_/g, " ")}
                                  </span>
                                  <div className="flex-1 h-2 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all ${
                                        val >= 70 ? "bg-emerald-500" :
                                        val >= 40 ? "bg-amber-500" : "bg-red-500"
                                      }`}
                                      style={{ width: `${val}%` }}
                                    />
                                  </div>
                                  <span className="text-xs font-semibold text-foreground w-7 text-right">{val}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>

        {/* Infinite-scroll sentinel */}
        <div ref={sentinelRef} className="h-1" />
        {isFetchingNextPage && (
          <div className="flex justify-center pb-4">
            <Loader2 size={20} className="animate-spin text-orange" />
          </div>
        )}
      </main>
    </div>
  );
}
