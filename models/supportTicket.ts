import mongoose, { Schema, Document } from 'mongoose';

export interface ISupportTicket extends Document {
  userId: mongoose.Types.ObjectId;
  ticketId: string;
  subject: string;
  category: string;
  message: string;
  status: 'open' | 'in-progress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high';
  createdAt: Date;
  updatedAt: Date;
}

const SupportTicketSchema: Schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  ticketId: { type: String, required: true, unique: true },
  subject: { type: String, required: true },
  category: { type: String, required: true, enum: ['general', 'technical', 'billing', 'feature_request', 'other'] },
  message: { type: String, required: true },
  status: { type: String, default: 'open', enum: ['open', 'in-progress', 'resolved', 'closed'] },
  priority: { type: String, default: 'medium', enum: ['low', 'medium', 'high'] },
}, { timestamps: true });

const SupportTicket = mongoose.models.SupportTicket || mongoose.model<ISupportTicket>('SupportTicket', SupportTicketSchema);

export default SupportTicket;
