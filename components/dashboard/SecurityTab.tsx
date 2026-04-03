"use client";

import React, { useState, useEffect } from 'react';
import { useDashboard } from '@/app/dashboard/layout';
import { useRouter } from 'next/navigation';

interface SessionInfo {
  id: string;
  device: string;
  location: string;
  lastActive: string;
}

export default function SecurityTab() {
  const { user, showToast } = useDashboard();
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);

  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const res = await fetch('/api/user/sessions');
        if (res.ok) {
          const data = await res.json();
          setSessions(data);
        }
      } catch (err) {
        console.error('Error fetching sessions:', err);
      }
    };
    fetchSessions();
  }, []);

  const handleAction = async (actionId: string, message: string) => {
    setLoading(actionId);

    try {
      if (actionId === 'export') {
        const res = await fetch('/api/user/export', { method: 'POST' });
        if (res.ok) {
          const blob = await res.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'vellum-export.zip';
          document.body.appendChild(a);
          a.click();
          a.remove();
          window.URL.revokeObjectURL(url);
          showToast(message, 'success');
        } else {
          showToast('Failed to export data', 'error');
        }
      } else if (actionId === 'delete') {
        const res = await fetch('/api/user/delete', { method: 'DELETE' });
        if (res.ok) {
          showToast(message, 'success');
          router.push('/login');
        } else {
          showToast('Failed to delete account', 'error');
        }
      } else if (actionId === 'logoutAll') {
        const res = await fetch('/api/user/sessions', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ all: true })
        });
        if (res.ok) {
          showToast(message, 'success');
          router.push('/login');
        }
      }
    } catch (err) {
      console.error(err);
      showToast('An error occurred during action', 'error');
    } finally {
      if (actionId !== 'delete' && actionId !== 'logoutAll') {
        setLoading(null);
      }
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    try {
      const res = await fetch('/api/user/sessions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
      if (res.ok) {
        setSessions(prev => prev.filter(s => s.id !== sessionId));
        showToast('Session revoked', 'success');
      }
    } catch {
      showToast('Failed to revoke session', 'error');
    }
  };

  return (
    <div className="flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-8">
        <h2 className="text-xl font-bold text-[#111827] dark:text-white">Security Settings</h2>
        <p className="text-[13px] text-[#6b7280] dark:text-gray-400 mt-1">Manage your authentication methods and account data.</p>
      </div>

      <div className="space-y-8">
        {/* Authentication Method */}
        <section className="bg-white dark:bg-[#1e293b] border border-[#eaedf3] dark:border-gray-700 rounded-2xl overflow-hidden shadow-sm">
          <div className="p-6 border-b border-[#eaedf3] dark:border-gray-700">
            <h3 className="text-sm font-bold text-[#111827] dark:text-white">Authentication Method</h3>
            <p className="text-[13px] text-[#6b7280] dark:text-gray-400 mt-1 line-clamp-2">
              Vellum uses passwordless authentication. You sign in using secure, one-time passcodes sent to your registered email.
            </p>
          </div>
          <div className="p-6 bg-[#f8fafc] dark:bg-[#0f172a] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#e0e7ff] text-[#4f46e5] flex items-center justify-center">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
              </div>
              <div>
                <p className="text-[13px] font-bold text-[#111827] dark:text-white">Email OTP</p>
                <p className="text-[11px] text-[#6b7280] dark:text-gray-400">Secured via {user?.email || 'your email'}</p>
              </div>
            </div>
            <div className="px-3 py-1 bg-[#dcfce7] text-[#166534] text-[11px] font-bold rounded-full border border-[#bbf7d0]">
              Active
            </div>
          </div>
        </section>

        {/* Active Sessions */}
        <section className="bg-white dark:bg-[#1e293b] border border-[#eaedf3] dark:border-gray-700 rounded-2xl overflow-hidden shadow-sm">
          <div className="p-6 border-b border-[#eaedf3] dark:border-gray-700 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-[#111827] dark:text-white">Active Sessions</h3>
              <p className="text-[13px] text-[#6b7280] dark:text-gray-400 mt-1">Devices currently logged into your account.</p>
            </div>
            <button 
              onClick={() => handleAction('logoutAll', 'Logged out of all sessions.')}
              disabled={loading === 'logoutAll'}
              className="text-[12px] font-bold text-[#ef4444] hover:text-[#b91c1c] transition-colors"
            >
              {loading === 'logoutAll' ? 'Processing...' : 'Logout all devices'}
            </button>
          </div>
          <div className="divide-y divide-[#eaedf3] dark:divide-gray-700">
            {sessions.length === 0 ? (
              <div className="p-6 text-center">
                 <p className="text-sm text-gray-500">Only this current session is active.</p>
              </div>
            ) : (
              sessions.map(session => (
                <div key={session.id} className="p-6 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-[#f1f5f9] dark:bg-gray-800 text-[#64748b] dark:text-gray-400 flex items-center justify-center">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
                    </div>
                    <div>
                      <p className="text-[13px] font-bold text-[#111827] dark:text-white">{session.device || 'Unknown Device'}</p>
                      <p className="text-[11px] text-[#6b7280] dark:text-gray-400">{session.location || 'Unknown Location'} • {new Date(session.lastActive).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleRevokeSession(session.id)}
                    className="w-8 h-8 rounded-lg text-[#94a3b8] hover:bg-[#f1f5f9] dark:hover:bg-gray-800 hover:text-[#ef4444] transition-colors flex items-center justify-center"
                    title="Revoke session"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Data & Privacy */}
        <section className="bg-white dark:bg-[#1e293b] border border-[#eaedf3] dark:border-gray-700 rounded-2xl overflow-hidden shadow-sm">
          <div className="p-6 border-b border-[#eaedf3] dark:border-gray-700">
            <h3 className="text-sm font-bold text-[#111827] dark:text-white">Data Strategy & Deletion</h3>
            <p className="text-[13px] text-[#6b7280] dark:text-gray-400 mt-1">Control your data or permanently remove your account.</p>
          </div>
          <div className="p-6 space-y-4">
            <button 
              onClick={() => handleAction('export', 'Data exported successfully!')}
              disabled={loading === 'export'}
              className="w-full sm:w-auto h-10 px-5 bg-white dark:bg-gray-800 border border-[#eaedf3] dark:border-gray-700 text-[#111827] dark:text-white text-[13px] font-bold rounded-xl hover:bg-[#f8fafc] dark:hover:bg-gray-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              {loading === 'export' ? (
                <div className="w-4 h-4 border-2 border-currentColor border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
              )}
              Download Data Export (ZIP)
            </button>
            
            <div className="pt-4 border-t border-[#eaedf3] dark:border-gray-700">
              <p className="text-[12px] text-[#6b7280] dark:text-gray-400 mb-3">
                Deleting your account will immediately remove all your data, files, and preferences. This action cannot be undone.
              </p>
              <button 
                onClick={() => {
                   if(window.confirm('Are you absolutely sure you want to delete your account? This is irreversible.')) {
                      handleAction('delete', 'Account deactivated.');
                   }
                }}
                disabled={loading === 'delete'}
                className="w-full sm:w-auto h-10 px-5 bg-[#fef2f2] border border-[#fecaca] text-[#ef4444] text-[13px] font-bold rounded-xl hover:bg-[#fee2e2] disabled:opacity-50 transition-all"
              >
                Delete Account
              </button>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
