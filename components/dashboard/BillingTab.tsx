"use client";

import React, { useState, useEffect } from 'react';
import { useDashboard } from '@/app/dashboard/layout';

export default function BillingTab() {
  const { user } = useDashboard();
  const [loading, setLoading] = useState<string | null>(null);
  
  const [processedFiles, setProcessedFiles] = useState(0);
  const [isDataLoading, setIsDataLoading] = useState(true);

  // We read `isPro` from the context or the endpoint
  const isPro = user?.plan === 'Pro';

  useEffect(() => {
    const fetchBillingData = async () => {
      try {
        const res = await fetch('/api/user/billing');
        if (res.ok) {
          const data = await res.json();
          setProcessedFiles(data.processedFiles || 0);
        }
      } catch (err) {
        console.error('Failed to fetch billing data', err);
      } finally {
        setIsDataLoading(false);
      }
    };

    fetchBillingData();
  }, []);

  const handleAction = (action: string) => {
    setLoading(action);
    setTimeout(() => {
      setLoading(null);
    }, 1500);
  };

  return (
    <div className="flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-8">
        <h2 className="text-xl font-bold text-[#111827]">Billing & Subscription</h2>
        <p className="text-[13px] text-[#6b7280] mt-1">Manage your plan, payment methods, and invoices.</p>
      </div>

      <div className="space-y-8">
        
        {/* Current Plan */}
        <section className="bg-white border border-[#eaedf3] rounded-2xl overflow-hidden shadow-sm relative">
          {isPro && (
            <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-[#6366f1] to-[#818cf8]" />
          )}
          <div className="p-6 border-b border-[#eaedf3] flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-[#111827]">Current Plan</h3>
              <p className="text-[13px] text-[#6b7280] mt-1">
                You are currently on the <strong className="text-[#111827]">{isPro ? 'Pro' : 'Free'}</strong> tier.
              </p>
            </div>
            {!isPro ? (
              <button 
                className="h-9 px-4 bg-[#6366f1] text-white text-[12px] font-bold rounded-lg hover:bg-[#4f46e5] transition-all flex items-center gap-2 shadow-sm shadow-[#6366f1]/20"
              >
                Upgrade Plan
              </button>
            ) : (
              <span className="px-3 py-1 bg-[#e0e7ff] text-[#4f46e5] text-[11px] font-bold rounded-full">
                Active Subscription
              </span>
            )}
          </div>
          <div className="p-6 bg-[#f8fafc] grid grid-cols-2 gap-4">
            <div className="bg-white p-4 rounded-xl border border-[#eaedf3]">
              <p className="text-[11px] font-bold text-[#6b7280] uppercase tracking-wider mb-2">Max Upload Size</p>
              <div className="flex items-end gap-1">
                <span className="text-2xl font-black text-[#111827]">50</span>
                <span className="text-sm font-bold text-[#6b7280] mb-0.5">MB</span>
              </div>
            </div>
            <div className="bg-white p-4 rounded-xl border border-[#eaedf3]">
              <p className="text-[11px] font-bold text-[#6b7280] uppercase tracking-wider mb-2">Processed Files</p>
              <div className="flex items-end gap-1">
                {isDataLoading ? (
                  <div className="w-8 h-8 rounded-md bg-gray-200 animate-pulse" />
                ) : (
                  <span className="text-2xl font-black text-[#111827]">{processedFiles}</span>
                )}
                <span className="text-sm font-bold text-[#6b7280] mb-0.5"> / ∞</span>
              </div>
            </div>
          </div>
        </section>

        {/* Payment Method */}
        {isPro && (
          <section className="bg-white border border-[#eaedf3] rounded-2xl overflow-hidden shadow-sm">
            <div className="p-6 border-b border-[#eaedf3] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[#111827]">Payment Method</h3>
                <p className="text-[13px] text-[#6b7280] mt-1">Your primary card for subscription renewals.</p>
              </div>
              <button className="text-[12px] font-bold text-[#6366f1] hover:text-[#4f46e5] transition-colors">
                Update
              </button>
            </div>
            <div className="p-6 flex items-center gap-4">
              <div className="w-16 h-10 bg-[#f8fafc] border border-[#eaedf3] rounded-lg flex items-center justify-center">
                <svg className="w-8 h-8 text-[#111827]" viewBox="0 0 36 24" fill="none"><path d="M12.662 16.5H9.684l1.884-11.517h2.977L12.66 16.5zm11.758-11.233c-.563-.263-1.442-.516-2.585-.516-2.905 0-4.948 1.487-4.966 3.618-.022 1.574 1.488 2.455 2.62 2.975 1.156.536 1.545.88 1.545 1.36-.02.738-.925 1.077-1.782 1.077-1.196 0-1.84-.187-2.825-.602l-.4-.182-.42 2.508c.698.31 1.954.58 3.267.59 3.09 0 5.09-1.464 5.116-3.73.023-1.258-.755-2.203-2.53-3.018-1.04-.51-1.678-.853-1.678-1.37.02-.68.802-1.01 1.7-1.01.996 0 1.636.216 2.164.44l.26.115.485-2.25zM27.275 5h-2.31c-.714 0-1.26.208-1.587.954l-4.5 10.54h3.125c.068-.184.5-1.34.5-1.34h3.816c.09.406.438 1.34.438 1.34h2.748L27.275 5zm-3.155 7.73l1.58-4.148h.034l.435 4.145h-2.05zM8.32 5.006l-3.03 7.8-1.066-5.464C4.04 6.55 3.128 5.412 2 4.982h6.315v.025h-.002z" fill="currentColor"/></svg>
              </div>
              <div>
                <p className="text-[13px] font-bold text-[#111827]">Visa ending in 4242</p>
                <p className="text-[11px] text-[#6b7280]">Expires 12/28</p>
              </div>
            </div>
          </section>
        )}

        {/* Invoice History */}
        <section className="bg-white border border-[#eaedf3] rounded-2xl overflow-hidden shadow-sm">
          <div className="p-6 border-b border-[#eaedf3]">
            <h3 className="text-sm font-bold text-[#111827]">Billing History</h3>
            <p className="text-[13px] text-[#6b7280] mt-1">View and download your past invoices.</p>
          </div>
          {isPro ? (
            <div className="divide-y divide-[#eaedf3]">
              {[1, 2, 3].map((i) => (
                <div key={i} className="p-4 sm:p-6 flex items-center justify-between group">
                  <div className="flex items-center gap-4">
                    <div className="hidden sm:flex w-10 h-10 rounded-xl bg-[#f8fafc] text-[#9ca3af] items-center justify-center">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                    </div>
                    <div>
                      <p className="text-[13px] font-bold text-[#111827]">Invoice #VEL-00{i}</p>
                      <p className="text-[11px] text-[#6b7280]">Oct {15 - i}, 2026</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-[13px] font-bold text-[#111827]">$12.00</span>
                    <button 
                      onClick={() => handleAction(`dl-${i}`)}
                      className="w-8 h-8 rounded-lg bg-[#f8fafc] text-[#64748b] hover:bg-[#6366f1] hover:text-white transition-all flex items-center justify-center shadow-sm"
                    >
                      {loading === `dl-${i}` ? (
                        <div className="w-3.5 h-3.5 border-2 border-currentColor border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-12 text-center flex flex-col items-center">
              <div className="w-16 h-16 rounded-full bg-[#f8fafc] flex items-center justify-center text-[#94a3b8] mb-4">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z"/></svg>
              </div>
              <p className="text-[13px] font-bold text-[#111827]">No Billing History</p>
              <p className="text-[12px] text-[#6b7280] mt-1 max-w-xs">You are currently on the free tier, so there are no invoices to display.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
