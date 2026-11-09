import dbConnect from '@/lib/db/mongoose';
import User, { type IUser } from '@/models/user';

export type NewNotification = Pick<IUser['notifications'][number], 'type' | 'title' | 'message' | 'link'>;

const KEPT_NOTIFICATIONS = 50;

/** Adds a notification to the user's list, keeping only the most recent ones. */
export async function pushNotification(userId: string, { type, title, message, link }: NewNotification) {
  const notification = {
    id: Math.random().toString(36).substring(7),
    type,
    title,
    message,
    timestamp: new Date().toISOString(),
    isRead: false,
    ...(link ? { link } : {}),
  };

  await dbConnect();
  await User.findByIdAndUpdate(userId, {
    $push: { notifications: { $each: [notification], $slice: -KEPT_NOTIFICATIONS } },
  });
  return notification;
}
