const PDFJS_ENTRY = 'pdfjs-dist/legacy/build/pdf.mjs';
const RECORDER = new URL('./pdfjs.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === PDFJS_ENTRY) {
    return { url: RECORDER, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
