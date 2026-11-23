import { reasonOf } from '@/lib/reason-of';

// Runs once when the server starts. A failure here would fail every request, so Compress
// Video's worker and the retention sweep are each started without ever letting an error out,
// and without depending on the other: the app serves without them.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { startVideoJobWorker } = await import('@/lib/video/video-job-service');
    startVideoJobWorker();
  } catch (error) {
    console.error(`Compress Video jobs will not run: ${reasonOf(error)}`);
  }
  try {
    const { startRetentionSweep } = await import('@/lib/retention-sweep');
    startRetentionSweep();
  } catch (error) {
    console.error(`Expired files will not be deleted: ${reasonOf(error)}`);
  }
}
