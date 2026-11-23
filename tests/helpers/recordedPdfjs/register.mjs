// Preloaded into a worker thread with --import: the worker then gets ./pdfjs.mjs in place
// of pdf.js, and its getDocument options can be read back from its reply.
import { register } from 'module';

register('./hooks.mjs', import.meta.url);
