"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useSession } from "@/lib/auth-client";
import { useQuery } from "@tanstack/react-query";
import AppHeader from "@/components/AppHeader";
import {
  ArrowLeft, User, Briefcase, GraduationCap, Star, Cpu,
  Upload, FileText, Mic, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { API_BASE } from "@/constants/common";

// ─── Types ────────────────────────────────────────────────────────────────────────────────

interface ResumeData {
  name: string;
  email: string;
  phone?: string;
  summary?: string;
  skills?: string[];
  experience?: { title: string; company: string; duration: string; highlights?: string[] }[];
  education?: { degree: string; institution: string; year: string }[];
  certifications?: string[];
  bold_claims?: string[];
  filename?: string;
  parsed_at?: string;
}

// ─── Page ────────────────────────────────────────────────────────────────────────────────

export default function ResumePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-orange border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <ResumeContent />
    </Suspense>
  );
}

function ResumeContent() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const from = searchParams.get("from");
  const origin = searchParams.get("origin"); // original `from` forwarded by the upload page
  const backHref  = from === "upload" ? `/resume/upload${origin ? `?from=${origin}` : ""}` : "/dashboard";
  const backLabel = from === "upload" ? "Back to upload" : "Back to dashboard";

  const uid = session?.user?.id;

  const { data: resumeData, isLoading: loading } = useQuery({
    queryKey: ["resume", uid],
    queryFn: () =>
      fetch(`${API_BASE}/resume/${uid}`)
        .then(r => r.ok ? r.json() : null),
    enabled: !!uid,
    staleTime: 10 * 60 * 1000,
  });

  const resume: ResumeData | null = resumeData?.resume_data ?? null;
  const pdfUrl = uid && resume ? `${API_BASE}/resume/${uid}/file` : null;
  const [pdfLoaded, setPdfLoaded] = useState(false);

  if (isPending || (!session && !loading)) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-orange border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!session) { router.replace("/login"); return null; }

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <AppHeader
        homeHref="/dashboard"
        name={session.user.name}
        email={session.user.email}
        image={session.user.image}
      />

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 py-12 flex flex-col gap-8">
        {/* Breadcrumb + actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-8">
          <Link href={backHref} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit">
            <ArrowLeft size={14} /> {backLabel}
          </Link>
          {resume && (
            <div className="flex items-center gap-3">
              <Button asChild className="rounded-full bg-orange text-light hover:opacity-90 hover:bg-orange gap-2">
                <Link href="/interview/setup?from=resume">
                  <Mic size={14} /> Start interview
                </Link>
              </Button>
              <Button asChild variant="outline" className="rounded-full border-border text-foreground hover:border-orange/50 gap-2">
                <Link href="/resume/upload?from=resume">
                  <Upload size={14} /> Upload new version
                </Link>
              </Button>
            </div>
          )}
        </div>

        {/* Title */}
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">My résumé</h1>
          {resume?.filename && (
            <p className="mt-1 text-sm text-muted-foreground">
              {resume.filename}
              {resume.parsed_at && (
                <> | Uploaded {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(resume.parsed_at))}</>
              )}
            </p>
          )}
        </div>

        {loading ? (
          <div className="grid gap-6 lg:grid-cols-5">
            {/* Left: parsed data skeleton */}
            <div className="lg:col-span-2 flex flex-col gap-5">
              <Card className="rounded-xl border border-border">
                <CardContent className="p-4 flex flex-col gap-3">
                  <div className="flex items-start gap-3.5">
                    <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                    <div className="flex-1 flex flex-col gap-2">
                      <Skeleton className="h-4 w-32 rounded" />
                      <Skeleton className="h-3 w-48 rounded" />
                    </div>
                  </div>
                  <Skeleton className="h-3 w-full rounded" />
                  <Skeleton className="h-3 w-5/6 rounded" />
                  <Skeleton className="h-3 w-4/6 rounded" />
                </CardContent>
              </Card>
              <Card className="rounded-xl border border-border">
                <CardContent className="p-4 flex flex-col gap-3">
                  <Skeleton className="h-3 w-16 rounded" />
                  <div className="flex flex-wrap gap-1.5">
                    {[80, 64, 96, 72, 56, 88].map((w, i) => (
                      <Skeleton key={i} className="h-6 rounded-md" style={{ width: w }} />
                    ))}
                  </div>
                </CardContent>
              </Card>
              <Card className="rounded-xl border border-border">
                <CardContent className="p-4 flex flex-col gap-4">
                  <Skeleton className="h-3 w-20 rounded" />
                  {[1, 2].map(i => (
                    <div key={i} className="flex flex-col gap-1.5">
                      <Skeleton className="h-3.5 w-40 rounded" />
                      <Skeleton className="h-3 w-32 rounded" />
                      <Skeleton className="h-3 w-full rounded" />
                      <Skeleton className="h-3 w-5/6 rounded" />
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card className="rounded-xl border border-border">
                <CardContent className="p-4 flex flex-col gap-3">
                  <Skeleton className="h-3 w-20 rounded" />
                  {[1, 2].map(i => (
                    <div key={i} className="flex flex-col gap-1">
                      <Skeleton className="h-3.5 w-48 rounded" />
                      <Skeleton className="h-3 w-36 rounded" />
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            {/* Right: resume preview skeleton */}
            <div className="lg:col-span-3">
              <Card className="rounded-xl border border-border overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <Skeleton className="h-4 w-32 rounded" />
                  <Skeleton className="h-4 w-24 rounded" />
                </div>
                <div
                  className="w-full flex flex-col gap-3 p-5 bg-zinc-50 dark:bg-zinc-800/50"
                  style={{ height: "calc(100vh - 220px)", minHeight: 500 }}
                >
                  <Skeleton className="h-6 w-48 rounded mb-2" />
                  {Array.from({ length: 18 }).map((_, i) => (
                    <Skeleton
                      key={i}
                      className="h-3 rounded"
                      style={{ width: `${65 + ((i * 37) % 30)}%` }}
                    />
                  ))}
                  <div className="mt-4" />
                  {Array.from({ length: 12 }).map((_, i) => (
                    <Skeleton
                      key={`b${i}`}
                      className="h-3 rounded"
                      style={{ width: `${55 + ((i * 53) % 35)}%` }}
                    />
                  ))}
                </div>
              </Card>
            </div>
          </div>
        ) : !resume ? (
          /* No resume uploaded yet */
          <div className="flex flex-col items-center justify-center py-24 text-center gap-5">
            <FileText size={48} className="text-muted-foreground opacity-30" />
            <div>
              <p className="font-semibold text-foreground">No résumé uploaded yet</p>
              <p className="text-sm text-muted-foreground mt-1">Upload your résumé to get personalised interview questions.</p>
            </div>
            <Button asChild className="rounded-full bg-orange text-light hover:opacity-90 hover:bg-orange">
              <Link href="/resume/upload?from=resume">Upload résumé</Link>
            </Button>
          </div>
        ) : (
          /* Two-column layout: parsed data + PDF viewer */
          <div className="grid gap-6 lg:grid-cols-5">

            {/* ── Left: parsed data ── */}
            <div className="lg:col-span-2 flex flex-col gap-5">

              {/* Identity */}
              <Section>
                <div className="flex items-start gap-3.5">
                  <div className="h-10 w-10 shrink-0 flex items-center justify-center rounded-full bg-orange/10">
                    <User size={18} className="text-orange" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-foreground text-base lg:text-lg">{resume.name}</p>
                    {resume.email && <p className="text-sm text-muted-foreground mt-1">{resume.email}</p>}
                    {resume.phone && <p className="text-sm text-muted-foreground mt-1">{resume.phone}</p>}
                  </div>
                </div>
                {resume.summary && (
                  <p className="text-sm lg:text-base leading-relaxed mt-3">{resume.summary}</p>
                )}
              </Section>

              {/* Skills */}
              {resume.skills && resume.skills.length > 0 && (
                <Section title="Skills" icon={<Cpu size={16} className="text-orange" />}>
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {resume.skills.map(skill => (
                      <Badge key={skill} variant="outline" className="rounded-md border-border text-foreground text-sm px-2.5 py-1">
                        {skill}
                      </Badge>
                    ))}
                  </div>
                </Section>
              )}

              {/* Bold claims */}
              {resume.bold_claims && resume.bold_claims.length > 0 && (
                <Section title="Key achievements" icon={<Star size={16} className="text-orange" />}>
                  <ul className="mt-3 flex flex-col gap-1.5">
                    {resume.bold_claims.map((claim, i) => (
                      <li key={i} className="text-sm text-foreground flex items-start gap-2">
                        <span className="text-orange mt-0.5 shrink-0">•</span>
                        {claim}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {/* Experience */}
              {resume.experience && resume.experience.length > 0 && (
                <Section title="Experience" icon={<Briefcase size={16} className="text-orange" />}>
                  <div className="mt-3 flex flex-col gap-4">
                    {resume.experience.map((exp, i) => (
                      <div key={i}>
                        <p className="text-sm lg:text-base font-semibold text-foreground">{exp.title}</p>
                        <p className="text-xs lg:text-sm text-muted-foreground mt-0.5">{exp.company} | {exp.duration}</p>
                        {exp.highlights && exp.highlights.length > 0 && (
                          <ul className="mt-1.5 flex flex-col gap-1">
                            {exp.highlights.map((h, j) => (
                              <li key={j} className="text-sm flex items-start gap-1.5">
                                <span className="text-orange shrink-0">–</span>
                                {h}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Education */}
              {resume.education && resume.education.length > 0 && (
                <Section title="Education" icon={<GraduationCap size={16} className="text-orange" />}>
                  <div className="mt-3 flex flex-col gap-3">
                    {resume.education.map((edu, i) => (
                      <div key={i}>
                        <p className="text-sm lg:text-base font-semibold text-foreground">{edu.degree}</p>
                        <p className="text-xs lg:text-sm text-muted-foreground mt-0.5">{edu.institution} | {edu.year}</p>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Certifications */}
              {resume.certifications && resume.certifications.length > 0 && (
                <Section title="Certifications" icon={<Star size={16} className="text-orange" />}>
                  <ul className="mt-3 flex flex-col gap-1.5">
                    {resume.certifications.map((cert, i) => (
                      <li key={i} className="text-sm text-foreground flex items-start gap-2">
                        <span className="text-orange mt-0.5 shrink-0">•</span>
                        {cert}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </div>

            {/* ── Right: PDF viewer ── */}
            <div className="lg:col-span-3">
              <Card className="rounded-xl border border-border overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <p className="text-sm font-medium text-foreground">Résumé preview</p>
                  {pdfUrl && (
                    <a
                      href={pdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs text-orange hover:underline"
                    >
                      Open in new tab <ExternalLink size={11} />
                    </a>
                  )}
                </div>
                {pdfUrl ? (
                  <div className="relative w-full" style={{ height: "calc(100vh - 72px)", minHeight: 512 }}>
                    {!pdfLoaded && (
                      <div className="absolute inset-0 flex flex-col gap-3 p-5 bg-zinc-50 dark:bg-zinc-800/50 z-10">
                        <Skeleton className="h-6 w-48 rounded mb-2" />
                        {Array.from({ length: 18 }).map((_, i) => (
                          <Skeleton key={i} className="h-3 rounded" style={{ width: `${65 + ((i * 37) % 30)}%` }} />
                        ))}
                        <div className="mt-4" />
                        {Array.from({ length: 10 }).map((_, i) => (
                          <Skeleton key={`b${i}`} className="h-3 rounded" style={{ width: `${55 + ((i * 53) % 35)}%` }} />
                        ))}
                      </div>
                    )}
                    <iframe
                      src={pdfUrl}
                      className="w-full h-full"
                      title="Résumé preview"
                      onLoad={() => setPdfLoaded(true)}
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-24 text-muted-foreground text-sm">
                    Preview unavailable
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Section card ────────────────────────────────────────────────────────────────────────────────

function Section({
  title,
  icon,
  children,
}: {
  title?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="rounded-xl border border-border">
      <CardContent className="p-4">
        {title && (
          <div className="flex items-center gap-1.5 mb-1">
            {icon}
            <p className="text-sm font-semibold text-foreground uppercase tracking-wide">{title}</p>
          </div>
        )}
        {children}
      </CardContent>
    </Card>
  );
}


