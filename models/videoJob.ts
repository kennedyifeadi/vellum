import mongoose, { Schema } from 'mongoose';

const DAY_SECONDS = 24 * 60 * 60;

export const VIDEO_JOB_STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled'] as const;

export const VideoJobSchema = new Schema({
  status: { type: String, enum: VIDEO_JOB_STATUSES, required: true },
  // A signed-in owner's user id, or the SHA-256 of a guest's job token.
  ownerId: { type: String, required: true },
  guest: { type: Boolean, required: true },
  // SHA-256 of the caller key (lib/convert/caller-jobs.ts), for one active job per caller.
  callerKey: { type: String, required: true },
  plan: { type: String, required: true },
  options: {
    crf: { type: Number, required: true },
    resolution: { type: String, required: true },
  },
  fileName: { type: String, required: true },
  originalSize: { type: Number, required: true },
  inputKey: { type: String },
  outputKey: { type: String },
  outputSize: { type: Number },
  outputFormat: {
    extension: { type: String },
    contentType: { type: String },
  },
  compressed: { type: Boolean },
  error: { type: String },
  createdAt: { type: Date, required: true },
  startedAt: { type: Date },
  finishedAt: { type: Date },
  leaseUntil: { type: Date },
  // Names the claim that holds the lease, so a worker whose lease was taken over can no
  // longer renew, finish or fail the job.
  claimId: { type: String },
  attempts: { type: Number, required: true, default: 0 },
  resultExpiresAt: { type: Date },
});

VideoJobSchema.index({ status: 1, createdAt: 1, _id: 1 });
VideoJobSchema.index({ status: 1, leaseUntil: 1 });
VideoJobSchema.index({ status: 1, resultExpiresAt: 1 });
VideoJobSchema.index({ callerKey: 1, status: 1 });
// Removes a finished job's row a day after its result expires. The worker's own sweep
// deletes the result's file at expiry; this index never touches files.
VideoJobSchema.index({ resultExpiresAt: 1 }, { expireAfterSeconds: DAY_SECONDS });

const VideoJobModel = mongoose.models.VideoJob || mongoose.model('VideoJob', VideoJobSchema);
export default VideoJobModel;
