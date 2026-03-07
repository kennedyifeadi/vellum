import mongoose, { Schema, Document } from 'mongoose';

export interface IToolUsage extends Document {
  toolId: string;
  usageCount: number;
  uniqueUsers: number;
  totalDataProcessed: number;
  lastUsed: Date;
}

const ToolUsageSchema: Schema = new Schema({
  toolId: { type: String, required: true, unique: true },
  usageCount: { type: Number, default: 0 },
  uniqueUsers: { type: Number, default: 0 },
  totalDataProcessed: { type: Number, default: 0 },
  lastUsed: { type: Date, default: Date.now },
});

const ToolUsage = mongoose.models.ToolUsage || mongoose.model<IToolUsage>('ToolUsage', ToolUsageSchema);
export default ToolUsage;