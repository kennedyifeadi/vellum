// Runs once when the server starts. A failure here would fail every request, so Compress
// Video's worker is started without ever letting an error out: the app serves without it.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { startVideoJobWorker } = await import('@/lib/video/video-job-service');
    startVideoJobWorker();
  } catch (error) {
    console.error(`Compress Video jobs will not run: ${error instanceof Error ? error.message : String(error)}`);
  }
}
