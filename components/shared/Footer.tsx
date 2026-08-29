'use client';

import Link from 'next/link';
import { motion, useInView } from 'framer-motion';
import Image from 'next/image';
import { useRef, useEffect } from 'react';

// ─── Footer column data ───────────────────────────────────────────────────────

const FOOTER_COLS = [
  {
    heading: 'Product',
    links: [
      { label: 'All Tools',      href: '/dashboard' },
      { label: 'Pricing',        href: '/pricing' },
      { label: 'Changelog',      href: '/changelog' },
      { label: 'Roadmap',        href: '/roadmap' },
    ],
  },
  {
    heading: 'PDF Tools',
    links: [
      { label: 'Merge PDF',      href: '/dashboard?tool=merge-pdf' },
      { label: 'Split PDF',      href: '/dashboard?tool=split-pdf' },
      { label: 'Compress PDF',   href: '/dashboard?tool=compress-pdf' },
      { label: 'Lock PDF',       href: '/dashboard?tool=lock-pdf' },
      { label: 'Find in PDF',    href: '/dashboard?tool=find-pdf' },
    ],
  },
  {
    heading: 'Image & Video',
    links: [
      { label: 'Image to PDF',   href: '/dashboard?tool=image-to-pdf' },
      { label: 'JPEG to PNG',    href: '/dashboard?tool=jpg-to-png' },
      { label: 'Compress Image', href: '/dashboard?tool=image-compress' },
      { label: 'Compress Video', href: '/dashboard?tool=video-compress' },
    ],
  },
  {
    heading: 'Documents',
    links: [
      { label: 'DOCX to PDF',    href: '/dashboard?tool=docx-to-pdf' },
      { label: 'HTML to PDF',    href: '/dashboard?tool=html-to-pdf' },
      { label: 'PDF to DOCX',    href: '/dashboard?tool=pdf-to-docx' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About',          href: '/about' },
      { label: 'Blog',           href: '/blog' },
      { label: 'Contact',        href: '/contact' },
      { label: 'Careers',        href: '/careers' },
    ],
  },
];

const LEGAL_LINKS = [
  { label: 'Privacy',          href: '/privacy' },
  { label: 'Terms',            href: '/terms' },
  { label: 'Cookie Policy',    href: '/cookies' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function Footer() {
  const year = new Date().getFullYear();
  const videoRef = useRef<HTMLVideoElement>(null);
  const isInView = useInView(videoRef, { once: true, margin: "0px 0px -100px 0px" });

  useEffect(() => {
    if (isInView && videoRef.current) {
      videoRef.current.play().catch(err => console.error("Video play failed:", err));
    }
  }, [isInView]);

  return (
    <footer className="relative z-10 w-full bg-white text-gray-900 pt-20 pb-8 px-6 lg:px-12 xl:px-20 border-t border-gray-100 flex flex-col justify-between min-h-[80vh]">
      
      {/* ── Top section: tagline + columns ── */}
      <div className="max-w-500 w-full mx-auto">
        <div className="flex flex-col xl:flex-row xl:gap-20 gap-14">

          {/* Left — brand tagline */}
          <div className="xl:w-64 shrink-0">
            {/* Logo */}
            <Link href="/" className="inline-flex items-center gap-2.5 mb-5">
              <Image src="/vellum.png" alt="Vellum Logo" width={80} height={40} className="w-10 h-auto" />
              <span className="font-semibold text-lg tracking-tight text-gray-900">Vellum</span>
            </Link>

            <p className="text-sm text-gray-500 leading-relaxed">
              The all-in-one file toolkit for&nbsp;
              <span className="text-gray-900 font-medium">PDF, image, video</span>
              &nbsp;and document workflows — built for speed.
            </p>
          </div>

          {/* Right — nav columns */}
          <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-10">
            {FOOTER_COLS.map((col) => (
              <div key={col.heading}>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-4">
                  {col.heading}
                </p>
                <ul className="space-y-2.5">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className="text-sm text-gray-700 hover:text-gray-900 transition-colors"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Middle: Massive Brand Text / Video ── */}
      <div className="flex-1 flex items-center justify-center py-24 overflow-hidden w-full bg-white">
        {/*
        <motion.h1 
          initial={{ y: 150, opacity: 0 }}
          whileInView={{ y: 0, opacity: 1 }}
          viewport={{ once: true, margin: "0px 0px -100px 0px" }}
          transition={{ duration: 1.3, ease: [0.16, 0.65, 0.24, 1] }}
          className="text-[20vw] sm:text-[18vw] font-bold tracking-tighter text-black leading-none select-none text-center"
        >
          Vellum
        </motion.h1>
        */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: "0px 0px -100px 0px" }}
          transition={{ duration: 1.3, ease: [0.16, 0.65, 0.24, 1] }}
          className="w-full max-w-375 flex justify-center overflow-hidden relative aspect-4/1"
        >
          <video
            ref={videoRef}
            src="/FooterVideo.mp4"
            muted
            playsInline
            className="w-full h-full object-cover"
            style={{ 
              filter: 'grayscale(1) contrast(1.3) brightness(1.15)',
              mixBlendMode: 'multiply'
            }}
          />
        </motion.div>
      </div>

      {/* ── Bottom bar ── */}
      <div className="max-w-500 w-full mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <p className="text-xs text-gray-400">
            © {year} Vellum. All rights reserved.
          </p>

          <nav className="flex items-center gap-6">
            {LEGAL_LINKS.map((l) => (
              <Link
                key={l.label}
                href={l.href}
                className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
      
    </footer>
  );
}
