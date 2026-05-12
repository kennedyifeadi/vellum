"use client";

import DragAndDrop from "@/components/dashboard/DragAndDrop";
import QuickTools from "@/components/dashboard/QuickTools";
import ActivityTable from "@/components/dashboard/ActivityTable";
import { useDashboard } from "./layout";
import { useState } from 'react';
import DashboardHeader from "@/components/dashboard/DashboardHeader";

export default function DashboardPage() {
  const { user } = useDashboard();
  const [search, setSearch] = useState('');
  const hour = new Date().getHours();
  let greeting = 'Good evening';
  if (hour < 12) greeting = 'Good morning';
  else if (hour < 18) greeting = 'Good afternoon';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <DashboardHeader 
        title={<h1 suppressHydrationWarning className="text-2xl font-bold bg-linear-to-r from-[#111827] to-[#374151] bg-clip-text text-transparent"> {greeting}, {user?.name?.split(' ')?.[0] || 'there'}!</h1>}
        subtitle="Ready to convert some files today?"
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search files, tools..."
      />
      <div className="p-4 md:p-8 flex-1 overflow-y-auto min-h-0 relative">
      <DragAndDrop />
      <QuickTools />
      
      {/* ActivityTable seamlessly handles its own data fetching internals */}
      <ActivityTable />
      </div>
    </div>
  );
}
