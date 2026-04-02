"use client";

import React, { useState, useRef, useEffect } from 'react';
import { useDashboard } from '@/app/dashboard/layout';
import Image from 'next/image';

export default function ProfileTab() {
  const { user, refreshData, showToast } = useDashboard();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  
  // Local form state
  const [fullName, setFullName] = useState(user?.name || '');
  const [currentGoal, setCurrentGoal] = useState(user?.currentGoal || '');
  const [avatar, setAvatar] = useState(user?.image || '');

  useEffect(() => {
    if (user) {
      setFullName(user.name || '');
      setCurrentGoal(user.currentGoal || '');
      setAvatar(user.image || '');
    }
  }, [user]);

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      showToast('Image too large (max 2MB)', 'error');
      return;
    }

    setUploading(true);
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64String = reader.result as string;
      try {
        const res = await fetch('/api/user/avatar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64Image: base64String }),
        });

        if (res.ok) {
          const data = await res.json();
          setAvatar(data.image);
          showToast('Avatar updated successfully', 'success');
          refreshData('all'); // Refresh global state to sync sidebar/header
        } else {
          showToast('Failed to update avatar', 'error');
        }
      } catch {
        showToast('Error uploading image', 'error');
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fullName, currentGoal }),
      });

      if (res.ok) {
        showToast('Profile updated successfully', 'success');
        refreshData('all');
      } else {
        const data = await res.json();
        showToast(data.error || 'Failed to update profile', 'error');
      }
    } catch {
      showToast('Error updating profile', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-8">
        <h2 className="text-xl font-bold text-[#111827]">Profile Information</h2>
        <p className="text-[13px] text-[#6b7280] mt-1">Update your photo and personal details here.</p>
      </div>

      <form onSubmit={handleSave} className="space-y-8">
        {/* Avatar Section */}
        <div className="flex items-center gap-6">
          <div className="relative group cursor-pointer" onClick={handleAvatarClick}>
            <div className="w-24 h-24 rounded-full border-4 border-white shadow-md overflow-hidden bg-[#f8fafc] flex items-center justify-center">
              {avatar ? (
                <Image src={avatar} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl font-bold text-[#6366f1]">{user?.name?.charAt(0) || 'U'}</span>
              )}
              
              {uploading && (
                <div className="absolute inset-0 bg-white/60 flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-[#6366f1] border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
            <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-full">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
            </div>
          </div>
          
          <div>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
              accept="image/*" 
              className="hidden" 
            />
            <button 
              type="button"
              onClick={handleAvatarClick}
              className="text-[13px] font-bold text-[#6366f1] hover:text-[#4f46e5] transition-colors"
            >
              Change Avatar
            </button>
            <p className="text-[11px] text-[#9ca3af] mt-1 uppercase tracking-wider font-bold">JPG, PNG or GIF. Max size of 2MB</p>
          </div>
        </div>

        {/* Inputs Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-[11px] font-bold text-[#111827] uppercase tracking-wider">Full Name</label>
            <input 
              type="text" 
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Alex Designer"
              className="w-full h-11 px-4 rounded-xl border border-[#eaedf3] bg-white text-sm focus:outline-none focus:ring-1 focus:ring-[#6366f1] focus:border-[#6366f1] transition-all"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-bold text-[#111827] uppercase tracking-wider">Email Address</label>
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9ca3af]">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
              </div>
              <input 
                type="email" 
                value={user?.email || ''} 
                disabled
                className="w-full h-11 pl-11 pr-4 rounded-xl border border-[#eaedf3] bg-[#f8fafc] text-sm text-[#9ca3af] cursor-not-allowed"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-bold text-[#111827] uppercase tracking-wider">Role</label>
            <div className="relative">
              <input 
                type="text" 
                value={user?.role || 'Administrator'} 
                disabled
                className="w-full h-11 px-4 rounded-xl border border-[#eaedf3] bg-[#f8fafc] text-sm text-[#9ca3af] cursor-not-allowed"
              />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[#9ca3af]">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
              </div>
            </div>
            <p className="text-[10px] text-[#9ca3af] mt-1 font-semibold">Contact your workspace owner to change your role.</p>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-bold text-[#111827] uppercase tracking-wider">Current Goal</label>
            <input 
              type="text" 
              value={currentGoal}
              onChange={(e) => setCurrentGoal(e.target.value)}
              placeholder="e.g. Manage my documents"
              className="w-full h-11 px-4 rounded-xl border border-[#eaedf3] bg-white text-sm focus:outline-none focus:ring-1 focus:ring-[#6366f1] focus:border-[#6366f1] transition-all"
            />
          </div>
        </div>

        <div className="flex justify-end pt-4">
          <button 
            type="submit"
            disabled={loading}
            className="h-11 px-8 bg-[#6366f1] text-white text-[13px] font-bold rounded-xl hover:bg-[#4f46e5] disabled:opacity-50 transition-all flex items-center gap-2 shadow-lg shadow-[#6366f1]/20"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : null}
            Save Changes
          </button>
        </div>
      </form>
    </div>
  );
}
