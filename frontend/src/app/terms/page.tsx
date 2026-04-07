import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Terms of Service — MockMate",
  description: "The terms governing your use of the MockMate platform.",
};

export default function TermsPage() {
  return (
    <>
      <Navbar />
      <main className="bg-background min-h-screen">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-24">
          <p className="text-xs font-semibold uppercase tracking-widest text-orange mb-3">
            Legal
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-foreground mb-2">
            Terms of Service
          </h1>
          <p className="text-sm text-muted-foreground mb-12">
            Last updated: 1 March 2026
          </p>

          <div className="prose prose-slate max-w-none text-sm leading-relaxed text-muted-foreground space-y-10">
            <section>
              <h2 className="text-base font-semibold text-foreground mb-3">1. Acceptance</h2>
              <p>
                By creating an account or using MockMate, you agree to these Terms of
                Service. If you do not agree, do not use the service.
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-foreground mb-3">2. Description of Service</h2>
              <p>
                MockMate provides AI-powered mock interview practice using voice, vision,
                and résumé-aware questioning. The service is intended for personal career
                development purposes only.
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-foreground mb-3">3. Account Responsibilities</h2>
              <ul className="list-disc pl-5 space-y-2">
                <li>You must be at least 16 years old to create an account.</li>
                <li>You are responsible for maintaining the security of your credentials.</li>
                <li>You must not share, resell, or sublicence access to the service.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-base font-semibold text-foreground mb-3">4. Acceptable Use</h2>
              <p>You agree not to:</p>
              <ul className="list-disc pl-5 space-y-2 mt-2">
                <li>Use the service for any unlawful purpose.</li>
                <li>Attempt to reverse-engineer, scrape, or extract underlying AI models.</li>
                <li>Upload résumés or content belonging to someone else without authorisation.</li>
                <li>Interfere with the operation of the platform or its infrastructure.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-base font-semibold text-foreground mb-3">5. Intellectual Property</h2>
              <p>
                All platform code, AI models, branding, and generated feedback reports are
                the intellectual property of MockMate. Your résumé content remains yours.
                You grant MockMate a limited licence to process your content solely to
                deliver the service.
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-foreground mb-3">6. Disclaimers</h2>
              <p>
                MockMate&apos;s feedback is AI-generated and provided for practice purposes
                only. It does not constitute professional career advice and does not
                guarantee any employment outcome. The service is provided &quot;as is&quot;
                without warranties of any kind.
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-foreground mb-3">7. Limitation of Liability</h2>
              <p>
                To the maximum extent permitted by law, MockMate shall not be liable for
                any indirect, incidental, or consequential damages arising from your use
                of the service.
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-foreground mb-3">8. Termination</h2>
              <p>
                We may suspend or terminate your account if you breach these terms.
                You may delete your account at any time from your account settings.
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-foreground mb-3">9. Changes to Terms</h2>
              <p>
                We may update these terms from time to time. Continued use of the
                service after changes constitutes acceptance of the revised terms.
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-foreground mb-3">10. Contact</h2>
              <p>
                For questions about these terms, email us at{" "}
                <a href="mailto:legal@mockmate.ai" className="text-orange hover:underline">
                  legal@mockmate.ai
                </a>
                . See also our{" "}
                <Link href="/privacy" className="text-orange hover:underline">
                  Privacy Policy
                </Link>{" "}
                and{" "}
                <Link href="/cookies" className="text-orange hover:underline">
                  Cookie Policy
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
