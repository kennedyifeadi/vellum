import * as pdfParseModule from 'pdf-parse';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfParse = (pdfParseModule as any).default || pdfParseModule;

interface FindTextInPdfOptions {
  pdfBuffer: Buffer;
  searchText: string;
}

interface TextSearchResult {
  page: number;
  occurrences: number;
  context: string[]; // Lines around the occurrence
}

export async function findTextInPdf({
  pdfBuffer,
  searchText,
}: FindTextInPdfOptions): Promise<TextSearchResult[]> {
  const data = await pdfParse(pdfBuffer);
  const results: TextSearchResult[] = [];
  const searchRegex = new RegExp(searchText, 'gi'); // Case-insensitive global search

  const pages = data.text.split(/\n\s*\n/); // Simple split by double newline for pages

  for (let i = 0; i < pages.length; i++) {
    const pageText = pages[i];
    const lines = pageText.split('\n');
    let occurrences = 0;
    const context: string[] = [];

    for (let j = 0; j < lines.length; j++) {
      const line = lines[j];
      if (searchRegex.test(line)) {
        occurrences++;
        // Add line and surrounding lines for context
        if (j > 0) context.push(lines[j - 1]);
        context.push(line);
        if (j < lines.length - 1) context.push(lines[j + 1]);
      }
    }

    if (occurrences > 0) {
      results.push({
        page: i + 1,
        occurrences,
        context: Array.from(new Set(context)), // Remove duplicate context lines
      });
    }
  }

  return results;
}