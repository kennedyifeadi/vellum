import mongoose from 'mongoose';

// Each send has an id, so a failed one can be taken back without another of the same moment.
const SendSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const OtpRequestSchema = new mongoose.Schema({
  // SHA-256 of what is counted: a limit, its window and whom it is counted for.
  _id: { type: String, required: true },
  // No default: an upsert cannot both default this array and pull from it.
  sends: { type: [SendSchema], default: undefined },
  expiresAt: { type: Date, required: true },
});

OtpRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.OtpRequest || mongoose.model('OtpRequest', OtpRequestSchema);
