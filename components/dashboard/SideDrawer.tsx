"use client";

import { motion, AnimatePresence } from 'framer-motion';
import { useState, useRef } from 'react';
import { useDashboard } from '@/app/dashboard/layout';

type SideDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  file: File | null;
  toolId: string | null;
};

// Define available tools for dropdown selection (General Layout)
const availableTools = [
  { id: 'image-to-pdf', name: 'Image to PDF', color: 'bg-[#FFEDD5] text-[#ef4444]' },
  { id: 'merge-pdf', name: 'Merge PDF', color: 'bg-[#DBEAFE] text-[#22c55e]' },
  { id: 'split-pdf', name: 'Split PDF', color: 'bg-[#F3E8FF] text-[#d946ef]' },
  { id: 'docx-to-pdf', name: 'DOCX to PDF', color: 'bg-[#E0E7FF] text-[#3b82f6]' },
  { id: 'lock-pdf', name: 'Lock PDF', color: 'bg-[#D1FAE5] text-[#eab308]' },
];

export default function SideDrawer({ isOpen, onClose, file, toolId }: SideDrawerProps) {
  const [selectedTool, setSelectedTool] = useState<string>('');
  const [prevToolId, setPrevToolId] = useState<string | null>(null);
  const { openDrawer, showToast } = useDashboard();
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (toolId !== prevToolId) {
    setPrevToolId(toolId);
    setSelectedTool(toolId || '');
  }

  // Format File Size helper
  const formatBytes = (bytes: number, decimals = 2) => {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    // Validate size (10MB max)
    const MAX_SIZE = 10 * 1024 * 1024;
    if (selectedFile.size > MAX_SIZE) {
      showToast("File size exceeds 10MB free limit. Please upgrade or use a smaller file.", "error");
      return;
    }

    openDrawer(selectedFile, selectedTool || null);
    e.target.value = ''; // Reset
  };

  // Find Tool Info for Header Coloring
  const currentToolInfo = availableTools.find(t => t.id === selectedTool);


  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.25 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black z-40 cursor-pointer"
          />

          {/* Side Drawer Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 20, stiffness: 200 }}
            className="absolute top-4 right-4 bottom-4 w-[400px] bg-white z-50 shadow-[-8px_0_24px_-10px_rgba(0,0,0,0.08)] flex flex-col rounded-l-3xl overflow-hidden border border-[#eaedf3]"
          >
            {/* Header section themed with tool color scheme node isolate bounding isolation */}
            <div className={`p-5 border-b border-[#eaedf3] ${
              currentToolInfo ? 'bg-linear-to-b from-[#f8fafc] to-white' : 'bg-white'
            }`}>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm ${
                    currentToolInfo?.color || 'bg-[#eef2ff] text-[#6366f1]'
                  }`}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-[#111827]">
                      {currentToolInfo ? `${currentToolInfo.name}` : 'Process File'}
                    </h2>
                    <p className="text-[10px] text-[#6b7280]">Free Plan Size Limit: 10MB</p>
                  </div>
                </div>
                <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#f3f4f6] text-[#6b7280]">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Content body layout container isolated node context bounds. */}
            <div className="flex-1 p-5 overflow-y-auto space-y-5">
              {/* Selected File Preview Box Isolated Frames isolate bounds isolates */}
              {file && (
                <div className="bg-[#f8fafc] border border-[#eaedf3] rounded-xl p-4 flex items-center gap-3">
                  <div className="w-10 h-10 bg-white rounded-lg border border-[#eaedf3] flex items-center justify-center text-lg">
                    {file.type.includes('pdf') ? '📄' : file.type.includes('image') ? '🖼️' : '📁'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[#111827] truncate">{file.name}</p>
                    <p className="text-[10px] text-[#6b7280] mt-0.5">{formatBytes(file.size)}</p>
                  </div>
                </div>
              )}

              {!file && (
                <div 
                  className="border-2 border-dashed border-[#eaedf3] rounded-xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-[#6366f1] hover:bg-[#6366f1]/5 transition-all group"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="w-10 h-10 bg-[#f8fafc] group-hover:bg-white rounded-xl flex items-center justify-center text-[#6366f1] border border-[#eaedf3] shadow-sm transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-semibold text-[#111827]">Upload File</p>
                    <p className="text-[10px] text-[#6b7280] mt-0.5">Select from device or drop here</p>
                  </div>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    onChange={handleFileChange}
                    accept=".pdf,.docx,.doc,.jpg,.jpeg,.png"
                  />
                </div>
              )}


              {/* Tool Selector Dropdown for General items isolated node bounds frames. */}
              {!toolId && (
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-[#4b5563] uppercase tracking-wide">Select Tool</label>
                  <div className="relative">
                    <select
                      value={selectedTool}
                      onChange={(e) => setSelectedTool(e.target.value)}
                      className="w-full h-10 bg-white border border-[#eaedf3] rounded-xl pl-3 pr-8 text-xs text-[#1f2937] focus:outline-none focus:ring-1 focus:ring-[#6366f1] cursor-pointer appearance-none"
                    >
                      <option value="" disabled>Choose a tool to perform...</option>
                      {availableTools.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <svg className="absolute right-3 top-3 w-4 h-4 text-[#9ca3af] pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              )}

              {/* Action options/description specific grids bounds maps layout. */}
              {selectedTool && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }} 
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-[#f0f9ff]/40 border border-[#bae6fd]/40 rounded-xl p-4 space-y-2"
                >
                  <p className="text-xs font-semibold text-[#0369a1]">Processing Action Available</p>
                  <p className="text-[11px] text-[#0c4a6e] leading-relaxed">
                    You have selected **{currentToolInfo?.name}**. This action will execute right away when tapping the Process button below.
                  </p>
                </motion.div>
              )}
            </div>

            {/* Footer containing trigger isolated grids actions layout node bounds. */}
            <div className="p-5 border-t border-[#eaedf3] space-y-3">
              <button 
                disabled={!selectedTool}
                className={`w-full h-10 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                  selectedTool 
                    ? 'bg-[#6366f1] text-white hover:bg-[#4f46e5] shadow-sm shadow-[#6366f1]/20' 
                    : 'bg-[#f3f4f6] text-[#9ca3af] cursor-not-allowed'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                </svg>
                Process File
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
