import Link from "next/link";
import { ArrowRight } from "lucide-react";

const PERSONAS = [
  { name: "Startup Founder",        tag: "Culture fit & ownership",       emoji: "🚀" },
  { name: "Investment Banker",      tag: "Precision & numbers",           emoji: "📊" },
  { name: "Tech Lead",              tag: "Depth & trade-offs",            emoji: "⚙️" },
  { name: "Algorithm Guru",         tag: "DSA & complexity",              emoji: "🧠" },
  { name: "System Designer",        tag: "Architecture & scalability",    emoji: "🏛️" },
  { name: "Prompt Wizard",            tag: "LLMs, ML & GenAI",              emoji: "🤖" },
  { name: "HR Manager",             tag: "Behavioural & values",          emoji: "🤝" },
  { name: "Product Manager",        tag: "User empathy & data",           emoji: "🗺️" },
  { name: "VP of Engineering",      tag: "Leadership & scale",            emoji: "🏗️" },
  { name: "Management Consultant",  tag: "Structure & frameworks",        emoji: "🧩" },
  { name: "CTO",                    tag: "Tech strategy & vision",        emoji: "🔭" },
  { name: "Recruiter",              tag: "Career narrative & fit",        emoji: "🎯" },
];

export default function Personas() {
  return (
    <section id="personas" className="relative bg-background py-24">
      <div className="landing-grid pointer-events-none absolute inset-0 opacity-20" aria-hidden="true" />
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-16 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-orange mb-3">
            Interviewer personas
          </p>
          <h2 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Choose your challenge
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
            Twelve distinct interviewers. Each one pushes differently — from an
            aggressive investment banker to a visionary CTO. The experience
            changes entirely depending on who you practise against.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-3 max-w-4xl mx-auto">
          {PERSONAS.map((p) => (
            <div
              key={p.name}
              className="glass-surface cursor-pointer rounded-2xl p-6 text-center transition-all duration-300 hover:-translate-y-1 hover:border-orange/35"
            >
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-orange/15 text-2xl">
                {p.emoji}
              </div>
              <h3 className="text-sm font-semibold text-foreground">{p.name}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{p.tag}</p>
            </div>
          ))}
        </div>

        {/* CTA band */}
        <div className="mt-20 rounded-3xl bg-gradient-to-br from-[#101a33] via-[#172849] to-[#101c38] px-8 py-14 text-center shadow-[0_28px_60px_rgba(12,28,68,0.4)]">
          <h2 className="text-3xl font-bold tracking-tight text-light sm:text-4xl">
            Ready to find out if you&apos;d get the job?
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-base leading-relaxed text-light/60">
            Upload your résumé, pick a persona, and sit your first mock
            interview — free, no credit card required.
          </p>
          <Link
            href="/login"
            className="group mt-8 inline-flex items-center gap-2 rounded-full bg-orange px-8 py-3.5 text-sm font-semibold text-light shadow-[0_10px_24px_rgba(59,130,246,0.35)] transition-all hover:-translate-y-0.5 hover:bg-orange/90"
          >
            Start your mock interview
            <ArrowRight
              size={16}
              className="transition-transform group-hover:translate-x-1"
            />
          </Link>
        </div>
      </div>
    </section>
  );
}
