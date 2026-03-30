"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

interface FileActivity {
  _id: string;
  fileName: string;
  toolUsed: string;
  status: string;
  createdAt: string;
  outputUrl: string;
}

export default function ActivityTable() {
  const [files, setFiles] = useState<FileActivity[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchActivity = async () => {
    try {
      const res = await fetch('/api/conversions');
      if (res.ok) setFiles(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActivity();
    
    const handleUpdate = () => fetchActivity();
    window.addEventListener('activityUpdated', handleUpdate);
    return () => window.removeEventListener('activityUpdated', handleUpdate);
  }, []);

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/conversions?id=${id}`, { method: 'DELETE' });
      if (res.ok) setFiles(prev => prev.filter(f => f._id !== id));
    } catch {}
  };

  const getRelativeTime = (dateString: string) => {
    const elapsed = new Date(dateString).getTime() - Date.now();
    const days = Math.round(elapsed / (1000 * 60 * 60 * 24));
    const hours = Math.round(elapsed / (1000 * 60 * 60));
    const minutes = Math.round(elapsed / (1000 * 60));
    
    if (Math.abs(days) >= 1) return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(days, 'day');
    if (Math.abs(hours) >= 1) return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(hours, 'hour');
    if (Math.abs(minutes) >= 1) return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(minutes, 'minute');
    return 'Just now';
  };

  return (
    <div className="mt-8 flex-1 flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <p className="font-bold text-[15px] text-[#111827]">Recent Activity</p>
        <button className="text-[#9ca3af] hover:text-[#4b5563]">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z"/></svg>
        </button>
      </div>

      <div className="border border-[#eaedf3] rounded-xl overflow-hidden flex-1 flex flex-col min-h-[300px]">
        {loading ? (
          <div className="flex-1 flex text-xs font-semibold text-[#6b7280] justify-center items-center">
            <div className="w-5 h-5 border-2 border-[#6366f1] border-t-transparent rounded-full animate-spin mr-2"></div>
            Loading history...
          </div>
        ) : files.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-[#fbfcfd]">
            <div className="w-16 h-16 rounded-full bg-[#f3f4f6] flex items-center justify-center text-[#9ca3af] mb-4">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-[#111827] mb-1">No recent activity</h3>
            <p className="text-xs text-[#6b7280] max-w-sm mb-4">You haven&apos;t processed any files yet. Go to the tools library to start converting or merging documents.</p>
            <Link href="/dashboard/library" className="h-8 px-4 bg-[#6366f1] text-white text-xs font-medium rounded-lg shadow-sm shadow-[#6366f1]/20 hover:bg-[#4f46e5] flex items-center gap-1 transition-colors">
              Go to Tools Library
            </Link>
          </div>
        ) : (
          <>
            <div className="bg-[#f8fafc] h-9 px-4 flex items-center text-[10px] font-semibold text-[#6b7280] uppercase tracking-wider border-b border-[#eaedf3]">
              <div className="w-[38%]">File Name</div>
              <div className="w-[22%]">Conversion Type</div>
              <div className="w-[15%]">Status</div>
              <div className="w-[15%]">Date</div>
              <div className="w-[10%] text-right text-transparent select-none">Actions</div>
            </div>
            
            <div className="flex-1 overflow-y-auto">
              {files.map((row) => (
                <div key={row._id} className="h-14 px-4 flex items-center border-b border-[#f1f4f8] last:border-0 hover:bg-[#fbfcfd] transition-colors text-xs">
                  <div className="w-[38%] pr-4 font-medium flex items-center gap-3 text-[#111827]">
                    <div className={`w-8 h-8 rounded-lg flex shrink-0 items-center justify-center text-[13px] ${row.fileName.includes('.pdf') ? 'bg-[#fef2f2] text-[#ef4444]' : row.fileName.includes('.zip') ? 'bg-[#f5f3ff] text-[#8b5cf6]' : 'bg-[#f0fdfa] text-[#14b8a6]'}`}>
                      {row.fileName.includes('.pdf') ? '📄' : row.fileName.includes('.zip') ? '🗂️' : '🖼️'}
                    </div>
                    <span className="truncate">{row.fileName}</span>
                  </div>
                  <div className="w-[22%] text-[#6b7280] text-[11px] truncate pr-4">{row.toolUsed}</div>
                  <div className="w-[15%]">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      row.status === 'Completed' ? 'bg-[#dcfce7] text-[#166534]' : 'bg-[#f1f5f9] text-[#475569]'
                    }`}>
                      {row.status}
                    </span>
                  </div>
                  <div className="w-[15%] text-[#9ca3af] text-[11px] font-medium capitalize pr-2">{getRelativeTime(row.createdAt)}</div>
                  <div className="w-[10%] flex justify-end gap-3 text-[#111827] font-semibold items-center">
                    <button onClick={() => window.location.href = row.outputUrl} className="text-[#6366f1] hover:text-[#4f46e5] transition-colors">
                      Download
                    </button>
                    <button onClick={() => handleDelete(row._id)} className="p-1.5 text-[#9ca3af] hover:bg-[#fee2e2] hover:text-[#ef4444] rounded-md transition-colors" title="Delete">
                      <svg className="w-[15px] h-[15px]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-4v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="bg-[#f8fafc] h-10 px-4 flex justify-between items-center border-t border-[#eaedf3] text-[11px] text-[#6b7280]">
              <span>Showing {Math.min(3, files.length)} of {files.length} recent files</span>
              <div className="flex gap-2">
                 <button className="w-5 h-5 flex items-center justify-center hover:bg-[#eaedf3] rounded">&lt;</button>
                 <button className="w-5 h-5 flex items-center justify-center hover:bg-[#eaedf3] rounded">&gt;</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
