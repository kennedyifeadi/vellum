import type { NextConfig } from "next";

// Every source a page loads must be listed here, or the browser blocks it: see "Security
// headers" in the README before adding a script, image, video, frame or fetch from a new host.
function contentSecurityPolicy(development: boolean): string {
  const directives: [string, ...string[]][] = [
    ['default-src', "'self'"],
    // 'unsafe-inline': Next's inline bootstrap scripts carry no nonce on statically rendered
    // pages. 'unsafe-eval' only in development, where React and Turbopack evaluate code for
    // debugging. The Google hosts serve the Drive picker's scripts: Identity Services for its
    // access token, and gapi's loader with the picker module it fetches from the same host.
    ['script-src', "'self'", "'unsafe-inline'", ...(development ? ["'unsafe-eval'"] : []),
      'https://accounts.google.com/gsi/client', 'https://apis.google.com'],
    // 'unsafe-inline': framer-motion and next/image write style attributes. Identity Services
    // loads its stylesheet from /gsi/style, as Google documents.
    ['style-src', "'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/style'],
    // data: for avatars, which are stored as data URLs; blob: for previews of the files a user
    // picks; Unsplash for the carousel's video poster, loaded without next/image.
    ['img-src', "'self'", 'data:', 'blob:', 'https://images.unsplash.com'],
    // data: and blob: because results are read back from data URLs and PDF previews from
    // object URLs. Identity Services fetches under /gsi/, as Google documents.
    ['connect-src', "'self'", 'data:', 'blob:', 'https://accounts.google.com/gsi/'],
    // Identity Services' frames, as Google documents, and the picker, which Google renders in
    // an iframe on docs.google.com.
    ['frame-src', 'https://accounts.google.com/gsi/', 'https://docs.google.com'],
    // The pdf.js worker is served from /pdfjs.
    ['worker-src', "'self'"],
    // The carousel on the pricing and contact pages plays a Mixkit video.
    ['media-src', "'self'", 'https://assets.mixkit.co'],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    // Google sign-in posts to our own route, which redirects to Google's sign-in host.
    ['form-action', "'self'", 'https://accounts.google.com'],
    ['frame-ancestors', "'none'"],
  ];
  return directives.map((directive) => directive.join(' ')).join('; ');
}

function securityHeaders(): { key: string; value: string }[] {
  return [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(process.env.NODE_ENV === 'development') },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Frame-Options', value: 'DENY' },
    {
      key: 'Permissions-Policy',
      value: 'accelerometer=(), bluetooth=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), hid=(), magnetometer=(), microphone=(), midi=(), payment=(), serial=(), usb=()',
    },
    // No includeSubDomains or preload until the production domain is chosen: both bind
    // every subdomain of it to HTTPS, and a preload listing is slow to undo.
    ...(process.env.NODE_ENV === 'production'
      ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }]
      : []),
  ];
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders() }];
  },
  // Prevent Next.js from trying to bundle Puppeteer & Chromium.
  // This is the App Router way to exclude large server-only packages.
  serverExternalPackages: [
    'puppeteer', 'puppeteer-core',
    'pdfjs-dist',
    'ffmpeg-static',
    'sharp',
    'mongoose',
    '@getbrevo/brevo',
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
  // Otherwise `next dev` writes an AGENTS.md into the repository whenever an AI coding
  // agent runs it, a file that is not part of the project and is easy to commit by mistake.
  agentRules: false,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      // A Google account's profile picture, which sign-in stores as the user's image.
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
    ],
  },
};

export default nextConfig;
