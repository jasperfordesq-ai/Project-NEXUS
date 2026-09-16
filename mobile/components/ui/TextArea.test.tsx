// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { TextInput } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import TextArea from './TextArea';
import { SheetFormFocusContext } from './sheetFormFocus';

jest.mock('heroui-native', () => {
  const React = require('react');
  const { Text, TextInput, View } = require('react-native');

  const TextField = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  const Label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;
  const FieldError = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;
  const HeroTextArea = React.forwardRef(
    (
      props: {
        accessibilityLabel?: string;
        onChangeText?: (value: string) => void;
        placeholder?: string;
        value?: string;
      },
      ref: React.Ref<TextInput>,
    ) => <TextInput ref={ref} multiline {...props} />,
  );

  return { FieldError, Label, TextArea: HeroTextArea, TextField };
});

describe('TextArea', () => {
  it('bounds long sheet notes and registers the native editor for focus scrolling', () => {
    const reveal = jest.fn();
    const ref = React.createRef<TextInput>();
    const { getByLabelText } = render(
      <SheetFormFocusContext.Provider value={reveal}>
        <TextArea ref={ref} label="Note" value={'Long note\n'.repeat(30)} />
      </SheetFormFocusContext.Provider>,
    );
    const input = getByLabelText('Note');
    expect(input.props.scrollEnabled).toBe(true);
    expect(input.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ height: 112, maxHeight: 112 })]));
    fireEvent(input, 'focus', { nativeEvent: { target: 1 } });
    expect(reveal).toHaveBeenLastCalledWith(ref.current);
    fireEvent(input, 'blur', { nativeEvent: { target: 1 } });
    expect(reveal).toHaveBeenLastCalledWith(null);
  });
  it('renders a HeroUI Native text area with label, value, and validation state', () => {
    const onChangeText = jest.fn();
    const { getByDisplayValue, getByLabelText, getByText } = render(
      <TextArea
        label="Comment"
        value="A useful reply"
        error="Write at least 3 characters"
        placeholder="Write a comment"
        accessibilityLabel="Comment"
        onChangeText={onChangeText}
      />,
    );

    expect(getByText('Comment')).toBeTruthy();
    expect(getByDisplayValue('A useful reply')).toBeTruthy();
    expect(getByText('Write at least 3 characters')).toBeTruthy();

    fireEvent.changeText(getByLabelText('Comment'), 'A better reply');
    expect(onChangeText).toHaveBeenCalledWith('A better reply');
  });

  it('forwards refs to the native text input', () => {
    const ref = React.createRef<TextInput>();

    render(<TextArea ref={ref} value="" placeholder="Reply" />);

    expect(ref.current).toBeTruthy();
  });

  it('preserves caller focus and blur handlers while wiring sheet keyboard awareness', () => {
    const onFocus = jest.fn();
    const onBlur = jest.fn();
    const { getByPlaceholderText } = render(
      <TextArea placeholder="Sheet notes" onFocus={onFocus} onBlur={onBlur} />,
    );
    const input = getByPlaceholderText('Sheet notes');

    fireEvent(input, 'focus', { nativeEvent: { target: 1 } });
    fireEvent(input, 'blur', { nativeEvent: { target: 1 } });

    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});
