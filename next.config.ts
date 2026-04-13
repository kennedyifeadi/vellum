import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevent Next.js from trying to bundle Puppeteer & Chromium.
  // This is the App Router way to exclude large server-only packages.
  serverExternalPackages: ['puppeteer', 'puppeteer-core', 'pdfjs-dist', 'ffmpeg-static', 'fluent-ffmpeg'],
  // Required to suppress "webpack config with Turbopack" error in Next.js 16
  turbopack: {},
};

export default nextConfig;
