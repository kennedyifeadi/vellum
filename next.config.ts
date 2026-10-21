import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevent Next.js from trying to bundle Puppeteer & Chromium.
  // This is the App Router way to exclude large server-only packages.
  serverExternalPackages: [
    'puppeteer', 'puppeteer-core',
    'pdfjs-dist',
    'ffmpeg-static',
    'sharp',
    'mongoose',
    '@getbrevo/brevo',
    'nodemailer',
    'pdf-lib',
    'pdf-parse',
  ],
  // PDF to Word, Find in PDF and Image to PDF do their heavy work in a worker thread
  // (lib/convert/worker-job.ts). A worker's entry file is loaded from disk by path and is
  // the only importer, on that route, of the library file it names, so the build cannot
  // trace either on its own; without these a traced deployment (Vercel, standalone
  // output) ships without them.
  outputFileTracingIncludes: {
    '/api/convert/image-to-pdf': [
      './lib/image/to-pdf-worker.mjs',
      './node_modules/pdf-lib/package.json',
      './node_modules/pdf-lib/dist/pdf-lib.min.js',
    ],
    '/api/convert/find-pdf': [
      './lib/convert/find-pdf-extraction-worker.mjs',
      './lib/convert/pdf-worker-runtime.mjs',
      './node_modules/pdfjs-dist/package.json',
      './node_modules/pdfjs-dist/legacy/build/pdf.mjs',
      './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
    ],
    '/api/convert/pdf-to-docx': [
      './lib/convert/pdf-extraction-worker.mjs',
      './lib/convert/pdf-worker-runtime.mjs',
      './node_modules/pdf-parse/package.json',
      './node_modules/pdf-parse/dist/pdf-parse/esm/**/*.js',
      './node_modules/pdf-parse/node_modules/pdfjs-dist/package.json',
      './node_modules/pdf-parse/node_modules/pdfjs-dist/legacy/build/pdf.mjs',
      './node_modules/pdf-parse/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
    ],
  },
  // Required to suppress "webpack config with Turbopack" error in Next.js 16
  turbopack: {},
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
  },
};

export default nextConfig;
