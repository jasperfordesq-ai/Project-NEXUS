// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React, { forwardRef } from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { useSheetFormFocus } from './sheetFormFocus';
import {
  FieldError,
  Label,
  TextArea as HeroTextArea,
  TextField,
  useBottomSheetAwareHandlers,
} from 'heroui-native';

const noopBottomSheetHandlers = {
  onFocus: () => undefined,
  onBlur: () => undefined,
};

// Some focused component tests use a minimal HeroUI visual mock. The real app
// always supplies the hook; the fallback only keeps those isolated mocks valid.
const useTextAreaBottomSheetHandlers = typeof useBottomSheetAwareHandlers === 'function'
  ? useBottomSheetAwareHandlers
  : () => noopBottomSheetHandlers;

interface TextAreaProps extends TextInputProps {
  label?: string;
  error?: string;
  containerClassName?: string;
  inputClassName?: string;
}

const TextArea = forwardRef<TextInput, TextAreaProps>(function TextArea(
  {
    label,
    error,
    containerClassName,
    inputClassName,
    style,
    editable,
    numberOfLines = 4,
    onFocus,
    onBlur,
    ...rest
  },
  ref,
) {
  const isDisabled = editable === false;
  const sheetFocus = useSheetFormFocus(ref);
  const bottomSheetHandlers = useTextAreaBottomSheetHandlers();

  return (
    <TextField isInvalid={!!error} isDisabled={isDisabled} className={containerClassName ?? 'mb-3'}>
      {label ? (
        <Label focusable={false} className="mb-1.5 text-sm font-semibold">{label}</Label>
      ) : null}
      <HeroTextArea
        ref={sheetFocus.inputRef}
        isInvalid={!!error}
        isDisabled={isDisabled}
        multiline
        numberOfLines={numberOfLines}
        style={[{ textAlignVertical: 'top' }, style, sheetFocus.inSheet ? { height: 112, minHeight: 0, maxHeight: 112 } : undefined]}
        scrollEnabled
        className={inputClassName ?? 'min-h-28'}
        onFocus={(event) => {
          bottomSheetHandlers.onFocus(event);
          sheetFocus.reveal();
          onFocus?.(event);
        }}
        onBlur={(event) => {
          bottomSheetHandlers.onBlur(event);
          sheetFocus.blur();
          onBlur?.(event);
        }}
        {...rest}
        accessibilityLabel={rest.accessibilityLabel ?? label}
      />
      {error ? (
        <FieldError className="mt-1 text-xs">{error}</FieldError>
      ) : null}
    </TextField>
  );
});

export default TextArea;
