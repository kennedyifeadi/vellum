"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';

const tools = [
  {
    id: 'pdf-to-doc',
    logoText: 'Vellum PDF',
    stats: [
      { value: '100%', label: 'Formatting retention across all doc types' },
      { value: '< 5s', label: 'Average time to convert a 50-page PDF' }
    ],
    title: 'Transform the way you handle documents',
    quote: '"Transform your static PDFs into fully editable Word documents in seconds. Preserve your original layout, formatting, and fonts without the hassle of manual retyping. Focus on what matters—your content."',
    mediaType: 'image',
    mediaUrl: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?q=80&w=2072&auto=format&fit=crop',
    cta: 'Try Converter',
    link: '/tools/pdf-to-word',
  },
  {
    id: 'video-compression',
    logoText: 'Vellum Video',
    stats: [
      { value: '80%', label: 'Reduction in file size on average' },
      { value: '4K', label: 'Resolution support with no quality loss' }
    ],
    title: 'Crystal clear quality, fraction of the size',
    quote: '"Reduce video file sizes dramatically without compromising on visual quality. Our intelligent compression algorithms make your videos easy to share, upload, and store while keeping every frame crystal clear."',
    mediaType: 'video',
    mediaUrl: 'https://assets.mixkit.co/videos/preview/mixkit-software-developer-working-on-code-4171-large.mp4',
    posterUrl: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?q=80&w=2071&auto=format&fit=crop',
    cta: 'Compress Video',
    link: '/tools/compress-video',
  },
  {
    id: 'merge-pdf',
    logoText: 'Vellum Merge',
    stats: [
      { value: '∞', label: 'Unlimited files per merge operation' },
      { value: '1-Click', label: 'Simple drag and drop interface' }
    ],
    title: 'The ultimate tool for document organization',
    quote: '"Combine multiple PDF files into a single, organized document. Whether you\'re assembling reports, portfolios, or invoices, our intuitive merge tool keeps everything perfectly structured and accessible."',
    mediaType: 'image',
    mediaUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2564&auto=format&fit=crop',
    cta: 'Merge Files',
    link: '/tools/merge-pdf',
  }
];

export default function ToolsCarousel() {
  const [currentIndex, setCurrentIndex] = useState(0);

  const handleNext = () => {
    setCurrentIndex((prev) => (prev + 1) % tools.length);
  };

  const handlePrev = () => {
    setCurrentIndex((prev) => (prev - 1 + tools.length) % tools.length);
  };

  useEffect(() => {
    const timer = setInterval(() => {
      handleNext();
    }, 7000);
    return () => clearInterval(timer);
  }, [currentIndex]);

  const currentTool = tools[currentIndex];

  return (
    <div className="w-full max-w-360">
      <div className="bg-[#f2f5f9] rounded-4xl p-6 md:p-14 lg:p-18">
        {/* Title Component */}
        <h2 className="text-3xl md:text-5xl font-normal text-gray-800 mb-10 tracking-tight">
          A world where any conversion is possible.
        </h2>

        {/* Carousel Component */}
        <div className="relative w-full h-110 md:h-132.5 rounded-3xl overflow-hidden">
          
          {/* Full-width Image/Video Background */}
          <AnimatePresence>
            <motion.div
              key={currentIndex}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.8, ease: "easeInOut" }}
              className="absolute inset-0 w-full h-full"
            >
              {currentTool.mediaType === 'image' ? (
                <Image
                  src={currentTool.mediaUrl}
                  alt={currentTool.title}
                  fill
                  className="object-cover opacity-90"
                />
              ) : (
                <video
                  src={currentTool.mediaUrl}
                  poster={currentTool.posterUrl}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="w-full h-full object-cover opacity-90"
                />
              )}
              {/* Subtle dark gradient overlay to ensure the white card stands out slightly more */}
              <div className="absolute inset-0 bg-black/30" />
            </motion.div>
          </AnimatePresence>

          {/* Floating Card */}
          <div 
            className="absolute top-4 right-4 bottom-4 md:top-8 md:right-8 md:bottom-8 w-full max-w-90 bg-white rounded-3xl md:rounded-4xl p-6 md:p-8 flex flex-col justify-between z-10 overflow-y-auto"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            
            {/* Header: Logo & Controls */}
            <div className="flex items-center justify-between mb-4">
              <div className="font-bold text-gray-900 flex items-center gap-2 text-lg tracking-tight">
                <div className="w-6 h-6 bg-indigo-700 rounded-full flex items-center justify-center shrink-0">
                  <span className="text-white text-[10px]">V</span>
                </div>
                <AnimatePresence mode="wait">
                  <motion.span
                    key={currentIndex}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ duration: 0.3 }}
                  >
                    {currentTool.logoText}
                  </motion.span>
                </AnimatePresence>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePrev}
                  className="w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors"
                  aria-label="Previous"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5M12 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  onClick={handleNext}
                  className="w-10 h-10 rounded-full border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors"
                  aria-label="Next"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={currentIndex}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.4, ease: "easeInOut" }}
                className="flex flex-col flex-1 justify-between"
              >
                <div>
                  {/* Stats Row */}
                  <div className="flex items-start mb-4 pb-4">
                    <div className="flex-1 pr-4">
                      <div className="text-3xl font-bold text-gray-900 mb-2">{currentTool.stats[0].value}</div>
                      <div className="text-xs text-gray-500 leading-relaxed pr-2">
                        {currentTool.stats[0].label}
                      </div>
                    </div>
                    <div className="w-px bg-gray-200 h-16 self-center"></div>
                    <div className="flex-1 pl-6">
                      <div className="text-3xl font-bold text-gray-900 mb-2">{currentTool.stats[1].value}</div>
                      <div className="text-xs text-gray-500 leading-relaxed pr-2">
                        {currentTool.stats[1].label}
                      </div>
                    </div>
                  </div>

                  {/* Content Body */}
                  <div className="flex-1 mb-4">
                    <h3 className="text-base font-bold text-gray-900 mb-3">
                      {currentTool.title}
                    </h3>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      {currentTool.quote}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-6">
                  <Link 
                    href={currentTool.link}
                    className="text-sm font-semibold text-gray-900 hover:text-indigo-600 transition-colors flex items-center gap-1 group w-fit"
                  >
                    {currentTool.cta} 
                    <span className="group-hover:translate-x-1 transition-transform inline-block">
                      &rarr;
                    </span>
                  </Link>
                </div>
              </motion.div>
            </AnimatePresence>

          </div>
        </div>
      </div>
    </div>
  );
}
