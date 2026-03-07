import mongoose, { Schema, Document } from 'mongoose';

export interface IEventLog extends Document {
  userId?: mongoose.Types.ObjectId;
  eventType: string;
  timestamp: Date;
  properties?: Record<string, unknown>;
}

const EventLogSchema: Schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  eventType: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  properties: { type: Schema.Types.Mixed },
});

const EventLog = mongoose.models.EventLog || mongoose.model<IEventLog>('EventLog', EventLogSchema);
export default EventLog;