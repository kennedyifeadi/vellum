import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js clones the request body for any route matched by proxy.ts's `matcher`
  // (so the proxy and the route handler can each read it), and caps that clone at
  // 10MB by default — silently truncating larger uploads before formData() ever
  // runs. Raised to cover the largest plan-tier upload limit in the app
  // (video-compress's 500MB Pro cap), with headroom for multipart overhead.
  experimental: {
    proxyClientMaxBodySize: 520 * 1024 * 1024,
  },
  // Prevent Next.js from trying to bundle Puppeteer & Chromium.
  // This is the App Router way to exclude large server-only packages.
  serverExternalPackages: [
    'puppeteer', 'puppeteer-core',
    'pdfjs-dist',
    'ffmpeg-static', 'fluent-ffmpeg',
    'sharp',
    'mongoose',
    '@getbrevo/brevo',
    'nodemailer',
    'pdf-lib',
    'pdf-parse',
  ],
  // PDF to Word extracts text in a worker thread (lib/convert/pdf-extraction.ts). The
  // worker's entry file is loaded from disk by path and is the only importer of
  // pdf-parse on that route, so the build cannot trace either on its own; without these
  // a traced deployment (Vercel, standalone output) ships without them.
  outputFileTracingIncludes: {
    '/api/convert/pdf-to-docx': [
      './lib/convert/pdf-extraction-worker.mjs',
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
