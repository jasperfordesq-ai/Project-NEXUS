// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/api/messages', () => ({
  sendTypingIndicator: jest.fn().mockResolvedValue({ data: { success: true } }),
}));

import { act, renderHook } from '@testing-library/react-native';

import { sendTypingIndicator } from '@/lib/api/messages';
import { useTypingSender } from './useTypingSender';

const mockSend = sendTypingIndicator as jest.Mock;

function typingCalls(value: boolean) {
  return mockSend.mock.calls.filter(([, isTyping]) => isTyping === value).length;
}

/*
  The typing signal costs a request each way (the route allows 60 a minute), so it is sent
  sparingly: once shortly after the member starts, at most every 3 s while they continue,
  and a single "stopped" when they pause, send, leave the box or leave the screen.
*/
describe('useTypingSender', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockSend.mockClear();
    mockSend.mockResolvedValue({ data: { success: true } });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sends "typing" 500 ms after the first non-empty change, then "stopped" after 3 s idle', () => {
    const { result } = renderHook(() => useTypingSender(9, true));

    act(() => result.current.onTextChange('h'));
    act(() => { jest.advanceTimersByTime(499); });
    expect(mockSend).not.toHaveBeenCalled();

    act(() => { jest.advanceTimersByTime(1); });
    expect(mockSend).toHaveBeenCalledWith(9, true);

    act(() => { jest.advanceTimersByTime(2999); });
    expect(typingCalls(false)).toBe(0);
    act(() => { jest.advanceTimersByTime(1); });
    expect(mockSend).toHaveBeenLastCalledWith(9, false);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('re-sends "typing" at most every 3 s while the member keeps typing', () => {
    const { result } = renderHook(() => useTypingSender(9, true));
    act(() => result.current.onTextChange('h'));
    act(() => { jest.advanceTimersByTime(500); });
    expect(typingCalls(true)).toBe(1);

    for (let i = 0; i < 6; i += 1) {
      act(() => {
        jest.advanceTimersByTime(1000);
        result.current.onTextChange('h'.repeat(i + 2));
      });
    }
    // t=0.5 s, then the changes at ≈3.5 s and ≈6.5 s; the ones in between are swallowed.
    expect(typingCalls(true)).toBe(3);
    expect(typingCalls(false)).toBe(0);
  });

  it('sends "stopped" once on send, and not again until typing resumes', () => {
    const { result } = renderHook(() => useTypingSender(9, true));
    act(() => result.current.onTextChange('h'));
    act(() => { jest.advanceTimersByTime(500); });

    act(() => result.current.onSend());
    expect(mockSend).toHaveBeenLastCalledWith(9, false);
    act(() => result.current.onSend());
    act(() => { jest.advanceTimersByTime(5000); });
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('sends "stopped" on blur only when a "typing" was sent', () => {
    const { result } = renderHook(() => useTypingSender(9, true));
    act(() => result.current.onBlur());
    expect(mockSend).not.toHaveBeenCalled();

    act(() => result.current.onTextChange('h'));
    act(() => { jest.advanceTimersByTime(500); });
    act(() => result.current.onBlur());
    expect(mockSend).toHaveBeenLastCalledWith(9, false);
  });

  it('sends "stopped" when it is disabled mid-typing and when it unmounts', () => {
    let enabled = true;
    const view = renderHook(() => useTypingSender(9, enabled));
    act(() => view.result.current.onTextChange('h'));
    act(() => { jest.advanceTimersByTime(500); });
    expect(typingCalls(true)).toBe(1);

    enabled = false;
    view.rerender({});
    expect(typingCalls(false)).toBe(1);

    // Disabled: nothing goes out, not even after a debounce.
    act(() => view.result.current.onTextChange('hello'));
    act(() => { jest.advanceTimersByTime(1000); });
    expect(mockSend).toHaveBeenCalledTimes(2);

    enabled = true;
    view.rerender({});
    act(() => view.result.current.onTextChange('hello again'));
    act(() => { jest.advanceTimersByTime(500); });
    expect(typingCalls(true)).toBe(2);
    view.unmount();
    expect(typingCalls(false)).toBe(2);
  });

  it('does nothing without a recipient, and an empty change never starts it', () => {
    const noRecipient = renderHook(() => useTypingSender(null, true));
    act(() => noRecipient.result.current.onTextChange('h'));
    act(() => { jest.advanceTimersByTime(1000); });
    expect(mockSend).not.toHaveBeenCalled();

    const { result } = renderHook(() => useTypingSender(9, true));
    act(() => result.current.onTextChange(''));
    act(() => { jest.advanceTimersByTime(1000); });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('swallows a failed request', () => {
    mockSend.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useTypingSender(9, true));
    act(() => result.current.onTextChange('h'));
    expect(() => {
      act(() => { jest.advanceTimersByTime(500); });
    }).not.toThrow();
    expect(mockSend).toHaveBeenCalledWith(9, true);
  });
});
