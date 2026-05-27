export default function Home() {
  return (
    <>
      {/* ── Hero placeholder ── tall enough to test scroll behaviour */}
      <section
        className="flex-1 flex flex-col items-center justify-center text-center px-6"
        style={{
          background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 40%, #4f46e5 100%)',
          minHeight: '100vh',
        }}
      >
        <h1 className="text-5xl sm:text-7xl font-bold text-white tracking-tight leading-tight max-w-3xl">
          Your file toolkit,<br />
          <span className="text-indigo-300">elevated.</span>
        </h1>
        <p className="mt-6 text-lg text-indigo-200 max-w-xl leading-relaxed">
          PDF, image, video and document tools — beautifully fast, built for the way you work.
        </p>
        <div className="mt-10 flex items-center gap-4">
          <a
            href="/sign-up"
            className="px-7 py-3.5 rounded-xl bg-white text-indigo-700 font-semibold text-sm hover:bg-indigo-50 transition-colors shadow-lg"
          >
            Get Started Free
          </a>
          <a
            href="/sign-in"
            className="px-7 py-3.5 rounded-xl border border-white/20 text-white font-semibold text-sm hover:bg-white/10 transition-colors"
          >
            Sign In
          </a>
        </div>
      </section>

      {/* Extra content so scrolling triggers floating nav */}
      <section className="py-32 bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm tracking-wide uppercase">More sections coming soon</p>
      </section>
    </>
  );
}
