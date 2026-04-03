"use client";

import React, { useState, useEffect } from 'react';
import { useDashboard } from '@/app/dashboard/layout';
import { useTheme } from 'next-themes';

export default function PreferencesTab() {
  const { showToast } = useDashboard();
  const { theme, setTheme } = useTheme();
  
  const [notifications, setNotifications] = useState({
    email: true,
    marketing: false,
    updates: true
  });
  const [autoDelete, setAutoDelete] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isDataLoaded, setIsDataLoaded] = useState(false);

  // Fetch initial preferences
  useEffect(() => {
    const fetchPrefs = async () => {
      try {
        const res = await fetch('/api/user/preferences');
        if (res.ok) {
          const data = await res.json();
          // Update local state without jarring flickerset
          if (data.theme) setTheme(data.theme);
          if (data.notifications) setNotifications(data.notifications);
          if (typeof data.autoDelete !== 'undefined') setAutoDelete(data.autoDelete);
        }
      } catch (err) {
        console.error('Failed to load preferences', err);
      } finally {
        setIsDataLoaded(true);
      }
    };
    fetchPrefs();
  }, [setTheme]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const payload = {
        theme,
        autoDelete,
        notifications
      };

      const res = await fetch('/api/user/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        showToast('Preferences updated successfully', 'success');
      } else {
        showToast('Failed to update preferences', 'error');
      }
    } catch {
      showToast('An error occurred while saving', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!isDataLoaded) {
    return <div className="animate-pulse flex space-x-4 p-4"><div className="h-4 bg-gray-200 rounded w-1/4"></div></div>;
  }

  return (
    <div className="flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-8">
        <h2 className="text-xl font-bold text-[#111827] dark:text-white">App Preferences</h2>
        <p className="text-[13px] text-[#6b7280] dark:text-gray-400 mt-1">Customize your Vellum experience and workflow.</p>
      </div>

      <form onSubmit={handleSave} className="space-y-8">
        
        {/* Appearance */}
        <section className="bg-white dark:bg-[#1e293b] border border-[#eaedf3] dark:border-gray-700 rounded-2xl overflow-hidden shadow-sm">
          <div className="p-6 border-b border-[#eaedf3] dark:border-gray-700">
            <h3 className="text-sm font-bold text-[#111827] dark:text-white">Appearance</h3>
            <p className="text-[13px] text-[#6b7280] dark:text-gray-400 mt-1">Select your preferred color theme.</p>
          </div>
          <div className="p-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <button
              type="button"
              onClick={() => setTheme('light')}
              className={`p-4 rounded-xl border-2 flex flex-col items-center gap-3 transition-all ${
                theme === 'light' ? 'border-[#6366f1] bg-[#f8fafc] dark:bg-gray-800' : 'border-[#eaedf3] dark:border-gray-700 hover:border-[#cbd5e1]'
              }`}
            >
              <div className="w-12 h-12 rounded-full bg-[#f1f5f9] flex items-center justify-center text-[#64748b]">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
              </div>
              <span className="text-[13px] font-bold text-[#111827] dark:text-white">Light Mode</span>
            </button>
            <button
              type="button"
              onClick={() => setTheme('dark')}
              className={`p-4 rounded-xl border-2 flex flex-col items-center gap-3 transition-all ${
                theme === 'dark' ? 'border-[#6366f1] bg-[#f8fafc] dark:bg-gray-800' : 'border-[#eaedf3] dark:border-gray-700 hover:border-[#cbd5e1]'
              }`}
            >
              <div className="w-12 h-12 rounded-full bg-[#1e293b] flex items-center justify-center text-[#94a3b8]">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>
              </div>
              <span className="text-[13px] font-bold text-[#111827] dark:text-white">Dark Mode</span>
            </button>
            <button
              type="button"
              onClick={() => setTheme('system')}
              className={`p-4 rounded-xl border-2 flex flex-col items-center gap-3 transition-all ${
                theme === 'system' ? 'border-[#6366f1] bg-[#f8fafc] dark:bg-gray-800' : 'border-[#eaedf3] dark:border-gray-700 hover:border-[#cbd5e1]'
              }`}
            >
              <div className="w-12 h-12 rounded-full bg-linear-to-br from-[#f1f5f9] to-[#1e293b] flex items-center justify-center text-white border border-[#cbd5e1] dark:border-gray-600">
                <svg className="w-6 h-6 drop-shadow-md" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              </div>
              <span className="text-[13px] font-bold text-[#111827] dark:text-white">System</span>
            </button>
          </div>
        </section>

        {/* Workflow & Processing */}
        <section className="bg-white dark:bg-[#1e293b] border border-[#eaedf3] dark:border-gray-700 rounded-2xl overflow-hidden shadow-sm">
          <div className="p-6 border-b border-[#eaedf3] dark:border-gray-700">
            <h3 className="text-sm font-bold text-[#111827] dark:text-white">File Processing</h3>
            <p className="text-[13px] text-[#6b7280] dark:text-gray-400 mt-1">Control how Vellum handles your converted files.</p>
          </div>
          <div className="p-6">
            <label className="flex items-start gap-3 cursor-pointer">
              <div className="relative flex items-center justify-center mt-1">
                <input 
                  type="checkbox" 
                  checked={autoDelete}
                  onChange={(e) => setAutoDelete(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-10 h-6 bg-[#cbd5e1] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#6366f1]"></div>
              </div>
              <div>
                <p className="text-[13px] font-bold text-[#111827] dark:text-white">Auto-delete processed files</p>
                <p className="text-[12px] text-[#6b7280] dark:text-gray-400 mt-0.5">
                  Immediately delete original files from Vellum servers after successful compression or conversion (bypasses the standard 3-day retention policy).
                </p>
              </div>
            </label>
          </div>
        </section>

        {/* Notifications */}
        <section className="bg-white dark:bg-[#1e293b] border border-[#eaedf3] dark:border-gray-700 rounded-2xl overflow-hidden shadow-sm">
          <div className="p-6 border-b border-[#eaedf3] dark:border-gray-700">
            <h3 className="text-sm font-bold text-[#111827] dark:text-white">Notifications</h3>
            <p className="text-[13px] text-[#6b7280] dark:text-gray-400 mt-1">Decide what alerts we send to your inbox.</p>
          </div>
          <div className="divide-y divide-[#eaedf3] dark:divide-gray-700">
            <label className="p-6 flex items-center justify-between cursor-pointer group">
              <div>
                <p className="text-[13px] font-bold text-[#111827] dark:text-white">Usage Alerts</p>
                <p className="text-[12px] text-[#6b7280] dark:text-gray-400">Get notified when you approach your file size or quota limits.</p>
              </div>
              <input 
                type="checkbox" 
                checked={notifications.email}
                onChange={(e) => setNotifications({...notifications, email: e.target.checked})}
                className="w-5 h-5 text-[#6366f1] bg-[#f8fafc] border-[#cbd5e1] rounded focus:ring-[#6366f1]"
              />
            </label>
            <label className="p-6 flex items-center justify-between cursor-pointer group">
              <div>
                <p className="text-[13px] font-bold text-[#111827] dark:text-white">Product Updates</p>
                <p className="text-[12px] text-[#6b7280] dark:text-gray-400">Receive news about new tools, features, and platform improvements.</p>
              </div>
              <input 
                type="checkbox" 
                checked={notifications.updates}
                onChange={(e) => setNotifications({...notifications, updates: e.target.checked})}
                className="w-5 h-5 text-[#6366f1] bg-[#f8fafc] border-[#cbd5e1] rounded focus:ring-[#6366f1]"
              />
            </label>
            <label className="p-6 flex items-center justify-between cursor-pointer group">
              <div>
                <p className="text-[13px] font-bold text-[#111827] dark:text-white">Marketing & Tips</p>
                <p className="text-[12px] text-[#6b7280] dark:text-gray-400">Occasional emails sharing advanced tips to get the most out of Vellum.</p>
              </div>
              <input 
                type="checkbox" 
                checked={notifications.marketing}
                onChange={(e) => setNotifications({...notifications, marketing: e.target.checked})}
                className="w-5 h-5 text-[#6366f1] bg-[#f8fafc] border-[#cbd5e1] rounded focus:ring-[#6366f1]"
              />
            </label>
          </div>
        </section>

        <div className="flex justify-end pt-4">
          <button 
            type="submit"
            disabled={loading}
            className="h-11 px-8 bg-[#6366f1] text-white text-[13px] font-bold rounded-xl hover:bg-[#4f46e5] disabled:opacity-50 transition-all flex items-center gap-2 shadow-lg shadow-[#6366f1]/20"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : null}
            Save Preferences
          </button>
        </div>

      </form>
    </div>
  );
}
