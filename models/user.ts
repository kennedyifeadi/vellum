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
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
export default User;