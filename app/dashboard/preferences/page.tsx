'use client'

import { useState } from 'react';
import Tabs from '@/components/dashboard/Tabs';
import ProfileTab from '@/components/dashboard/ProfileTab';
import Link from 'next/link';

export default function PreferencesPage() {
  const [activeTab, setActiveTab] = useState('profile');

  const tabs = [
    { id: 'profile', label: 'Profile', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/></svg> },
    { id: 'security', label: 'Security', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>, disabled: false },
    { id: 'preferences', label: 'Preferences', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"/></svg>, disabled: false },
    { id: 'billing', label: 'Billing', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/></svg>, disabled: false },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'profile':
        return <ProfileTab />;
      default:
        return (
          <div className="flex flex-col items-center justify-center h-full py-20 text-center animate-in fade-in zoom-in-95 duration-500">
            <div className="w-20 h-20 rounded-full bg-indigo-50 flex items-center justify-center text-[#6366f1] mb-4">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/></svg>
            </div>
            <h3 className="text-base font-bold text-[#111827]">Coming Soon</h3>
            <p className="text-sm text-[#6b7280] mt-2 max-w-xs">We&apos;re working hard to bring you the {activeTab} settings. Stay tuned!</p>
          </div>
        );
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#fbfcfd]">
      <header className="px-8 py-6 border-b border-[#eaedf3] bg-white">
        <h1 className="text-2xl font-bold text-[#111827]">Preferences</h1>
        <p className="text-sm text-[#6b7280] mt-1">Manage your account preferences and security.</p>
      </header>

      <div className="flex flex-1 min-h-0">
        <aside className="w-80 border-r border-[#eaedf3] bg-[#f8fafc]/50 p-6 flex flex-col justify-between">
          <div>
             <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
          </div>

          {/* Upgrade Card */}
          <div className="bg-[#6366f1] rounded-2xl p-5 text-white shadow-xl shadow-[#6366f1]/20 group relative overflow-hidden">
            <div className="absolute -right-4 -top-4 w-24 h-24 bg-white/10 rounded-full blur-2xl group-hover:bg-white/20 transition-all duration-500" />
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-black uppercase tracking-widest opacity-80">Free Plan</span>
                <svg className="w-5 h-5 text-white opacity-80" fill="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14H11V21L20 10H13Z"/></svg>
              </div>
              <p className="text-[13px] font-medium leading-relaxed opacity-90 mb-4">You are currently using the free tier. Upgrade to unlock premium features.</p>
              <Link 
                href="/pricing"
                className="w-full h-10 bg-white text-[#6366f1] text-[13px] font-bold rounded-xl flex items-center justify-center hover:bg-white/90 transition-all shadow-sm"
              >
                Upgrade to Pro →
              </Link>
            </div>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto p-8 bg-white">
          <div className="max-w-3xl">
            {renderContent()}
          </div>
        </main>
      </div>
    </div>
  );
}
