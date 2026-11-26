import type { Metadata } from 'next';
import HeroSection from '@/components/marketing/HeroSection';
import VideoSection from '@/components/marketing/VideoSection';

export const metadata: Metadata = {
  title: 'Vellum | PDF, image and video tools',
  description: 'Convert, compress, merge, split and protect PDFs, images, videos and documents, with or without an account.',
};

export default function Home() {
  return (
    <>
      <HeroSection />
      <VideoSection />
    </>
  );
}
