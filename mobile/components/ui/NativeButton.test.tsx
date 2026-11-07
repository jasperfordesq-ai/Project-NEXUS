// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { Platform, Text, View } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { Button } from './NativeButton';
import AppButton from './Button';

const realPlatform = Platform.OS;
function onPlatform(os: 'android' | 'ios') {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
}
afterEach(() => onPlatform(realPlatform as 'android' | 'ios'));

/**
 * 🔴 On Android, React Native (BaseViewManager.updateViewContentDescription) writes "busy"
 * into a button's description when accessibilityState.busy turns true and the button has no
 * accessibilityLabel, and never clears it when busy turns false. TalkBack then said "busy"
 * instead of the button's words for as long as the screen stayed open: "Verify and turn on"
 * after a wrong code, the welcome wizard's Next and Not now after the profile was saved
 * (Android 16 emulator, 7 November 2026). A button that reports busy therefore always carries
 * its own words as its label, so the description is rebuilt as "Next" or "Next, busy".
 */
describe('NativeButton: a button that reports busy keeps its name', () => {
  it('names the button after its text', () => {
    render(<Button testID="b" accessibilityState={{ busy: false }}>Verify and turn on</Button>);
    expect(screen.getByTestId('b').props.accessibilityLabel).toBe('Verify and turn on');
  });

  it('reads the words inside a Label, ignoring a spinner beside them', () => {
    render(
      <Button testID="b" accessibilityState={{ busy: true }}>
        <View testID="spinner" />
        <Button.Label>Save changes</Button.Label>
      </Button>,
    );
    expect(screen.getByTestId('b').props.accessibilityLabel).toBe('Save changes');
    expect(screen.getByTestId('b').props.accessibilityState).toMatchObject({ busy: true });
  });

  it('joins words split across pieces the way they read', () => {
    render(
      <Button testID="b" accessibilityState={{ busy: false }}>
        <Button.Label>{'Load '}{3}{' more'}</Button.Label>
        <Text>items</Text>
      </Button>,
    );
    expect(screen.getByTestId('b').props.accessibilityLabel).toBe('Load 3 more items');
  });

  it('keeps a label the screen gave it', () => {
    render(
      <Button testID="b" accessibilityLabel="Upload profile photo" accessibilityState={{ busy: false }}>
        Change photo
      </Button>,
    );
    expect(screen.getByTestId('b').props.accessibilityLabel).toBe('Upload profile photo');
  });

  it('on Android, leaves busy out when the button has no words, rather than let "busy" stick to it', () => {
    onPlatform('android');
    render(
      <Button testID="b" isIconOnly isDisabled accessibilityState={{ busy: true }}>
        <View />
      </Button>,
    );
    const button = screen.getByTestId('b');
    expect(button.props.accessibilityLabel).toBeUndefined();
    // React Native's Pressable lists every state key, so "not reported" reads as undefined.
    expect(button.props.accessibilityState.busy).toBeUndefined();
    expect(button.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('on iPhone, still reports busy for a button with no words: nothing pins it there', () => {
    onPlatform('ios');
    render(
      <Button testID="b" isIconOnly isDisabled accessibilityState={{ busy: true }}>
        <View />
      </Button>,
    );
    expect(screen.getByTestId('b').props.accessibilityState).toMatchObject({ busy: true, disabled: true });
  });

  it('leaves a button that never reports busy as it was', () => {
    render(<Button testID="b">Open</Button>);
    expect(screen.getByTestId('b').props.accessibilityLabel).toBeUndefined();
  });
});

describe('Button: the shared button keeps its name while and after loading', () => {
  it('is named after its text while loading and once loading ends', () => {
    const view = render(<AppButton testID="b" isLoading>Next</AppButton>);
    expect(screen.getByTestId('b').props.accessibilityLabel).toBe('Next');
    expect(screen.getByTestId('b').props.accessibilityState).toMatchObject({ busy: true });

    view.rerender(<AppButton testID="b">Next</AppButton>);
    expect(screen.getByTestId('b').props.accessibilityLabel).toBe('Next');
    expect(screen.getByTestId('b').props.accessibilityState).toMatchObject({ busy: false });
  });
});
