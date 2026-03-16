"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/dashboard/Sidebar";

// Create context to share user data easily across sub-pages
// Create context to share user data and drawer state easily across sub-pages
const DashboardContext = createContext<{
  user: any;
  openDrawer: (file: File | null, toolId: string | null) => void;
  closeDrawer: () => void;
  showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}>({
  user: null,
  openDrawer: () => {},
  closeDrawer: () => {},
  showToast: () => {},
});

export const useDashboard = () => useContext(DashboardContext);

import SideDrawer from "@/components/dashboard/SideDrawer";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Drawer & Toast States
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [activeToolId, setActiveToolId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  useEffect(() => {
    async function fetchUser() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        } else {
          router.push('/login');
        }







      } catch (error) {
        console.error('Failed to fetch user:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchUser();
  }, [router]);

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
    <DashboardContext.Provider value={{ user, openDrawer, closeDrawer, showToast }}>
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
          <div className={`absolute bottom-6 right-6 px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 text-xs font-medium z-50 animate-bounce ${
            toast.type === 'error' ? 'bg-[#fef2f2] text-[#ef4444] border border-[#fecaca]' :
            toast.type === 'success' ? 'bg-[#f0fdf4] text-[#22c55e] border border-[#bbf7d0]' :
            'bg-[#f0f9ff] text-[#0ea5e9] border border-[#bae6fd]'
          }`}>
            <span>{toast.message}</span>
          </div>
        )}
      </div>
    </DashboardContext.Provider>
  );
}

