"use client";

import React from 'react';
import { motion } from 'framer-motion';

export const AuthLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#f8f9ff] relative overflow-hidden">
      {/* Soft Premium Background Gradients */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-[#e0e7ff] rounded-full blur-[120px] opacity-60 animate-pulse" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-[#f5f3ff] rounded-full blur-[120px] opacity-60 animate-pulse" />
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="relative z-10 w-full max-w-[480px] px-6"
      >
        {children}
      </motion.div>
    </div>
  );
};

export const AuthCard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="bg-white rounded-[24px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-[#f1f1f1] p-10 flex flex-col items-center">
      {children}
    </div>
  );
};

export const AuthInput: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { icon?: React.ReactNode }> = ({ icon, ...props }) => {
  return (
    <div className="relative w-full group">
      <input
        {...props}
        className="w-full h-12 px-4 bg-[#f9fafb] border border-[#e5e7eb] rounded-xl text-[#111827] placeholder-[#9ca3af] outline-none transition-all duration-200 focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/10 group-hover:border-[#d1d5db]"
      />
      {icon && (
        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[#9ca3af]">
          {icon}
        </div>
      )}
    </div>
  );
};

export const SocialButton: React.FC<{ 
  onClick: () => void; 
  icon: React.ReactNode; 
  label: string;
  provider: 'google' | 'microsoft';
}> = ({ onClick, icon, label }) => {
  return (
    <button
      onClick={onClick}
      className="w-full h-12 flex items-center justify-center gap-3 px-4 bg-white border border-[#e5e7eb] rounded-xl text-[#374151] font-medium transition-all duration-200 hover:bg-[#f9fafb] hover:border-[#d1d5db] active:scale-[0.98]"
    >
      <span className="w-5 h-5 flex items-center justify-center">
        {icon}
      </span>
      {label}
    </button>
  );
};

export const AuthButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ children, ...props }) => {
  return (
    <button
      {...props}
      className="w-full h-12 bg-[#6366f1] text-white font-semibold rounded-xl transition-all duration-200 hover:bg-[#4f46e5] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-[#6366f1]/20"
    >
      {children}
    </button>
  );
};

export const VellumLogo = () => (
    <div className="flex items-center gap-2 mb-6">
        <div className="w-10 h-10 bg-[#6366f1] rounded-lg flex items-center justify-center text-white font-bold text-xl shadow-md">
            V
        </div>
        <span className="text-2xl font-bold text-[#1f2937]">Vellum</span>
    </div>
);
