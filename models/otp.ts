import mongoose from 'mongoose';

const OtpSchema = new mongoose.Schema({
  // SHA-256 of the browser's cookie and the email, so each browser has its own code for an
  // address, and only one even when its requests race.
  _id: { type: String, required: true },
  code: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, required: true },
});

// Auto-delete expired OTPs using MongoDB TTL index
OtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.Otp || mongoose.model('Otp', OtpSchema);
