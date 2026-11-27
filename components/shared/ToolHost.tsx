"use client";

import { createContext, useContext } from 'react';
import type { NewAppNotification } from '@/lib/notifications-client';

export type ToastType = 'success' | 'error' | 'info';

/** What the tool drawer needs from the page that mounts it: the dashboard or Solutions. */
export interface ToolHost {
  /** The signed-in user, or null for a guest. */
  user: { plan?: string } | null;
  showToast: (message: string, type: ToastType) => void;
  addNotification: (notification: NewAppNotification) => void;
}

const ToolHostContext = createContext<ToolHost>({
  user: null,
  showToast: () => {},
  addNotification: () => {},
});

export const ToolHostProvider = ToolHostContext.Provider;

export const useToolHost = () => useContext(ToolHostContext);
