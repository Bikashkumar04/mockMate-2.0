export const APP_NAME= "MockMate";
export const APP_DESCRIPTION =
  "MockMate conducts live, voice-based mock interviews personalised to your résumé — scoring your tone, posture, vocabulary, and confidence in real time. Walk into every real interview already knowing how it ends.";

// ── API ──────────────────────────────────────────────────────────────────────
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

// ── Persona display mappings ────────────────────────────────────────────────
export const PERSONA_LABELS: Record<string, string> = {
  neutral: "Professional",
  startup_founder: "Startup Founder",
  investment_banker: "Investment Banker",
  tech_lead: "Tech Lead",
  hr_manager: "HR Manager",
  product_manager: "Product Manager",
  vp_engineering: "VP of Engineering",
  management_consultant: "Consultant",
  cto: "CTO",
  recruiter: "Recruiter",
  algorithm_guru: "Algorithm Guru",
  system_designer: "System Designer",
  prompt_wizard: "Prompt Wizard",
};

export const PERSONA_COLORS: Record<string, string> = {
  neutral: "bg-orange-500/15 text-orange-500 dark:text-orange-300",
  startup_founder: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  investment_banker: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  tech_lead: "bg-green-500/15 text-green-600 dark:text-green-400",
  hr_manager: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
  product_manager: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  vp_engineering: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
  management_consultant: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
  cto: "bg-red-500/15 text-red-600 dark:text-red-400",
  recruiter: "bg-lime-500/15 text-lime-600 dark:text-lime-400",
  algorithm_guru: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
  system_designer: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  prompt_wizard: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400"
};

// ── Persona helpers ─────────────────────────────────────────────────────────
export function personaLabel(p: string) {
  return PERSONA_LABELS[p] ?? p;
}

export function personaColor(p: string) {
  return (
    PERSONA_COLORS[p] ?? "bg-zinc-500/15 text-zinc-400 dark:text-zinc-300"
  );
}

// ── Score helpers ────────────────────────────────────────────────────────────
export function scorePillClass(score: number | null) {
  if (score === null) return "bg-zinc-500/15 text-zinc-500 dark:text-zinc-400";
  if (score >= 85) return "bg-green-500/15 text-green-600 dark:text-green-400";
  if (score >= 70)
    return "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400";
  if (score >= 50) return "bg-orange/15 text-orange";
  return "bg-red-500/15 text-red-600 dark:text-red-400";
}

// ── Date helpers ────────────────────────────────────────────────────────────
export function fmtDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

export function fmtDuration(start: string, end: string | null) {
  if (!end) return "—";
  const mins = Math.round(
    (new Date(end).getTime() - new Date(start).getTime()) / 60000
  );
  if (mins < 1) return "< 1 min";
  return `${mins} min${mins !== 1 ? "s" : ""}`;
}