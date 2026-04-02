import React from 'react';

export type Tool = {
  id: string;
  title: string;
  desc: string;
  icon: React.ReactNode;
  color: string;
  bgColor?: string;
  iconColor?: string;
  categories?: string[];
};

export const ALL_TOOLS: Tool[] = [
  { 
    id: 'image-to-pdf', 
    title: 'Image to PDF', 
    desc: 'Convert JPG/PNG to PDF',
    categories: ['Images', 'PDF'],
    bgColor: 'bg-[#FFE4E6]',
    iconColor: 'text-[#e11d48]',
    color: 'bg-[#FFEDD5] text-[#ef4444]',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 21" />
      </svg>
    )
  },
  { 
    id: 'merge-pdf', 
    title: 'Merge PDF', 
    desc: 'Combine multiple PDFs',
    categories: ['PDF'],
    bgColor: 'bg-[#DBEAFE]',
    iconColor: 'text-[#2563EB]',
    color: 'bg-[#DBEAFE] text-[#22c55e]',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M16 13a4 4 0 11-8 0 4 4 0 018 0z" />
        <path d="M12 9v8" />
      </svg>
    )
  },
  { 
    id: 'split-pdf', 
    title: 'Split PDF', 
    desc: 'Extract pages instantly',
    categories: ['PDF'],
    bgColor: 'bg-[#F3E8FF]',
    iconColor: 'text-[#d946ef]',
    color: 'bg-[#F3E8FF] text-[#d946ef]',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 6h18M3 12h18M3 18h18" />
        <path d="M5 6v12M19 6v12" />
      </svg>
    )
  },
  { 
    id: 'docx-to-pdf', 
    title: 'DOCX to PDF', 
    desc: 'Word to high-res PDF',
    categories: ['Documents', 'PDF'],
    bgColor: 'bg-[#E0E7FF]',
    iconColor: 'text-[#4f46e5]',
    color: 'bg-[#E0E7FF] text-[#3b82f6]',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
      </svg>
    )
  },
  { 
    id: 'lock-pdf', 
    title: 'Lock PDF', 
    desc: 'Add password protection',
    categories: ['PDF', 'Security'],
    bgColor: 'bg-[#D1FAE5]',
    iconColor: 'text-[#eab308]',
    color: 'bg-[#D1FAE5] text-[#eab308]',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0110 0v4" />
      </svg>
    )
  },
  { 
    id: 'compress-pdf', 
    title: 'Compress PDF', 
    desc: 'Reduce file size',
    categories: ['PDF'],
    bgColor: 'bg-[#E0E7FF]',
    iconColor: 'text-[#4f46e5]',
    color: 'bg-[#E0E7FF] text-[#4f46e5]',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 14l8-8 8 8" />
        <path d="M12 6v12" />
      </svg>
    )
  },
  { 
    id: 'find-pdf', 
    title: 'Find in PDF', 
    desc: 'Search text strings',
    categories: ['PDF'],
    bgColor: 'bg-[#FFEDD5]',
    iconColor: 'text-[#ea580c]',
    color: 'bg-[#FFEDD5] text-[#ea580c]',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
        <path d="M12 11h.01" />
      </svg>
    )
  },
  { 
    id: 'html-to-pdf', 
    title: 'HTML to PDF', 
    desc: 'Webpage to document',
    categories: ['Documents', 'PDF'],
    bgColor: 'bg-[#FFFBEB]',
    iconColor: 'text-[#d97706]',
    color: 'bg-[#FFFBEB] text-[#d97706]',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
      </svg>
    )
  },
  { 
    id: 'jpg-to-png', 
    title: 'JPEG to PNG', 
    desc: 'Image format swap',
    categories: ['Images'],
    bgColor: 'bg-[#ECFDF5]',
    iconColor: 'text-[#10b981]',
    color: 'bg-[#ECFDF5] text-[#10b981]',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M16 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-5" />
        <path d="M14 6L9 11v11" />
        <path d="M21 3l-5 5-5-5" />
      </svg>
    )
  }
];
