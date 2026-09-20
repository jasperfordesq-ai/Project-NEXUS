// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { Linking } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { useOpenExternalUrl } from './useOpenExternalUrl';

const mockShow = jest.fn();
jest.mock('@/components/ui/AppToast', () => ({ useAppToast: () => ({ show: mockShow }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
});

it('suppresses a late website failure after the calling screen unmounts', async () => {
  let fail!: (error: Error) => void;
  jest.mocked(Linking.openURL).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  const screen = renderHook(() => useOpenExternalUrl());
  const pending = screen.result.current('https://example.org');
  expect(Linking.openURL).toHaveBeenCalledTimes(1);
  screen.unmount();
  await act(async () => { fail(new Error('Handler failed')); await pending; });
  expect(await pending).toBe('unopenable');
  expect(mockShow).not.toHaveBeenCalled();
});

it('reports an active-screen website failure under StrictMode replay', async () => {
  jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error('Handler failed'));
  const screen = renderHook(() => useOpenExternalUrl(), {
    wrapper: ({ children }: { children: React.ReactNode }) => <React.StrictMode>{children}</React.StrictMode>,
  });
  await act(async () => { expect(await screen.result.current('https://example.org')).toBe('unopenable'); });
  expect(mockShow).toHaveBeenCalledWith({ title: 'errors.linkOpenFailed', variant: 'danger' });
});

it('reports an invalid destination without dispatching it', async () => {
  const screen = renderHook(() => useOpenExternalUrl());
  await act(async () => { expect(await screen.result.current('')).toBe('invalid'); });
  expect(Linking.openURL).not.toHaveBeenCalled();
  expect(mockShow).toHaveBeenCalledWith({ title: 'errors.linkUnavailable', variant: 'warning' });
});

it('returns successful dispatch without an error message', async () => {
  const screen = renderHook(() => useOpenExternalUrl());
  await act(async () => { expect(await screen.result.current('https://example.org')).toBe('opened'); });
  expect(Linking.openURL).toHaveBeenCalledWith('https://example.org');
  expect(mockShow).not.toHaveBeenCalled();
});
