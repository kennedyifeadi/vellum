"use client";

import { motion } from 'framer-motion';

export default function DragAndDrop() {
  return (
    <motion.div 
      className="w-full h-56 border-2 border-dashed border-[#6366f1] rounded-2xl flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors bg-[#fbfcfd]"
    >
      <div className="w-12 h-12 rounded-full bg-[#f0f2fe] flex items-center justify-center text-[#4f46e5]">
        <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-[#111827]">Drag & Drop files here</p>
      <p className="text-[11px] text-[#6b7280]">Support for PDF, DOCX, JPG, PNG and more. Max file size 50MB.</p>
      <div className="flex gap-2 mt-2">
        <button className="h-8 px-4 bg-[#6366f1] text-white text-xs font-medium rounded-lg shadow-sm shadow-[#6366f1]/20 hover:bg-[#4f46e5] transition-colors">
          + Upload File
        </button>
        <button className="h-8 px-4 border border-[#e2e8f0] bg-white text-xs font-medium rounded-lg hover:bg-[#f9fafb] transition-colors">
          Browse Drive
        </button>
      </div>
    </motion.div>
  );
}
