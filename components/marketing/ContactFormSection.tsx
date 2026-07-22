'use client';

import React, { useState } from 'react';
import Link from 'next/link';
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
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-10">
          <div>
            <h4 className="font-bold text-gray-900 mb-2">Support Hours</h4>
            <p className="text-sm text-gray-600">Monday - Friday</p>
            <p className="text-sm text-gray-600">9:00 AM - 5:00 PM EST</p>
          </div>
          <div>
            <h4 className="font-bold text-gray-900 mb-2">Our Location</h4>
            <p className="text-sm text-gray-600">123 Tech Avenue</p>
            <p className="text-sm text-gray-600">San Francisco, CA 94105</p>
          </div>
          <div>
            <h4 className="font-bold text-gray-900 mb-2">Email</h4>
            <a href="mailto:support@vellum.com" className="text-sm text-indigo-600 hover:text-indigo-700 hover:underline">
              support@vellum.com
            </a>
          </div>
          <div>
            <h4 className="font-bold text-gray-900 mb-2">Social Network</h4>
            <div className="flex items-center gap-4 text-gray-600">
              <Link href="#" className="hover:text-gray-900 transition-colors">
                <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><path d="M24 4.557c-.883.392-1.832.656-2.828.775 1.017-.609 1.798-1.574 2.165-2.724-.951.564-2.005.974-3.127 1.195-.897-.957-2.178-1.555-3.594-1.555-3.179 0-5.515 2.966-4.797 6.045-4.091-.205-7.719-2.165-10.148-5.144-1.29 2.213-.669 5.108 1.523 6.574-.806-.026-1.566-.247-2.229-.616-.054 2.281 1.581 4.415 3.949 4.89-.693.188-1.452.232-2.224.084.626 1.956 2.444 3.379 4.6 3.419-2.07 1.623-4.678 2.348-7.29 2.04 2.179 1.397 4.768 2.212 7.548 2.212 9.142 0 14.307-7.721 13.995-14.646.962-.695 1.797-1.562 2.457-2.549z"/></svg>
              </Link>
              <Link href="#" className="hover:text-gray-900 transition-colors">
                <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/></svg>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right Column: Form Card ── */}
      <div className="bg-[#f8f9fa] rounded-3xl p-8 sm:p-12 border border-gray-100">
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
              className="mt-6 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
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
              className="w-full p-4 bg-[#f9fafb] border border-[#e5e7eb] rounded-xl text-[#111827] placeholder-[#9ca3af] outline-none transition-all duration-200 focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/10 hover:border-[#d1d5db] resize-none"
            ></textarea>

            {status === 'error' && (
              <p className="text-sm text-red-600 mt-2">{errorMessage}</p>
            )}

            <button 
              type="submit" 
              disabled={status === 'loading'}
              className="mt-4 inline-flex items-center justify-center rounded-xl bg-gray-900 px-8 py-3.5 text-sm font-semibold text-white hover:bg-gray-800 transition-colors shadow-sm disabled:opacity-70 gap-2"
            >
              {status === 'loading' && (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              Send a message
            </button>
          </form>
        )}
      </div>

    </div>
  );
}
