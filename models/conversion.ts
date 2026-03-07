import mongoose, { Schema, Document } from 'mongoose';

export interface IConversion extends Document {
  userId: mongoose.Types.ObjectId;
  toolUsed: string;
  fileName: string;
  fileSize: number;
  status: 'success' | 'failed' | 'processing';
  outputUrl?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const ConversionSchema: Schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  toolUsed: { type: String, required: true },
  fileName: { type: String, required: true },
  fileSize: { type: Number, required: true },
  status: { type: String, enum: ['success', 'failed', 'processing'], required: true },
  outputUrl: { type: String },
  metadata: { type: Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now },
});

const Conversion = mongoose.models.Conversion || mongoose.model<IConversion>('Conversion', ConversionSchema);
export default Conversion;