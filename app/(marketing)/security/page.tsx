import React from 'react';
import Link from 'next/link';
import { STORAGE_LIMITS, formatQuota } from '@/lib/storage-limits';

export const metadata = {
  title: "Trust & Security | Vellum",
  description: "How Vellum handles your documents, images and videos: encrypted in transit, and deleted automatically after a few days.",
};

export default function SecurityPage() {
  return (
    <div className="min-h-screen pt-32 pb-24 bg-surface text-gray-900 font-sans">
      <div className="max-w-4xl mx-auto px-6 lg:px-8">
        
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-gray-900 mb-6">
            Your files are your business. <br className="hidden md:block" />
            <span className="text-brand-strong">Keeping them safe is ours.</span>
          </h1>
          <p className="text-lg text-gray-600 leading-relaxed max-w-2xl mx-auto">
            What Vellum does with the files you convert, and how long it keeps them.
          </p>
        </div>

        {/* Security Pillars */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
          
          <div className="p-8 rounded-panel bg-gray-50 border border-gray-100">
            <div className="w-12 h-12 bg-indigo-100 text-brand-strong rounded-control flex items-center justify-center mb-6">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path>
              </svg>
            </div>
            <h3 className="text-xl font-bold mb-3">Automatic Deletion</h3>
            <p className="text-gray-600 text-sm leading-relaxed">
              We process your files temporarily. Without an account, nothing you convert is stored, except Compress Video results, which you can download for 24 hours. On Basic, Pro and Enterprise, stored documents and conversion history are deleted automatically after {STORAGE_LIMITS.Basic.retentionDays}, {STORAGE_LIMITS.Pro.retentionDays} or {STORAGE_LIMITS.Enterprise.retentionDays} days, and with auto-delete turned on a conversion stores no file at all. Deleting your account deletes your conversions, documents and video jobs.
            </p>
          </div>

          <div className="p-8 rounded-panel bg-gray-50 border border-gray-100">
            <div className="w-12 h-12 bg-indigo-100 text-brand-strong rounded-control flex items-center justify-center mb-6">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
              </svg>
            </div>
            <h3 className="text-xl font-bold mb-3">Encrypted in Transit</h3>
            <p className="text-gray-600 text-sm leading-relaxed">
              Every file you upload and download travels over HTTPS, so it is encrypted between your browser and our servers.
            </p>
          </div>

          <div className="p-8 rounded-panel bg-gray-50 border border-gray-100">
            <div className="w-12 h-12 bg-indigo-100 text-brand-strong rounded-control flex items-center justify-center mb-6">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path>
              </svg>
            </div>
            <h3 className="text-xl font-bold mb-3">Zero Data Mining</h3>
            <p className="text-gray-600 text-sm leading-relaxed">
              We never read, analyze, or mine the contents of your files. Your PDFs, videos, and images belong entirely to you. We are in the business of file conversion, not data brokering.
            </p>
          </div>

          <div className="p-8 rounded-panel bg-gray-50 border border-gray-100">
            <div className="w-12 h-12 bg-indigo-100 text-brand-strong rounded-control flex items-center justify-center mb-6">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
              </svg>
            </div>
            <h3 className="text-xl font-bold mb-3">Enterprise</h3>
            <p className="text-gray-600 text-sm leading-relaxed">
              Enterprise has the highest limits: {formatQuota(STORAGE_LIMITS.Enterprise.quotaBytes)} of storage, with files kept {STORAGE_LIMITS.Enterprise.retentionDays} days. If your team needs more, <Link href="/contact" className="text-brand-strong hover:underline">tell us what you need</Link>.
            </p>
          </div>

        </div>

        {/* Call to Action */}
        <div className="text-center py-12 border-t border-gray-200">
          <h2 className="text-2xl font-bold mb-4">Ready to start processing files securely?</h2>
          <div className="flex justify-center gap-4 mt-6">
            <Link href="/" className="px-6 py-3 rounded-xl text-sm font-semibold bg-brand-strong text-on-brand hover:bg-brand-hover transition-colors shadow-sm">
              Use Free Tools
            </Link>
            <Link href="/pricing" className="px-6 py-3 rounded-xl text-sm font-semibold bg-surface-sunken text-gray-900 hover:bg-gray-200 transition-colors">
              View Pricing
            </Link>
          </div>
        </div>

      </div>
    </div>
  );
}
