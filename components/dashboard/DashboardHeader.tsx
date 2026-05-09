"use client";

import React, { useState } from 'react';
import { useDashboard } from '@/app/dashboard/layout';
import NotificationDropdown from '@/components/dashboard/NotificationDropdown';

interface DashboardHeaderProps {
  title: React.ReactNode;
  subtitle: string;
  searchValue?: string;
  onSearchChange?: (val: string) => void;
  searchPlaceholder?: string;
}

export default function DashboardHeader({ 
  title, 
  subtitle, 
  searchValue = '', 
  onSearchChange,
  searchPlaceholder = 'Search...'
}: DashboardHeaderProps) {
  const { unreadCount } = useDashboard();
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);

  return (
    <div className="px-6 py-5 bg-white border-b border-[#eaedf3] flex justify-between items-center shrink-0">
      <div className="flex items-center gap-4 min-w-0">
        <div className="flex flex-col">
          {typeof title === 'string' ? (
            <h1 className="text-xl font-bold text-[#111827] tracking-tight">{title}</h1>
          ) : (
            title
          )}
          {subtitle && <p className="text-[11px] text-[#6b7280] font-medium">{subtitle}</p>}
        </div>
      </div>
      
      <div className="flex items-center gap-3">
        <div className="relative w-64">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9ca3af]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>
          <input 
            type="text" 
            value={searchValue} 
            onChange={e => onSearchChange?.(e.target.value)}
            placeholder={searchPlaceholder} 
            className="w-full h-10 pl-9 pr-3 text-xs bg-[#f8fafc] border border-[#eaedf3] rounded-xl focus:outline-none focus:ring-1 focus:ring-[#6366f1] focus:border-[#6366f1] text-[#374151] placeholder-[#9ca3af] transition-all"
          />
        </div>

        {/* Notification bell */}
        <div className="relative">
          <button 
            onClick={(e) => { e.stopPropagation(); setIsNotificationsOpen(!isNotificationsOpen); }}
            className={`relative w-10 h-10 flex items-center justify-center rounded-xl border transition-all ${isNotificationsOpen ? 'bg-[#f0f9ff] border-[#6366f1] text-[#6366f1]' : 'bg-[#f8fafc] border-[#eaedf3] text-[#6b7280] hover:bg-[#f3f4f6]'}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>
            </svg>
            {unreadCount > 0 && (
              <span className="absolute top-2 right-2 w-2 h-2 bg-[#ef4444] rounded-full border border-white animate-pulse shadow-[0_0_0_2px_rgba(239,68,68,0.2)]"/>
            )}
          </button>
          <NotificationDropdown isOpen={isNotificationsOpen} onClose={() => setIsNotificationsOpen(false)} />
        </div>
      </div>
    </div>
  );
}
