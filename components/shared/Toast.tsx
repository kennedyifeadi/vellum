"use client";

import { useCallback, useState } from 'react';
import type { ToastType } from './ToolHost';

export interface ToastMessage {
  message: string;
  type: ToastType;
}

export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);
  return { toast, showToast };
}

export function Toast({ toast }: { toast: ToastMessage | null }) {
  if (!toast) return null;
  return (
    <div role="status" className={`fixed bottom-8 right-8 px-5 py-3.5 rounded-2xl shadow-xl flex items-center gap-3 text-[13px] font-semibold z-100 border backdrop-blur-sm transition-all animate-in fade-in slide-in-from-bottom-5 ${
      toast.type === 'error' ? 'bg-red-50/90 text-red-600 border-red-100 shadow-red-200/20' :
      toast.type === 'success' ? 'bg-emerald-50/90 text-emerald-600 border-emerald-100 shadow-emerald-200/20' :
      'bg-indigo-50/90 text-indigo-600 border-indigo-100 shadow-indigo-200/20'
    }`}>
      <div className={`w-2 h-2 rounded-full animate-pulse ${
        toast.type === 'error' ? 'bg-red-400' :
        toast.type === 'success' ? 'bg-emerald-400' :
        'bg-indigo-400'
      }`} />
      <span>{toast.message}</span>
    </div>
  );
}
