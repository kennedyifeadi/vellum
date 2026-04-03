import { PDFDocument, rgb } from 'pdf-lib';
import { compressPdf } from './compress';
import fs from 'fs';
import path from 'path';

async function test() {
  console.log("Creating test PDF...");
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([600, 400]);
  page.drawText('Vellum PDF Compression Test', { x: 50, y: 350, size: 30, color: rgb(0.1, 0.2, 0.7) });
  
  // No real high-res images here, but we can verify the logic runs
  const pdfBytes = await pdfDoc.save();
  const buffer = Buffer.from(pdfBytes);
  
  console.log(`Original Size: ${buffer.length} bytes`);
  
  try {
    const result = await compressPdf({
      pdfBuffer: buffer,
      level: 'high'
    });
    
    console.log(`Compressed Size: ${result.compressedSize} bytes`);
    console.log("Compression successful!");
  } catch (err) {
    console.error("Compression failed:", err);
  }
}

test();
