// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ScrollView, View } from 'react-native';
import { useScrollToFirstError } from './useScrollToFirstError';

function setup() {
  const inner = {} as View;
  const scrollTo = jest.fn();
  const scrollRef = { current: { getInnerViewRef: () => inner, scrollTo } as unknown as ScrollView };
  const field = (y: number) => ({ measureLayout: (relative: unknown, done: (x: number, y: number) => void) => { expect(relative).toBe(inner); done(0, y); } }) as unknown as View;
  const hook = renderHook(() => useScrollToFirstError<'title' | 'category' | 'hours'>(scrollRef));
  act(() => {
    hook.result.current.anchor('title')(field(100));
    hook.result.current.anchor('category')(field(900));
    hook.result.current.anchor('hours')(field(1100));
  });
  return { hook, scrollTo };
}

it('scrolls to the first invalid field in form order, not the first key in the error object', async () => {
  const { hook, scrollTo } = setup();
  act(() => { hook.result.current.reveal(['title', 'category', 'hours'], { hours: 'x', category: 'y' }); });
  await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ y: 884, animated: true }));
});

it('scrolls again on a repeated failed submit for the same field', async () => {
  const { hook, scrollTo } = setup();
  act(() => { hook.result.current.reveal(['title', 'category'], { category: 'y' }); });
  await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(1));
  act(() => { hook.result.current.reveal(['title', 'category'], { category: 'y' }); });
  await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(2));
});

it('does nothing when there are no errors', async () => {
  const { hook, scrollTo } = setup();
  act(() => { hook.result.current.reveal(['title', 'category'], {}); });
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(scrollTo).not.toHaveBeenCalled();
});

it('still scrolls after a StrictMode-style unmount and remount', async () => {
  const inner = {} as View;
  const scrollTo = jest.fn();
  const scrollRef = { current: { getInnerViewRef: () => inner, scrollTo } as unknown as ScrollView };
  const { result } = renderHook(() => useScrollToFirstError<'title'>(scrollRef), { wrapper: React.StrictMode });
  act(() => { result.current.anchor('title')({ measureLayout: (_r: unknown, done: (x: number, y: number) => void) => done(0, 500) } as unknown as View); });
  act(() => { result.current.reveal(['title'], { title: 'x' }); });
  await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ y: 484, animated: true }));
});
