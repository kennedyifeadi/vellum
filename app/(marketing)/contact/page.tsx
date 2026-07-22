import Link from "next/link";
import ContactFormSection from "@/components/marketing/ContactFormSection";

export default function ContactPage() {
  return (
    <div className="pt-10 pb-32 max-w-350 mx-auto px-6">
      {/* ── Page Header ── */}
      <div className="w-full mb-16 flex justify-between ">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl mb-5 leading-tight">
            Questions, feedback,
            <br />
            or need a hand?
          </h1>
          <p className="text-lg text-gray-600">
            We&apos;re here to help you get the most out of Vellum.
          </p>
        </div>
        <p className="text-lg text-gray-600 self-end">
          Let&apos;s build better documents together.
        </p>
      </div>

      {/* ── Contact Grid ── */}
      <div className="border border-gray-200 rounded-2xl overflow-hidden bg-white">
        {/* Top Section */}
        <div className="p-8 sm:p-10 border-b border-gray-200 relative overflow-hidden">
          <div className="relative z-10">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                General Support
              </h2>
              <p className="text-gray-600 max-w-md mb-8 leading-relaxed">
                Need help converting files,
                <br className="hidden sm:block" />
                using a feature,
                <br className="hidden sm:block" />
                or troubleshooting an issue?
              </p>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                <Link
                  href="/dashboard/help"
                  className="inline-flex items-center justify-center rounded-lg bg-gray-900 px-6 py-3 text-sm font-semibold text-white hover:bg-gray-800 transition-all w-fit"
                >
                  Contact Support &rarr;
                </Link>
                <div className="flex items-center gap-2 text-sm text-gray-500 font-medium justify-end">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                  </span>
                  All systems operational
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Section - 3 columns */}
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-gray-200 bg-white">
          {/* Col 1 */}
          <div className="p-8 sm:p-10 flex flex-col items-start transition-colors hover:bg-white">
            <div className="flex-1">
              <h3 className="text-lg font-bold text-gray-900 mb-3">
                Feature Request
              </h3>
              <p className="text-sm text-gray-600 leading-relaxed mb-8">
                Have an idea that would make
                <br className="hidden sm:block" />
                Vellum even better?
              </p>
            </div>
            <Link
              href="mailto:support@vellum.com?subject=Feature Request"
              className="inline-flex items-center justify-center rounded-lg bg-white border border-gray-200 px-5 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 hover:border-gray-300 transition-colors"
            >
              Share an idea &rarr;
            </Link>
          </div>

          {/* Col 2 */}
          <div className="p-8 sm:p-10 flex flex-col items-start transition-colors hover:bg-white">
            <div className="flex-1">
              <h3 className="text-lg font-bold text-gray-900 mb-3">
                Bug Report
              </h3>
              <p className="text-sm text-gray-600 leading-relaxed mb-8">
                Found something that isn&apos;t working?
              </p>
            </div>
            <Link
              href="mailto:support@vellum.com?subject=Bug Report"
              className="inline-flex items-center justify-center rounded-lg bg-white border border-gray-200 px-5 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 hover:border-gray-300 transition-colors"
            >
              Report a bug &rarr;
            </Link>
          </div>

          {/* Col 3 */}
          <div className="p-8 sm:p-10 flex flex-col items-start transition-colors hover:bg-white">
            <div className="flex-1">
              <h3 className="text-lg font-bold text-gray-900 mb-3">Business</h3>
              <p className="text-sm text-gray-600 leading-relaxed mb-8">
                Interested in partnerships,
                <br className="hidden sm:block" />
                API access,
                <br className="hidden sm:block" />
                or enterprise solutions?
              </p>
            </div>
            <Link
              href="mailto:support@vellum.com?subject=Business Inquiry"
              className="inline-flex items-center justify-center rounded-lg bg-white border border-gray-200 px-5 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 hover:border-gray-300 transition-colors"
            >
              Let&apos;s talk &rarr;
            </Link>
          </div>
        </div>
      </div>

      {/* ── Additional Form Section ── */}
      <div className="mt-32">
        <ContactFormSection />
      </div>

    </div>
  );
}
