import { motion } from 'framer-motion';
import { useRef } from 'react';
import { useDashboard } from '@/app/dashboard/layout';

export default function DragAndDrop() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { openDrawer, showToast } = useDashboard();

  const handleAreaClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate size (50MB max for Free Trial)
    const MAX_SIZE = 50 * 1024 * 1024; // 50MB
    if (file.size > MAX_SIZE) {
      showToast("File size exceeds 50MB free limit. Please upgrade or use a smaller file.", "error");
      return;
    }

    openDrawer(file, null); // General upload layout without predefined tool id bounds framing node isolates.
    // Reset input for subsequent clicks isolates bounds.
    e.target.value = '';
  };

  return (
    <motion.div 
      onClick={handleAreaClick}
      whileHover={{ scale: 1.005, opacity: 0.98 }}
      className="w-full h-56 border-2 border-dashed border-[#6366f1] rounded-2xl flex flex-col items-center justify-center gap-2 cursor-pointer transition-all bg-[#fbfcfd] hover:bg-[#f8fafc] group"
    >
      {/* Invisible File Input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        className="hidden" 
        accept=".pdf,.docx,.doc,.jpg,.jpeg,.png"
      />

      <div className="w-12 h-12 rounded-full bg-[#f0f2fe] flex items-center justify-center text-[#4f46e5] group-hover:scale-110 transition-transform">
        <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-[#111827]">Drag & Drop files here</p>
      <p className="text-[11px] text-[#6b7280]">Support for PDF, DOCX, JPG, PNG and more. Max file size 50MB.</p>
      <div className="flex gap-2 mt-2">
        <button className="h-8 px-4 bg-[#6366f1] text-white text-xs font-medium rounded-lg shadow-sm shadow-[#6366f1]/20 hover:bg-[#4f46e5] transition-colors pointer-events-none">
          + Upload File
        </button>
        <button className="h-8 px-4 border border-[#e2e8f0] bg-white text-xs font-medium rounded-lg hover:bg-[#f9fafb] transition-colors pointer-events-none">
          Browse Drive
        </button>
      </div>
    </motion.div>
  );
}

