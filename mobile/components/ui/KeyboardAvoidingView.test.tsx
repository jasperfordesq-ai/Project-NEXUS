// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import {
  Keyboard,
  KeyboardAvoidingView as NativeKeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  type KeyboardEvent,
} from 'react-native';
import { act, fireEvent, render, type RenderAPI } from '@testing-library/react-native';

import KeyboardAvoidingView from './KeyboardAvoidingView';

/** The screen, top to bottom, from the top of the window. */
const SCREEN_HEIGHT = 800;
/** Where the keyboard's top edge sits while it is up. */
const KEYBOARD_TOP = 500;
/**
 * What React Native 0.83 sends as `screenY` when the keyboard closes on Android 11+: the
 * visible area's HEIGHT (the screen less a 50-high status bar), where its bottom belongs.
 */
const HIDE_SCREEN_Y = 750;

const originalPlatformOS = Platform.OS;
// Every keyboard listener, in the order it subscribed, so the test can play the events
// React Native would send: React Native's own KeyboardAvoidingView, then ours.
let listeners: Record<string, ((event: KeyboardEvent) => void)[]> = {};

beforeEach(() => {
  listeners = {};
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((eventName: string, listener: (event: KeyboardEvent) => void) => {
    (listeners[eventName] ??= []).push(listener);
    return {
      remove: () => { listeners[eventName] = (listeners[eventName] ?? []).filter((each) => each !== listener); },
    };
  }) as unknown as typeof Keyboard.addListener);
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false);
});

afterEach(() => {
  jest.restoreAllMocks();
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalPlatformOS });
});

function onPlatform(os: 'android' | 'ios') {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
}

function keyboardEvent(screenY: number, height: number): KeyboardEvent {
  return { duration: 0, easing: 'keyboard', endCoordinates: { screenX: 0, screenY, width: 412, height } } as KeyboardEvent;
}

function styleOf(view: RenderAPI) {
  return StyleSheet.flatten(view.getByTestId('screen').props.style) ?? {};
}

/** Lays the screen out as the phone would: a fixed height when one is set, else the full screen. */
async function layOut(view: RenderAPI) {
  const { height } = styleOf(view);
  await act(async () => {
    fireEvent(view.getByTestId('screen'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 412, height: typeof height === 'number' ? height : SCREEN_HEIGHT } },
      persist: () => undefined,
    });
  });
}

/** Plays a keyboard event to every listener, then lets the screen lay itself out again. */
async function keyboard(view: RenderAPI, eventName: 'keyboardDidShow' | 'keyboardDidHide', event: KeyboardEvent) {
  await act(async () => {
    for (const listener of [...(listeners[eventName] ?? [])]) listener(event);
  });
  await layOut(view);
}

/** How much of the screen's height is kept clear for the keyboard. */
function roomForKeyboard(view: RenderAPI): number {
  const { height, paddingBottom } = styleOf(view);
  const outer = typeof height === 'number' ? height : SCREEN_HEIGHT;
  return SCREEN_HEIGHT - (outer - (typeof paddingBottom === 'number' ? paddingBottom : 0));
}

async function renderScreen(props: Partial<React.ComponentProps<typeof KeyboardAvoidingView>> = {}) {
  const view = render(
    <KeyboardAvoidingView testID="screen" style={{ flex: 1 }} behavior="height" {...props}>
      <Text>field</Text>
    </KeyboardAvoidingView>,
  );
  await layOut(view);
  return view;
}

describe('on Android', () => {
  beforeEach(() => onPlatform('android'));

  it('makes room while the keyboard is up, and gives all of it back when it closes', async () => {
    // React Native's own wrapper kept a band the height of the status bar after the
    // keyboard closed, on every screen with a keyboard (emulator, 7 November 2026).
    const view = await renderScreen();
    expect(roomForKeyboard(view)).toBe(0);

    await keyboard(view, 'keyboardDidShow', keyboardEvent(KEYBOARD_TOP, SCREEN_HEIGHT - KEYBOARD_TOP));
    expect(roomForKeyboard(view)).toBe(SCREEN_HEIGHT - KEYBOARD_TOP);

    await keyboard(view, 'keyboardDidHide', keyboardEvent(HIDE_SCREEN_Y, 0));
    expect(roomForKeyboard(view)).toBe(0);
  });

  it('makes exactly the same room each time the keyboard opens again', async () => {
    const view = await renderScreen();
    for (let round = 0; round < 3; round += 1) {
      await keyboard(view, 'keyboardDidShow', keyboardEvent(KEYBOARD_TOP, SCREEN_HEIGHT - KEYBOARD_TOP));
      expect(roomForKeyboard(view)).toBe(SCREEN_HEIGHT - KEYBOARD_TOP);
      await keyboard(view, 'keyboardDidHide', keyboardEvent(HIDE_SCREEN_Y, 0));
      expect(roomForKeyboard(view)).toBe(0);
    }
  });

  it('stays off when the screen switches it off', async () => {
    const view = await renderScreen({ enabled: false });
    await keyboard(view, 'keyboardDidShow', keyboardEvent(KEYBOARD_TOP, SCREEN_HEIGHT - KEYBOARD_TOP));
    expect(roomForKeyboard(view)).toBe(0);
  });

  it('does nothing for a screen that asks for no behaviour on Android', async () => {
    const view = await renderScreen({ behavior: undefined });
    await keyboard(view, 'keyboardDidShow', keyboardEvent(KEYBOARD_TOP, SCREEN_HEIGHT - KEYBOARD_TOP));
    expect(roomForKeyboard(view)).toBe(0);
  });
});

describe('on iOS', () => {
  beforeEach(() => onPlatform('ios'));

  it('is React Native’s own wrapper, unchanged', async () => {
    const view = await renderScreen({ behavior: 'padding', keyboardVerticalOffset: 64 });
    const native = view.UNSAFE_getByType(NativeKeyboardAvoidingView);
    expect(native.props).toEqual(expect.objectContaining({ behavior: 'padding', enabled: true, keyboardVerticalOffset: 64 }));
  });
});
