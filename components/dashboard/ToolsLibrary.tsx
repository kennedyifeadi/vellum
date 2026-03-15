"use client";

import { useState } from 'react';
import { motion } from 'framer-motion';

// Define the tool type
type Tool = {
  id: string;
  name: string;
  description: string;
  categories: string[];
  icon: React.ReactNode;
  bgColor: string;
  iconColor: string;
  starred?: boolean;
};

export default function ToolsLibrary() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All Tools');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Categories list
  const categories = ['All Tools', 'PDF', 'Images', 'Documents', 'Security'];

  // Tools data based on User's working list
  const tools: Tool[] = [
    {
      id: 'merge-pdf',
      name: 'Merge PDF',
      description: 'Combine multiple PDF files into a single document.',
      categories: ['PDF'],
      bgColor: 'bg-[#DBEAFE]',
      iconColor: 'text-[#2563EB]',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M16 13a4 4 0 11-8 0 4 4 0 018 0z" />
          <path d="M12 9v8" />
        </svg>
      ),
    },
    {
      id: 'split-pdf',
      name: 'Split PDF',
      description: 'Divide a PDF into individual pages or specific ranges.',
      categories: ['PDF'],
      bgColor: 'bg-[#F3E8FF]',
      iconColor: 'text-[#d946ef]',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 6h18M3 12h18M3 18h18" />
          <path d="M5 6v12M19 6v12" />
        </svg>
      ),
    },
    {
      id: 'lock-pdf',
      name: 'Lock PDF',
      description: 'Add password protection to any PDF file.',
      categories: ['PDF', 'Security'],
      bgColor: 'bg-[#D1FAE5]',
      iconColor: 'text-[#eab308]',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0110 0v4" />
        </svg>
      ),
    },
    {
      id: 'find-pdf',
      name: 'Find in PDF',
      description: 'Search for specific text strings within a PDF.',
      categories: ['PDF'],
      bgColor: 'bg-[#FFEDD5]',
      iconColor: 'text-[#ea580c]',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
          <path d="M12 11h.01" />
        </svg>
      ),
    },
    {
      id: 'img-to-pdf',
      name: 'Image to PDF',
      description: 'Convert one or more images into a single PDF.',
      categories: ['Images', 'PDF'],
      bgColor: 'bg-[#FFE4E6]',
      iconColor: 'text-[#e11d48]',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
      ),
    },
    {
      id: 'jpg-to-png',
      name: 'JPEG to PNG',
      description: 'Change the format of a JPEG image to transparent PNG.',
      categories: ['Images'],
      bgColor: 'bg-[#ECFDF5]',
      iconColor: 'text-[#10b981]',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M16 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-5" />
          <path d="M14 6L9 11v11" />
          <path d="M21 3l-5 5-5-5" />
        </svg>
      ),
    },
    {
      id: 'docx-to-pdf',
      name: 'DOCX to PDF',
      description: 'Convert Microsoft Word documents into professional PDFs.',
      categories: ['Documents', 'PDF'],
      bgColor: 'bg-[#E0E7FF]',
      iconColor: 'text-[#4f46e5]',
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
        </svg>
      ),
    },
    {
      id: 'html-to-pdf',
      name: 'HTML to PDF',
      description: 'Convert raw HTML code or a live website URL into a PDF.',
      categories: ['Documents', 'PDF'],
      bgColor: 'bg-[#FFFBEB]',
      iconColor: 'text-[#d97706]',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
        </svg>
      ),
    },
  ];

  // Filter logic
  const filteredTools = tools.filter(tool => {
    const matchesSearch = tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         tool.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = activeCategory === 'All Tools' || tool.categories.includes(activeCategory);
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="flex flex-col h-full bg-[#f8fafc] p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#111827]">Tools Library</h1>
          <p className="text-xs text-[#6b7280]">Manage, convert, and edit your files with ease.</p>
        </div>
        
        {/* Search Bar */}
        <div className="relative w-64">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9ca3af]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search for a tool..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-10 pl-9 pr-3 rounded-xl border border-[#eaedf3] bg-white text-xs text-[#1f2937] placeholder-[#9ca3af] focus:outline-none focus:ring-1 focus:ring-[#6366f1] focus:border-[#6366f1]"
          />
        </div>
      </div>

      {/* Tabs / Filters */}
      <div className="flex items-center gap-2 mb-6 border-b border-[#eaedf3] pb-4">
        {categories.map((category) => (
          <button
            key={category}
            onClick={() => setActiveCategory(category)}
            className={`h-8 px-4 rounded-full text-xs font-medium transition-all ${
              activeCategory === category
                ? 'bg-[#6366f1] text-white'
                : 'bg-white text-[#4b5563] border border-[#eaedf3] hover:bg-[#f3f4f6]'
            }`}
          >
            {category}
          </button>
        ))}
      </div>

      {/* Available Tools Header with View Toggle */}
      <div className="flex justify-between items-center mb-4">
        <p className="font-bold text-xs text-[#9ca3af] uppercase tracking-wider">Available Tools</p>
        <div className="flex items-center gap-1">
          <button 
            onClick={() => setViewMode('grid')}
            className={`p-1.5 rounded-lg ${viewMode === 'grid' ? 'bg-[#eef2ff] text-[#4f46e5]' : 'text-[#6b7280] hover:bg-[#f3f4f6]'}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6z M14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6z M4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2z M14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          </button>
          <button 
            onClick={() => setViewMode('list')}
            className={`p-1.5 rounded-lg ${viewMode === 'list' ? 'bg-[#eef2ff] text-[#4f46e5]' : 'text-[#6b7280] hover:bg-[#f3f4f6]'}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Tools Grid / List */}
      <div className={`grid ${viewMode === 'grid' ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4' : 'grid-cols-1'} gap-4`}>
        {filteredTools.map((tool) => (
          <motion.button
            key={tool.id}
            whileHover={{ y: -4, boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}
            className={`bg-white border border-[#eaedf3] rounded-2xl p-5 flex ${
              viewMode === 'grid' ? 'flex-col items-start' : 'items-center gap-4'
            } gap-4 hover:border-[#e0e7ff] text-left transition-all cursor-pointer shadow-[0_1px_4px_rgba(0,0,0,0.01)] relative`}
          >
            {/* Star Icon */}
            <div className="absolute top-4 right-4 text-[#9ca3af] hover:text-[#fbbf24] cursor-pointer">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.364 1.118l1.518 4.674c.3.921-.755 1.688-1.54 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.784.57-1.838-.197-1.539-1.118l1.518-4.674a1 1 0 00-.364-1.118L2.493 10.1c-.783-.57-.381-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            </div>

            <div className={`w-10 h-10 ${tool.bgColor} ${tool.iconColor} rounded-xl flex items-center justify-center text-lg`}>
              {tool.icon}
            </div>
            <div>
              <p className="text-sm font-bold text-[#111827]">{tool.name}</p>
              <p className="text-xs text-[#6b7280] mt-1 leading-normal">{tool.description}</p>
            </div>
          </motion.button>
        ))}
      </div>

      {/* No Results State */}
      {filteredTools.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12">
          <p className="text-sm font-medium text-[#4b5563]">No tools found</p>
          <p className="text-xs text-[#6b7280] mt-1">Try searching for something else or change filters.</p>
        </div>
      )}

      {/* Load More Button */}
      {filteredTools.length > 0 && (
        <div className="flex justify-center mt-8">
          <button className="h-10 px-6 rounded-xl border border-[#eaedf3] bg-white text-xs font-semibold text-[#4b5563] hover:bg-[#f3f4f6] transition-colors">
            Load More Tools
          </button>
        </div>
      )}
    </div>
  );
}
