process.env.JWT_SECRET = 'test_secret_key_for_jwt_verification_in_jest';
process.env.NEXTAUTH_SECRET = 'test_next_auth_secret';
process.env.MONGODB_URI = 'mongodb://localhost:27017/test_vellum';

// Every upload route counts against lib/http/rate-limit.ts's per-process budget, which
// would otherwise carry over from one test to the next and refuse the 31st request.
// The per-caller job claims of lib/convert/caller-jobs.ts carry over the same way, so a
// test that failed while holding a job does not refuse the next test's caller. Compress
// Video's job runtime (lib/video/video-job-service.ts) is dropped too, so a job queued by one
// test does not count as the next test's caller's active job.
beforeEach(() => {
  (globalThis as { vellumRateLimits?: Map<string, unknown> }).vellumRateLimits?.clear();
  (globalThis as { vellumCallerJobs?: Map<symbol, unknown> }).vellumCallerJobs?.clear();
  delete (globalThis as { vellumVideoJobs?: unknown }).vellumVideoJobs;
});
