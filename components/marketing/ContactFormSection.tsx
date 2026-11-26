'use client';

import React, { useState } from 'react';
import { AuthInput } from '@/components/auth/AuthComponents';

export default function ContactFormSection() {
  const [formData, setFormData] = useState({
    guestName: '',
    guestEmail: '',
    subject: '',
    message: ''
  });
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setErrorMessage('');

    try {
      const res = await fetch('/api/support/ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          category: 'general'
        }),
      });

      if (res.ok) {
        setStatus('success');
        setFormData({ guestName: '', guestEmail: '', subject: '', message: '' });
      } else {
        const errorData = await res.json();
        setErrorMessage(errorData.error || 'Failed to send message.');
        setStatus('error');
      }
    } catch {
      setErrorMessage('An unexpected error occurred. Please try again.');
      setStatus('error');
    }
  };

  return (
    <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-8 items-start py-12">
      
      {/* ── Left Column: Contact Info ── */}
      <div className="flex flex-col pr-0 lg:pr-12">
        <span className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">/ get in touch /</span>
        <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-gray-900 mb-6 leading-tight">
          We are always ready to help you and answer your questions
        </h2>
        <p className="text-gray-600 mb-12 leading-relaxed">
          Whether you need help with a complex PDF conversion, want to discuss enterprise features, or have feedback on our tools, our team is here to assist you.
        </p>
      </div>

      {/* ── Right Column: Form Card ── */}
      <div id="get-in-touch" className="bg-[#f8f9fa] rounded-3xl p-8 sm:p-12 border border-gray-100">
        <h3 className="text-2xl font-bold text-gray-900 mb-3">Get in Touch</h3>
        <p className="text-sm text-gray-600 mb-8">
          Let us know what you need help with, and our team will get back to you as soon as possible.
        </p>

        {status === 'success' ? (
          <div className="bg-green-50 border border-green-200 text-green-800 rounded-xl p-6 text-center">
            <svg className="w-12 h-12 text-green-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <h4 className="font-bold text-lg mb-2">Message Sent!</h4>
            <p className="text-sm">We&apos;ve received your message and will be in touch shortly.</p>
            <button 
              onClick={() => setStatus('idle')}
              className="mt-6 text-sm font-semibold text-brand-strong hover:text-brand-hover"
            >
              Send another message
            </button>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={handleSubmit}>
            <AuthInput 
              type="text" 
              placeholder="Full name" 
              required 
              value={formData.guestName}
              onChange={(e) => setFormData({...formData, guestName: e.target.value})}
            />
            <AuthInput 
              type="email" 
              placeholder="Email" 
              required 
              value={formData.guestEmail}
              onChange={(e) => setFormData({...formData, guestEmail: e.target.value})}
            />
            <AuthInput 
              type="text" 
              placeholder="Subject" 
              required 
              value={formData.subject}
              onChange={(e) => setFormData({...formData, subject: e.target.value})}
            />
            
            <textarea 
              placeholder="Message" 
              required
              rows={5}
              value={formData.message}
              onChange={(e) => setFormData({...formData, message: e.target.value})}
              className="w-full p-4 bg-[#f9fafb] border border-[#e5e7eb] rounded-xl text-ink placeholder-ink-disabled outline-none transition-all duration-200 focus:border-brand focus:ring-2 focus:ring-brand/10 hover:border-border-strong resize-none"
            ></textarea>

            {status === 'error' && (
              <p className="text-sm text-red-600 mt-2">{errorMessage}</p>
            )}

            <button 
              type="submit" 
              disabled={status === 'loading'}
              className="mt-4 flex items-center justify-center rounded-xl bg-brand-strong px-8 py-3.5 text-sm font-semibold text-on-brand hover:bg-brand-hover transition-colors shadow-sm disabled:opacity-70 gap-2"
            >
              {status === 'loading' && (
                <div className="w-4 h-4 border-2 border-on-brand border-t-transparent rounded-full animate-spin" />
              )}
              Send a message
            </button>
          </form>
        )}
      </div>

    </div>
  );
}
