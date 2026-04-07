import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Privacy Policy — MockMate",
  description: "How MockMate collects, uses, and protects your personal data.",
};

export default function PrivacyPage() {
  return (
    <>
      <Navbar />
      <main className="bg-background min-h-screen">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-24">
          <p className="text-xs font-semibold uppercase tracking-widest text-orange mb-3">
            Legal
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-foreground mb-2">
            Privacy Policy
          </h1>
          <p className="text-sm text-muted-foreground mb-12">
            Last updated: 1 March 2026
          </p>

          <div className="prose prose-slate max-w-none text-sm leading-relaxed text-muted-foreground space-y-10">
            <section>
              <h2 className="text-base font-semibold text-foreground mb-3">1. Introduction</h2>
              <p>
                MockMate (&quot;we&quot;, &quot;our&quot;, &quot;us&quot;) is committed to protecting your personal data.
                This Privacy Policy explains what information we collect when you use MockMate,
                how we use it, and your rights in relation to it.
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-foreground mb-3">2. Data We Collect</h2>
              <ul className="list-disc pl-5 space-y-2">
                <li>
                  <strong className="text-foreground">Account data</strong> — your name and email address when
                  you create an account.
                </li>
                <li>
                  <strong className="text-foreground">Résumé data</strong> — the content of résumés you upload,
                  parsed and stored to generate personalised interview questions.
                </li>
                <li>
                  <strong className="text-foreground">Session data</strong> — audio transcripts, webcam posture
                  scores, and feedback generated during mock interview sessions.
                </li>
                <li>
                  <strong className="text-foreground">Usage data</strong> — pages visited, features used, and
                  browser/device information collected via analytics.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-base font-semibold text-foreground mb-3">3. How We Use Your Data</h2>
              <ul className="list-disc pl-5 space-y-2">
                <li>To provide, operate and improve the MockMate service.</li>
                <li>To generate personalised interview questions and feedback reports.</li>
                <li>To send you service-related communications (e.g. session results).</li>
                <li>To comply with legal obligations.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-base font-semibold text-foreground mb-3">4. Data Sharing</h2>
              <p>
                We do not sell your personal data. We share data only with:
              </p>
              <ul className="list-disc pl-5 space-y-2 mt-2">
                <li>
                  <strong className="text-foreground">Infrastructure providers</strong> — for
                  AI processing, storage, hosting, and database operations required
                  to run MockMate.
                </li>
                <li>
                  <strong className="text-foreground">Analytics providers</strong> — in anonymised or aggregated
                  form only.
                </li>
                <li>
                  Law enforcement or regulators where required by applicable law.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-base font-semibold text-foreground mb-3">5. Data Retention</h2>
              <p>
                We retain your account and session data for as long as your account
                is active. You may request deletion at any time by contacting us.
                Résumé files are deleted automatically 12 months after upload.
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-foreground mb-3">6. Your Rights</h2>
              <p>
                Depending on your location you may have the right to access, correct,
                port, or delete your personal data, and to object to or restrict
                certain processing. To exercise these rights, contact us at the
                address below.
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-foreground mb-3">7. Cookies</h2>
              <p>
                We use cookies and similar technologies as described in our{" "}
                <Link href="/cookies" className="text-orange hover:underline">
                  Cookie Policy
                </Link>
                .
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-foreground mb-3">8. Contact</h2>
              <p>
                For any privacy-related questions, email us at{" "}
                <a href="mailto:privacy@mockmate.ai" className="text-orange hover:underline">
                  privacy@mockmate.ai
                </a>
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
