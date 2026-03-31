"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/dashboard/Sidebar";

// Types for Notifications
export interface AppNotification {
  id: string;
  type: 'success' | 'warning' | 'error' | 'info';
  title: string;
  message: string;
  timestamp: string;
  isRead: boolean;
  link?: string;
}

// Create context to share user data and drawer state easily across sub-pages
const DashboardContext = createContext<{
  user: any;
  documents: any[];
  recentActivity: any[];
  storage: { usedBytes: number; limitBytes: number; plan: string } | null;
  refreshData: (type?: 'all' | 'documents' | 'activity' | 'storage') => Promise<void>;
  openDrawer: (file: File | null, toolId: string | null) => void;
  closeDrawer: () => void;
  showToast: (message: string, type: 'success' | 'error' | 'info') => void;
  notifications: AppNotification[];
  addNotification: (n: Omit<AppNotification, 'id' | 'timestamp' | 'isRead'>) => void;
  markAllAsRead: () => void;
  unreadCount: number;
}>({
  user: null,
  documents: [],
  recentActivity: [],
  storage: null,
  refreshData: async () => {},
  openDrawer: () => {},
  closeDrawer: () => {},
  showToast: () => {},
  notifications: [],
  addNotification: () => {},
  markAllAsRead: () => {},
  unreadCount: 0,
});

export const useDashboard = () => useContext(DashboardContext);

import SideDrawer from "@/components/dashboard/SideDrawer";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [storage, setStorage] = useState<any>(null);
  const router = useRouter();

  // Notification State
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  
  // Drawer & Toast States
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [activeToolId, setActiveToolId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const addNotification = (n: Omit<AppNotification, 'id' | 'timestamp' | 'isRead'>) => {
    const newNote: AppNotification = {
      ...n,
      id: Math.random().toString(36).substring(7),
      timestamp: new Date().toISOString(),
      isRead: false,
    };
    setNotifications(prev => {
      const updated = [newNote, ...prev].slice(0, 50); // Keep last 50
      localStorage.setItem('vellum_notifications', JSON.stringify(updated));
      return updated;
    });
  };

  const markAllAsRead = () => {
    setNotifications(prev => {
      const updated = prev.map(n => ({ ...n, isRead: true }));
      localStorage.setItem('vellum_notifications', JSON.stringify(updated));
      return updated;
    });
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  const refreshData = async (type: 'all' | 'documents' | 'activity' | 'storage' = 'all') => {
    try {
      const promises = [];
      if (type === 'all' || type === 'documents') promises.push(fetch('/api/documents').then(r => r.ok ? r.json() : []));
      if (type === 'all' || type === 'activity') promises.push(fetch('/api/conversions').then(r => r.ok ? r.json() : []));
      if (type === 'all' || type === 'storage') promises.push(fetch('/api/storage').then(r => r.ok ? r.json() : null));

      const results = await Promise.all(promises);
      
      let idx = 0;
      if (type === 'all' || type === 'documents') setDocuments(results[idx++]);
      if (type === 'all' || type === 'activity') setRecentActivity(results[idx++]);
      if (type === 'all' || type === 'storage') setStorage(results[idx++]);
    } catch (error) {
      console.error('Failed to refresh dashboard data:', error);
    }
  };

  useEffect(() => {
    async function initDashboard() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
          refreshData();
          
          // Load local notifications
          const saved = localStorage.getItem('vellum_notifications');
          if (saved) setNotifications(JSON.parse(saved));
        } else {
          router.push('/login');
        }
      } catch (error) {
        console.error('Failed to initialize dashboard:', error);
      } finally {
        setLoading(false);
      }
    }
    initDashboard();

    const handleUpdate = () => refreshData();
    window.addEventListener('activityUpdated', handleUpdate);
    window.addEventListener('starredToolsUpdated', handleUpdate);
    
    return () => {
      window.removeEventListener('activityUpdated', handleUpdate);
      window.removeEventListener('starredToolsUpdated', handleUpdate);
    };
  }, [router]);

  // Automated Storage Notifications
  useEffect(() => {
    if (!storage) return;
    const percent = (storage.usedBytes / storage.limitBytes) * 100;
    
    const lastAlert = localStorage.getItem('vellum_storage_alert');
    if (percent >= 100 && lastAlert !== 'full') {
      addNotification({
        type: 'error',
        title: 'Storage Full',
        message: 'You have reached your storage limit. Please delete some files or upgrade to Pro.',
        link: '/dashboard/documents'
      });
      localStorage.setItem('vellum_storage_alert', 'full');
    } else if (percent >= 50 && percent < 100 && lastAlert !== 'warning') {
      addNotification({
        type: 'warning',
        title: 'Storage Warning',
        message: `Your storage is ${Math.round(percent)}% full. Free users have a 50MB limit.`,
        link: '/dashboard/documents'
      });
      localStorage.setItem('vellum_storage_alert', 'warning');
    } else if (percent < 50) {
      localStorage.removeItem('vellum_storage_alert');
    }
  }, [storage]);

  const handleSignOut = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const openDrawer = (file: File | null, toolId: string | null) => {
    setSelectedFile(file);
    setActiveToolId(toolId);
    setIsDrawerOpen(true);
  };

  const closeDrawer = () => {
    setIsDrawerOpen(false);
    setTimeout(() => {
      setSelectedFile(null);
      setActiveToolId(null);
    }, 300); // Wait for transition out animation
  };

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000); // Auto close after 3s
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#f4f7fb]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#6366f1]"></div>
      </div>
    );
  }

  return (
    <DashboardContext.Provider value={{ 
      user, 
      documents, 
      recentActivity, 
      storage, 
      refreshData, 
      openDrawer, 
      closeDrawer, 
      showToast,
      notifications,
      addNotification,
      markAllAsRead,
      unreadCount
    }}>
      <div className="flex h-screen bg-[#f4f7fb] p-4 gap-4 overflow-hidden text-[#111827] relative">
        <Sidebar user={user} onSignOut={handleSignOut} />
        <main className="flex-1 bg-white rounded-2xl border border-[#eaedf3] shadow-[0_2px_12px_-3px_rgba(0,0,0,0.03)] flex flex-col overflow-hidden">
          {children}
        </main>

        {/* Global Components: Drawer overlaying above absolute bounds isolates wrapper isolates. */}
        <SideDrawer 
          isOpen={isDrawerOpen} 
          onClose={closeDrawer} 
          file={selectedFile} 
          toolId={activeToolId} 
        />

        {/* Global Toast */}
        {toast && (
          <div className={`fixed bottom-8 right-8 px-5 py-3.5 rounded-2xl shadow-xl flex items-center gap-3 text-[13px] font-semibold z-[100] border backdrop-blur-sm transition-all animate-in fade-in slide-in-from-bottom-5 ${
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
        )}
      </div>
    </DashboardContext.Provider>
  );
}

