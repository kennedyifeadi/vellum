"use client";

import React, { useState, useRef, useMemo } from 'react';
import { useDashboard } from '@/app/dashboard/layout';

const categories = [
  { id: 'getting-started', title: 'Getting Started', description: 'New here? Learn the basics of Vellum.', icon: 'M13 10V3L4 14h7v7l9-11h-7z', color: 'bg-blue-50 text-blue-600' },
  { id: 'pdf-tools', title: 'PDF Tools', description: 'Master merging, splitting, and locking PDFs.', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', color: 'bg-red-50 text-red-600' },
  { id: 'account', title: 'Account & Privacy', description: 'Manage your profile and data security.', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z', color: 'bg-emerald-50 text-emerald-600' },
  { id: 'billing', title: 'Billing', description: 'Questions about Pro plans and invoices.', icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z', color: 'bg-amber-50 text-amber-600' },
  { id: 'storage', title: 'Storage', description: 'Understanding limits and file auto-deletion.', icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4', color: 'bg-indigo-50 text-indigo-600' },
  { id: 'api', title: 'API & Developers', description: 'Technical guides for Vellum integrations.', icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4', color: 'bg-slate-50 text-slate-600' },
];

const faqsData = [
  // Getting Started
  { q: "How do I start using Vellum?", a: "Simply upload your PDF or image files to the dashboard. You can then use our tools like 'Merge PDF' or 'Split PDF' to process them instantly.", category: 'getting-started' },
  { q: "Is Vellum free to use?", a: "Yes, we offer a generous free tier that includes up to 5 conversions per day. For unlimited processing and larger file limits, check out our Pro plans.", category: 'getting-started' },
  
  // PDF Tools
  { q: "What is the maximum file size for conversion?", a: "Free tier users can upload files up to 50MB. Pro users enjoy an increased limit of up to 100MB per file.", category: 'pdf-tools' },
  { q: "Can I merge more than two PDFs?", a: "Absolutely! Our Merge tool allows you to combine multiple PDF files into a single document in just seconds.", category: 'pdf-tools' },
  
  // Storage
  { q: "How long are my staged files kept?", a: "To ensure your privacy and manage storage, files are automatically deleted after 3 days for Free users and 5 days for Pro users.", category: 'storage' },
  { q: "Where can I find my converted files?", a: "Your recently converted files are available in the 'Recent Files' section of your dashboard for a limited time.", category: 'storage' },
  
  // Billing
  { q: "Can I cancel my Pro subscription at any time?", a: "Yes, you can cancel your subscription from the Billing section in your account settings at any time without any penalties.", category: 'billing' },
  { q: "Do you offer refunds?", a: "We offer a 7-day money-back guarantee if you are not satisfied with our Pro features. Please contact support for assistance.", category: 'billing' },
  
  // Account
  { q: "How do I update my profile picture?", a: "Go to Preferences > Profile and click on your current avatar to upload a new image. Supported formats include JPG, PNG, and GIF.", category: 'account' },
  
  // API
  { q: "Do you have a developer API?", a: "We are currently in private beta for our Developer API. If you're interested in building with Vellum, please submit a support ticket.", category: 'api' },
];

export default function HelpPage() {
  const { showToast } = useDashboard();
  const [search, setSearch] = useState('');
  const [activeSearchTerm, setActiveSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const faqRef = useRef<HTMLElement>(null);

  const [formData, setFormData] = useState({
    subject: '',
    category: 'general',
    message: '',
  });

  // Filter Logic
  const filteredFaqs = useMemo(() => {
    return faqsData.filter(faq => {
      const matchesSearch = 
        faq.q.toLowerCase().includes(activeSearchTerm.toLowerCase()) || 
        faq.a.toLowerCase().includes(activeSearchTerm.toLowerCase());
      const matchesCategory = !selectedCategory || faq.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [activeSearchTerm, selectedCategory]);

  const handleSearchTrigger = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setActiveSearchTerm(search);
    setSelectedCategory(null); // Clear category filter when performing a global search
    
    // Small delay to allow React to render the filtered list before scrolling
    setTimeout(() => {
      faqRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  const handleTopicClick = (categoryId: string) => {
    setSelectedCategory(categoryId);
    setSearch(''); 
    setActiveSearchTerm(''); // Clear search when picking a category
    faqRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);
    try {
      const res = await fetch('/api/support/ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        showToast('Support ticket submitted successfully!', 'success');
        setFormData({ subject: '', category: 'general', message: '' });
      } else {
        const error = await res.json();
        showToast(error.error || 'Failed to submit ticket', 'error');
      }
    } catch {
      showToast('Error submitting support ticket', 'error');
    } finally {
      setFormLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#fbfcfd]">
      <header className="px-8 py-10 bg-white border-b border-[#eaedf3] text-center">
        <h1 className="text-3xl font-extrabold text-[#111827]">Help Center</h1>
        <p className="text-[#6b7280] mt-2 text-sm">Find answers, learn about Vellum, or get in touch with our team.</p>
        
        <form onSubmit={handleSearchTrigger} className="max-w-2xl mx-auto mt-8 relative group">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-[#9ca3af] group-focus-within:text-[#6366f1] transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          </div>
          <input 
            type="text" 
            placeholder="Search for help topics..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-14 pl-12 pr-32 bg-[#f8fafc] border border-[#eaedf3] rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6366f1]/20 focus:border-[#6366f1] transition-all"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
            {search && (
              <button 
                type="button"
                onClick={() => {setSearch(''); setActiveSearchTerm('');}}
                className="p-2 text-[#9ca3af] hover:text-[#6366f1] transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            )}
            <button 
              type="submit"
              className="h-10 px-6 bg-[#6366f1] text-white text-xs font-bold rounded-lg hover:bg-[#4f46e5] transition-all shadow-md shadow-indigo-500/10"
            >
              Search
            </button>
          </div>
        </form>
      </header>

      <main className="flex-1 overflow-y-auto p-8 space-y-16 pb-24">
        {/* Categories Grid */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-wider">Browse by Topic</h2>
              {selectedCategory && (
                <button 
                  onClick={() => setSelectedCategory(null)}
                  className="text-[10px] font-bold text-[#6366f1] hover:underline flex items-center gap-1"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                  Clear filter
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {categories.map((cat) => {
              const isActive = selectedCategory === cat.id;
              return (
                <button 
                  key={cat.id} 
                  onClick={() => handleTopicClick(cat.id)}
                  className={`bg-white border p-6 rounded-2xl text-left transition-all group relative overflow-hidden ${
                    isActive 
                      ? 'border-[#6366f1] shadow-lg shadow-indigo-500/10 ring-1 ring-[#6366f1]' 
                      : 'border-[#eaedf2] hover:border-[#6366f1] hover:shadow-md'
                  }`}
                >
                  {isActive && (
                    <div className="absolute top-0 right-0 p-2">
                       <div className="w-2 h-2 rounded-full bg-[#6366f1]"></div>
                    </div>
                  )}
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${cat.color} group-hover:scale-110 transition-transform`}>
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d={cat.icon}/></svg>
                  </div>
                  <h3 className="text-sm font-bold text-[#111827] mb-1">{cat.title}</h3>
                  <p className="text-[12px] text-[#6b7280] leading-relaxed line-clamp-2">{cat.description}</p>
                </button>
              );
            })}
          </div>
        </section>

        {/* FAQs and Support Form */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 pt-4">
          {/* FAQ Section */}
          <section ref={faqRef} className="space-y-6 scroll-mt-8">
            <div className="flex items-center justify-between">
              <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-wider">
                {selectedCategory 
                  ? `FAQs: ${categories.find(c => c.id === selectedCategory)?.title}` 
                  : 'Frequently Asked Questions'}
              </h2>
              <span className="text-[10px] font-bold text-[#9ca3af]">{filteredFaqs.length} results</span>
            </div>
            <div className="space-y-3">
              {filteredFaqs.length > 0 ? (
                filteredFaqs.map((faq, idx) => (
                  <div key={idx} className="bg-white border border-[#eaedf3] rounded-2xl overflow-hidden transition-all hover:border-[#c7d2fe]">
                    <button 
                      onClick={() => setExpandedFaq(expandedFaq === idx ? null : idx)}
                      className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-[#fafbff] transition-colors"
                    >
                      <span className="text-xs font-bold text-[#111827] pr-4">{faq.q}</span>
                      <svg className={`w-4 h-4 text-[#9ca3af] shrink-0 transition-transform ${expandedFaq === idx ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/></svg>
                    </button>
                    {expandedFaq === idx && (
                      <div className="px-6 py-4 text-[12px] text-[#6b7280] leading-relaxed border-t border-[#eaedf3] bg-[#fdfdff] animate-in fade-in slide-in-from-top-2 duration-300">
                        {faq.a}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="bg-white border border-dashed border-[#eaedf3] rounded-2xl p-12 text-center">
                  <div className="w-12 h-12 bg-[#f8fafc] rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-6 h-6 text-[#9ca3af]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                  </div>
                  <h3 className="text-sm font-bold text-[#111827]">No results found</h3>
                  <p className="text-xs text-[#6b7280] mt-1 max-w-[240px] mx-auto">We couldn&apos;t find any FAQs matching your search. Try adjusting your terms or category.</p>
                  <button 
                    onClick={() => {setSearch(''); setSelectedCategory(null);}}
                    className="mt-4 text-xs font-bold text-[#6366f1] hover:underline"
                  >
                    Clear all filters
                  </button>
                </div>
              )}
            </div>
            <div className="bg-linear-to-br from-indigo-50/80 to-blue-50/40 rounded-2xl p-6 border border-indigo-100/50">
              <p className="text-xs font-medium text-[#4f46e5]/80 text-center italic leading-relaxed">
                &quot;Finding answers should be as easy as processing a document. We&apos;re here to help.&quot;
              </p>
            </div>
          </section>

          {/* Support Ticket Section */}
          <section className="space-y-6">
            <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-wider">Direct Support</h2>
            <div className="bg-white border border-[#eaedf3] rounded-2xl p-8 shadow-sm">
              <div className="mb-8">
                <h3 className="text-base font-bold text-[#111827]">Submit a Ticket</h3>
                <p className="text-xs text-[#6b7280] mt-1">Expected response time: Within 24-48 hours</p>
              </div>

              <form onSubmit={handleFormSubmit} className="space-y-5">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-[#111827] uppercase tracking-wider">Subject</label>
                  <input 
                    type="text" 
                    required
                    value={formData.subject}
                    onChange={(e) => setFormData({...formData, subject: e.target.value})}
                    placeholder="Brief summary of your issue"
                    className="w-full h-11 px-4 rounded-xl border border-[#eaedf3] bg-[#f8fafc] text-xs focus:outline-none focus:ring-1 focus:ring-[#6366f1] focus:border-[#6366f1] transition-all"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-[#111827] uppercase tracking-wider">Category</label>
                  <select 
                    required
                    value={formData.category}
                    onChange={(e) => setFormData({...formData, category: e.target.value})}
                    className="w-full h-11 px-4 rounded-xl border border-[#eaedf3] bg-[#f8fafc] text-xs focus:outline-none focus:ring-1 focus:ring-[#6366f1] focus:border-[#6366f1] transition-all appearance-none"
                  >
                    <option value="general">General Inquiry</option>
                    <option value="technical">Technical Issue</option>
                    <option value="billing">Billing & Subscription</option>
                    <option value="feature_request">Feature Request</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-[#111827] uppercase tracking-wider">Message</label>
                  <textarea 
                    required
                    value={formData.message}
                    onChange={(e) => setFormData({...formData, message: e.target.value})}
                    placeholder="Tell us more about what's going on..."
                    rows={4}
                    className="w-full px-4 py-3 rounded-xl border border-[#eaedf3] bg-[#f8fafc] text-xs focus:outline-none focus:ring-1 focus:ring-[#6366f1] focus:border-[#6366f1] transition-all resize-none"
                  ></textarea>
                </div>

                <button 
                  type="submit"
                  disabled={formLoading}
                  className="w-full h-11 bg-[#6366f1] text-white text-xs font-bold rounded-xl hover:bg-[#4f46e5] disabled:opacity-50 transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#6366f1]/20"
                >
                  {formLoading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : null}
                  Send Message
                </button>
              </form>

              <div className="mt-8 pt-8 border-t border-[#eaedf3] text-center">
                <p className="text-[11px] text-[#6b7280]">Prefer email? Contact us directly at</p>
                <a href="mailto:support@vellum.com" className="text-xs font-bold text-[#6366f1] hover:underline mt-1 block">support@vellum.com</a>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
