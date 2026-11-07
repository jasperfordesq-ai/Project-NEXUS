// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { act, renderHook } from '@testing-library/react-native';
import { Keyboard, type ScrollView } from 'react-native';
import { useScrollToEndOnKeyboard } from './useScrollToEndOnKeyboard';

let keyboardShown: (() => void) | undefined;
const removeListener = jest.fn();

beforeEach(() => {
  jest.useFakeTimers();
  keyboardShown = undefined;
  removeListener.mockClear();
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, listener: () => void) => {
    if (event === 'keyboardDidShow') keyboardShown = listener;
    return { remove: removeListener };
  }) as unknown as typeof Keyboard.addListener);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function setup(keyboardAlreadyUp: boolean) {
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(keyboardAlreadyUp);
  const scrollToEnd = jest.fn();
  const hook = renderHook(() => useScrollToEndOnKeyboard());
  hook.result.current.scrollRef.current = { scrollToEnd } as unknown as ScrollView;
  return { hook, scrollToEnd };
}

it('scrolls to the end once the keyboard has opened for the focused box', () => {
  const { hook, scrollToEnd } = setup(false);
  act(() => { hook.result.current.bringEndIntoView(); });
  expect(scrollToEnd).not.toHaveBeenCalled();

  act(() => { keyboardShown?.(); });
  act(() => { jest.advanceTimersByTime(150); });
  expect(scrollToEnd).toHaveBeenCalledWith({ animated: true });
});

it('scrolls straight away when the keyboard is already up', () => {
  const { hook, scrollToEnd } = setup(true);
  act(() => { hook.result.current.bringEndIntoView(); });
  expect(scrollToEnd).toHaveBeenCalledWith({ animated: true });
});

it('leaves the screen alone when the keyboard opens for some other box', () => {
  const { scrollToEnd } = setup(false);
  act(() => { keyboardShown?.(); });
  act(() => { jest.advanceTimersByTime(150); });
  expect(scrollToEnd).not.toHaveBeenCalled();
});

it('scrolls once per focus, and stops listening when the screen goes', () => {
  const { hook, scrollToEnd } = setup(false);
  act(() => { hook.result.current.bringEndIntoView(); });
  act(() => { keyboardShown?.(); });
  act(() => { jest.advanceTimersByTime(150); });
  act(() => { keyboardShown?.(); });
  act(() => { jest.advanceTimersByTime(150); });
  expect(scrollToEnd).toHaveBeenCalledTimes(1);

  hook.unmount();
  expect(removeListener).toHaveBeenCalled();
});
