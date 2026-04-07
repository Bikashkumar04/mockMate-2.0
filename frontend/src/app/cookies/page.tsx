import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Cookie Policy — MockMate",
  description: "How MockMate uses cookies and similar tracking technologies.",
};

export default function CookiesPage() {
  return (
    <>
      <Navbar />
      <main className="bg-background min-h-screen">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-24">
          <p className="text-xs font-semibold uppercase tracking-widest text-orange mb-3">
            Legal
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-foreground mb-2">
            Cookie Policy
          </h1>
          <p className="text-sm text-muted-foreground mb-12">
            Last updated: 1 March 2026
          </p>

          <div className="prose prose-slate max-w-none text-sm leading-relaxed text-muted-foreground space-y-10">
            <section>
              <h2 className="text-base font-semibold text-foreground mb-3">1. What Are Cookies?</h2>
              <p>
                Cookies are small text files placed on your device when you visit a website.
                They are widely used to make sites work efficiently and to provide information
                to the site owners.
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-foreground mb-3">2. How We Use Cookies</h2>
              <p>MockMate uses cookies for the following purposes:</p>
              <ul className="list-disc pl-5 space-y-2 mt-2">
                <li>
                  <strong className="text-foreground">Authentication</strong> — to keep you signed in
                  securely across page loads (session cookies, strictly necessary).
                </li>
                <li>
                  <strong className="text-foreground">Preferences</strong> — to remember settings such
                  as theme or language choice.
                </li>
                <li>
                  <strong className="text-foreground">Analytics</strong> — to understand how visitors
                  interact with our platform so we can improve it. Analytics cookies are
                  only placed with your consent.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-base font-semibold text-foreground mb-3">3. Types of Cookies We Set</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse mt-2">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 pr-4 font-semibold text-foreground">Cookie</th>
                      <th className="text-left py-2 pr-4 font-semibold text-foreground">Purpose</th>
                      <th className="text-left py-2 font-semibold text-foreground">Duration</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    <tr>
                      <td className="py-2 pr-4 font-mono">better-auth.session</td>
                      <td className="py-2 pr-4">Maintains your login session</td>
                      <td className="py-2">Session</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-mono">__Secure-next-auth</td>
                      <td className="py-2 pr-4">CSRF protection</td>
                      <td className="py-2">Session</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-mono">_mm_analytics</td>
                      <td className="py-2 pr-4">Anonymous usage analytics</td>
                      <td className="py-2">1 year</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h2 className="text-base font-semibold text-foreground mb-3">4. Third-Party Cookies</h2>
              <p>
                We may use Google Analytics to collect anonymised usage data. Google may
                set their own cookies subject to{" "}
                <a
                  href="https://policies.google.com/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-orange hover:underline"
                >
                  Google&apos;s Privacy Policy
                </a>
                .
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-foreground mb-3">5. Managing Cookies</h2>
              <p>
                You can control or delete cookies at any time through your browser settings.
                Note that disabling strictly necessary cookies (authentication) will prevent
                you from signing in to MockMate. Disabling analytics cookies has no effect
                on the core functionality of the service.
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-foreground mb-3">6. Contact</h2>
              <p>
                Questions about our use of cookies? Email us at{" "}
                <a href="mailto:privacy@mockmate.ai" className="text-orange hover:underline">
                  privacy@mockmate.ai
                </a>
                . See also our{" "}
                <Link href="/privacy" className="text-orange hover:underline">
                  Privacy Policy
                </Link>{" "}
                and{" "}
                <Link href="/terms" className="text-orange hover:underline">
                  Terms of Service
                </Link>
                .
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
