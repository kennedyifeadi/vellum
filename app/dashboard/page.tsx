"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AuthLayout, AuthCard, AuthButton } from "@/components/auth/AuthComponents";

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    // This is a secondary check, middleware handles the heavy lifting
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <AuthLayout>
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#6366f1]"></div>
        </div>
      </AuthLayout>
    );
  }

  const handleSignOut = async () => {
    try {
      // 1. Clear backend cookies
      await fetch("/api/auth/logout", { method: "POST" });
      
      // 2. Clear NextAuth session (client-side)
      // Since we already cleared cookies, the middleware will handle the redirect
      // but we push to login to be immediate.
      router.push("/login");
      router.refresh();
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] p-8">
      <div className="max-w-7xl mx-auto">
        <header className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-[#111827]">Dashboard</h1>
            <p className="text-[#6b7280]">Welcome back, {session?.user?.name || "User"}</p>
          </div>
          <AuthButton className="w-auto px-6" onClick={handleSignOut}>
            Sign Out
          </AuthButton>
        </header>

        <AuthCard className="max-w-none">
          <div className="text-center py-12">
            <div className="w-20 h-20 bg-[#f3f4ff] rounded-full flex items-center justify-center mx-auto mb-6 text-[#6366f1]">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-[#111827] mb-2">Workspace Ready</h2>
            <p className="text-[#6b7280] max-w-md mx-auto">
              You have successfully completed your profile. This is your dashboard where you can manage your projects and workflow.
            </p>
          </div>
        </AuthCard>
      </div>
    </div>
  );
}
