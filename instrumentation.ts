export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startVideoJobWorker } = await import('@/lib/video/video-job-service');
    startVideoJobWorker();
  }
}
