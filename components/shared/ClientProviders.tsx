"use client";

import { SessionProvider } from "next-auth/react";
import { Provider } from 'react-redux';
import { store } from '@/lib/store/store';

import { ThemeProvider } from 'next-themes';

export default function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <SessionProvider>
        <Provider store={store}>
          {children}
        </Provider>
      </SessionProvider>
    </ThemeProvider>
  );
}
