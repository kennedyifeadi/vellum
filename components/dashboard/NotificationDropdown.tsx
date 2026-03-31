"use client";

import React, { useRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDashboard, AppNotification } from '@/app/dashboard/layout';
import Link from 'next/link';

interface NotificationDropdownProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function NotificationDropdown({ isOpen, onClose }: NotificationDropdownProps) {
  const { notifications, markAllAsRead, unreadCount } = useDashboard();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  const formatTimestamp = (isoString: string, currentTime: Date) => {
    const date = new Date(isoString);
    const diffMs = currentTime.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const getIcon = (type: AppNotification['type']) => {
    switch (type) {
      case 'success':
        return (
          <div className="w-8 h-8 rounded-full bg-emerald-100/50 flex items-center justify-center text-emerald-600 shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
          </div>
        );
      case 'warning':
        return (
          <div className="w-8 h-8 rounded-full bg-amber-100/50 flex items-center justify-center text-amber-600 shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
          </div>
        );
      case 'error':
        return (
          <div className="w-8 h-8 rounded-full bg-red-100/50 flex items-center justify-center text-red-600 shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </div>
        );
      default:
        return (
          <div className="w-8 h-8 rounded-full bg-indigo-100/50 flex items-center justify-center text-indigo-600 shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </div>
        );
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={dropdownRef}
          initial={{ opacity: 0, y: 10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.95 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="absolute top-12 right-0 w-80 bg-white/90 backdrop-blur-md border border-[#eaedf3] rounded-2xl shadow-2xl z-[110] overflow-hidden flex flex-col"
        >
          <div className="p-4 border-b border-[#eaedf3] flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#111827]">Notifications</h3>
            {unreadCount > 0 && (
              <button 
                onClick={markAllAsRead}
                className="text-[11px] font-semibold cursor-pointer text-[#6366f1] hover:text-[#4f46e5] transition-colors"
              >
                Mark all as read
              </button>
            )}
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-8 text-center">
                <div className="w-12 h-12 rounded-full bg-[#f8fafc] flex items-center justify-center text-[#9ca3af] mx-auto mb-3">
                   <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" /></svg>
                </div>
                <p className="text-xs font-medium text-[#6b7280]">No notifications yet</p>
                <p className="text-[10px] text-[#9ca3af] mt-1 text-center">We&apos;ll alert you when your files are ready or storage is low.</p>
              </div>
            ) : (
              <div className="divide-y divide-[#f1f4f8]">
                {notifications.map((n) => (
                  <Link 
                    key={n.id} 
                    href={n.link || '#'} 
                    onClick={() => { if(n.link) onClose(); }}
                    className={`p-4 flex gap-3 hover:bg-[#f8fafc] transition-colors group relative ${!n.isRead ? 'bg-[#f0f9ff]/50' : ''}`}
                  >
                    {!n.isRead && (
                      <div className="absolute left-1 top-1/2 -translate-y-1/2 w-1 h-8 bg-[#6366f1] rounded-full" />
                    )}
                    {getIcon(n.type)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <p className={`text-xs font-bold truncate ${n.isRead ? 'text-[#374151]' : 'text-[#111827]'}`}>{n.title}</p>
                        <span className="text-[9px] font-medium text-[#9ca3af] shrink-0">{formatTimestamp(n.timestamp, now)}</span>
                      </div>
                      <p className="text-[11px] text-[#6b7280] leading-relaxed line-clamp-2">{n.message}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="p-3 border-t border-[#eaedf3] bg-[#f8fafc]/50 text-center">
            <Link 
              href="/dashboard/recent" 
              onClick={onClose}
              className="text-[11px] font-bold text-[#6b7280] hover:text-[#111827] transition-colors flex items-center justify-center gap-1.5"
            >
              View all activity
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>
            </Link>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
