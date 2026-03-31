import mongoose, { Schema, Document } from 'mongoose';

export interface IUserDocument extends Document {
  userId: mongoose.Types.ObjectId;
  fileName: string;
  diskFileName: string;
  fileSize: number;
  mimeType: string;
  createdAt: Date;
  expiresAt: Date;
}

const UserDocumentSchema: Schema = new Schema({
  userId:       { type: Schema.Types.ObjectId, ref: 'User', required: true },
  fileName:     { type: String, required: true },
  diskFileName: { type: String, required: true },
  fileSize:     { type: Number, required: true },
  mimeType:     { type: String, required: true },
  createdAt:    { type: Date, default: Date.now },
  expiresAt:    { type: Date, required: true },
});

// MongoDB TTL index — auto-deletes expired records
UserDocumentSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const UserDocumentModel =
  mongoose.models.UserDocument ||
  mongoose.model<IUserDocument>('UserDocument', UserDocumentSchema);

export default UserDocumentModel;
