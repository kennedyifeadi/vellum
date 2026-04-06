import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  email: string;
  name?: string;
  role?: string;
  currentGoal?: string;
  image?: string;
  isProfileComplete: boolean;
  plan: 'Free' | 'Pro';
  emailVerified?: Date;
  accounts?: mongoose.Types.ObjectId[];
  starredTools: string[];
  notifications: Array<{
    id: string;
    type: 'success' | 'warning' | 'error' | 'info';
    title: string;
    message: string;
    timestamp: string;
    isRead: boolean;
    link?: string;
  }>;
  preferences: {
    theme: 'light' | 'dark' | 'system';
    autoDelete: boolean;
    notifications: {
      email: boolean;
      marketing: boolean;
      updates: boolean;
    };
  };
  tokenVersion: number;
  activeSessions: Array<{
    id: string;
    device: string;
    location: string;
    lastActive: Date;
  }>;
  createdAt: Date;
}

const UserSchema: Schema = new Schema({
  email: { type: String, required: true, unique: true },
  name: { type: String },
  role: { type: String },
  currentGoal: { type: String },
  image: { type: String },
  isProfileComplete: { type: Boolean, default: false },
  plan: { type: String, enum: ['Free', 'Pro'], default: 'Free' },
  emailVerified: { type: Date },
  accounts: [{ type: Schema.Types.ObjectId, ref: 'Account' }],
  starredTools: { type: [String], default: [] },
  notifications: {
    type: [{
      id: { type: String, required: true },
      type: { type: String, enum: ['success', 'warning', 'error', 'info'], required: true },
      title: { type: String, required: true },
      message: { type: String, required: true },
      timestamp: { type: String, required: true },
      isRead: { type: Boolean, default: false },
      link: { type: String },
    }],
    default: []
  },
  preferences: {
    theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
    autoDelete: { type: Boolean, default: false },
    notifications: {
      email: { type: Boolean, default: true },
      marketing: { type: Boolean, default: false },
      updates: { type: Boolean, default: true },
    }
  },
  tokenVersion: { type: Number, default: 1 },
  activeSessions: [{
    id: { type: String, required: true },
    device: { type: String },
    location: { type: String },
    lastActive: { type: Date, default: Date.now },
  }],
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
export default User;