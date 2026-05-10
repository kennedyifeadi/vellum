"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useDashboard } from '@/app/dashboard/layout';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import ToolIcon from '@/components/shared/ToolIcon';
import { ALL_TOOLS } from '@/lib/tools';

export default function RecentFilesPage() {
  const { recentActivity, refreshData, unreadCount, openDrawer } = useDashboard();
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('Last 30 days');
  const [typeFilter, setTypeFilter] = useState('All Types');
  const [page, setPage] = useState(1);
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
    if (typeFilter !== 'All Types') {
      result = result.filter(f => {
        const tool = ALL_TOOLS.find(t => t.title === f.toolUsed);
        return tool?.categories?.includes(typeFilter);
      });
    }

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

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#fbfcfd]">
      <DashboardHeader 
        title="Recent Files" 
        subtitle="History of your processed documents"
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search history..."
      />

      <div className="p-6 flex flex-col flex-1 min-h-0 bg-white">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex items-center gap-2">
            {['All Tools', 'PDF', 'Images', 'Documents', 'Security'].map((type) => {
              const isActive = type === 'All Tools' ? typeFilter === 'All Types' : typeFilter === type;
              return (
                <button
                  key={type}
                  onClick={() => { setTypeFilter(type === 'All Tools' ? 'All Types' : type); setPage(1); }}
                  className={`h-8 px-4 rounded-full text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-[#6366f1] text-white'
                      : 'bg-white text-[#4b5563] border border-[#eaedf3] hover:bg-[#f3f4f6]'
                  }`}
                >
                  {type}
                </button>
              );
            })}
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
                    <ToolIcon toolName={file.toolUsed} />
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
