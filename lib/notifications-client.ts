export interface NewAppNotification {
  type: 'success' | 'warning' | 'error' | 'info';
  title: string;
  message: string;
  link?: string;
}

/** Adds a notification to the signed-in user's list. It is not awaited: a failure is only logged. */
export function saveNotification(notification: NewAppNotification) {
  fetch('/api/user/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(notification),
  }).catch(err => console.error('Failed to save notification:', err));
}
