// Stands in for pdf.js: refuses every document, naming in the error the options it was
// opened with, which the worker passes back as a parser error.
export function getDocument(options) {
  const error = new Error(JSON.stringify({ ...options, data: undefined }));
  error.name = 'RecordedOptions';
  return { promise: Promise.reject(error), destroy: async () => {} };
}
