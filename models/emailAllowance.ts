import mongoose from 'mongoose';

const EmailSendSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    // The limits this send counts against, such as "guests" or "account:<id>".
    keys: { type: [String], required: true },
  },
  { _id: false },
);

const EmailAllowanceSchema = new mongoose.Schema({
  // The kind of email: one row each.
  _id: { type: String, required: true },
  // No default: an upsert cannot both default this array and pull from it.
  sends: { type: [EmailSendSchema], default: undefined },
  expiresAt: { type: Date, required: true },
});

EmailAllowanceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.EmailAllowance || mongoose.model('EmailAllowance', EmailAllowanceSchema);
