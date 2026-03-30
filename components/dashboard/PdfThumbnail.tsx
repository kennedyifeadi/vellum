"use client";

import { useState, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';

// Set up the worker for pdf.js using a stable CDN
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfThumbnailProps {
  file: File;
  pageNumber?: number;
  onLoadSuccess?: (pdf: { numPages: number }) => void;
}

export default function PdfThumbnail({ file, pageNumber = 1, onLoadSuccess }: PdfThumbnailProps) {
  const [fileUrl, setFileUrl] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;
    const url = URL.createObjectURL(file);

    // Defer the state update to prevent "cascading render" React warnings
    Promise.resolve().then(() => {
      if (isActive) setFileUrl(url);
    });

    return () => {
      isActive = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  return (
    <div className="w-[260px] max-w-full bg-white rounded-xl border border-[#e2e8f0] overflow-hidden shrink-0 flex flex-col items-center justify-center relative shadow-md">
      <div className="pointer-events-none w-full flex justify-center">
        {fileUrl ? (
          <Document
            file={fileUrl}
            onLoadSuccess={onLoadSuccess}
            className="flex justify-center w-full"
            loading={
              <div className="w-full aspect-3/4 flex items-center justify-center text-xs text-[#94a3b8] font-medium bg-[#f8fafc]">
                Loading preview...
              </div>
            }
            error={
              <div className="w-full aspect-3/4 flex items-center justify-center text-xs text-[#ef4444] font-medium bg-[#fef2f2]">
                Preview Error
              </div>
            }
          >
            <Page 
              pageNumber={pageNumber} 
              width={260} 
              renderTextLayer={false} 
              renderAnnotationLayer={false}
              className="transition-opacity duration-300 shadow-sm"
            />
          </Document>
        ) : (
          <div className="w-full aspect-3/4 flex items-center justify-center text-xs text-[#94a3b8] font-medium bg-[#f8fafc]">
            Loading preview...
          </div>
        )}
      </div>
    </div>
  );
}
