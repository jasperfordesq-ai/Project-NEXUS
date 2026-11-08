// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The verify screen opened twice for ONE tapped link, against the real
 * `verifyEmail` and a fake server that accepts a code once, as the real one does.
 *
 * 🔴 Why twice: Expo Router opens the link itself (`+native-intent.ts`), then the root
 * navigator replays the same link (`decideAuthRedirect` → `navigateToLink`), and
 * `router.replace` to the same screen gives it a new key, so React mounts a fresh copy.
 * Each copy used to send the code. The server accepted the first, deleted the code, and
 * refused the second — and the second copy is the one left on screen, so the member
 * read "Could not verify email" about an address that had just been verified.
 *
 * `verify-email.test.tsx` mocks `@/lib/api/auth` wholesale, so it cannot see this.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

const mockPost = jest.fn();
jest.mock('@/lib/api/client', () => ({
  api: { post: (...args: unknown[]) => mockPost(...args), get: jest.fn() },
  ApiResponseError: class ApiResponseError extends Error {
    status!: number;
    constructor(status: number, message: string) { super(message); this.status = status; this.name = 'ApiResponseError'; }
  },
  registerUnauthorizedCallback: jest.fn(),
}));

let mockParams: Record<string, string | undefined> = {};
jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'test-community' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));

import { ApiResponseError } from '@/lib/api/client';
import VerifyEmailScreen from './verify-email';

/** A server that verifies an address once and then forgets the code, as Laravel does. */
function singleUseServer() {
  const used = new Set<string>();
  let release: (() => void) | null = null;
  const held = new Promise<void>((resolve) => { release = resolve; });
  mockPost.mockImplementation(async (url: string, body: { token: string }) => {
    if (url !== '/api/auth/verify-email') throw new Error(`unexpected request ${url}`);
    if (used.has(body.token)) {
      throw new ApiResponseError(400, 'Invalid or expired verification token');
    }
    used.add(body.token);
    await held;
    return { success: true, data: { verified: true, message: 'Your email address is verified.' } };
  });
  return { answer: () => release?.() };
}

describe('VerifyEmailScreen opened twice for one link', () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it('shows the verified state when the copy is replaced before the server answers', async () => {
    mockParams = { token: 'token-replaced-while-waiting' };
    const server = singleUseServer();

    // Expo Router opens the link: the first copy sends the code.
    const first = render(<VerifyEmailScreen />);
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));

    // The root navigator replays it: router.replace unmounts the first copy and mounts a new one.
    first.unmount();
    const second = render(<VerifyEmailScreen />);
    server.answer();

    expect(await second.findByText('Email verified')).toBeTruthy();
    expect(second.queryByText('Could not verify email')).toBeNull();
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('shows the verified state when the copy is replaced after the server answered', async () => {
    mockParams = { token: 'token-replaced-after-answer' };
    const server = singleUseServer();
    server.answer();

    const first = render(<VerifyEmailScreen />);
    expect(await first.findByText('Email verified')).toBeTruthy();

    first.unmount();
    const second = render(<VerifyEmailScreen />);

    expect(await second.findByText('Email verified')).toBeTruthy();
    expect(second.queryByText('Could not verify email')).toBeNull();
    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});
