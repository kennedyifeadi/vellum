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
 * Undo PNG/TIFF prediction filters common in Flate-encoded PDF images.
 */
function decodePredictor(data: Uint8Array, predictor: number, colors: number, bpc: number, columns: number): Buffer {
  if (predictor <= 1) return Buffer.from(data);

  const bytesPerPixel = Math.max(1, (colors * bpc) / 8);
  const rowSize = columns * bytesPerPixel;
  const stride = predictor >= 10 ? rowSize + 1 : rowSize; // PNG predictors prepend a byte per row
  const rows = Math.floor(data.length / stride);
  const decoded = Buffer.alloc(rows * rowSize);

  // TIFF Predictor 2: Horizontal differencing
  if (predictor === 2) {
    for (let i = 0; i < rows; i++) {
    const rowStart = i * rowSize;
        for (let j = 0; j < rowSize; j++) {
            const rawIdx = i * rowSize + j;
            const current = data[rawIdx];
            const prev = j >= bytesPerPixel ? decoded[rowStart + j - bytesPerPixel] : 0;
            decoded[rowStart + j] = (current + prev) & 0xFF;
        }
    }
    return decoded;
  }

  // PNG Predictors (10, 11, 12, 13, 14)
  if (predictor >= 10 && predictor <= 14) {
    for (let i = 0; i < rows; i++) {
        const rawRowStart = i * stride;
        const decodedRowStart = i * rowSize;
        const filterType = predictor === 10 ? data[rawRowStart] : predictor - 10;
        for (let j = 0; j < rowSize; j++) {
            const rawIdx = rawRowStart + 1 + j;
            const current = data[rawIdx];
            
            const left = j >= bytesPerPixel ? decoded[decodedRowStart + j - bytesPerPixel] : 0;
            const up = i > 0 ? decoded[decodedRowStart - rowSize + j] : 0;
            const leftUp = (i > 0 && j >= bytesPerPixel) ? decoded[decodedRowStart - rowSize + j - bytesPerPixel] : 0;

            let val = 0;
            switch(filterType) {
                case 0: val = current; break; // None
                case 1: val = current + left; break; // Sub
                case 2: val = current + up; break; // Up
                case 3: val = current + Math.floor((left + up) / 2); break; // Average
                case 4: { // Paeth
                    const p = left + up - leftUp;
                    const pa = Math.abs(p - left);
                    const pb = Math.abs(p - up);
                    const pc = Math.abs(p - leftUp);
                    const closest = (pa <= pb && pa <= pc) ? left : (pb <= pc ? up : leftUp);
                    val = current + closest;
                    break;
                }
            }
            decoded[decodedRowStart + j] = val & 0xFF;
        }
    }
    return decoded;
  }

  return Buffer.from(data);
}

/**
 * Decodes a PDF stream, handling Filter (Flate) and DecodeParms (Predictor).
 */
function decodeStream(pdfObject: PDFRawStream): Buffer | null {
  const dict = pdfObject.dict;
  const filter = dict.get(PDFName.of('Filter'));
  const contents = pdfObject.contents;

  if (!filter) return Buffer.from(contents);

  const filters = filter instanceof PDFArray 
    ? filter.asArray().map(f => f.toString()) 
    : [filter.toString()];
  
  for (let i = filters.length - 1; i >= 0; i--) {
    const f = filters[i];
    
    if (f === '/FlateDecode' || f === '/Fl') {
      try {
        const decompressed = zlib.inflateSync(contents);
        const decodeParms = dict.get(PDFName.of('DecodeParms')) || dict.get(PDFName.of('DP'));
        
        if (decodeParms && typeof (decodeParms as any).get === 'function') {
          const parms = decodeParms as any;
          const predictor = parms.get(PDFName.of('Predictor'))?.numberValue || 1;
          const columns = parms.get(PDFName.of('Columns'))?.numberValue || 1;
          const colors = parms.get(PDFName.of('Colors'))?.numberValue || 1;
          const bpc = parms.get(PDFName.of('BitsPerComponent'))?.numberValue || 8;
          
          if (predictor > 1) {
            return decodePredictor(decompressed, predictor, colors, bpc, columns);
          }
        }
        return Buffer.from(decompressed);
      } catch {
        return null;
      }
    } else if (f === '/DCTDecode' || f === '/DCT') {
      return Buffer.from(contents);
    } else {
      return null;
    }
  }

  return Buffer.from(contents);
}

async function recompressImages(pdfDoc: PDFDocument, level: string): Promise<void> {
  const quality = JPEG_QUALITY[level] ?? 65;
  const context = pdfDoc.context;
  const processedRefs = new Set<string>();

  // Iterate over all indirect objects to find images
  for (const [ref, pdfObject] of context.enumerateIndirectObjects()) {
    const refKey = `${ref.objectNumber}-${ref.generationNumber}`;
    if (processedRefs.has(refKey)) continue;
    if (!(pdfObject instanceof PDFRawStream)) continue;

    const dict = pdfObject.dict;
    const subtype = dict.get(PDFName.of('Subtype'));
    if (!subtype || subtype.toString() !== '/Image') continue;

    const filter = dict.get(PDFName.of('Filter'))?.toString();
    if (filter === '/JPXDecode' || filter === '/JBIG2Decode' || filter === '/CCITTFaxDecode' || filter === '/LZWDecode') {
      processedRefs.add(refKey);
      continue;
    }

    const width = (dict.get(PDFName.of('Width')) as any)?.numberValue;
    const height = (dict.get(PDFName.of('Height')) as any)?.numberValue;
    const bpc = (dict.get(PDFName.of('BitsPerComponent')) as any)?.numberValue || 8;
    if (!width || !height) continue;

    // Sharp's raw format currently requires 8-bit depth. Skip 1-bit, 4-bit, 16-bit for raw Flate processing
    const isFlateOrRaw = filter === '/FlateDecode' || filter === '/Fl' || !filter || (filter && filter.includes('FlateDecode'));
    if (isFlateOrRaw && bpc !== 8) {
        processedRefs.add(refKey);
        continue;
    }

    const decoded = decodeStream(pdfObject);
    if (!decoded) continue;

    try {
      let pipeline;
      const colorSpaceObj = dict.get(PDFName.of('ColorSpace'));
      const colorSpace = colorSpaceObj?.toString() || '';

      if (isFlateOrRaw) {
        // If it's an indexed colorspace, we can't easily parse it natively right now.
        if (colorSpaceObj instanceof PDFArray) {
            const csName = colorSpaceObj.get(0)?.toString();
            if (csName === '/Indexed') {
                processedRefs.add(refKey);
                continue;
            }
        }

        // Determine channels
        let channels: 1 | 2 | 3 | 4 = 3;
        if (colorSpace === '/DeviceCMYK') channels = 4;
        else if (colorSpace === '/DeviceGray') channels = 1;
        else if (colorSpace === '/DeviceRGB') channels = 3;
        else {
            // Unclear color space, try to infer from data length
            const pixels = width * height;
            const bytesPerPixel = decoded.length / pixels;
            if (bytesPerPixel === 1 || bytesPerPixel === 2 || bytesPerPixel === 3 || bytesPerPixel === 4) {
               channels = Math.round(bytesPerPixel) as 1 | 2 | 3 | 4;
            } else {
               processedRefs.add(refKey);
               continue;
            }
        }

        pipeline = sharp(decoded, {
          raw: {
            width,
            height,
            channels
          }
        });
      } else {
        pipeline = sharp(decoded); // e.g. DCTDecode (JPEG passes through normally)
      }

      const metadata = await pipeline.metadata();
      const isCmyk = colorSpace === '/DeviceCMYK' || metadata.space === 'cmyk';
      const isGray = colorSpace === '/DeviceGray' || metadata.channels === 1;

      // 1. Handle CMYK -> sRGB
      if (isCmyk) {
        pipeline = pipeline.toColorspace('srgb');
      }

      // 2. Handle Grayscale
      if (isGray) {
        pipeline = pipeline.grayscale();
      }

      // 3. Downsampling logic
      const threshold = level === 'high' ? 1200 : 2000;
      if (width > threshold || height > threshold) {
        const scale = threshold / Math.max(width, height);
        pipeline = pipeline.resize({
          width: Math.floor(width * scale),
          withoutEnlargement: true,
          fit: 'inside'
        });
      }

      // 4. Compression
      const reencoded = await pipeline
        .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:2:0' })
        .toBuffer();

      if (reencoded.length < pdfObject.contents.length) {
        const newDict = pdfObject.dict.clone();
        newDict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
        newDict.set(PDFName.of('Length'), pdfDoc.context.obj(reencoded.length));
        newDict.set(PDFName.of('ColorSpace'), isGray ? PDFName.of('DeviceGray') : PDFName.of('DeviceRGB'));
        newDict.set(PDFName.of('BitsPerComponent'), pdfDoc.context.obj(8));
        
        // Remove Flate-specific entries if they exist
        newDict.delete(PDFName.of('DecodeParms'));
        newDict.delete(PDFName.of('DP'));

        const newStream = pdfDoc.context.stream(reencoded, newDict as any);
        context.assign(ref, newStream);
      }
      
      processedRefs.add(refKey);
    } catch (err) {
      console.error(`Skipping image ${refKey} due to sharp error:`, err);
      // Gracefully skip images that sharp can't process
      processedRefs.add(refKey);
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
