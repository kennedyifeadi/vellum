"use client";

import { useEffect, useState } from 'react';

interface ImageThumbnailProps {
  file: File;
}

export default function ImageThumbnail({ file }: ImageThumbnailProps) {
  const [fileUrl, setFileUrl] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;
    const url = URL.createObjectURL(file);

    Promise.resolve().then(() => {
      if (isActive) setFileUrl(url);
    });

    return () => {
      isActive = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  return (
    <div className="w-[260px] max-w-full bg-white rounded-xl border border-[#e2e8f0] overflow-hidden shrink-0 flex items-center justify-center relative shadow-md aspect-3/4">
      {fileUrl ? (
        <img 
          src={fileUrl} 
          alt={file.name} 
          className="w-full h-full object-contain bg-[#f8fafc]"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-xs text-[#94a3b8] font-medium bg-[#f8fafc]">
          Loading preview...
        </div>
      )}
    </div>
  );
}
