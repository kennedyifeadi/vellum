"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/dashboard/Sidebar";

// Create context to share user data easily across sub-pages
const DashboardContext = createContext<{ user: any }>({ user: null });

export const useDashboard = () => useContext(DashboardContext);

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    async function fetchUser() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        } else {
          // Unauthenticated or Error
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#f4f7fb]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#6366f1]"></div>
      </div>
    );
  }

  return (
    <DashboardContext.Provider value={{ user }}>
      <div className="flex h-screen bg-[#f4f7fb] p-4 gap-4 overflow-hidden text-[#111827]">
        <Sidebar user={user} onSignOut={handleSignOut} />
        <main className="flex-1 bg-white rounded-2xl border border-[#eaedf3] shadow-[0_2px_12px_-3px_rgba(0,0,0,0.03)] flex flex-col p-8 overflow-y-auto">
          {children}
        </main>
      </div>
    </DashboardContext.Provider>
  );
}
