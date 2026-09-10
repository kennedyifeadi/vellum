import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PDFDocument as EncryptablePDFDocument } from 'pdf-lib-plus-encrypt';
import { loadPdf } from '../lib/pdf/loadPdf';
import { ClientError } from '../lib/convert/errors';

async function createPdf(pageCount = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([200, 200]).drawText(`Page ${i + 1}`, { x: 20, y: 100, font, size: 14 });
  }
  return Buffer.from(await doc.save());
}

describe('loadPdf (lib/pdf/loadPdf.ts)', () => {
  it('returns a usable PDFDocument for a valid PDF', async () => {
    const doc = await loadPdf(await createPdf(3));
    expect(doc.getPageCount()).toBe(3);
  });

  it('rejects an empty buffer as a client error', async () => {
    await expect(loadPdf(Buffer.alloc(0))).rejects.toBeInstanceOf(ClientError);
    await expect(loadPdf(Buffer.alloc(0))).rejects.toThrow(/empty/i);
  });

  it('rejects a non-PDF buffer as a corrupt client error', async () => {
    const notaPdf = Buffer.from('this is plain text, not a pdf at all');
    await expect(loadPdf(notaPdf)).rejects.toBeInstanceOf(ClientError);
    await expect(loadPdf(notaPdf)).rejects.toThrow(/not a valid PDF or is corrupted/i);
  });

  it('rejects a truncated PDF as a corrupt client error', async () => {
    const truncated = (await createPdf(2)).subarray(0, 128);
    await expect(loadPdf(truncated)).rejects.toBeInstanceOf(ClientError);
    await expect(loadPdf(truncated)).rejects.toThrow(/not a valid PDF or is corrupted/i);
  });

  it('rejects an encrypted PDF with the default message', async () => {
    const plain = await EncryptablePDFDocument.load(await createPdf(1));
    await plain.encrypt({ userPassword: 'secret', ownerPassword: 'secret' });
    const encrypted = Buffer.from(await plain.save());

    await expect(loadPdf(encrypted)).rejects.toThrow(/password-protected/i);
  });

  it('uses a caller-supplied label and encryption message', async () => {
    const plain = await EncryptablePDFDocument.load(await createPdf(1));
    await plain.encrypt({ userPassword: 'secret', ownerPassword: 'secret' });
    const encrypted = Buffer.from(await plain.save());

    await expect(
      loadPdf(Buffer.alloc(0), { label: 'File 2' }),
    ).rejects.toThrow('File 2 is empty.');

    await expect(
      loadPdf(encrypted, { encryptedMessage: 'Remove the password before merging it.' }),
    ).rejects.toThrow('Remove the password before merging it.');
  });

  it('attaches the underlying parse failure as the ClientError cause', async () => {
    try {
      await loadPdf(Buffer.from('nope'));
      throw new Error('expected loadPdf to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(ClientError);
      expect((err as ClientError).cause).toBeInstanceOf(Error);
    }
  });
});
