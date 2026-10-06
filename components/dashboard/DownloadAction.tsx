"use client";

import React from 'react';

interface DownloadActionProps {
  outputUrl?: string;
  className: string;
  title?: string;
  children: React.ReactNode;
}

export default function DownloadAction({ outputUrl, className, title, children }: DownloadActionProps) {
  if (!outputUrl) return null;

  return (
    <button onClick={() => { window.location.href = outputUrl; }} className={className} title={title}>
      {children}
    </button>
  );
}
