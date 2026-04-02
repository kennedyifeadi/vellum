import { PDFDocument, PDFName, PDFRawStream, PDFArray } from 'pdf-lib';
import sharp from 'sharp';
import zlib from 'zlib';

interface CompressPdfOptions {
  pdfBuffer: Buffer;
  level: 'low' | 'medium' | 'high';
}

export interface CompressResult {
  buffer: Buffer;
  originalSize: number;
  compressedSize: number;
}

const JPEG_QUALITY: Record<string, number> = {
  low: 85,
  medium: 65,
  high: 40,
};

/**
 * Robustly decodes a PDF stream, handling multiple filters and predictors.
 */
function decodeStream(pdfObject: PDFRawStream): Buffer | null {
  const dict = pdfObject.dict;
  const filter = dict.get(PDFName.of('Filter'));
  let contents = Buffer.from(pdfObject.contents);

  if (!filter) return contents;

  const filters = filter instanceof PDFArray 
    ? filter.asArray().map(f => f.toString()) 
    : [filter.toString()];
  
  // PDF filters are applied in the order they appear in the array.
  // To decode, we apply them in reverse order.
  for (let i = filters.length - 1; i >= 0; i--) {
    const f = filters[i];
    
    if (f === '/FlateDecode' || f === '/Fl') {
      try {
        contents = zlib.inflateSync(contents);
      } catch (err) {
        console.warn(`[Compression] Failed to inflate FlateDecode stream: ${err}`);
        return null;
      }
    } else if (f === '/DCTDecode' || f === '/DCT') {
      // It's a JPEG, return as is (sharp will handle it)
      return contents;
    } else {
      // For other filters (LZW, RLE, etc.), we skip for now to avoid complexity
      return null;
    }
  }

  return contents;
}

async function recompressImages(pdfDoc: PDFDocument, level: string): Promise<void> {
  const quality = JPEG_QUALITY[level] ?? 65;
  const context = pdfDoc.context;

  for (const [ref, pdfObject] of context.enumerateIndirectObjects()) {
    if (!(pdfObject instanceof PDFRawStream)) continue;

    const dict = pdfObject.dict;
    const subtype = dict.get(PDFName.of('Subtype'));
    if (!subtype || subtype.toString() !== '/Image') continue;

    const width = (dict.get(PDFName.of('Width')) as any)?.numberValue;
    const height = (dict.get(PDFName.of('Height')) as any)?.numberValue;
    if (!width || !height) continue;

    const decoded = decodeStream(pdfObject);
    if (!decoded) continue;

    try {
      let image = sharp(decoded);
      
      // Resolution check & downscaling
      let shouldScale = false;
      let newWidth = width;
      // High resolution scans are often > 3000px. Downscale to reasonable sizes.
      const threshold = level === 'high' ? 1500 : 2500;
      if (width > threshold || height > threshold) {
        shouldScale = true;
        newWidth = level === 'high' ? 1024 : 1600;
      }

      if (shouldScale) {
        image = image.resize({ width: newWidth, withoutEnlargement: true });
      }

      const reencoded = await image
        .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:2:0' })
        .toBuffer();

      // Only replace if genuinely smaller OR if we downscaled it
      if (reencoded.length < pdfObject.contents.length || shouldScale) {
        const newStream = context.stream(reencoded, {
          Type: 'XObject',
          Subtype: 'Image',
          Filter: 'DCTDecode',
          Width: width,
          Height: height,
          ColorSpace: dict.get(PDFName.of('ColorSpace')) || 'DeviceRGB',
          BitsPerComponent: 8,
          Length: reencoded.length,
        });
        context.assign(ref, newStream);
      }
    } catch (err) {
      // Skip if sharp fails (likely unsupported color space or raw format)
    }
  }
}

async function stripOptionalContent(pdfDoc: PDFDocument, level: string): Promise<void> {
  // Strip document info metadata
  pdfDoc.setTitle('');
  pdfDoc.setAuthor('');
  pdfDoc.setSubject('');
  pdfDoc.setKeywords([]);
  pdfDoc.setProducer('');
  pdfDoc.setCreator('');

  // Remove XMP Metadata
  try { pdfDoc.catalog.delete(PDFName.of('Metadata')); } catch {}

  const pages = pdfDoc.getPages();
  for (const page of pages) {
    if (level === 'medium' || level === 'high') {
      try { page.node.delete(PDFName.of('Annots')); } catch {}
    }
    if (level === 'high') {
      try { page.node.delete(PDFName.of('Thumb')); } catch {}
      try { page.node.delete(PDFName.of('PieceInfo')); } catch {}
    }
  }

  if (level === 'high') {
    try { pdfDoc.catalog.delete(PDFName.of('AcroForm')); } catch {}
    try { pdfDoc.catalog.delete(PDFName.of('OCProperties')); } catch {}
  }
}

export async function compressPdf({
  pdfBuffer,
  level,
}: CompressPdfOptions): Promise<CompressResult> {
  const originalSize = pdfBuffer.length;

  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });

  await stripOptionalContent(pdfDoc, level);

  if (level === 'medium' || level === 'high') {
    await recompressImages(pdfDoc, level);
  }

  // Save with object-stream packing
  const savedBytes = await pdfDoc.save({ useObjectStreams: true });
  const compressedBuffer = Buffer.from(savedBytes);

  return {
    buffer: compressedBuffer,
    originalSize,
    compressedSize: compressedBuffer.length,
  };
}
