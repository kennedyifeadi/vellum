"use client";

import React, { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useDashboard } from '@/app/dashboard/layout';

// ── Types ──
interface StagedDoc {
  _id: string;
  fileName: string;
  diskFileName: string;
  fileSize: number;
  mimeType: string;
  createdAt: string;
  expiresAt: string;
}

interface StorageInfo {
  usedBytes: number;
  limitBytes: number;
  plan: string;
}

interface StarredTool {
  id: string;
  name: string;
}

const ALL_TOOL_NAMES: Record<string, string> = {
  'merge-pdf': 'Merge PDF', 'split-pdf': 'Split PDF', 'lock-pdf': 'Lock PDF',
  'find-pdf': 'Find in PDF', 'image-to-pdf': 'Image to PDF', 'jpg-to-png': 'JPEG to PNG',
  'docx-to-pdf': 'DOCX to PDF', 'html-to-pdf': 'HTML to PDF',
};

// Smart tool suggestions by file extension
const TOOL_MAP: Record<string, { primary: string; all: string[] }> = {
  pdf:  { primary: 'merge-pdf',   all: ['merge-pdf', 'split-pdf', 'lock-pdf', 'find-pdf'] },
  jpg:  { primary: 'image-to-pdf',  all: ['image-to-pdf', 'jpg-to-png'] },
  jpeg: { primary: 'image-to-pdf',  all: ['image-to-pdf', 'jpg-to-png'] },
  png:  { primary: 'image-to-pdf',  all: ['image-to-pdf'] },
  webp: { primary: 'image-to-pdf',  all: ['image-to-pdf'] },
  docx: { primary: 'docx-to-pdf', all: ['docx-to-pdf'] },
  doc:  { primary: 'docx-to-pdf', all: ['docx-to-pdf'] },
  html: { primary: 'html-to-pdf', all: ['html-to-pdf'] },
  htm:  { primary: 'html-to-pdf', all: ['html-to-pdf'] },
};

// ── Helpers ──
function fmtBytes(b: number) {
  if (b === 0) return '0 Bytes';
  const k = 1024, i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + ['Bytes', 'KB', 'MB', 'GB'][i];
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getExpiryLabel(expiresAt: string): { label: string; urgency: 'normal' | 'warn' | 'critical' } {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return { label: 'Expired', urgency: 'critical' };
  const hours = ms / (1000 * 60 * 60);
  const days = Math.floor(hours / 24);
  const remHours = Math.floor(hours % 24);
  if (hours < 2) return { label: `${Math.floor(hours * 60)}m left`, urgency: 'critical' };
  if (hours < 24) return { label: `${Math.floor(hours)}h left`, urgency: 'warn' };
  return { label: `${days}d ${remHours}h left`, urgency: 'normal' };
}

function fileExt(name: string): string {
  return (name.split('.').pop() ?? '').toLowerCase();
}

function fileIconColors(name: string) {
  const ext = fileExt(name);
  if (ext === 'pdf') return { bg: 'bg-[#fef2f2]', color: 'text-[#ef4444]' };
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return { bg: 'bg-[#fff7ed]', color: 'text-[#f97316]' };
  if (['doc', 'docx'].includes(ext)) return { bg: 'bg-[#eff6ff]', color: 'text-[#3b82f6]' };
  if (['html', 'htm'].includes(ext)) return { bg: 'bg-[#f3e8ff]', color: 'text-[#9333ea]' };
  return { bg: 'bg-[#f8fafc]', color: 'text-[#64748b]' };
}

// ── Component ──
export default function DocumentsPage() {
  const { documents, storage, refreshData, openDrawer, showToast } = useDashboard();

  const [uploading, setUploading] = useState(false);

  const [starredTools, setStarredTools] = useState<StarredTool[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const ids: string[] = JSON.parse(localStorage.getItem('starredTools') || '[]');
      return ids.map(id => ({ id, name: ALL_TOOL_NAMES[id] ?? id }));
    } catch { return []; }
  });

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'size'>('date');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showStarredPanel, setShowStarredPanel] = useState(false);
  const [convertMenuId, setConvertMenuId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onStar = (e: Event) => {
      const ids = (e as CustomEvent<string[]>).detail;
      setStarredTools(ids.map(id => ({ id, name: ALL_TOOL_NAMES[id] ?? id })));
    };
    window.addEventListener('starredToolsUpdated', onStar);
    return () => {
      window.removeEventListener('starredToolsUpdated', onStar);
    };
  }, []);

  // ── Upload ──
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    setUploading(true);
    const formData = new FormData();
    Array.from(e.target.files).forEach(f => formData.append('files', f));
    try {
      const res = await fetch('/api/documents/upload', { method: 'POST', body: formData });
      if (res.ok) {
        showToast('Files uploaded successfully!', 'success');
        refreshData();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error ?? 'Upload failed.', 'error');
      }
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  // ── Delete ──
  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/documents?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      refreshData();
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const handleDeleteSelected = async () => {
    await Promise.all(Array.from(selected).map(id => fetch(`/api/documents?id=${id}`, { method: 'DELETE' })));
    refreshData();
    setSelected(new Set());
    showToast('Selected files deleted.', 'success');
  };

  // ── Quick convert ──
  const handleQuickConvert = async (doc: StagedDoc) => {
    const ext = fileExt(doc.fileName);
    const toolId = TOOL_MAP[ext]?.primary ?? 'merge-pdf';
    
    try {
      const res = await fetch(`/api/documents/download/${doc._id}`);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const file = new File([blob], doc.fileName, { type: doc.mimeType });
      
      openDrawer(file, toolId);
      showToast(`Opening ${ALL_TOOL_NAMES[toolId] ?? toolId} for "${doc.fileName}"`, 'info');
    } catch (_error) {
      showToast('Failed to load file for conversion.', 'error');
    }
  };

  const handleConvertWithTool = async (doc: StagedDoc, toolId: string) => {
    setConvertMenuId(null);
    try {
      const res = await fetch(`/api/documents/download/${doc._id}`);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const file = new File([blob], doc.fileName, { type: doc.mimeType });
      
      openDrawer(file, toolId);
      showToast(`Opening ${ALL_TOOL_NAMES[toolId] ?? toolId} for "${doc.fileName}"`, 'info');
    } catch (_error) {
      showToast('Failed to load file for conversion.', 'error');
    }
  };

  // ── Sort/filter ──
  const displayed = documents
    .filter((d: any) => d.fileName.toLowerCase().includes(search.toLowerCase()))
    .sort((a: any, b: any) => {
      if (sortBy === 'name') return a.fileName.localeCompare(b.fileName);
      if (sortBy === 'size') return b.fileSize - a.fileSize;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const toggleSelect = (id: string) => {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const totalDocsBytes = documents.reduce((s: number, d: any) => s + d.fileSize, 0);
  const totalUsedBytes = (storage?.usedBytes ?? 0) + totalDocsBytes;
  const limitBytes = storage?.limitBytes ?? 50 * 1024 * 1024;
  const storagePercent = Math.min(100, (totalUsedBytes / limitBytes) * 100);
  const storageColor = storagePercent > 85 ? 'bg-[#ef4444]' : storagePercent > 60 ? 'bg-[#f97316]' : 'bg-[#6366f1]';

  const urgencyClass = { normal: 'bg-[#f3f4f6] text-[#6b7280]', warn: 'bg-[#fef3c7] text-[#d97706]', critical: 'bg-[#fee2e2] text-[#dc2626]' };

  return (
    <div className="flex flex-col h-full overflow-hidden" onClick={() => { setShowStarredPanel(false); setConvertMenuId(null); }}>
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-[#eaedf3] flex items-center justify-between gap-4 shrink-0">
        <h1 className="text-xl font-bold text-[#111827]">My Documents</h1>
        <div className="flex items-center gap-3">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9ca3af]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search files..." className="h-9 pl-9 pr-4 text-xs bg-[#f8fafc] border border-[#eaedf3] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#6366f1] w-52 text-[#374151]"/>
          </div>
          <button className="relative w-9 h-9 flex items-center justify-center rounded-lg bg-[#f8fafc] border border-[#eaedf3] text-[#6b7280] hover:bg-[#f3f4f6]">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#ef4444] rounded-full border border-white"/>
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5 pb-24">

        {/* Storage + Upload */}
        <div className="flex items-start gap-4">
          <div className="flex-1 bg-white border border-[#eaedf3] rounded-2xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.02)]">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-semibold text-[#374151]">Storage Usage</span>
              <span className="text-[11px] font-bold text-[#6366f1]">{Math.round(storagePercent)}%</span>
            </div>
            <div className="h-2 bg-[#f3f4f6] rounded-full overflow-hidden mb-2">
              <div className={`h-full rounded-full transition-all duration-500 ${storageColor}`} style={{ width: `${storagePercent}%` }}/>
            </div>
            <p className="text-[11px] text-[#6b7280]">
              {fmtBytes(totalUsedBytes)} of {fmtBytes(limitBytes)} used{' '}
              <span className="ml-1 px-1.5 py-0.5 bg-[#eef2ff] text-[#6366f1] text-[10px] font-semibold rounded-full">{storage?.plan ?? 'Free'}</span>
            </p>
          </div>
          <input type="file" ref={fileInputRef} className="hidden" onChange={handleUpload} multiple/>
          <button
            onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
            disabled={uploading}
            className="h-[72px] px-6 bg-[#6366f1] text-white text-xs font-semibold rounded-2xl hover:bg-[#4f46e5] disabled:opacity-60 transition-colors flex flex-col items-center justify-center gap-1.5 shadow-sm shadow-[#6366f1]/20 min-w-[130px]"
          >
            {uploading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"/> : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>
            )}
            {uploading ? 'Uploading...' : 'Upload New'}
          </button>
        </div>

        {/* Quick Access */}
        <div>
          <p className="text-[10px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-3">Quick Access</p>
          <div className="grid grid-cols-3 gap-3">
            <Link href="/dashboard/recent" className="bg-white border border-[#eaedf3] rounded-xl p-4 flex items-center gap-3 hover:border-[#c7d2fe] hover:bg-[#fafbff] transition-all group">
              <div className="w-10 h-10 rounded-xl bg-[#fff7ed] text-[#f97316] flex items-center justify-center shrink-0">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              </div>
              <div>
                <p className="text-xs font-bold text-[#111827] group-hover:text-[#4f46e5] transition-colors">Recent Conversions</p>
                <p className="text-[10px] text-[#9ca3af] mt-0.5">View converted files</p>
              </div>
            </Link>

            {/* Starred Tools dropdown */}
            <div className="relative" onClick={e => e.stopPropagation()}>
              <button
                onClick={() => setShowStarredPanel(p => !p)}
                className={`w-full bg-white border rounded-xl p-4 flex items-center gap-3 transition-all group text-left ${showStarredPanel ? 'border-[#fbbf24] bg-[#fffbeb]' : 'border-[#eaedf3] hover:border-[#fde68a] hover:bg-[#fffbeb]'}`}
              >
                <div className="w-10 h-10 rounded-xl bg-[#fffbeb] text-[#f59e0b] flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.364 1.118l1.518 4.674c.3.921-.755 1.688-1.54 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.784.57-1.838-.197-1.539-1.118l1.518-4.674a1 1 0 00-.364-1.118L2.493 10.1c-.783-.57-.381-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/></svg>
                </div>
                <div className="flex-1">
                  <p className="text-xs font-bold text-[#111827] group-hover:text-[#d97706] transition-colors">Starred Tools</p>
                  <p className="text-[10px] text-[#9ca3af] mt-0.5">{starredTools.length} tool{starredTools.length !== 1 ? 's' : ''} starred</p>
                </div>
                <svg className={`w-4 h-4 text-[#9ca3af] transition-transform ${showStarredPanel ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/></svg>
              </button>
              {showStarredPanel && (
                <div className="absolute top-full left-0 right-0 mt-1 z-20 bg-white border border-[#eaedf3] rounded-xl shadow-lg overflow-hidden">
                  {starredTools.length === 0 ? (
                    <div className="p-4 text-center">
                      <p className="text-xs text-[#6b7280] mb-2">No starred tools yet.</p>
                      <Link href="/dashboard/library" className="text-xs text-[#6366f1] font-semibold hover:underline">Go to Tools Library →</Link>
                    </div>
                  ) : (
                    <div className="max-h-52 overflow-y-auto divide-y divide-[#f3f4f6]">
                      {starredTools.map(tool => (
                        <button key={tool.id} onClick={() => { setShowStarredPanel(false); openDrawer(null, tool.id); }} className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-[#fafbff] transition-colors text-left">
                          <svg className="w-3.5 h-3.5 text-[#fbbf24] shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.364 1.118l1.518 4.674c.3.921-.755 1.688-1.54 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.784.57-1.838-.197-1.539-1.118l1.518-4.674a1 1 0 00-.364-1.118L2.493 10.1c-.783-.57-.381-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/></svg>
                          <span className="text-xs font-medium text-[#111827]">{tool.name}</span>
                          <svg className="w-3.5 h-3.5 text-[#9ca3af] ml-auto shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Team Shared placeholder */}
            <div className="bg-white border border-dashed border-[#eaedf3] rounded-xl p-4 flex items-center gap-3 opacity-50 cursor-not-allowed">
              <div className="w-10 h-10 rounded-xl bg-[#eff6ff] text-[#3b82f6] flex items-center justify-center shrink-0">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              </div>
              <div>
                <p className="text-xs font-bold text-[#111827]">Team Shared</p>
                <p className="text-[10px] text-[#9ca3af] mt-0.5">Coming soon</p>
              </div>
            </div>
          </div>
        </div>

        {/* All Files */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-semibold text-[#9ca3af] uppercase tracking-wider">
              Staged Files ({displayed.length}){' '}
              <span className="normal-case font-normal text-[#9ca3af]">· auto-deleted after {storage?.plan === 'Pro' ? '5' : '3'} days</span>
            </p>
            <div className="flex items-center gap-2">
              <div className="relative">
                <select value={sortBy} onChange={e => setSortBy(e.target.value as 'date' | 'name' | 'size')} className="h-7 pl-2 pr-6 text-[11px] bg-white border border-[#eaedf3] rounded-lg text-[#374151] appearance-none focus:outline-none cursor-pointer">
                  <option value="date">Date Modified</option>
                  <option value="name">Name</option>
                  <option value="size">Size</option>
                </select>
                <svg className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[#9ca3af] pointer-events-none" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/></svg>
              </div>
              <div className="flex items-center gap-0.5 bg-[#f8fafc] border border-[#eaedf3] rounded-lg p-0.5">
                <button onClick={() => setViewMode('grid')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-white shadow-sm text-[#4f46e5]' : 'text-[#9ca3af]'}`}>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6z M14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6z M4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2z M14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/></svg>
                </button>
                <button onClick={() => setViewMode('list')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-white shadow-sm text-[#4f46e5]' : 'text-[#9ca3af]'}`}>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
                </button>
              </div>
            </div>
          </div>

          {displayed.length === 0 ? (
            /* Empty state */
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-[#e5e7eb] rounded-2xl p-12 flex flex-col items-center text-center bg-[#fafafa] cursor-pointer hover:border-[#c7d2fe] hover:bg-[#fafbff] transition-all group"
            >
              <div className="w-16 h-16 rounded-full bg-[#ede9fe] flex items-center justify-center mb-4 group-hover:bg-[#ddd6fe] transition-colors">
                <svg className="w-8 h-8 text-[#8b5cf6]" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>
              </div>
              <h3 className="text-sm font-bold text-[#111827] mb-1">Upload files to convert</h3>
              <p className="text-xs text-[#6b7280]">Files are stored temporarily and auto-deleted after {storage?.plan === 'Pro' ? '5' : '3'} days.</p>
            </div>
          ) : viewMode === 'grid' ? (
            /* Grid */
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {displayed.map(doc => {
                const { bg, color } = fileIconColors(doc.fileName);
                const ext = fileExt(doc.fileName).toUpperCase();
                const isSelected = selected.has(doc._id);
                const expiry = getExpiryLabel(doc.expiresAt);
                const tools = TOOL_MAP[fileExt(doc.fileName)]?.all ?? [];
                return (
                  <div key={doc._id} onClick={() => toggleSelect(doc._id)} className={`relative bg-white border rounded-xl p-3 flex flex-col gap-2 cursor-pointer transition-all hover:shadow-md group ${isSelected ? 'border-[#6366f1] ring-2 ring-[#6366f1]/20' : 'border-[#eaedf3] hover:border-[#c7d2fe]'}`}>
                    {/* Checkbox */}
                    <div className={`absolute top-2 left-2 w-4 h-4 rounded border flex items-center justify-center z-10 transition-all ${isSelected ? 'bg-[#6366f1] border-[#6366f1]' : 'border-[#d1d5db] bg-white opacity-0 group-hover:opacity-100'}`}>
                      {isSelected && <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>}
                    </div>
                    {/* File icon */}
                    <div className={`w-full aspect-square flex items-center justify-center rounded-lg ${bg}`}>
                      <span className={`text-2xl font-black ${color}`}>{ext}</span>
                    </div>
                    {/* Expiry badge */}
                    <span className={`absolute top-2 right-2 text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${urgencyClass[expiry.urgency]}`}>{expiry.label}</span>
                    {/* Info */}
                    <div>
                      <p className="text-[11px] font-semibold text-[#111827] truncate">{doc.fileName}</p>
                      <div className="flex justify-between items-center mt-0.5">
                        <span className="text-[10px] text-[#9ca3af]">{fmtBytes(doc.fileSize)}</span>
                        <span className="text-[10px] text-[#9ca3af]">{fmtDate(doc.createdAt)}</span>
                      </div>
                    </div>
                    {/* Action buttons */}
                    <div className="flex gap-1 mt-auto" onClick={e => e.stopPropagation()}>
                      {/* Quick convert */}
                      <button
                        onClick={() => handleQuickConvert(doc)}
                        title="Quick Convert"
                        className="flex-1 h-7 flex items-center justify-center gap-1 bg-[#6366f1] text-white text-[10px] font-semibold rounded-lg hover:bg-[#4f46e5] transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                        Convert
                      </button>
                      {/* More tools */}
                      {tools.length > 1 && (
                        <div className="relative">
                          <button
                            onClick={() => setConvertMenuId(id => id === doc._id ? null : doc._id)}
                            className="h-7 w-7 flex items-center justify-center rounded-lg border border-[#eaedf3] text-[#6b7280] hover:bg-[#f3f4f6] transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/></svg>
                          </button>
                          {convertMenuId === doc._id && (
                            <div className="absolute bottom-full right-0 mb-1 z-30 bg-white border border-[#eaedf3] rounded-xl shadow-lg w-36 overflow-hidden">
                              {tools.map(tid => (
                                <button key={tid} onClick={() => handleConvertWithTool(doc, tid)} className="w-full px-3 py-2 text-[11px] text-left text-[#374151] hover:bg-[#f3f4f6] transition-colors">
                                  {ALL_TOOL_NAMES[tid]}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {/* Delete */}
                      <button onClick={() => handleDelete(doc._id)} className="h-7 w-7 flex items-center justify-center rounded-lg text-[#9ca3af] hover:bg-[#fee2e2] hover:text-[#ef4444] transition-colors">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-4v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* List */
            <div className="bg-white border border-[#eaedf3] rounded-xl overflow-hidden">
              <div className="grid grid-cols-[auto_1fr_80px_100px_110px_130px] px-4 h-9 items-center text-[10px] font-semibold text-[#9ca3af] uppercase tracking-wider border-b border-[#f1f4f8] bg-[#f8fafc]">
                <div className="w-5 mr-3"/>
                <div>File Name</div><div>Type</div><div>Size</div><div>Expires</div><div className="text-right">Actions</div>
              </div>
              {displayed.map(doc => {
                const { bg, color } = fileIconColors(doc.fileName);
                const ext = fileExt(doc.fileName);
                const isSelected = selected.has(doc._id);
                const expiry = getExpiryLabel(doc.expiresAt);
                const tools = TOOL_MAP[ext]?.all ?? [];
                return (
                  <div key={doc._id} onClick={() => toggleSelect(doc._id)} className={`grid grid-cols-[auto_1fr_80px_100px_110px_130px] px-4 h-14 items-center border-b border-[#f8fafc] last:border-0 cursor-pointer transition-colors hover:bg-[#fafbff] ${isSelected ? 'bg-[#eef2ff]' : ''}`}>
                    <div className={`w-4 h-4 rounded border mr-3 flex items-center justify-center shrink-0 ${isSelected ? 'bg-[#6366f1] border-[#6366f1]' : 'border-[#d1d5db]'}`}>
                      {isSelected && <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>}
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-7 h-7 rounded-lg shrink-0 flex items-center justify-center text-[9px] font-black ${bg} ${color}`}>{ext.toUpperCase()}</div>
                      <span className="text-xs font-medium text-[#111827] truncate">{doc.fileName}</span>
                    </div>
                    <div className="text-xs font-semibold text-[#6b7280]">{ext.toUpperCase()}</div>
                    <div className="text-xs text-[#6b7280]">{fmtBytes(doc.fileSize)}</div>
                    <div><span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${urgencyClass[expiry.urgency]}`}>{expiry.label}</span></div>
                    <div className="flex justify-end items-center gap-1" onClick={e => e.stopPropagation()}>
                      <button onClick={() => handleQuickConvert(doc)} className="h-7 px-2 flex items-center gap-1 bg-[#6366f1] text-white text-[10px] font-semibold rounded-lg hover:bg-[#4f46e5] transition-colors">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                        Convert
                      </button>
                      {tools.length > 1 && (
                        <div className="relative">
                          <button onClick={() => setConvertMenuId(id => id === doc._id ? null : doc._id)} className="h-7 w-7 flex items-center justify-center rounded-lg border border-[#eaedf3] text-[#6b7280] hover:bg-[#f3f4f6] transition-colors">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/></svg>
                          </button>
                          {convertMenuId === doc._id && (
                            <div className="absolute bottom-full right-0 mb-1 z-30 bg-white border border-[#eaedf3] rounded-xl shadow-lg w-36 overflow-hidden">
                              {tools.map(tid => (
                                <button key={tid} onClick={() => handleConvertWithTool(doc, tid)} className="w-full px-3 py-2 text-[11px] text-left text-[#374151] hover:bg-[#f3f4f6] transition-colors">{ALL_TOOL_NAMES[tid]}</button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <button onClick={() => handleDelete(doc._id)} className="h-7 w-7 flex items-center justify-center rounded-lg text-[#9ca3af] hover:bg-[#fee2e2] hover:text-[#ef4444] transition-colors">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-4v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Multi-select action bar */}
      {selected.size > 0 && (
        <div className="absolute bottom-4 left-4 right-4 pointer-events-none flex justify-center">
          <div className="bg-[#6366f1] text-white rounded-2xl px-5 py-3 flex items-center gap-5 shadow-lg shadow-[#6366f1]/30 pointer-events-auto">
            <span className="text-xs font-bold">{selected.size} item{selected.size !== 1 ? 's' : ''} selected</span>
            <div className="w-px h-4 bg-white/30"/>
            <button onClick={handleDeleteSelected} className="flex flex-col items-center gap-0.5 hover:opacity-80 transition-opacity">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-4v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              <span className="text-[9px] font-medium">Delete All</span>
            </button>
            <button onClick={() => setSelected(new Set())} className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors ml-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
