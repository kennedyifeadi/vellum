// Shared by the worker entry files in this directory. Like them, nothing bundles or
// transpiles this file: it must stay plain JavaScript.

// pdf.js loads the native @napi-rs/canvas addon on import to polyfill the canvas types
// its renderer uses. A worker thread that has loaded that addon takes the whole process
// down with a segfault when it exits, so pdf-worker.ts starts every worker with
// --no-addons. Text extraction never renders; pdf.js only needs these names to exist
// while its module loads, and warns once on import that the addon is missing.
class UnavailableInWorker {}

export async function importWithoutCanvas(importPdfJs) {
  globalThis.DOMMatrix ??= UnavailableInWorker;
  globalThis.ImageData ??= UnavailableInWorker;
  globalThis.Path2D ??= UnavailableInWorker;

  const { warn } = console;
  console.warn = () => {};
  try {
    return await importPdfJs();
  } finally {
    console.warn = warn;
  }
}

export function toParserErrorMessage(error) {
  return {
    kind: 'parser-error',
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
  };
}
