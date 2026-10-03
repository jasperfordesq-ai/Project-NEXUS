// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { isHotkeyTarget, useHotkey } from './useHotkey';

function press(key: string, init: KeyboardEventInit & { target?: Element } = {}) {
  const { target, ...rest } = init;
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...rest });
  (target ?? document.body).dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useHotkey', () => {
  it('runs the handler for a bare key press on the page and claims the event', () => {
    const onJ = vi.fn();
    renderHook(() => useHotkey({ j: onJ }));

    const event = press('j');
    expect(onJ).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does nothing for keys that are not in the map', () => {
    const onJ = vi.fn();
    renderHook(() => useHotkey({ j: onJ }));

    const event = press('x');
    expect(onJ).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('matches the key exactly, so Shift+J is not j', () => {
    const onJ = vi.fn();
    renderHook(() => useHotkey({ j: onJ }));

    press('J', { shiftKey: true });
    expect(onJ).not.toHaveBeenCalled();
  });

  it.each([
    ['input', () => Object.assign(document.createElement('input'), { type: 'text' })],
    ['search input', () => Object.assign(document.createElement('input'), { type: 'search' })],
    ['textarea', () => document.createElement('textarea')],
    ['select', () => document.createElement('select')],
    [
      'contenteditable',
      () => {
        const div = document.createElement('div');
        div.setAttribute('contenteditable', 'true');
        // jsdom does not derive isContentEditable from the attribute.
        Object.defineProperty(div, 'isContentEditable', { value: true });
        return div;
      },
    ],
  ])('ignores the key while typing in a %s', (_label, make) => {
    const onR = vi.fn();
    renderHook(() => useHotkey({ r: onR }));
    const el = make();
    document.body.appendChild(el);

    const event = press('r', { target: el });
    expect(onR).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it.each([['ctrlKey'], ['metaKey'], ['altKey']])('ignores the key with %s held', (modifier) => {
    const onR = vi.fn();
    renderHook(() => useHotkey({ r: onR }));

    press('r', { [modifier]: true });
    expect(onR).not.toHaveBeenCalled();
  });

  it('ignores keys pressed inside an open dialog', () => {
    const onA = vi.fn();
    renderHook(() => useHotkey({ a: onA }));
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const button = document.createElement('button');
    dialog.appendChild(button);
    document.body.appendChild(dialog);

    press('a', { target: button });
    expect(onA).not.toHaveBeenCalled();
  });

  it('leaves Enter to a focused button or link, which it already activates', () => {
    const onEnter = vi.fn();
    renderHook(() => useHotkey({ Enter: onEnter }));
    const button = document.createElement('button');
    const link = document.createElement('a');
    link.href = '/somewhere';
    document.body.append(button, link);

    press('Enter', { target: button });
    press('Enter', { target: link });
    expect(onEnter).not.toHaveBeenCalled();

    press('Enter');
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('still runs a letter key when a button happens to have focus', () => {
    const onJ = vi.fn();
    renderHook(() => useHotkey({ j: onJ }));
    const button = document.createElement('button');
    document.body.appendChild(button);

    press('j', { target: button });
    expect(onJ).toHaveBeenCalledTimes(1);
  });

  it('does nothing while disabled', () => {
    const onJ = vi.fn();
    renderHook(() => useHotkey({ j: onJ }, { enabled: false }));

    press('j');
    expect(onJ).not.toHaveBeenCalled();
  });

  it('uses the latest handlers without re-subscribing', () => {
    const first = vi.fn();
    const second = vi.fn();
    const addSpy = vi.spyOn(window, 'addEventListener');
    const { rerender } = renderHook(({ fn }) => useHotkey({ j: fn }), { initialProps: { fn: first } });
    const subscriptions = addSpy.mock.calls.filter(([type]) => type === 'keydown').length;

    rerender({ fn: second });
    press('j');

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(addSpy.mock.calls.filter(([type]) => type === 'keydown').length).toBe(subscriptions);
    addSpy.mockRestore();
  });

  it('removes its listener on unmount', () => {
    const onJ = vi.fn();
    const { unmount } = renderHook(() => useHotkey({ j: onJ }));
    unmount();

    press('j');
    expect(onJ).not.toHaveBeenCalled();
  });
});

describe('isHotkeyTarget', () => {
  it('treats the document body and plain elements as hotkey targets', () => {
    expect(isHotkeyTarget(document.body)).toBe(true);
    expect(isHotkeyTarget(document.createElement('div'))).toBe(true);
    expect(isHotkeyTarget(null)).toBe(true);
  });

  it('rejects typing targets', () => {
    expect(isHotkeyTarget(document.createElement('input'))).toBe(false);
    expect(isHotkeyTarget(document.createElement('textarea'))).toBe(false);
  });
});
