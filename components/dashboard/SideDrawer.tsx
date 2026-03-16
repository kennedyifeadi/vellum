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

  // Multi-file state array
  const [fileList, setFileList] = useState<File[]>([]);
  const [prevFile, setPrevFile] = useState<File | null>(null);

  if (toolId !== prevToolId) {
    setPrevToolId(toolId);
    setSelectedTool(toolId || '');
  }

  if (file !== prevFile) {
    setPrevFile(file);
    if (file) {
      setFileList(prev => {
        if (prev.find(f => f.name === file.name && f.size === file.size)) return prev;
        return [...prev, file];
      });
    } else {
      setFileList([]); // Clear if file goes null
    }
  }

  // Tool-specific options states
  const [splitOptions, setSplitOptions] = useState({ startPage: 1, endPage: 1, splitEvery: false });
  const [lockOptions, setLockOptions] = useState({ password: '', confirmPassword: '' });
  const [findOptions, setFindOptions] = useState({ searchTerm: '' });
  const [htmlOptions, setHtmlOptions] = useState({ url: '', mode: 'file' as 'file' | 'url' });



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

    // Check Multiple file limits
    if (selectedTool === 'merge-pdf' && fileList.length >= 3) {
      showToast("Free tier supports merging up to 3 PDFs only.", "error");
      return;
    }
    if (selectedTool === 'image-to-pdf' && fileList.length >= 5) {
      showToast("Free tier supports converting up to 5 images only.", "error");
      return;
    }

    setFileList(prev => {
      if (prev.find(f => f.name === selectedFile.name && f.size === selectedFile.size)) return prev;
      return [...prev, selectedFile];
    });

    e.target.value = ''; // Reset
  };


  // Find Tool Info for Header Coloring
  const currentToolInfo = availableTools.find(t => t.id === selectedTool);

  // Dynamic tool options inputs rendering layout Switch
  const renderToolInputs = () => {
    if (!selectedTool) return null;

    switch (selectedTool) {
      case 'split-pdf':
        return (
          <div className="space-y-3 bg-[#f8fafc] border border-[#eaedf3] rounded-xl p-4">
            <p className="text-xs font-semibold text-[#111827]">Split Options</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-[#6b7280]">Start Page</label>
                <input 
                  type="number" 
                  min="1"
                  value={splitOptions.startPage}
                  onChange={(e) => setSplitOptions(prev => ({ ...prev, startPage: parseInt(e.target.value) || 1 }))}
                  className="w-full h-9 bg-white border border-[#eaedf3] rounded-lg px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#6366f1]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-[#6b7280]">End Page</label>
                <input 
                  type="number" 
                  min={splitOptions.startPage}
                  value={splitOptions.endPage}
                  onChange={(e) => setSplitOptions(prev => ({ ...prev, endPage: parseInt(e.target.value) || 1 }))}
                  className="w-full h-9 bg-white border border-[#eaedf3] rounded-lg px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#6366f1]"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer mt-1">
              <input 
                type="checkbox" 
                checked={splitOptions.splitEvery}
                onChange={(e) => setSplitOptions(prev => ({ ...prev, splitEvery: e.target.checked }))}
                className="rounded border-[#eaedf3] text-[#111827] focus:ring-[#6366f1]"
              />
              <span className="text-[11px] text-[#4b5563]">Split every page into separate PDF</span>
            </label>
          </div>
        );
      case 'lock-pdf':
        return (
          <div className="space-y-2.5 bg-[#f8fafc] border border-[#eaedf3] rounded-xl p-4">
            <p className="text-xs font-semibold text-[#111827]">Security Settings</p>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-[#6b7280]">Password</label>
              <input 
                type="password" 
                placeholder="Min 6 characters"
                value={lockOptions.password}
                onChange={(e) => setLockOptions(prev => ({ ...prev, password: e.target.value }))}
                className="w-full h-9 bg-white border border-[#eaedf3] rounded-lg px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#6366f1]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-[#6b7280]">Confirm Password</label>
              <input 
                type="password" 
                placeholder="Repeat password"
                value={lockOptions.confirmPassword}
                onChange={(e) => setLockOptions(prev => ({ ...prev, confirmPassword: e.target.value }))}
                className="w-full h-9 bg-white border border-[#eaedf3] rounded-lg px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#6366f1]"
              />
            </div>
          </div>
        );
      case 'find-pdf':
        return (
          <div className="space-y-2 bg-[#f8fafc] border border-[#eaedf3] rounded-xl p-4">
            <p className="text-xs font-semibold text-[#111827]">Search Target</p>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-[#6b7280]">Search Term</label>
              <input 
                type="text" 
                placeholder="Word or phrase to find..."
                value={findOptions.searchTerm}
                onChange={(e) => setFindOptions(prev => ({ ...prev, searchTerm: e.target.value }))}
                className="w-full h-9 bg-white border border-[#eaedf3] rounded-lg px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#6366f1]"
              />
            </div>
          </div>
        );
      case 'html-to-pdf':
        return (
          <div className="space-y-2.5">
            <div className="flex gap-1 bg-[#f1f5f9] p-1 rounded-xl">
              <button 
                onClick={() => setHtmlOptions(prev => ({ ...prev, mode: 'file' }))} 
                className={`flex-1 h-8 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                  htmlOptions.mode === 'file' ? 'bg-white shadow-sm text-[#111827]' : 'text-[#6b7280]'
                }`}
              >
                Upload File
              </button>
              <button 
                onClick={() => setHtmlOptions(prev => ({ ...prev, mode: 'url' }))} 
                className={`flex-1 h-8 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                  htmlOptions.mode === 'url' ? 'bg-white shadow-sm text-[#111827]' : 'text-[#6b7280]'
                }`}
              >
                Enter URL
              </button>
            </div>
            {htmlOptions.mode === 'url' && (
              <div className="space-y-1 bg-[#f8fafc] border border-[#eaedf3] rounded-xl p-4">
                <label className="text-[10px] font-medium text-[#6b7280]">Website URL</label>
                <input 
                  type="text" 
                  placeholder="https://example.com" 
                  value={htmlOptions.url} 
                  onChange={(e) => setHtmlOptions(prev => ({ ...prev, url: e.target.value }))} 
                  className="w-full h-9 bg-white border border-[#eaedf3] rounded-lg px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#6366f1]" 
                />
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };
  // Validate action constraints
  const isActionDisabled = () => {
    if (!selectedTool) return true;
    
    // Ignore file list checking if in HTML URL mode
    const isHtmlUrl = selectedTool === 'html-to-pdf' && htmlOptions.mode === 'url';
    if (fileList.length === 0 && !isHtmlUrl) return true;

    switch (selectedTool) {
      case 'merge-pdf':
        return fileList.length < 2;
      case 'split-pdf':
        return !splitOptions.startPage || !splitOptions.endPage;
      case 'lock-pdf':
        return lockOptions.password.length < 6 || lockOptions.password !== lockOptions.confirmPassword;
      case 'find-pdf':
        return !findOptions.searchTerm.trim();
      case 'html-to-pdf':
        return htmlOptions.mode === 'url' ? !htmlOptions.url.trim() : fileList.length === 0;

      default:
        return false;
    }
  };
  // Determine file types accepted based on selected tool
  const getAcceptAttribute = () => {
    switch (selectedTool) {
      case 'merge-pdf':
      case 'split-pdf':
      case 'lock-pdf':
      case 'find-pdf':
        return '.pdf';
      case 'image-to-pdf':
        return '.jpg,.jpeg,.png';
      case 'jpeg-to-png':
        return '.jpg,.jpeg';
      case 'docx-to-pdf':
        return '.docx,.doc';
      case 'html-to-pdf':
        return '.html';
      default:
        return '.pdf,.docx,.doc,.jpg,.jpeg,.png';
    }
  };


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
              {fileList.length > 0 && (
                <div className="space-y-3">
                  <p className="text-[11px] font-semibold text-[#4b5563] uppercase tracking-wide">Selected Files ({fileList.length})</p>
                  <div className="space-y-2">
                    {fileList.map((f, index) => (
                      <div key={index} className="bg-[#f8fafc] border border-[#eaedf3] rounded-xl p-3 flex items-center gap-3 relative group">
                        <div className="w-10 h-10 bg-white rounded-lg border border-[#eaedf3] flex items-center justify-center overflow-hidden shrink-0 text-lg">
                          {f.type.includes('pdf') ? '📄' : f.type.includes('image') ? '🖼️' : '📁'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-[#111827] truncate">{f.name}</p>
                          <p className="text-[10px] text-[#6b7280] mt-0.5">{formatBytes(f.size)}</p>
                        </div>
                        <button 
                          onClick={() => setFileList(prev => prev.filter((_, i) => i !== index))}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#ef4444] text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>

                  {(selectedTool === 'merge-pdf' || selectedTool === 'image-to-pdf') && (
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full h-9 border border-dashed border-[#eaedf3] rounded-xl flex items-center justify-center gap-1 text-[11px] font-medium text-[#6366f1] hover:bg-[#6366f1]/5 transition-all mt-1"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                      Add more files
                    </button>
                  )}
                </div>
              )}

              {fileList.length === 0 && !(selectedTool === 'html-to-pdf' && htmlOptions.mode === 'url') && (


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
                    accept={getAcceptAttribute()}
                  />


                </div>
              )}

              {/* Dynamic Inputs Rendered options */}
              {renderToolInputs()}



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
                disabled={isActionDisabled()}

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
