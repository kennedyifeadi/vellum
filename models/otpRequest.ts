import mongoose from 'mongoose';

const OtpRequestSchema = new mongoose.Schema({
  // The lower-cased email.
  _id: { type: String, required: true },
  // No default: an upsert cannot both default this array and pull from it.
  requestedAt: { type: [Date], default: undefined },
  expiresAt: { type: Date, required: true },
});

OtpRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.OtpRequest || mongoose.model('OtpRequest', OtpRequestSchema);
