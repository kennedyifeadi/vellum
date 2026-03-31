"use client";

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useDashboard } from '@/app/dashboard/layout';

interface FileActivity {
  _id: string;
  fileName: string;
  toolUsed: string;
  status: string;
  createdAt: string;
  outputUrl: string;
}

const PAGE_SIZE = 8;

const typeOptions = ['All Types', 'Merge PDF', 'Split PDF', 'Lock PDF', 'Image to PDF', 'HTML to PDF'];
const dateOptions = ['Last 7 days', 'Last 30 days', 'Last 90 days', 'All time'];

const toolTypeLabel: Record<string, string> = {
  'Merge PDF': 'PDF',
  'Split PDF': 'PDF',
  'Lock PDF': 'PDF',
  'Image to PDF': 'PDF',
  'HTML to PDF': 'PDF',
};

const toolColorMap: Record<string, { bg: string; color: string; icon: React.ReactNode }> = {
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

function getToolIcon(tool: string) {
  const config = toolColorMap[tool] ?? {
    bg: 'bg-[#f3f4f6]', color: 'text-[#6b7280]',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>,
  };
  return (
    <div className={`w-9 h-9 rounded-lg flex shrink-0 items-center justify-center ${config.bg} ${config.color}`}>
      {config.icon}
    </div>
  );
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function RecentFilesPage() {
  const { recentActivity, refreshData, openDrawer } = useDashboard();
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('Last 30 days');
  const [typeFilter, setTypeFilter] = useState('All Types');
  const [page, setPage] = useState(1);

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/conversions?id=${id}`, { method: 'DELETE' });
    if (res.ok) refreshData('activity');
  };

  const filtered = useMemo(() => {
    let result = [...recentActivity];

    // Date filter
    const now = Date.now();
    const days = dateFilter === 'Last 7 days' ? 7 : dateFilter === 'Last 30 days' ? 30 : dateFilter === 'Last 90 days' ? 90 : null;
    if (days) result = result.filter(f => now - new Date(f.createdAt).getTime() < days * 86400000);

    // Type filter
    if (typeFilter !== 'All Types') result = result.filter(f => f.toolUsed === typeFilter);

    // Search
    if (search.trim()) result = result.filter(f => f.fileName.toLowerCase().includes(search.toLowerCase()));

    return result;
  }, [recentActivity, dateFilter, typeFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1).slice(
    Math.max(0, currentPage - 2), Math.max(3, currentPage + 1)
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-[#eaedf3] flex items-center justify-between gap-4 flex-shrink-0">
        <h1 className="text-xl font-bold text-[#111827]">Recent Files</h1>
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9ca3af]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search files..."
              className="h-9 pl-9 pr-4 text-xs bg-[#f8fafc] border border-[#eaedf3] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#6366f1] w-52 text-[#374151]"
            />
          </div>
          {/* Notification bell placeholder */}
          <button className="relative w-9 h-9 flex items-center justify-center rounded-lg bg-[#f8fafc] border border-[#eaedf3] text-[#6b7280] hover:bg-[#f3f4f6]">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>
            </svg>
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#ef4444] rounded-full border border-white"></span>
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="px-6 py-3 border-b border-[#eaedf3] flex items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          {/* Date filter */}
          <div className="relative">
            <select
              value={dateFilter}
              onChange={e => { setDateFilter(e.target.value); setPage(1); }}
              className="h-8 pl-3 pr-7 text-xs bg-white border border-[#eaedf3] rounded-lg text-[#374151] focus:outline-none focus:ring-1 focus:ring-[#6366f1] appearance-none cursor-pointer"
            >
              {dateOptions.map(o => <option key={o}>{o}</option>)}
            </select>
            <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[#9ca3af] pointer-events-none" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/></svg>
          </div>
          {/* Type filter */}
          <div className="relative">
            <select
              value={typeFilter}
              onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
              className="h-8 pl-3 pr-7 text-xs bg-white border border-[#eaedf3] rounded-lg text-[#374151] focus:outline-none focus:ring-1 focus:ring-[#6366f1] appearance-none cursor-pointer"
            >
              {typeOptions.map(o => <option key={o}>{o}</option>)}
            </select>
            <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[#9ca3af] pointer-events-none" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/></svg>
          </div>
        </div>

        {/* Convert New */}
        <button
          onClick={() => openDrawer(null, null)}
          className="h-8 px-4 bg-[#6366f1] text-white text-xs font-semibold rounded-lg hover:bg-[#4f46e5] transition-colors flex items-center gap-1.5 shadow-sm shadow-[#6366f1]/20"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
          Convert New
        </button>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          /* ---------- EMPTY STATE ---------- */
          <div className="flex items-center justify-center h-full p-8">
            <div className="w-full max-sm border-2 border-dashed border-[#e5e7eb] rounded-2xl p-12 flex flex-col items-center text-center bg-[#fafafa]">
              <div className="w-16 h-16 rounded-full bg-[#ede9fe] flex items-center justify-center mb-5">
                <svg className="w-8 h-8 text-[#8b5cf6]" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/>
                </svg>
              </div>
              <h3 className="text-sm font-bold text-[#111827] mb-1">No recent files found</h3>
              <p className="text-xs text-[#6b7280] mb-6">Start by converting a file in the Tools Library.</p>
              <Link
                href="/dashboard/library"
                className="h-9 px-5 bg-[#6366f1] text-white text-xs font-semibold rounded-lg hover:bg-[#4f46e5] transition-colors flex items-center gap-2 shadow-sm shadow-[#6366f1]/20"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                Go to Tools Library
              </Link>
            </div>
          </div>
        ) : (
          /* ---------- TABLE ---------- */
          <div className="flex flex-col h-full">
            {/* Table Header */}
            <div className="grid grid-cols-[2fr_100px_140px_120px_100px] px-6 h-10 items-center text-[10px] font-semibold text-[#9ca3af] uppercase tracking-wider border-b border-[#f1f4f8] bg-white sticky top-0 z-10">
              <div>File Name</div>
              <div>Type</div>
              <div>Date</div>
              <div>Status</div>
              <div className="text-right">Actions</div>
            </div>

            {/* Rows */}
            <div className="flex-1">
              {paginated.map(row => (
                <div
                  key={row._id}
                  className="grid grid-cols-[2fr_100px_140px_120px_100px] px-6 h-[60px] items-center border-b border-[#f8fafc] hover:bg-[#fafbff] transition-colors"
                >
                  {/* File Name */}
                  <div className="flex items-center gap-3 min-w-0">
                    {getToolIcon(row.toolUsed)}
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-[#111827] truncate">{row.fileName}</p>
                    </div>
                  </div>

                  {/* Type */}
                  <div className="text-xs font-semibold text-[#6b7280]">
                    {row.fileName.endsWith('.zip') ? 'ZIP' : toolTypeLabel[row.toolUsed] ?? 'PDF'}
                  </div>

                  {/* Date */}
                  <div className="text-xs text-[#6b7280]">{formatDate(row.createdAt)}</div>

                  {/* Status */}
                  <div>
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold ${
                      row.status === 'Completed'
                        ? 'bg-[#dcfce7] text-[#166534]'
                        : row.status === 'Failed'
                        ? 'bg-[#fee2e2] text-[#991b1b]'
                        : 'bg-[#f1f5f9] text-[#64748b]'
                    }`}>
                      {row.status}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => window.location.href = row.outputUrl}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6b7280] hover:bg-[#eef2ff] hover:text-[#6366f1] transition-colors"
                      title="Download"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                    </button>
                    <button
                      onClick={() => handleDelete(row._id)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6b7280] hover:bg-[#fee2e2] hover:text-[#ef4444] transition-colors"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-4v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination Footer */}
            <div className="flex items-center justify-between px-6 h-12 border-t border-[#f1f4f8] bg-white flex-shrink-0">
              <span className="text-[11px] text-[#6b7280]">
                Showing {(currentPage - 1) * PAGE_SIZE + 1} to {Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} result{filtered.length !== 1 ? 's' : ''}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="w-7 h-7 rounded-lg border border-[#eaedf3] flex items-center justify-center text-[#6b7280] hover:bg-[#f3f4f6] disabled:opacity-40 disabled:cursor-not-allowed text-xs"
                >
                  ‹
                </button>
                {pageNumbers.map(n => (
                  <button
                    key={n}
                    onClick={() => setPage(n)}
                    className={`w-7 h-7 rounded-lg border text-xs font-medium transition-colors ${
                      n === currentPage
                        ? 'bg-[#6366f1] text-white border-[#6366f1]'
                        : 'border-[#eaedf3] text-[#374151] hover:bg-[#f3f4f6]'
                    }`}
                  >
                    {n}
                  </button>
                ))}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="w-7 h-7 rounded-lg border border-[#eaedf3] flex items-center justify-center text-[#6b7280] hover:bg-[#f3f4f6] disabled:opacity-40 disabled:cursor-not-allowed text-xs"
                >
                  ›
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
