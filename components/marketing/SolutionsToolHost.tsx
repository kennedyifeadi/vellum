"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { ToolHostProvider, type ToolHost } from '@/components/shared/ToolHost';
import { Toast, useToast } from '@/components/shared/Toast';
import { fetchSignedInUser } from '@/lib/session-client';
import { saveNotification } from '@/lib/notifications-client';

/** Serves the tool sheet on Solutions: a signed-in user gets notifications as on the dashboard, a guest none. */
export default function SolutionsToolHost({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<ToolHost['user']>(null);
  // Read when a conversion ends, which can be after a session check that was pending when it started.
  const userRef = useRef(user);
  const { toast, showToast } = useToast();

  useEffect(() => {
    let current = true;
    fetchSignedInUser()
      .then((signedIn) => {
        if (!current) return;
        userRef.current = signedIn;
        setUser(signedIn);
      })
      .catch((error) => console.error('Could not check the session:', error));
    return () => {
      current = false;
    };
  }, []);

  const host = useMemo<ToolHost>(
    () => ({
      user,
      showToast,
      addNotification: (notification) => {
        if (userRef.current) saveNotification(notification);
      },
    }),
    [user, showToast],
  );

  return (
    <ToolHostProvider value={host}>
      {children}
      <Toast toast={toast} />
    </ToolHostProvider>
  );
}
