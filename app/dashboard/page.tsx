"use client";

import DragAndDrop from "@/components/dashboard/DragAndDrop";
import QuickTools from "@/components/dashboard/QuickTools";
import ActivityTable from "@/components/dashboard/ActivityTable";
import { useDashboard } from "./layout";

export default function DashboardPage() {
  const { user } = useDashboard();

  return (
    <div className="flex flex-col rounded-2xl">
      <header className="flex justify-between rounded-t-2xl items-center border-b border-[#eaedf3] mb-2 p-4 sticky top-0 z-10 bg-white">
        <div>
          <h1 className="text-2xl font-bold bg-linear-to-r from-[#111827] to-[#374151] bg-clip-text text-transparent"> Good morning, {user?.name?.split(' ')?.[0] || 'there'}!</h1>
          <p className="text-xs text-[#6b7280]">Ready to convert some files today?</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <input 
              type="text" 
              placeholder="Search files, tools..." 
              className="h-9 w-52 bg-[#f4f7fb] border border-[#eaedf3] rounded-xl pl-8 pr-3 text-xs focus:outline-none focus:border-[#6366f1] transition-all"
            />
            <svg className="absolute left-2.5 top-2.5 w-4 h-4 text-[#9ca3af]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <button className="relative w-9 h-9 rounded-xl border border-[#eaedf3] hover:bg-[#f9fafb] flex items-center justify-center transition-all text-[#6b7280]">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-[#ef4444] rounded-full" />
          </button>
        </div>
      </header>
      <div className="p-8 h-[72%] overflow-y-auto">
      <DragAndDrop />
      <QuickTools />
      
      {/* ActivityTable seamlessly handles its own data fetching internals */}
      <ActivityTable />
      </div>
    </div>
  );
}
