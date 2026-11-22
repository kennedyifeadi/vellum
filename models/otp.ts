import mongoose from 'mongoose';

const OtpSchema = new mongoose.Schema({
  // The email is the key, so an address has one code even when two requests race.
  _id: { type: String, required: true },
  code: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, required: true },
});

// Auto-delete expired OTPs using MongoDB TTL index
OtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.Otp || mongoose.model('Otp', OtpSchema);