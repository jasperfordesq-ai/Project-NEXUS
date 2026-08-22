// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The four behaviours that matter, one test each. The third is the one that was broken
 * everywhere: a deep link into a screen that is already open.
 */

import { act, renderHook } from '@testing-library/react-native';

import { firstParam, useParamTab } from './useParamTab';

type Tab = 'browse' | 'alerts' | 'mine';

const resolve = (raw: string | undefined): Tab | null => {
  if (raw === 'alerts') return 'alerts';
  if (raw === 'mine' || raw === 'myPostings') return 'mine';
  if (raw === 'browse') return 'browse';
  return null;
};

describe('useParamTab', () => {
  it('honours the parameter on the first render', () => {
    const { result } = renderHook(() => useParamTab<Tab>('alerts', resolve, 'browse'));
    expect(result.current[0]).toBe('alerts');
  });

  it('falls back when the parameter is absent or unrecognised', () => {
    expect(renderHook(() => useParamTab<Tab>(undefined, resolve, 'browse')).result.current[0]).toBe('browse');
    expect(renderHook(() => useParamTab<Tab>('nonsense', resolve, 'browse')).result.current[0]).toBe('browse');
  });

  it('moves the tab when the parameter changes on an ALREADY OPEN screen', () => {
    const { result, rerender } = renderHook(
      ({ view }: { view?: string }) => useParamTab<Tab>(view, resolve, 'browse'),
      { initialProps: { view: undefined as string | undefined } },
    );

    expect(result.current[0]).toBe('browse');

    rerender({ view: 'alerts' });

    expect(result.current[0]).toBe('alerts');
  });

  it('does not undo a tap the member made themselves', () => {
    const { result, rerender } = renderHook(
      ({ view }: { view?: string }) => useParamTab<Tab>(view, resolve, 'browse'),
      { initialProps: { view: 'alerts' as string | undefined } },
    );

    expect(result.current[0]).toBe('alerts');

    act(() => result.current[1]('mine'));
    expect(result.current[0]).toBe('mine');

    // A plain re-render with the SAME parameter must not drag them back to 'alerts'.
    rerender({ view: 'alerts' });
    expect(result.current[0]).toBe('mine');
  });

  it('leaves the current tab alone when a later parameter is unrecognised', () => {
    const { result, rerender } = renderHook(
      ({ view }: { view?: string }) => useParamTab<Tab>(view, resolve, 'browse'),
      { initialProps: { view: 'alerts' as string | undefined } },
    );

    rerender({ view: 'something-else' });

    expect(result.current[0]).toBe('alerts');
  });

  it('firstParam takes the first of a repeated query parameter', () => {
    expect(firstParam(['alerts', 'browse'])).toBe('alerts');
    expect(firstParam('alerts')).toBe('alerts');
    expect(firstParam(undefined)).toBeUndefined();
  });
});
