"use client";

import React, { useState } from 'react';
import { useDashboard } from '@/app/dashboard/layout';

const categories = [
  { id: 'getting-started', title: 'Getting Started', description: 'New here? Learn the basics of Vellum.', icon: 'M13 10V3L4 14h7v7l9-11h-7z', color: 'bg-blue-50 text-blue-600' },
  { id: 'pdf-tools', title: 'PDF Tools', description: 'Master merging, splitting, and locking PDFs.', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', color: 'bg-red-50 text-red-600' },
  { id: 'account', title: 'Account & Privacy', description: 'Manage your profile and data security.', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z', color: 'bg-emerald-50 text-emerald-600' },
  { id: 'billing', title: 'Billing', description: 'Questions about Pro plans and invoices.', icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z', color: 'bg-amber-50 text-amber-600' },
  { id: 'storage', title: 'Storage', description: 'Understanding limits and file auto-deletion.', icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4', color: 'bg-indigo-50 text-indigo-600' },
  { id: 'api', title: 'API & Developers', description: 'Technical guides for Vellum integrations.', icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4', color: 'bg-slate-50 text-slate-600' },
];

const faqs = [
  { q: "How long are my staged files kept?", a: "To ensure your privacy and manage storage, files are automatically deleted after 3 days for Free users and 5 days for Pro users." },
  { q: "What is the maximum file size for conversion?", a: "Currently, our free tier supports files up to 10MB. Pro users can process files up to 100MB." },
  { q: "Can I cancel my Pro subscription at any time?", a: "Yes, you can cancel your subscription from the Billing section in your account settings at any time." },
  { q: "Where can I find my converted files?", a: "Your recently converted files are available in the 'Recent Files' section of your dashboard for a limited time." },
];

export default function HelpPage() {
  const { showToast } = useDashboard();
  const [search, setSearch] = useState('');
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  const [formData, setFormData] = useState({
    subject: '',
    category: 'general',
    message: '',
  });

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
        <p className="text-[#6b7280] mt-2">Find answers, learn about Vellum, or get in touch with our team.</p>
        
        <div className="max-w-2xl mx-auto mt-8 relative group">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-[#9ca3af] group-focus-within:text-[#6366f1] transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          </div>
          <input 
            type="text" 
            placeholder="Search for help topics..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-14 pl-12 pr-4 bg-[#f8fafc] border border-[#eaedf3] rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6366f1]/20 focus:border-[#6366f1] transition-all"
          />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-8 space-y-16 pb-24">
        {/* Categories Grid */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-wider">Browse by Topic</h2>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span className="text-[11px] font-bold text-[#111827]">Systems Operational</span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {categories.map((cat) => (
              <button key={cat.id} className="bg-white border border-[#eaedf3] p-6 rounded-2xl text-left hover:border-[#6366f1] hover:shadow-lg hover:shadow-indigo-500/5 transition-all group">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${cat.color} group-hover:scale-110 transition-transform`}>
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d={cat.icon}/></svg>
                </div>
                <h3 className="text-sm font-bold text-[#111827] mb-1">{cat.title}</h3>
                <p className="text-[12px] text-[#6b7280] leading-relaxed">{cat.description}</p>
              </button>
            ))}
          </div>
        </section>

        {/* FAQs and Support Form */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          {/* FAQ Section */}
          <section className="space-y-6">
            <h2 className="text-[11px] font-bold text-[#9ca3af] uppercase tracking-wider">Frequently Asked Questions</h2>
            <div className="space-y-3">
              {faqs.map((faq, idx) => (
                <div key={idx} className="bg-white border border-[#eaedf3] rounded-2xl overflow-hidden transition-all">
                  <button 
                    onClick={() => setExpandedFaq(expandedFaq === idx ? null : idx)}
                    className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-[#f8fafc] transition-colors"
                  >
                    <span className="text-xs font-bold text-[#111827]">{faq.q}</span>
                    <svg className={`w-4 h-4 text-[#9ca3af] transition-transform ${expandedFaq === idx ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/></svg>
                  </button>
                  {expandedFaq === idx && (
                    <div className="px-6 py-4 text-[12px] text-[#6b7280] leading-relaxed border-t border-[#eaedf3] animate-in fade-in slide-in-from-top-2 duration-300">
                      {faq.a}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="bg-indigo-50/50 rounded-2xl p-6 border border-indigo-100/50">
              <p className="text-xs font-medium text-[#4f46e5] text-center italic">"The simplest way to manage your documents, supported by a team that cares."</p>
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
