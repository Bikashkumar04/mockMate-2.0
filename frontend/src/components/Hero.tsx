import Link from "next/link";
import { ArrowRight, Mic, Eye, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function Hero() {
  return (
    <section className="hero-mesh relative overflow-hidden">
      <div
        aria-hidden="true"
        className="landing-grid pointer-events-none absolute inset-0 opacity-20"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-start justify-end"
      >
        <div
          className="h-[520px] w-[520px] rounded-full opacity-25 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, rgba(59,130,246,0.95) 0%, rgba(59,130,246,0) 72%)",
          }}
        />
      </div>

      <div className="relative mx-auto flex max-w-7xl flex-col items-center px-6 pb-28 pt-36 text-center">
        <Badge
          variant="outline"
          className="mb-8 gap-2 rounded-full border-orange/30 bg-orange/15 px-4 py-1.5 text-xs uppercase tracking-widest text-orange"
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-orange" />
          AI-Powered Mock Interviews
        </Badge>

        <h1 className="max-w-4xl text-5xl font-bold leading-tight tracking-tight text-light sm:text-6xl lg:text-7xl">
          Interview practice,{" "}
          <span className="text-gradient">without the nerves.</span>
        </h1>

        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-light/60">
          MockMate conducts live, voice-based mock interviews personalised to
          your résumé — scoring your tone, posture, vocabulary, and confidence
          in real time. Walk into every real interview already knowing how it
          ends.
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Button
            asChild
            size="lg"
            className="group rounded-full bg-orange px-8 text-light shadow-[0_10px_30px_rgba(59,130,246,0.35)] transition-all hover:-translate-y-0.5 hover:bg-orange"
          >
            <Link href="/login">
              Start your mock interview
              <ArrowRight
                size={16}
                className="transition-transform group-hover:translate-x-1"
              />
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="rounded-full border-light/20 bg-transparent px-8 text-light hover:border-light/50 hover:bg-light/10 hover:text-light"
          >
            <Link href="#how-it-works">See how it works</Link>
          </Button>
        </div>

        <p className="mt-8 text-xs text-light/30 tracking-wide">
          No credit card required &nbsp;|&nbsp; Mock sessions generated instantly
        </p>

        <div className="glass-surface mt-14 grid w-full max-w-4xl grid-cols-1 gap-3 rounded-2xl p-4 sm:grid-cols-3">
          {[
            { icon: <Mic size={14} />, label: "Live voice interview" },
            { icon: <Eye size={14} />, label: "Real-time vision analysis" },
            { icon: <FileText size={14} />, label: "Résumé-personalised questions" },
          ].map((item) => (
            <Badge
              key={item.label}
              variant="outline"
              className="h-auto justify-center gap-2 rounded-xl border-light/10 bg-light/5 px-4 py-2.5 text-xs font-medium text-light/75 hover:bg-light/10"
            >
              <span className="text-orange">{item.icon}</span>
              {item.label}
            </Badge>
          ))}
        </div>
      </div>
    </section>
  );
}
