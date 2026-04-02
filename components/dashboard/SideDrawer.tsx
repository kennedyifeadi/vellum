"use client";

import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { useState, useRef, useEffect } from 'react';
import { useDashboard } from '@/app/dashboard/layout';
import dynamic from 'next/dynamic';

interface FindMatch {
  page: number;
  text: string;
  snippet: string;
}
import ImageThumbnail from './ImageThumbnail';

const PdfThumbnail = dynamic(() => import('./PdfThumbnail'), { ssr: false });

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
  { id: 'find-pdf', name: 'Find in PDF', color: 'bg-[#FFEDD5] text-[#ea580c]' },
  { id: 'html-to-pdf', name: 'HTML to PDF', color: 'bg-[#F3F4F6] text-[#6366f1]' },
  { id: 'jpg-to-png', name: 'JPEG to PNG', color: 'bg-[#FFF7ED] text-[#f97316]' },
];

export default function SideDrawer({ isOpen, onClose, file, toolId }: SideDrawerProps) {
  const [selectedTool, setSelectedTool] = useState<string>('');
  const [prevToolId, setPrevToolId] = useState<string | null>(null);
  const { showToast, addNotification, user } = useDashboard();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Multi-file state array
  const [fileList, setFileList] = useState<File[]>([]);
  const [prevFile, setPrevFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const maxAllowedJpg = user?.plan === 'Pro' ? 10 : 5;
  const maxAllowedMerge = user?.plan === 'Pro' ? 10 : 3;
  const maxAllowedImage = user?.plan === 'Pro' ? 10 : 3;

  useEffect(() => {
    if (toolId !== prevToolId) {
      setPrevToolId(toolId);
      const finalId = toolId === 'img-to-pdf' ? 'image-to-pdf' : toolId;
      setSelectedTool(finalId || '');
    }
  }, [toolId, prevToolId]);

  useEffect(() => {
    if (file !== prevFile) {
      setPrevFile(file);
      if (file) {
        setFileList(prev => {
          if (prev.find(f => f.name === file.name && f.size === file.size)) return prev;
          return [...prev, file];
        });
      } else {
        setFileList([]);
      }
    }
  }, [file, prevFile]);

  // Tool-specific options states
  const [splitOptions, setSplitOptions] = useState({ startPage: 1, endPage: 1, splitEvery: false });
  const [pdfPageCount, setPdfPageCount] = useState<number>(0);
  const [lockOptions, setLockOptions] = useState({ password: '', confirmPassword: '' });
  const [findOptions, setFindOptions] = useState({ searchTerm: '' });
  const [htmlOptions, setHtmlOptions] = useState({ url: '', mode: 'file' as 'file' | 'url' });
  const [findResults, setFindResults] = useState<{ matches: FindMatch[], matchCount: number, pdfBase64?: string } | null>(null);

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
    if (!e.target.files || e.target.files.length === 0) return;

    const newFiles = Array.from(e.target.files);
    let errorShown = false;

    setFileList(prev => {
      const updatedList = [...prev];

      for (const selectedFile of newFiles) {
        const MAX_SIZE = 10 * 1024 * 1024;
        if (selectedFile.size > MAX_SIZE) {
          if (!errorShown) showToast("A file exceeds 10MB free limit. Skipped.", "error");
          errorShown = true;
          continue;
        }

        if (selectedTool === 'merge-pdf' && updatedList.length >= maxAllowedMerge) {
          if (!errorShown) showToast(`Your plan supports merging up to ${maxAllowedMerge} PDFs for this tool.`, "error");
          errorShown = true;
          break;
        }
        if (selectedTool === 'image-to-pdf' && updatedList.length >= maxAllowedImage) {
          if (!errorShown) showToast(`Your plan supports converting up to ${maxAllowedImage} images for this tool.`, "error");
          errorShown = true;
          break;
        }
        if (selectedTool === 'jpg-to-png' && updatedList.length >= maxAllowedJpg) {
          if (!errorShown) showToast(`Your plan supports up to ${maxAllowedJpg} images for this tool.`, "error");
          errorShown = true;
          break;
        }
        if (selectedTool && selectedTool !== 'merge-pdf' && selectedTool !== 'image-to-pdf' && selectedTool !== 'jpg-to-png' && updatedList.length >= 1) {
          if (!errorShown) showToast("This tool only supports processing 1 file at a time.", "error");
          errorShown = true;
          break;
        }

        if (updatedList.find(f => f.name === selectedFile.name && f.size === selectedFile.size)) continue;
        
        const currentTotalSize = updatedList.reduce((acc, f) => acc + f.size, 0);
        if (currentTotalSize + selectedFile.size > MAX_SIZE) {
          if (!errorShown) showToast("Total combined size exceeds the 10MB limit.", "error");
          errorShown = true;
          break;
        }

        updatedList.push(selectedFile);
      }

      return updatedList;
    });

    e.target.value = '';
  };

  const currentToolInfo = availableTools.find(t => t.id === selectedTool);

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
                  max={pdfPageCount || 1}
                  value={splitOptions.startPage}
                  onChange={(e) => {
                    let val = parseInt(e.target.value) || 1;
                    if (pdfPageCount && val > pdfPageCount) val = pdfPageCount;
                    if (val > splitOptions.endPage) {
                      setSplitOptions(prev => ({ ...prev, startPage: val, endPage: val }));
                    } else {
                      setSplitOptions(prev => ({ ...prev, startPage: val }));
                    }
                  }}
                  className="w-full h-9 bg-white border border-[#eaedf3] rounded-lg px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#6366f1]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-[#6b7280]">End Page</label>
                <input 
                  type="number" 
                  min={splitOptions.startPage}
                  max={pdfPageCount || 1}
                  value={splitOptions.endPage}
                  onChange={(e) => {
                    let val = parseInt(e.target.value) || 1;
                    if (pdfPageCount && val > pdfPageCount) val = pdfPageCount;
                    if (val < splitOptions.startPage) {
                      setSplitOptions(prev => ({ ...prev, endPage: splitOptions.startPage }));
                    } else {
                      setSplitOptions(prev => ({ ...prev, endPage: val }));
                    }
                  }}
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

  const isActionDisabled = () => {
    if (!selectedTool) return true;
    const isHtmlUrl = selectedTool === 'html-to-pdf' && htmlOptions.mode === 'url';
    if (fileList.length === 0 && !isHtmlUrl) return true;

    switch (selectedTool) {
      case 'merge-pdf':
        return fileList.length < 2;
      case 'image-to-pdf':
        return fileList.length === 0;
      case 'split-pdf':
        return !splitOptions.startPage || !splitOptions.endPage;
      case 'lock-pdf':
        return lockOptions.password.length < 6 || lockOptions.password !== lockOptions.confirmPassword;
      case 'find-pdf':
        return !findOptions.searchTerm.trim();
      case 'html-to-pdf':
        return htmlOptions.mode === 'url' ? !htmlOptions.url.trim() : fileList.length === 0;
      case 'docx-to-pdf':
        return fileList.length === 0;
      case 'jpg-to-png':
        return fileList.length === 0;
      default:
        return false;
    }
  };

  const getAcceptAttribute = () => {
    switch (selectedTool) {
      case 'merge-pdf':
      case 'split-pdf':
      case 'lock-pdf':
      case 'find-pdf':
        return '.pdf';
      case 'image-to-pdf':
        return '.jpg,.jpeg,.png';
      case 'jpg-to-png':
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
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.25 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black z-40 cursor-pointer"
          />

          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 20, stiffness: 200 }}
            className="absolute top-4 right-4 bottom-4 w-[400px] bg-white z-50 shadow-[-8px_0_24px_-10px_rgba(0,0,0,0.08)] flex flex-col rounded-l-3xl overflow-hidden border border-[#eaedf3]"
          >
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

            <div className="flex-1 p-5 overflow-y-auto space-y-5">
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                onChange={handleFileChange}
                accept={getAcceptAttribute()}
                multiple={selectedTool === 'merge-pdf' || selectedTool === 'image-to-pdf' || selectedTool === 'jpg-to-png' || !selectedTool}
              />
              {fileList.length > 0 && (
                <div className="space-y-3">
                  <p className="text-[11px] font-semibold text-[#4b5563] uppercase tracking-wide">Selected Files ({fileList.length})</p>
                  <Reorder.Group axis="y" values={fileList} onReorder={setFileList} className="space-y-2">
                    {fileList.map((f, index) => (
                      <Reorder.Item 
                        key={`${f.name}-${f.size}`} 
                        value={f} 
                        className="bg-[#f1f5f9] border border-[#e2e8f0] rounded-xl p-4 flex flex-col items-center gap-4 relative group shadow-sm transition-shadow hover:shadow-md cursor-grab active:cursor-grabbing"
                      >
                        <div className="absolute top-3 left-3 w-7 h-7 rounded-lg bg-white/70 flex items-center justify-center text-[#94a3b8] opacity-0 group-hover:opacity-100 transition-opacity border border-[#e2e8f0] shadow-sm pointer-events-none">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8h16M4 16h16" />
                          </svg>
                        </div>
                        {f.type.includes('pdf') ? (
                          selectedTool === 'split-pdf' && !splitOptions.splitEvery ? (
                            <div className="flex gap-2 w-full justify-center px-4 overflow-x-auto">
                              <PdfThumbnail 
                                file={f} 
                                pageNumber={splitOptions.startPage} 
                                onLoadSuccess={({numPages}) => setPdfPageCount(numPages)} 
                              />
                              {splitOptions.startPage !== splitOptions.endPage && (
                                <>
                                  <div className="flex flex-col justify-center text-[#94a3b8] font-medium text-xs">
                                    <span>...</span>
                                  </div>
                                  <PdfThumbnail 
                                    file={f} 
                                    pageNumber={splitOptions.endPage} 
                                  />
                                </>
                              )}
                            </div>
                          ) : (
                            <PdfThumbnail file={f} onLoadSuccess={({numPages}) => setPdfPageCount(numPages)} />
                          )
                        ) : f.type.includes('image') ? (
                          <ImageThumbnail file={f} />
                        ) : (
                          <div className="w-[240px] aspect-3/4 max-w-full bg-white rounded-lg border border-[#e2e8f0] flex items-center justify-center overflow-hidden shrink-0 text-6xl shadow-sm">
                            📁
                          </div>
                        )}
                        <div className="w-full text-center flex flex-col items-center">
                          <p className="text-sm font-semibold text-[#1e293b] truncate w-full max-w-[260px]">{f.name}</p>
                          <p className="text-xs text-[#64748b] mt-1 font-medium bg-white px-2 py-0.5 rounded-full border border-[#e2e8f0] inline-block">{formatBytes(f.size)}</p>
                        </div>
                        <button 
                          onClick={() => setFileList(prev => prev.filter((_, i) => i !== index))}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#ef4444] text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm z-10"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </Reorder.Item>
                    ))}
                  </Reorder.Group>

                  {(selectedTool === 'merge-pdf' || selectedTool === 'image-to-pdf' || selectedTool === 'jpg-to-png') && (
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
                </div>
              )}

              {renderToolInputs()}

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

              {selectedTool === 'find-pdf' && findResults && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }} 
                  animate={{ opacity: 1, scale: 1 }}
                  className="space-y-3"
                >
                  <div className="flex justify-between items-center px-1">
                    <p className="text-[11px] font-bold text-[#4b5563] uppercase">Search Results ({findResults.matchCount})</p>
                    <button 
                      onClick={() => setFindResults(null)}
                      className="text-[10px] text-[#6366f1] font-bold hover:underline"
                    >
                      Clear Results
                    </button>
                  </div>
                  <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                    {findResults.matches.length > 0 ? (
                      findResults.matches.map((match, idx) => (
                        <div key={idx} className="bg-[#f8fafc] border border-[#eaedf3] rounded-xl p-3 hover:border-[#6366f1]/30 transition-colors">
                          <div className="flex justify-between items-start mb-1">
                            <span className="text-[10px] font-bold text-[#6366f1] bg-[#6366f1]/5 px-2 py-0.5 rounded-full">Page {match.page}</span>
                          </div>
                          <p className="text-[11px] text-[#4b5563] italic line-clamp-2 leading-relaxed">
                            {match.snippet}
                          </p>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8 bg-[#f8fafc] border border-dashed border-[#eaedf3] rounded-xl">
                        <p className="text-[11px] text-[#6b7280]">No text matches found in this document.</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </div>

            <div className="p-5 border-t border-[#eaedf3] space-y-3">
              <button 
                disabled={isActionDisabled() || isProcessing}
                onClick={async () => {
                  if (selectedTool === 'merge-pdf' || selectedTool === 'image-to-pdf' || selectedTool === 'docx-to-pdf' || selectedTool === 'jpg-to-png' || selectedTool === 'find-pdf') {
                    setIsProcessing(true);
                    try {
                      const formData = new FormData();
                      let fileKey = 'file';
                      if (selectedTool === 'merge-pdf') fileKey = 'pdfs';
                      else if (selectedTool === 'image-to-pdf') fileKey = 'images';
                      else if (selectedTool === 'docx-to-pdf') fileKey = 'docx';
                      else if (selectedTool === 'jpg-to-png') fileKey = 'images';
                      else if (selectedTool === 'find-pdf') fileKey = 'pdf';

                      fileList.forEach(file => formData.append(fileKey, file));
                      
                      if (selectedTool === 'find-pdf') {
                        formData.append('searchTerm', findOptions.searchTerm);
                      }
                      
                      const apiUrl = `/api/convert/${selectedTool}`;
                      const response = await fetch(apiUrl, {
                        method: 'POST',
                        body: formData,
                      });

                      if (!response.ok) {
                        const err = await response.json().catch(() => ({}));
                        throw new Error(err.error || `Failed to process: ${selectedTool}`);
                      }

                      const data = await response.json();
                      
                      if (selectedTool === 'find-pdf') {
                        setFindResults(data);
                        showToast(`Found ${data.matchCount} matches!`, 'success');
                        
                        const blob = await (await fetch(`data:application/pdf;base64,${data.pdfBase64}`)).blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `highlighted_${fileList[0].name}`;
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(url);
                        document.body.removeChild(a);
                      } else {
                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        
                        let downloadName = 'processed.pdf';
                        if (selectedTool === 'merge-pdf') downloadName = 'merged.pdf';
                        else if (selectedTool === 'image-to-pdf') downloadName = 'converted_images.pdf';
                        else if (selectedTool === 'docx-to-pdf') downloadName = 'converted.pdf';
                        else if (selectedTool === 'jpg-to-png') downloadName = fileList.length > 1 ? 'converted_images.zip' : 'converted.png';

                        a.download = downloadName;
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(url);
                        document.body.removeChild(a);
                        showToast('File processed successfully!', 'success');
                      }
                      
                      addNotification({
                        type: 'success',
                        title: 'Conversion Complete',
                        message: `Your file is ready.`,
                        link: '/dashboard/recent'
                      });
                      window.dispatchEvent(new Event('activityUpdated'));
                      if (selectedTool !== 'find-pdf') {
                        onClose();
                        setFileList([]);
                      }
                    } catch (error) {
                      console.error('Process error:', error);
                      const msg = error instanceof Error ? error.message : 'Error processing files. Please try again.';
                      showToast(msg, 'error');
                    } finally {
                      setIsProcessing(false);
                    }
                  } else if (selectedTool === 'lock-pdf') {
                    setIsProcessing(true);
                    try {
                      const formData = new FormData();
                      formData.append('pdf', fileList[0]);
                      formData.append('password', lockOptions.password);
                      
                      const response = await fetch('/api/convert/lock-pdf', {
                        method: 'POST',
                        body: formData,
                      });

                      if (!response.ok) {
                        throw new Error(`Failed to process: ${selectedTool}`);
                      }

                      const blob = await response.blob();
                      const url = window.URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'locked.pdf';
                      document.body.appendChild(a);
                      a.click();
                      window.URL.revokeObjectURL(url);
                      document.body.removeChild(a);
                      
                      showToast('PDF locked successfully!', 'success');
                      addNotification({
                        type: 'success',
                        title: 'Lock Complete',
                        message: 'Your PDF has been successfully password protected.',
                        link: '/dashboard/recent'
                      });
                      window.dispatchEvent(new Event('activityUpdated'));
                      onClose();
                      setFileList([]);
                      setLockOptions({ password: '', confirmPassword: '' });
                    } catch (error) {
                      console.error('Process error:', error);
                      showToast('Error locking PDF. Please try again.', 'error');
                    } finally {
                      setIsProcessing(false);
                    }
                  } else if (selectedTool === 'split-pdf') {
                    setIsProcessing(true);
                    try {
                      const formData = new FormData();
                      formData.append('pdf', fileList[0]);
                      formData.append('startPage', splitOptions.startPage.toString());
                      formData.append('endPage', splitOptions.endPage.toString());
                      formData.append('splitEvery', splitOptions.splitEvery.toString());
                      
                      const response = await fetch('/api/convert/split-pdf', {
                        method: 'POST',
                        body: formData,
                      });

                      if (!response.ok) {
                        throw new Error(`Failed to process: ${selectedTool}`);
                      }

                      const blob = await response.blob();
                      const url = window.URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      const isZip = response.headers.get('Content-Type') === 'application/zip';
                      a.download = isZip ? 'split_documents.zip' : `split_document_pages_${splitOptions.startPage}_to_${splitOptions.endPage}.pdf`;
                      document.body.appendChild(a);
                      a.click();
                      window.URL.revokeObjectURL(url);
                      document.body.removeChild(a);
                      
                      showToast('PDF split successfully!', 'success');
                      window.dispatchEvent(new Event('activityUpdated'));
                      onClose();
                      setFileList([]);
                      setSplitOptions({ startPage: 1, endPage: 1, splitEvery: false });
                    } catch (error) {
                      console.error('Process error:', error);
                      showToast('Error splitting PDF. Please try again.', 'error');
                    } finally {
                      setIsProcessing(false);
                    }
                  } else if (selectedTool === 'html-to-pdf') {
                    setIsProcessing(true);
                    try {
                      let response: Response;

                      if (htmlOptions.mode === 'url') {
                        response = await fetch('/api/convert/html-to-pdf', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ url: htmlOptions.url }),
                        });
                      } else {
                        const formData = new FormData();
                        formData.append('html', fileList[0]);
                        response = await fetch('/api/convert/html-to-pdf', {
                          method: 'POST',
                          body: formData,
                        });
                      }

                      if (!response.ok) {
                        const err = await response.json().catch(() => ({}));
                        throw new Error(err.error || 'Failed to convert HTML to PDF');
                      }

                      const disposition = response.headers.get('Content-Disposition') || '';
                      const nameMatch = disposition.match(/filename="(.+?)"/);
                      const downloadName = nameMatch ? nameMatch[1] : 'converted.pdf';

                      const blob = await response.blob();
                      const url = window.URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = downloadName;
                      document.body.appendChild(a);
                      a.click();
                      window.URL.revokeObjectURL(url);
                      document.body.removeChild(a);

                      showToast('HTML converted to PDF successfully!', 'success');
                      window.dispatchEvent(new Event('activityUpdated'));
                      onClose();
                      setFileList([]);
                      setHtmlOptions({ url: '', mode: 'file' });
                    } catch (error) {
                      console.error('HTML to PDF error:', error);
                      const msg = error instanceof Error ? error.message : 'Error converting HTML to PDF.';
                      showToast(msg, 'error');
                    } finally {
                      setIsProcessing(false);
                    }
                  } else {
                    showToast('Processing started.', 'success');
                  }
                }}
                className={`w-full h-10 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                  selectedTool && !isProcessing
                    ? 'bg-[#6366f1] text-white hover:bg-[#4f46e5] shadow-sm shadow-[#6366f1]/20' 
                    : 'bg-[#f3f4f6] text-[#9ca3af] cursor-not-allowed'
                }`}
              >
                {isProcessing ? (
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-[#9ca3af]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                  </svg>
                )}
                {isProcessing ? 'Processing...' : 'Process File'}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
