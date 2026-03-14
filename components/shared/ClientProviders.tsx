"use client";

import { SessionProvider } from "next-auth/react";
import { Provider } from 'react-redux';
import { store } from '@/lib/store/store';

export default function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <Provider store={store}>
        {children}
      </Provider>
    </SessionProvider>
  );
}
