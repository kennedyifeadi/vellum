"use client";

import React from 'react';

interface Tab {
  id: string;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (id: string) => void;
  className?: string;
}

export default function Tabs({ tabs, activeTab, onChange, className = "" }: TabsProps) {
  return (
    <div className={`flex flex-col gap-1 w-64 ${className}`}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          disabled={tab.disabled}
          onClick={() => onChange(tab.id)}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 group ${
            activeTab === tab.id
              ? 'bg-[#6366f1]/5 text-[#6366f1] shadow-sm'
              : 'text-[#6b7280] hover:bg-[#f8fafc] hover:text-[#111827]'
          } ${tab.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <div className={`${activeTab === tab.id ? 'text-[#6366f1]' : 'text-[#9ca3af] group-hover:text-[#111827]'} transition-colors`}>
            {tab.icon}
          </div>
          {tab.label}
        </button>
      ))}
    </div>
  );
}
