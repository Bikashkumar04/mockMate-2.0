"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useSession } from "@/lib/auth-client";
import { useQuery, useMutation } from "@tanstack/react-query";
import AppHeader from "@/components/AppHeader";
import { getResume, startSession } from "@/lib/api";
import {
  ArrowLeft,
  ArrowRight,
  Zap,
  TrendingUp,
  Code2,
  Users,
  Briefcase,
  Loader2,
  FileText,
  LayoutDashboard,
  Layers,
  BarChart2,
  Cpu,
  UserCheck,
  Binary,
  Network,
  Bot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type Persona = {
  id: string;
  label: string;
  tagline: string;
  description: string;
  icon: React.ReactNode;
};

const PERSONAS: Persona[] = [
  {
    id: "neutral",
    label: "Professional",
    tagline: "Balanced & thorough",
    description:
      "A fair, methodical interviewer who covers all bases without unnecessary pressure.",
    icon: <Briefcase size={20} className="text-orange" />,
  },
  {
    id: "startup_founder",
    label: "Startup Founder",
    tagline: "Fast-paced & direct",
    description:
      "Cares about ownership, bias for action, and culture fit. Pushes back on vague answers.",
    icon: <Zap size={20} className="text-orange" />,
  },
  {
    id: "investment_banker",
    label: "Investment Banker",
    tagline: "High-pressure & precise",
    description:
      "Expects STAR-format answers with quantifiable results. No filler words tolerated.",
    icon: <TrendingUp size={20} className="text-orange" />,
  },
  {
    id: "tech_lead",
    label: "Tech Lead",
    tagline: "Deep technical dives",
    description:
      "Probes system design trade-offs, code quality, and exposes gaps with follow-ups.",
    icon: <Code2 size={20} className="text-orange" />,
  },
  {
    id: "hr_manager",
    label: "HR Manager",
    tagline: "Behavioural focus",
    description:
      "Focuses on teamwork, conflict resolution, and alignment with company values.",
    icon: <Users size={20} className="text-orange" />,
  },
  {
    id: "product_manager",
    label: "Product Manager",
    tagline: "User-obsessed & data-driven",
    description:
      "Probes product thinking, prioritisation, and cross-functional influence. Expects impact metrics.",
    icon: <LayoutDashboard size={20} className="text-orange" />,
  },
  {
    id: "vp_engineering",
    label: "VP of Engineering",
    tagline: "Leadership & scale",
    description:
      "Evaluates engineering leadership, team building, and how you balance velocity with quality.",
    icon: <Layers size={20} className="text-orange" />,
  },
  {
    id: "management_consultant",
    label: "Consultant",
    tagline: "Structured & hypothesis-led",
    description:
      "Expects MECE thinking, quantified analysis, and a clear recommendation. Keeps you focused if you ramble.",
    icon: <BarChart2 size={20} className="text-orange" />,
  },
  {
    id: "cto",
    label: "CTO",
    tagline: "Vision meets depth",
    description:
      "Big-picture technology strategy combined with deep architectural judgment. Challenges your trade-offs.",
    icon: <Cpu size={20} className="text-orange" />,
  },
  {
    id: "recruiter",
    label: "Recruiter",
    tagline: "Career narrative & fit",
    description:
      "Explores your motivations, career transitions, and what you're optimising for. Warm but probing.",
    icon: <UserCheck size={20} className="text-orange" />,
  },
  {
    id: "algorithm_guru",
    label: "Algorithm Guru",
    tagline: "DSA & problem solving",
    description:
      "Tests algorithmic thinking, data structures, and complexity analysis. Pushes for optimal solutions.",
    icon: <Binary size={20} className="text-orange" />,
  },
  {
    id: "system_designer",
    label: "System Designer",
    tagline: "Architecture & scalability",
    description:
      "Probes distributed systems, trade-offs, and failure modes. Expects structured, top-down thinking.",
    icon: <Network size={20} className="text-orange" />,
  },
  {
    id: "prompt_wizard",
    label: "Prompt Wizard",
    tagline: "LLMs, ML systems & GenAI",
    description:
      "Focuses on AI/ML fundamentals, LLM application design, evaluation, safety, and production trade-offs.",
    icon: <Bot size={20} className="text-orange" />,
  },
];

const DIFFICULTIES = [
  {
    id: "easy",
    label: "Easy",
    description: "Foundational questions, gentle follow-ups.",
  },
  {
    id: "medium",
    label: "Medium",
    description: "Realistic interview pressure with probing follow-ups.",
  },
  {
    id: "hard",
    label: "Hard",
    description: "Aggressive follow-ups, deep technical dives, tough challenges.",
  },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function InterviewSetupPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <SetupPageInner />
    </Suspense>
  );
}

function SetupPageInner() {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!isPending && !session) router.replace("/login");
  }, [session, isPending, router]);

  if (isPending) return <Spinner />;
  if (!session) return null;

  return (
    <SetupContent
      userId={session.user.id}
      userName={session.user.name}
      userImage={session.user.image}
      userEmail={session.user.email}
    />
  );
}

// ---------------------------------------------------------------------------
// Main content
// ---------------------------------------------------------------------------

function SetupContent({
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
  const from = searchParams.get("from"); // "dashboard" | "resume" | "sessions" | "resumes"

  const [persona, setPersona]       = useState(() => searchParams.get("persona") ?? "neutral");
  const [jobRole, setJobRole]       = useState(() => searchParams.get("job_role") ?? "");
  const [difficulty, setDifficulty] = useState(() => searchParams.get("difficulty") ?? "medium");
  const [error, setError]           = useState("");

  // Check if the user has a resume
  const { data: resumeData, isLoading: resumeLoading } = useQuery({
    queryKey: ["resume", userId],
    queryFn: () => getResume(userId),
    enabled: !!userId,
    staleTime: 10 * 60 * 1000,
  });
  const hasResume = resumeLoading ? null : !!resumeData;
  const suggestedTitles: string[] = resumeData?.suggested_job_titles ?? [];
  const suggestedPlaceholder =
    suggestedTitles[0]
    ?? resumeData?.experience?.[0]?.title
    ?? "e.g. Senior Software Engineer at a Series B startup";

  const startSessionMutation = useMutation({
    mutationFn: startSession,
    onSuccess: (result) => {
      router.push(
        `/interview/live?session_id=${result.session_id}` +
        `&persona=${encodeURIComponent(persona)}` +
        `&job_role=${encodeURIComponent(jobRole.trim())}` +
        `&difficulty=${encodeURIComponent(difficulty)}` +
        `&interviewer_name=${encodeURIComponent(result.interviewer_name ?? "Alex")}` +
        (result.interviewer_avatar_url ? `&avatar_url=${encodeURIComponent(result.interviewer_avatar_url)}` : ""),
      );
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    },
  });

  // Back link based on where we came from
  const backHref =
    from === "resume" ? "/resume" :
    from === "sessions" ? "/sessions" :
    "/dashboard";
  const backLabel =
    from === "resume"   ? "Back to résumé" :
    from === "sessions" ? "Back to sessions" :
    "Back to dashboard";

  const canSubmit =
    jobRole.trim().length > 0 &&
    !resumeLoading &&
    !startSessionMutation.isPending &&
    hasResume === true;

  const handleSubmit = () => {
    if (!canSubmit) return;
    setError("");
    startSessionMutation.mutate({
      user_id: userId,
      persona,
      job_role: jobRole.trim(),
      difficulty,
    });
  };

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <AppHeader
        homeHref="/dashboard"
        name={userName}
        email={userEmail}
        image={userImage}
      />

      <main className="flex-1 mx-auto w-full max-w-3xl px-4 sm:px-6 py-12 flex flex-col gap-10">
        {/* Breadcrumb */}
        <Link
          href={backHref}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
        >
          <ArrowLeft size={14} />
          {backLabel}
        </Link>

        {/* Resume gate */}
        {resumeLoading && (
          <Alert className="border-border bg-background rounded-xl">
            <AlertDescription className="flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin" />
              Checking your résumé before interview setup…
            </AlertDescription>
          </Alert>
        )}

        {hasResume === false && (
          <Alert className="border-orange/30 bg-orange/5 rounded-xl">
            <AlertDescription className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <p className="font-semibold text-foreground flex items-center gap-2">
                  <FileText size={16} className="text-orange" />
                  Résumé required
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  You need to upload your résumé before starting an interview so MockMate can personalise the questions.
                </p>
              </div>
              <Button asChild className="shrink-0 rounded-full bg-orange text-light hover:opacity-90 hover:bg-orange">
                <Link href="/resume/upload?from=setup">Upload résumé</Link>
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Title */}
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">
            Configure your interview
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose a target role, pick an interviewer, and set the pressure level.
          </p>
        </div>

        {/* Step 1 — Job role */}
        <section className="flex flex-col gap-3">
          <SectionLabel step={1} label="Target job role" />
          <Input
            type="text"
            placeholder={suggestedPlaceholder}
            value={jobRole}
            onChange={(e) => setJobRole(e.target.value)}
            disabled={hasResume !== true}
            className="rounded-xl border-border bg-background focus:ring-orange/40 focus:border-orange"
          />
          {suggestedTitles.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Suggestions</span>
              {suggestedTitles.map((title) => (
                <Button
                  key={title}
                  type="button"
                  variant="outline"
                  onClick={() => setJobRole(title)}
                  disabled={hasResume !== true}
                  className={[
                    "text-xs px-3 py-1.5 rounded-full border transition-all hover:bg-inherit hover:text-inherit",
                    jobRole === title
                      && "border-orange text-orange dark:border-orange dark:text-orange"
                  ].join(" ")}
                >
                  {title}
                </Button>
              ))}
            </div>
          )}
        </section>

        {/* Step 2 — Persona */}
        <section className="flex flex-col gap-3">
          <SectionLabel step={2} label="Choose interviewer persona" />
          <div className="grid gap-3 sm:grid-cols-2">
            {PERSONAS.map((p) => (
              <PersonaCard
                key={p.id}
                persona={p}
                selected={persona === p.id}
                onSelect={() => setPersona(p.id)}
              />
            ))}
          </div>
        </section>

        {/* Step 3 — Difficulty */}
        <section className="flex flex-col gap-3">
          <SectionLabel step={3} label="Difficulty level" />
          <div className="flex flex-col sm:flex-row gap-3">
            {DIFFICULTIES.map((d) => (
              <DifficultyCard
                key={d.id}
                difficulty={d}
                selected={difficulty === d.id}
                onSelect={() => setDifficulty(d.id)}
              />
            ))}
          </div>
        </section>

        {/* Error */}
        {error && (
          <Alert variant="destructive" className="rounded-xl">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* CTA */}
        <div className="flex items-center justify-end pt-2">
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="rounded-full bg-orange text-light hover:opacity-90 hover:bg-orange disabled:opacity-40 px-6"
          >
            {startSessionMutation.isPending ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Generating questions…
              </>
            ) : (
              <>
                Generate questions
                <ArrowRight size={14} />
              </>
            )}
          </Button>
        </div>

        {/* Blocking modal — prevents navigation while questions are being generated */}
        <Dialog open={startSessionMutation.isPending}>
          <DialogContent
            className="sm:max-w-md rounded-2xl border-border bg-background [&>button]:hidden"
            onInteractOutside={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => e.preventDefault()}
          >
            <div className="flex flex-col items-center gap-5 py-4">
              <div className="relative flex items-center justify-center">
                <div className="h-14 w-14 rounded-full border-[3px] border-orange/20 border-t-orange animate-spin" />
              </div>
              <div className="text-center space-y-1.5">
                <DialogTitle className="text-lg font-bold text-foreground">
                  Setting up your interview
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  Generating tailored questions based on your résumé and selected job role.
                  This usually takes a minute — please don&apos;t close this page.
                </DialogDescription>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionLabel({ step, label }: { step: number; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange text-xs font-bold text-light">
        {step}
      </span>
      <span className="text-sm font-semibold text-foreground">{label}</span>
    </div>
  );
}

function PersonaCard({
  persona,
  selected,
  onSelect,
}: {
  persona: Persona;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Card
      onClick={onSelect}
      className={[
        "cursor-pointer rounded-xl border transition-all",
        selected
          ? "border-orange bg-orange/5 ring-1 ring-orange/30"
          : "border-border bg-background hover:border-orange/40",
      ].join(" ")}
    >
      <CardContent className="p-4 flex flex-col gap-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange/10">
            {persona.icon}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground truncate">{persona.label}</p>
            <p className="text-xs text-muted-foreground truncate">{persona.tagline}</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{persona.description}</p>
      </CardContent>
    </Card>
  );
}

function DifficultyCard({
  difficulty,
  selected,
  onSelect,
}: {
  difficulty: { id: string; label: string; description: string };
  selected: boolean;
  onSelect: () => void;
}) {
  const accent =
    difficulty.id === "easy"
      ? "text-green-600"
      : difficulty.id === "medium"
      ? "text-orange"
      : "text-red-500";

  return (
    <Card
      onClick={onSelect}
      className={[
        "flex-1 cursor-pointer rounded-xl border transition-all",
        selected
          ? "border-orange bg-orange/5 ring-1 ring-orange/30"
          : "border-border bg-background hover:border-orange/40",
      ].join(" ")}
    >
      <CardContent className="p-4 flex flex-col gap-1.5">
        <p className={`text-sm font-bold ${accent}`}>{difficulty.label}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{difficulty.description}</p>
      </CardContent>
    </Card>
  );
}

function Spinner() {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-orange border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
