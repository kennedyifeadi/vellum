'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';

// ─── Tools data per mega-nav category ────────────────────────────────────────

const MEGA_NAV_CATEGORIES = [
  {
    label: 'PDF Solutions',
    description: 'Work with PDF files effortlessly',
    tools: [
      { name: 'Merge PDF',      desc: 'Combine multiple PDFs into one',   href: '/dashboard?tool=merge-pdf' },
      { name: 'Split PDF',      desc: 'Extract or separate PDF pages',    href: '/dashboard?tool=split-pdf' },
      { name: 'Compress PDF',   desc: 'Reduce PDF file size instantly',   href: '/dashboard?tool=compress-pdf' },
      { name: 'Lock PDF',       desc: 'Password-protect your PDFs',       href: '/dashboard?tool=lock-pdf' },
      { name: 'Find in PDF',    desc: 'Search text across PDF documents', href: '/dashboard?tool=find-pdf' },
    ],
  },
  {
    label: 'Image Solutions',
    description: 'Transform and optimise images',
    tools: [
      { name: 'Image to PDF',   desc: 'Convert JPG/PNG to a PDF',        href: '/dashboard?tool=image-to-pdf' },
      { name: 'JPEG to PNG',    desc: 'Swap image formats with ease',     href: '/dashboard?tool=jpg-to-png' },
      { name: 'Compress Image', desc: 'Shrink images without quality loss', href: '/dashboard?tool=image-compress' },
    ],
  },
  {
    label: 'Video Solutions',
    description: 'Optimise and process video files',
    tools: [
      { name: 'Compress Video', desc: 'Reduce video size while preserving quality', href: '/dashboard?tool=video-compress' },
    ],
  },
  {
    label: 'Document Solutions',
    description: 'Convert docs across all formats',
    tools: [
      { name: 'DOCX to PDF',   desc: 'Turn Word docs into polished PDFs', href: '/dashboard?tool=docx-to-pdf' },
      { name: 'HTML to PDF',   desc: 'Render any webpage as a PDF',       href: '/dashboard?tool=html-to-pdf' },
      { name: 'PDF to DOCX',   desc: 'Convert PDF back to editable Word', href: '/dashboard?tool=pdf-to-docx' },
    ],
  },
];

// ─── Arrow chevron icon ───────────────────────────────────────────────────────
function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transition: 'transform 0.2s ease', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
    >
      <path d="M2 4l4 4 4-4" />
    </svg>
  );
}

// ─── Mega nav panel ───────────────────────────────────────────────────────────
function MegaNav({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className="absolute top-full left-1/2 -translate-x-1/2 mt-3 w-[860px] max-w-[96vw] bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-50"
      onMouseLeave={onClose}
    >
      <div className="grid grid-cols-4 divide-x divide-gray-100">
        {MEGA_NAV_CATEGORIES.map((cat) => (
          <div key={cat.label} className="p-6">
            {/* category header */}
            <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-1">
              {cat.label}
            </p>
            <p className="text-xs text-gray-400 mb-4 leading-snug">{cat.description}</p>

            {/* tools list */}
            <ul className="space-y-1">
              {cat.tools.map((tool) => (
                <li key={tool.name}>
                  <Link
                    href={tool.href}
                    onClick={onClose}
                    className="group flex flex-col gap-0.5 rounded-lg px-2 py-2 hover:bg-gray-50 transition-colors"
                  >
                    <span className="text-sm font-medium text-gray-800 group-hover:text-indigo-600 transition-colors">
                      {tool.name}
                    </span>
                    <span className="text-[11px] text-gray-400 leading-tight">{tool.desc}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* bottom CTA bar */}
      <div className="bg-gray-50 border-t border-gray-100 px-6 py-3 flex items-center justify-between">
        <p className="text-xs text-gray-500">
          Explore all <span className="font-semibold text-gray-700">12 tools</span> across every category
        </p>
        <Link
          href="/dashboard"
          onClick={onClose}
          className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition-colors flex items-center gap-1"
        >
          View all tools
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 6h8M7 3l3 3-3 3" />
          </svg>
        </Link>
      </div>
    </motion.div>
  );
}

// ─── Main Navbar ──────────────────────────────────────────────────────────────
export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [megaOpen, setMegaOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const megaRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── scroll detection ──────────────────────────────────────────────────────
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // ── close mega nav on outside click ──────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (megaRef.current && !megaRef.current.contains(e.target as Node)) {
        setMegaOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSolutionsEnter = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setMegaOpen(true);
  };

  const handleSolutionsLeave = () => {
    timerRef.current = setTimeout(() => setMegaOpen(false), 150);
  };

  return (
    <>
      {/* ── spacer so hero content starts below the fixed bar ── */}
      <div className="h-20 bg-transparent" />

      <header
        className={`
          fixed left-0 right-0 z-40
          transition-all duration-500 ease-out
          ${scrolled
            ? 'top-4 px-4 sm:px-6 lg:px-8'
            : 'top-0 px-0'
          }
        `}
      >
        <nav
          className={`
            mx-auto flex items-center justify-between
            transition-all duration-500 ease-out
            ${scrolled
              ? 'max-w-5xl rounded-2xl bg-white/90 backdrop-blur-md shadow-lg shadow-black/6 border border-gray-200/60 px-5 h-14'
              : 'max-w-[2000px] bg-transparent border border-transparent px-6 lg:px-12 h-20'
            }
          `}
        >
          {/* ── Logo ── */}
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <Image src="/vellum.png" alt="Vellum Logo" width={40} height={40} className="w-10 h-auto" />
            <span className="font-semibold text-lg tracking-tight transition-colors text-gray-900">
              Vellum
            </span>
          </Link>

          {/* ── Desktop links ── */}
          <div className="hidden md:flex items-center gap-1 relative" ref={megaRef}>
            {/* Solutions — mega nav trigger */}
            <div
              className="relative"
              onMouseEnter={handleSolutionsEnter}
              onMouseLeave={handleSolutionsLeave}
            >
              <button
                className={`
                  flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium
                  transition-all duration-150
                  ${scrolled
                    ? 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }
                  ${megaOpen ? (scrolled ? 'text-gray-900 bg-gray-100' : 'text-gray-900 bg-gray-50') : ''}
                `}
                aria-expanded={megaOpen}
                onClick={() => setMegaOpen((p) => !p)}
              >
                Solutions <ChevronDown open={megaOpen} />
              </button>

              <AnimatePresence>
                {megaOpen && <MegaNav onClose={() => setMegaOpen(false)} />}
              </AnimatePresence>
            </div>

            {/* Static links */}
            {['About', 'Pricing', 'Contact'].map((item) => (
              <Link
                key={item}
                href={`/${item.toLowerCase()}`}
                className={`
                  px-3.5 py-2 rounded-lg text-sm font-medium
                  transition-all duration-150
                  ${scrolled
                    ? 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }
                `}
              >
                {item}
              </Link>
            ))}
          </div>

          {/* ── Right actions ── */}
          <div className="hidden md:flex items-center gap-2">
            <Link
              href="/sign-in"
              className={`
                px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150
                ${scrolled
                  ? 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }
              `}
            >
              Login
            </Link>
            <Link
              href="/sign-up"
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-sm"
            >
              Get Started
            </Link>
          </div>

          {/* ── Mobile hamburger ── */}
          <button
            className="md:hidden p-2 rounded-lg transition-colors text-gray-700 hover:bg-gray-100"
            onClick={() => setMobileOpen((p) => !p)}
            aria-label="Toggle menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {mobileOpen
                ? <><path d="M18 6L6 18" /><path d="M6 6l12 12" /></>
                : <><path d="M3 6h18" /><path d="M3 12h18" /><path d="M3 18h18" /></>
              }
            </svg>
          </button>
        </nav>

        {/* ── Mobile drawer ── */}
        <AnimatePresence>
          {mobileOpen && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.18 }}
              className={`
                md:hidden mx-4 mt-2 rounded-2xl bg-white border border-gray-100 shadow-xl overflow-hidden
              `}
            >
              <div className="p-4 space-y-1">
                {/* Solutions accordion */}
                <button
                  onClick={() => setMegaOpen((p) => !p)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Solutions <ChevronDown open={megaOpen} />
                </button>
                <AnimatePresence>
                  {megaOpen && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: 'auto' }}
                      exit={{ height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="pl-4 pb-2 space-y-3">
                        {MEGA_NAV_CATEGORIES.map((cat) => (
                          <div key={cat.label}>
                            <p className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-1">{cat.label}</p>
                            {cat.tools.map((t) => (
                              <Link
                                key={t.name}
                                href={t.href}
                                onClick={() => setMobileOpen(false)}
                                className="block px-2 py-1.5 text-sm text-gray-700 hover:text-indigo-600 rounded-lg hover:bg-gray-50"
                              >
                                {t.name}
                              </Link>
                            ))}
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {['About', 'Pricing', 'Contact'].map((item) => (
                  <Link
                    key={item}
                    href={`/${item.toLowerCase()}`}
                    onClick={() => setMobileOpen(false)}
                    className="block px-3 py-2.5 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    {item}
                  </Link>
                ))}
              </div>

              <div className="border-t border-gray-100 p-4 flex gap-2">
                <Link
                  href="/sign-in"
                  onClick={() => setMobileOpen(false)}
                  className="flex-1 text-center px-4 py-2.5 rounded-lg text-sm font-medium text-gray-700 border border-gray-200 hover:bg-gray-50"
                >
                  Login
                </Link>
                <Link
                  href="/sign-up"
                  onClick={() => setMobileOpen(false)}
                  className="flex-1 text-center px-4 py-2.5 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  Get Started
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>
    </>
  );
}
