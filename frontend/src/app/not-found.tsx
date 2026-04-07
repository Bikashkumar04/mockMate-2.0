import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-dark px-4 sm:px-6 text-center">
      {/* Subtle glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <div
          className="h-[500px] w-[500px] rounded-full opacity-10"
          style={{ background: "radial-gradient(circle, #FF7518 0%, transparent 70%)" }}
        />
      </div>

      <div className="relative z-10 flex flex-col items-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-orange mb-6">
          Error 404
        </p>
        <h1 className="text-7xl font-bold tracking-tight text-light sm:text-9xl">
          404
        </h1>
        <p className="mt-6 text-xl font-semibold text-light">
          Page not found
        </p>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-light/50">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>

        <Link
          href="/"
          className="group mt-10 inline-flex items-center gap-2 rounded-full border border-light/20 bg-light/5 px-6 py-3 text-sm font-semibold text-light transition-all hover:bg-light/10 hover:border-orange"
        >
          <ArrowLeft size={15} className="transition-transform group-hover:-translate-x-1" />
          Back to home
        </Link>
      </div>
    </div>
  );
}
