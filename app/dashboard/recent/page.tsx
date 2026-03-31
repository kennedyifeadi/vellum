"use client";

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useDashboard } from '@/app/dashboard/layout';
import NotificationDropdown from '@/components/dashboard/NotificationDropdown';

export default function RecentFilesPage() {
  const { recentActivity, refreshData, unreadCount, openDrawer } = useDashboard();
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('Last 30 days');
  const [typeFilter, setTypeFilter] = useState('All Types');
  const [page, setPage] = useState(1);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/conversions?id=${id}`, { method: 'DELETE' });
    if (res.ok) refreshData('activity');
  };

  const filteredActivity = useMemo(() => {
    let result = [...recentActivity];

    // Date filter
    const nowMs = new Date().getTime();
    const days = dateFilter === 'Last 7 days' ? 7 : dateFilter === 'Last 30 days' ? 30 : dateFilter === 'Last 90 days' ? 90 : null;
    if (days) result = result.filter(f => nowMs - new Date(f.createdAt).getTime() < days * 86400000);

    // Type filter
    if (typeFilter !== 'All Types') result = result.filter(f => f.toolUsed === typeFilter);

    // Search filter
    if (search) {
      result = result.filter(f => f.fileName.toLowerCase().includes(search.toLowerCase()));
    }

    return result;
  }, [recentActivity, dateFilter, typeFilter, search]);

  const itemsPerPage = 8;
  const totalPages = Math.ceil(filteredActivity.length / itemsPerPage);
  const paginatedActivity = filteredActivity.slice((page - 1) * itemsPerPage, page * itemsPerPage);

  const getRelativeTime = (dateString: string, currentTime: Date) => {
    const past = new Date(dateString);
    const diffMs = currentTime.getTime() - past.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays} days ago`;
  };

  const getToolIcon = (tool: string) => {
    const toolMap: Record<string, { bg: string; color: string; icon: React.ReactNode }> = {
      'Merge PDF': {
        bg: 'bg-[#dbeafe]', color: 'text-[#2563eb]',
        icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
      },
      'Split PDF': {
        bg: 'bg-[#fce7f3]', color: 'text-[#db2777]',
        icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
      },
      'Lock PDF': {
        bg: 'bg-[#d1fae5]', color: 'text-[#059669]',
        icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
      },
      'Image to PDF': {
        bg: 'bg-[#ffedd5]', color: 'text-[#ea580c]',
        icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
      },
      'HTML to PDF': {
        bg: 'bg-[#f3e8ff]', color: 'text-[#9333ea]',
        icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>
      },
    };

    const config = toolMap[tool] ?? {
      bg: 'bg-[#f3f4f6]', color: 'text-[#6b7280]',
      icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
    };

    return (
      <div className={`w-8 h-8 rounded-lg flex shrink-0 items-center justify-center ${config.bg} ${config.color}`}>
        {config.icon}
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#fbfcfd]">
      <div className="flex justify-between items-center p-6 bg-white border-b border-[#eaedf3]">
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex flex-col">
            <h1 className="text-xl font-bold text-[#111827] tracking-tight">Recent Files</h1>
            <p className="text-[11px] text-[#6b7280] font-medium">History of your processed documents</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9ca3af]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            <input 
              type="text" 
              value={search} 
              onChange={e => setSearch(e.target.value)}
              placeholder="Search history..." 
              className="h-9 pl-9 pr-4 text-xs bg-[#f8fafc] border border-[#eaedf3] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#6366f1] w-52 text-[#374151]"
            />
          </div>
          {/* Notification bell */}
          <div className="relative">
            <button 
              onClick={(e) => { e.stopPropagation(); setIsNotificationsOpen(!isNotificationsOpen); }}
              className={`relative w-9 h-9 flex items-center justify-center rounded-lg border transition-all ${isNotificationsOpen ? 'bg-[#f0f9ff] border-[#6366f1] text-[#6366f1]' : 'bg-[#f8fafc] border-[#eaedf3] text-[#6b7280] hover:bg-[#f3f4f6]'}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#ef4444] rounded-full border border-white animate-pulse shadow-[0_0_0_2px_rgba(239,68,68,0.2)]"/>
              )}
            </button>
            <NotificationDropdown isOpen={isNotificationsOpen} onClose={() => setIsNotificationsOpen(false)} />
          </div>
        </div>
      </div>

      <div className="p-6 flex flex-col flex-1 min-h-0 bg-white">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex items-center gap-2 bg-[#f8fafc] p-1 rounded-lg border border-[#eaedf3]">
            {['All Types', 'Merge PDF', 'Split PDF', 'Image to PDF', 'Lock PDF'].map((type) => (
              <button
                key={type}
                onClick={() => { setTypeFilter(type); setPage(1); }}
                className={`px-3 py-1.5 text-[11px] font-semibold rounded-md transition-all ${
                  typeFilter === type ? 'bg-white text-[#6366f1] shadow-sm' : 'text-[#6b7280] hover:text-[#374151]'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
          
          <select 
            value={dateFilter}
            onChange={e => { setDateFilter(e.target.value); setPage(1); }}
            className="h-8.5 px-3 text-[11px] font-semibold bg-white border border-[#eaedf3] rounded-lg focus:outline-none text-[#374151] cursor-pointer"
          >
            <option>Last 7 days</option>
            <option>Last 30 days</option>
            <option>Last 90 days</option>
            <option>All time</option>
          </select>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col border border-[#eaedf3] rounded-xl">
          <div className="bg-[#f8fafc] h-10 px-6 flex items-center text-[10px] font-bold text-[#6b7280] uppercase tracking-wider border-b border-[#eaedf3]">
            <div className="w-[40%]">File Name</div>
            <div className="w-[20%]">Type</div>
            <div className="w-[15%]">Status</div>
            <div className="w-[15%]">Date</div>
            <div className="w-[10%] text-right">Actions</div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {paginatedActivity.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center p-12 text-center">
                <div className="w-16 h-16 rounded-full bg-[#f3f4f6] flex items-center justify-center text-[#9ca3af] mb-4">
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                </div>
                <h3 className="text-sm font-semibold text-[#111827] mb-1">No activity found</h3>
                <p className="text-xs text-[#6b7280] max-w-sm">No files match your current search and filters.</p>
              </div>
            ) : (
              paginatedActivity.map((file) => (
                <div key={file._id} className="h-16 px-6 flex items-center border-b border-[#f1f4f8] last:border-0 hover:bg-[#fbfcfd] transition-colors group">
                  <div className="w-[40%] pr-4 font-bold flex items-center gap-3 text-[#111827] text-xs">
                    {getToolIcon(file.toolUsed)}
                    <span className="truncate group-hover:text-[#6366f1] transition-colors">{file.fileName}</span>
                  </div>
                  <div className="w-[20%] text-[#6b7280] text-[11px] font-medium truncate pr-4">{file.toolUsed}</div>
                  <div className="w-[15%]">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      file.status === 'Completed' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-[#f1f5f9] text-[#475569]'
                    }`}>
                      {file.status}
                    </span>
                  </div>
                  <div className="w-[15%] text-[#9ca3af] text-[11px] font-semibold">{getRelativeTime(file.createdAt, now)}</div>
                  <div className="w-[10%] flex justify-end gap-3 items-center">
                    <button 
                      onClick={() => window.location.href = file.outputUrl}
                      className="p-2 text-[#6b7280] hover:text-[#6366f1] hover:bg-white rounded-lg border border-transparent hover:border-[#eaedf3] transition-all shadow-none hover:shadow-sm" 
                      title="Download"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                    </button>
                    <button 
                      onClick={() => handleDelete(file._id)}
                      className="p-2 text-[#9ca3af] hover:text-red-500 hover:bg-red-50 rounded-lg border border-transparent hover:border-red-100 transition-all" 
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-4v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="bg-[#f8fafc] h-12 px-6 flex justify-between items-center border-t border-[#eaedf3] text-xs font-medium text-[#6b7280]">
            <span>Showing {paginatedActivity.length} of {filteredActivity.length} results</span>
            <div className="flex gap-1.5">
              <button 
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 rounded-lg border border-[#eaedf3] bg-white hover:bg-[#f8fafc] disabled:opacity-50 transition-all font-bold"
              >
                Previous
              </button>
              <div className="flex gap-1 items-center px-2">
                {[...Array(totalPages)].map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setPage(i + 1)}
                    className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${
                      page === i + 1 ? 'bg-[#6366f1] text-white shadow-md shadow-[#6366f1]/20' : 'text-[#6b7280] hover:bg-[#f0f9ff] hover:text-[#6366f1]'
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
              <button 
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages || totalPages === 0}
                className="px-3 py-1.5 rounded-lg border border-[#eaedf3] bg-white hover:bg-[#f8fafc] disabled:opacity-50 transition-all font-bold"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
