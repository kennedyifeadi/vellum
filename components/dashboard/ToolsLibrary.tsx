"use client";

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useDashboard } from '@/app/dashboard/layout';
import NotificationDropdown from './NotificationDropdown';
import { ALL_TOOLS, Tool } from '@/lib/tools';

export default function ToolsLibrary() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All Tools');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());
  const { openDrawer, unreadCount, user } = useDashboard();
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);

  // Load starred tools from DB when user is available
  useEffect(() => {
    if (!user?._id) return;
    fetch('/api/user/starred')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.starredTools) setStarredIds(new Set(data.starredTools));
      })
      .catch(console.error);
  }, [user?._id]);

  const toggleStar = async (e: React.MouseEvent, toolId: string) => {
    e.stopPropagation();
    // Optimistic update
    setStarredIds(prev => {
      const next = new Set(prev);
      if (next.has(toolId)) next.delete(toolId); else next.add(toolId);
      // Dispatch so QuickTools / Documents page update immediately on same tab
      window.dispatchEvent(new CustomEvent('starredToolsUpdated', { detail: Array.from(next) }));
      return next;
    });
    // Persist to DB
    try {
      const res = await fetch('/api/user/starred', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolId }),
      });
      if (res.ok) {
        const data = await res.json();
        const updated = new Set<string>(data.starredTools);
        setStarredIds(updated);
        window.dispatchEvent(new CustomEvent('starredToolsUpdated', { detail: data.starredTools }));
      }
    } catch (err) {
      console.error('Failed to toggle star:', err);
    }
  };

  const handleToolClick = (id: string) => {
    openDrawer(null, id);
  };

  // Categories list
  const categories = ['All Tools', 'PDF', 'Images', 'Documents', 'Security'];

  // Filter logic
  const filteredTools = ALL_TOOLS.filter(tool => {
    const matchesSearch = tool.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         tool.desc.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = activeCategory === 'All Tools' || (tool.categories && tool.categories.includes(activeCategory));
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="flex flex-col h-full bg-[#f8fafc] p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#111827]">Tools Library</h1>
          <p className="text-xs text-[#6b7280]">Manage, convert, and edit your files with ease.</p>
        </div>
        
        {/* Search Bar */}
        <div className="relative w-64">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9ca3af]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search for a tool..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-10 pl-9 pr-3 rounded-xl border border-[#eaedf3] bg-white text-xs text-[#1f2937] placeholder-[#9ca3af] focus:outline-none focus:ring-1 focus:ring-[#6366f1] focus:border-[#6366f1]"
          />
        </div>

        {/* Notification bell */}
        <div className="relative ml-2">
          <button 
            onClick={(e) => { e.stopPropagation(); setIsNotificationsOpen(!isNotificationsOpen); }}
            className={`relative w-10 h-10 flex items-center justify-center rounded-xl border transition-all ${isNotificationsOpen ? 'bg-[#f0f9ff] border-[#6366f1] text-[#6366f1]' : 'bg-white border-[#eaedf3] text-[#6b7280] hover:bg-[#f3f4f6]'}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>
            {unreadCount > 0 && (
              <span className="absolute top-2 right-2 w-2 h-2 bg-[#ef4444] rounded-full border border-white animate-pulse" />
            )}
          </button>
          <NotificationDropdown isOpen={isNotificationsOpen} onClose={() => setIsNotificationsOpen(false)} />
        </div>
      </div>

      {/* Tabs / Filters */}
      <div className="flex items-center gap-2 mb-6 border-b border-[#eaedf3] pb-4">
        {categories.map((category) => (
          <button
            key={category}
            onClick={() => setActiveCategory(category)}
            className={`h-8 px-4 rounded-full text-xs font-medium transition-all ${
              activeCategory === category
                ? 'bg-[#6366f1] text-white'
                : 'bg-white text-[#4b5563] border border-[#eaedf3] hover:bg-[#f3f4f6]'
            }`}
          >
            {category}
          </button>
        ))}
      </div>

      {/* Available Tools Header with View Toggle */}
      <div className="flex justify-between items-center mb-4">
        <p className="font-bold text-xs text-[#9ca3af] uppercase tracking-wider">Available Tools</p>
        <div className="flex items-center gap-1">
          <button 
            onClick={() => setViewMode('grid')}
            className={`p-1.5 rounded-lg ${viewMode === 'grid' ? 'bg-[#eef2ff] text-[#4f46e5]' : 'text-[#6b7280] hover:bg-[#f3f4f6]'}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6z M14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6z M4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2z M14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          </button>
          <button 
            onClick={() => setViewMode('list')}
            className={`p-1.5 rounded-lg ${viewMode === 'list' ? 'bg-[#eef2ff] text-[#4f46e5]' : 'text-[#6b7280] hover:bg-[#f3f4f6]'}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Tools Grid / List */}
      <div className={`grid ${viewMode === 'grid' ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4' : 'grid-cols-1'} gap-4 overflow-y-auto pr-2`}>
        {filteredTools.map((tool) => (
          <motion.button
            key={tool.id}
            onClick={() => handleToolClick(tool.id)}
            whileHover={{ y: -4, boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}
            className={`bg-white border border-[#eaedf3] rounded-2xl p-5 flex ${
              viewMode === 'grid' ? 'flex-col items-start' : 'items-center gap-4'
            } gap-4 hover:border-[#6366f1]/30 text-left transition-all cursor-pointer shadow-[0_1px_4px_rgba(0,0,0,0.01)] relative group`}
          >
            {/* Star Icon */}
            <div
              onClick={(e) => toggleStar(e, tool.id)}
              className={`absolute top-4 right-4 cursor-pointer transition-colors z-10 ${
                starredIds.has(tool.id) ? 'text-[#fbbf24]' : 'text-[#d1d5db] hover:text-[#fbbf24] opacity-0 group-hover:opacity-100'
              }`}
            >
              <svg className="w-4 h-4" fill={starredIds.has(tool.id) ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.364 1.118l1.518 4.674c.3.921-.755 1.688-1.54 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.784.57-1.838-.197-1.539-1.118l1.518-4.674a1 1 0 00-.364-1.118L2.493 10.1c-.783-.57-.381-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            </div>

            <div className={`w-10 h-10 ${tool.bgColor} ${tool.iconColor} rounded-xl flex items-center justify-center text-lg`}>
              {tool.icon}
            </div>
            <div>
              <p className="text-sm font-bold text-[#111827]">{tool.title}</p>
              <p className="text-xs text-[#6b7280] mt-1 leading-normal">{tool.desc}</p>
            </div>
          </motion.button>
        ))}
      </div>

      {/* No Results State */}
      {filteredTools.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12">
          <p className="text-sm font-medium text-[#4b5563]">No tools found</p>
          <p className="text-xs text-[#6b7280] mt-1">Try searching for something else or change filters.</p>
        </div>
      )}
    </div>
  );
}
