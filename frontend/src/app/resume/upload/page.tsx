"use client";

import { useState, useCallback, useRef, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useSession } from "@/lib/auth-client";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import AppHeader from "@/components/AppHeader";
import { uploadResume } from "@/lib/api";
import type { ParsedResume } from "@/lib/api";
import {
  Upload,
  FileText,
  CheckCircle,
  XCircle,
  ArrowRight,
  Briefcase,
  GraduationCap,
  Star,
  Cpu,
  User,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { API_BASE } from "@/constants/common";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ResumeUploadPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!isPending && !session) router.replace("/login");
  }, [session, isPending, router]);

  if (isPending) return <Spinner />;
  if (!session) return null;

  return (
    <Suspense fallback={<Spinner />}>
      <ResumeContent userId={session.user.id} userName={session.user.name} userImage={session.user.image} userEmail={session.user.email} />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Main content
// ---------------------------------------------------------------------------

type Stage = "idle" | "uploading" | "success" | "error";

function ResumeContent({
  userId,
  userName,
  userImage,
  userEmail,
}: {
  userId: string;
  userName?: string | null;
  userImage?: string | null;
  userEmail?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const from = searchParams.get("from");
  const backHref = from === "dashboard" ? "/dashboard" : from === "setup" ? "/interview/setup" : "/resume";
  const backLabel = from === "dashboard" ? "Back to dashboard" : from === "setup" ? "Back to interview setup" : "Back to my résumé";

  const { data: existingResumeData, isLoading: loadingExistingResume } = useQuery({
    queryKey: ["resume", userId],
    queryFn: () =>
      fetch(`${API_BASE}/resume/${userId}`).then((r) => (r.ok ? r.json() : null)),
    enabled: !!userId,
  });
  const existingResume = existingResumeData?.resume_data ?? null;

  const [stage, setStage] = useState<Stage>("idle");
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [resume, setResume] = useState<ParsedResume | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Fake incremental progress while waiting for the Gemini round-trip
  useEffect(() => {
    if (stage !== "uploading") return;
    const timeout = setTimeout(() => {
      setProgress(5);
      const interval = setInterval(() => {
        setProgress((p) => {
          if (p >= 90) { clearInterval(interval); return 90; }
          return p + Math.floor(Math.random() * 8) + 3;
        });
      }, 600);
      return () => clearInterval(interval);
    }, 0);
    return () => clearTimeout(timeout);
  }, [stage]);

  const uploadMutation = useMutation({
    mutationFn: ({ file }: { file: File }) => uploadResume(userId, file),
    onSuccess: (result) => {
      queryClient.setQueryData(["resume", userId], { resume_data: result.resume_data });
      queryClient.invalidateQueries({ queryKey: ["resume", userId] });
      setResume(result.resume_data);
      setProgress(100);
      setStage("success");
    },
    onError: (err) => {
      setErrorMsg(err instanceof Error ? err.message : "Upload failed. Please try again.");
      setStage("error");
    },
  });

  const handleFile = useCallback(
    (file: File) => {
      const allowed = [".pdf", ".docx", ".doc", ".txt"];
      const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      if (!allowed.includes(ext)) {
        setErrorMsg(`Unsupported file type "${ext}". Accepted: PDF, DOCX, DOC, TXT.`);
        setStage("error");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setErrorMsg("File exceeds the 10 MB size limit.");
        setStage("error");
        return;
      }

      setSelectedFile(file);
      setStage("uploading");
      setErrorMsg("");
      uploadMutation.mutate({ file });
    },
    [uploadMutation],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const reset = () => {
    setStage("idle");
    setProgress(0);
    setResume(null);
    setSelectedFile(null);
    setErrorMsg("");
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <AppHeader
        homeHref="/dashboard"
        name={userName}
        email={userEmail}
        image={userImage}
      />

      <main className="flex-1 mx-auto w-full max-w-3xl px-4 sm:px-6 py-12 flex flex-col gap-8">
        {/* Breadcrumb */}
        <Link href={backHref} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit">
          ← {backLabel}
        </Link>

        {/* Title */}
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">
            Upload your résumé
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            MockMate uses your résumé to personalise every interview question to your
            experience and skills.
          </p>
        </div>

        {/* Drop zone / upload area */}
        {stage !== "success" && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => stage === "idle" && inputRef.current?.click()}
            className={[
              "relative flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed p-12 transition-colors",
              stage === "idle"
                ? dragging
                  ? "border-orange bg-orange/5 cursor-copy"
                  : "border-border bg-background hover:border-orange/50 cursor-pointer"
                : "border-border bg-background",
            ].join(" ")}
          >
            <Input
              ref={inputRef}
              type="file"
              accept=".pdf,.docx,.doc,.txt"
              className="hidden"
              onChange={onInputChange}
            />

            {stage === "idle" && (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-orange/10">
                  <Upload size={26} className="text-orange" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-foreground">
                    Drag &amp; drop your résumé here
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    or click to browse — PDF, DOCX, DOC, TXT | max 10 MB
                  </p>
                </div>
              </>
            )}

            {stage === "uploading" && (
              <div className="w-full flex flex-col items-center gap-4">
                <div className="h-12 w-12 rounded-full border-4 border-orange border-t-transparent animate-spin" />
                <div className="w-full max-w-xs">
                  <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                    <span>Parsing with AI…</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-surface overflow-hidden">
                    <div
                      className="h-full bg-orange rounded-full transition-all duration-500"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Uploading <span className="font-medium text-foreground">{selectedFile?.name}</span>
                </p>
              </div>
            )}

            {stage === "error" && (
              <div className="flex flex-col items-center gap-3 text-center">
                <XCircle size={36} className="text-red-500" />
                <p className="text-sm font-semibold text-foreground">Upload failed</p>
                <p className="text-xs text-muted-foreground max-w-xs">{errorMsg}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); reset(); }}
                  className="mt-1 rounded-full border-border text-foreground hover:border-orange hover:text-orange"
                >
                  Try again
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Skeleton preview while parsing */}
        {stage === "uploading" && <ResumeCardSkeleton />}

        {/* Parsed résumé result */}
        {stage === "success" && resume && (
          <ParsedResumeCard resume={resume} onReplace={reset} onContinue={() => router.push("/interview/setup?from=resume")} />
        )}

        {/* Current résumé card — shown while idle or after error */}
        {(stage === "idle" || stage === "error") && (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-foreground">Current résumé</p>
            <Card className="rounded-xl border border-border">
              <CardContent className="p-4">
                {loadingExistingResume ? (
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
                ) : existingResume ? (
                  <div className="flex flex-col gap-4">
                    {/* Identity */}
                    <div className="flex items-start gap-3">
                      <div className="h-9 w-9 shrink-0 flex items-center justify-center rounded-full bg-orange/10">
                        <User size={16} className="text-orange" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground text-sm truncate">{existingResume.name}</p>
                        {existingResume.experience?.[0] && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {existingResume.experience[0].title} | {existingResume.experience[0].company}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Skills */}
                    {existingResume.skills && existingResume.skills.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-2">Top skills</p>
                        <div className="flex flex-wrap gap-1.5">
                          {existingResume.skills.slice(0, 8).map((skill: string) => (
                            <Badge
                              key={skill}
                              variant="outline"
                              className="px-2 py-0.5 text-xs text-foreground border-border bg-surface rounded-md"
                            >
                              {skill}
                            </Badge>
                          ))}
                          {existingResume.skills.length > 8 && (
                            <Badge variant="outline" className="px-2 py-0.5 text-xs text-muted-foreground border-border bg-surface rounded-md">
                              +{existingResume.skills.length - 8} more
                            </Badge>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Experience */}
                    {existingResume.experience && existingResume.experience.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-2">Experience</p>
                        <div className="flex flex-col gap-3">
                          {existingResume.experience.slice(0, 2).map((exp: { title: string; company: string; duration: string }, i: number) => (
                            <div key={i} className="flex items-start gap-2.5">
                              <Briefcase size={12} className="text-muted-foreground mt-0.5 shrink-0" />
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-foreground truncate">{exp.title}</p>
                                <p className="text-xs text-muted-foreground truncate">{exp.company} | {exp.duration}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <Link
                      href={`/resume?from=upload${from ? `&origin=${from}` : ""}`}
                      className="text-xs text-orange hover:underline inline-flex items-center gap-1 w-fit"
                    >
                      View full résumé <ChevronRight size={12} />
                    </Link>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 py-6 text-center">
                    <FileText size={28} className="text-muted-foreground opacity-40" />
                    <p className="text-sm text-muted-foreground">No résumé uploaded yet</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Parsed résumé display
// ---------------------------------------------------------------------------

function ParsedResumeCard({
  resume,
  onReplace,
  onContinue,
}: {
  resume: ParsedResume;
  onReplace: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      {/* Success banner */}
      <Alert className="border-green-200 bg-green-50 rounded-xl">
        <CheckCircle size={16} className="text-green-600" />
        <AlertDescription>
          <p className="text-sm font-semibold text-foreground">Résumé parsed successfully</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {resume.filename} | parsed {new Date(resume.parsed_at).toLocaleString()}
          </p>
        </AlertDescription>
      </Alert>

      {/* Profile summary */}
      <Card className="rounded-xl border border-border">
        <CardContent className="p-5 flex flex-col gap-4">
        <div>
          <h2 className="text-base font-bold text-foreground">{resume.name || "—"}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {[resume.email, resume.phone].filter(Boolean).join(" | ")}
          </p>
          {resume.summary && (
            <p className="mt-3 text-sm text-foreground/80 leading-relaxed">{resume.summary}</p>
          )}
        </div>

        {/* Skills */}
        {resume.skills?.length > 0 && (
          <Section icon={<Cpu size={14} className="text-orange" />} title="Skills">
            <div className="flex flex-wrap gap-2 mt-2">
              {resume.skills.map((s) => (
                <Badge
                  key={s}
                  variant="outline"
                  className="rounded-full border-border text-foreground text-xs px-3 py-1"
                >
                  {s}
                </Badge>
              ))}
            </div>
          </Section>
        )}

        {/* Experience */}
        {resume.experience?.length > 0 && (
          <Section icon={<Briefcase size={14} className="text-orange" />} title="Experience">
            <ul className="mt-2 flex flex-col gap-3">
              {resume.experience.map((exp, i) => (
                <li key={i} className="text-sm">
                  <span className="font-medium text-foreground">{exp.title}</span>
                  {exp.company && (
                    <span className="text-muted-foreground"> | {exp.company}</span>
                  )}
                  {exp.duration && (
                    <span className="text-muted-foreground text-xs"> ({exp.duration})</span>
                  )}
                  {exp.highlights?.length > 0 && (
                    <ul className="mt-1 ml-3 flex flex-col gap-0.5 list-disc list-inside">
                      {exp.highlights.map((h, j) => (
                        <li key={j} className="text-xs text-muted-foreground leading-relaxed">
                          {h}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Education */}
        {resume.education?.length > 0 && (
          <Section icon={<GraduationCap size={14} className="text-orange" />} title="Education">
            <ul className="mt-2 flex flex-col gap-1.5">
              {resume.education.map((edu, i) => (
                <li key={i} className="text-sm">
                  <span className="font-medium text-foreground">{edu.degree}</span>
                  {edu.institution && (
                    <span className="text-muted-foreground"> | {edu.institution}</span>
                  )}
                  {edu.year && (
                    <span className="text-xs text-muted-foreground"> ({edu.year})</span>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Bold claims */}
        {resume.bold_claims?.length > 0 && (
          <Section icon={<Star size={14} className="text-orange" />} title="Notable claims">
            <ul className="mt-2 flex flex-col gap-1.5">
              {resume.bold_claims.map((c, i) => (
                <li key={i} className="text-sm text-foreground/80 flex gap-2">
                  <span className="text-orange shrink-0">✦</span>
                  {c}
                </li>
              ))}
            </ul>
          </Section>
        )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={onReplace}
          className="rounded-full border-border text-foreground hover:border-orange hover:text-orange gap-2"
        >
          <FileText size={14} />
          Replace résumé
        </Button>
        <Button
          onClick={onContinue}
          className="rounded-full bg-orange text-light hover:opacity-90 hover:bg-orange gap-2"
        >
          Set up interview
          <ArrowRight size={14} />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function ResumeCardSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-20 w-full rounded-xl" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-orange border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
