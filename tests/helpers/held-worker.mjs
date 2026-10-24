import { parentPort, workerData } from 'node:worker_threads';

// Holds its worker slot until the test posts this job's id with the outcome to end it
// with; see heldJobs.ts.
const id = new TextDecoder().decode(workerData.data);
const channel = new BroadcastChannel('vellum-held-worker-jobs');

channel.onmessage = ({ data }) => {
  if (data.id !== id) return;
  channel.close();
  if (data.outcome === 'server-error') {
    throw new Error('Held worker job failed');
  }
  parentPort.postMessage(
    data.outcome === 'client-error'
      ? { kind: 'parser-error', name: 'InvalidPDFException', message: 'Held worker job refused its input' }
      : { kind: 'held-result', result: data.result },
  );
};

channel.postMessage({ ready: id });
