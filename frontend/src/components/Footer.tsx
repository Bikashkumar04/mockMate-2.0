import Link from "next/link";
import Logo from "@/components/Logo";

const PRODUCT_LINKS = [
  { label: "Features",     href: "/#features" },
  { label: "Personas",     href: "/#personas" },
  { label: "How it works", href: "/#how-it-works" },
];

const LEGAL_LINKS = [
  { label: "Privacy policy",   href: "/privacy" },
  { label: "Terms of service", href: "/terms" },
  { label: "Cookie policy",    href: "/cookies" },
];

export default function Footer() {
  return (
    <footer className="bg-gradient-to-br from-[#0d1730] via-[#112242] to-[#0d1730] text-light/65">
      <div className="mx-auto max-w-7xl px-6 py-16">
        {/* Top row */}
        <div className="flex flex-col gap-10 lg:flex-row lg:justify-between">
          {/* Brand */}
          <div className="max-w-xs">
            <Link href="/" className="flex items-center gap-2.5 mb-4">
              <Logo color="#ffffff" />
              <span className="text-light font-semibold text-lg tracking-tight">
                Mock<span className="text-orange">Mate</span>
              </span>
            </Link>
            <p className="text-sm leading-relaxed">
              Interview practice, without the nerves. Real-time AI mock
              interviews powered by voice, vision, and your résumé.
            </p>
          </div>

          {/* Link columns */}
          <div className="grid grid-cols-2 gap-10">
            <div>
              <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-light">
                Product
              </p>
              <ul className="space-y-2.5">
                {PRODUCT_LINKS.map(({ label, href }) => (
                  <li key={label}>
                    <Link href={href} className="text-sm transition-colors hover:text-orange">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-light">
                Legal
              </p>
              <ul className="space-y-2.5">
                {LEGAL_LINKS.map(({ label, href }) => (
                  <li key={label}>
                    <Link href={href} className="text-sm transition-colors hover:text-orange">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom row */}
        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-light/10 pt-8 sm:flex-row">
          <p className="text-xs">
            © {new Date().getFullYear()} MockMate. All rights reserved.
          </p>
          <p className="text-xs">
            Built with{" "}
            <span className="text-orange">Sarvam AI</span> &amp;{" "}
            <span className="text-orange">MongoDB</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
