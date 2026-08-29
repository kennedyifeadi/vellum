import HeroSection from '@/components/marketing/HeroSection';

export default function Home() {
  return (
    <>
      <HeroSection />

      {/* Extra content so scrolling triggers floating nav */}
      <section className="relative z-10 py-32 flex items-center justify-center">
        <p className="text-gray-400 text-sm tracking-wide uppercase">More sections coming soon</p>
      </section>
    </>
  );
}
