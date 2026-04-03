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
  accounts?: mongoose.Types.ObjectId[]; // For NextAuth.js accounts
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