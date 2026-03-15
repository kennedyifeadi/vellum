"use client";

import React from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';

export default function QuickTools() {
  const tools = [
    { id: 1, title: 'Image to PDF', icon: '🖼️', color: 'bg-[#fef2f2] text-[#ef4444]', desc: 'Convert JPG/PNG files' },
    { id: 2, title: 'Merge PDF', icon: '📄', color: 'bg-[#f0fdf4] text-[#22c55e]', desc: 'Combine multiple PDFs' },
    { id: 3, title: 'Split PDF', icon: '✂️', color: 'bg-[#fdf4ff] text-[#d946ef]', desc: 'Extract pages instantly' },
    { id: 4, title: 'DOCX to PDF', icon: '📘', color: 'bg-[#eff6ff] text-[#3b82f6]', desc: 'Word to high-res PDF' },
    { id: 5, title: 'Lock PDF', icon: '🔒', color: 'bg-[#fefce8] text-[#eab308]', desc: 'Add password protection' }
  ];

  return (
    <div className="mt-8">
      <div className="flex justify-between items-center mb-4">
        <p className="font-bold text-[15px] text-[#111827]">Quick Tools</p>
        <Link href="/dashboard/library" className="text-xs font-medium text-[#6366f1] hover:underline flex items-center gap-1">
          View All &rarr;
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {tools.map((tool) => (
          <motion.button
            key={tool.id}
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
