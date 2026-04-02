"use client";

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useDashboard } from '@/app/dashboard/layout';
import Link from 'next/link';
import { ALL_TOOLS, Tool } from '@/lib/tools';

export default function QuickTools() {
  const { openDrawer } = useDashboard();
  const [displayTools, setDisplayTools] = useState<Tool[]>([]);

  useEffect(() => {
    const updateTools = () => {
      if (typeof window === 'undefined') return;

      // 1. Get starred tools from localStorage
      const starredIds = JSON.parse(localStorage.getItem('starredTools') || '[]');
      
      // 2. Separate starred and unstarred
      const starredTools = ALL_TOOLS.filter(t => starredIds.includes(t.id));
      const unstarredTools = ALL_TOOLS.filter(t => !starredIds.includes(t.id));

      // 3. Shuffle unstarred tools for "random" selection
      const shuffledUnstarred = [...unstarredTools].sort(() => Math.random() - 0.5);

      // 4. Combine: Starred first (up to 5), then fill with random up to 5
      const combined = [...starredTools, ...shuffledUnstarred].slice(0, 5);
      
      setDisplayTools(combined);
    };

    updateTools();

    // Listen for updates from Tools Library
    window.addEventListener('starredToolsUpdated', updateTools);
    return () => window.removeEventListener('starredToolsUpdated', updateTools);
  }, []);

  const handleToolClick = (id: string) => {
    openDrawer(null, id);
  };

  return (
    <div className="mt-8">
      <div className="flex justify-between items-center mb-4">
        <p className="font-bold text-[15px] text-[#111827]">Quick Tools</p>
        <Link href="/dashboard/library" className="text-xs font-medium text-[#6366f1] hover:underline flex items-center gap-1">
          View All &rarr;
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {displayTools.map((tool) => (
          <motion.button
            key={tool.id}
            onClick={() => handleToolClick(tool.id)}
            whileHover={{ y: -4, boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}
            className="bg-white border border-[#edf1f7] rounded-xl p-4 flex flex-col items-start gap-2 hover:border-[#e0e7ff] text-left transition-all cursor-pointer shadow-[0_1px_4px_rgba(0,0,0,0.01)]"
          >
            <div className={`w-9 h-9 ${tool.color} rounded-lg flex items-center justify-center text-lg`}>
              {tool.icon}
            </div>
            <div>
              <p className="text-xs font-bold text-[#111827]">{tool.title}</p>
              <p className="text-[10px] text-[#6b7280] mt-0.5 leading-tight">{tool.desc}</p>
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
