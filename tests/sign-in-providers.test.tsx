import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('@/lib/db/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({}),
}));

jest.mock('@next-auth/mongodb-adapter', () => ({
  MongoDBAdapter: () => ({}),
}));

jest.mock('@/models/user', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('next-auth/react', () => ({
  signIn: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

import { authOptions } from '../app/api/auth/[...nextauth]/route';
import LoginPage from '../app/(auth)/login/page';

describe('configured sign-in providers', () => {
  it('are exactly Google and the email OTP credentials provider', () => {
    const providers = authOptions.providers.map((provider) => ({
      id: provider.options?.id ?? provider.id,
      type: provider.type,
    }));

    expect(providers).toEqual([
      { id: 'google', type: 'oauth' },
      { id: 'email-otp', type: 'credentials' },
    ]);
  });

  it('offer Google as the only OAuth provider', () => {
    const oauthProviderIds = authOptions.providers
      .filter((provider) => provider.type === 'oauth')
      .map((provider) => provider.id);

    expect(oauthProviderIds).toEqual(['google']);
  });
});

describe('login page', () => {
  const markup = renderToStaticMarkup(<LoginPage />);

  it('renders a Google sign-in control', () => {
    expect(markup).toMatch(/<button[^>]*>.*?Google<\/button>/);
  });

  it('offers nothing for Microsoft', () => {
    expect(markup).not.toMatch(/microsoft|azure/i);
  });

  it('renders Google as the only social sign-in button', () => {
    const socialSection = markup.slice(markup.indexOf('or continue with'));

    expect(socialSection.split('<button').length - 1).toBe(1);
  });
});
