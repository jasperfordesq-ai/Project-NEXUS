// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React, { forwardRef } from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { FieldError, Label, TextArea as HeroTextArea, TextField } from 'heroui-native';

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
    ...rest
  },
  ref,
) {
  const isDisabled = editable === false;

  return (
    <TextField isInvalid={!!error} isDisabled={isDisabled} className={containerClassName ?? 'mb-3'}>
      {label ? (
        <Label focusable={false} className="mb-1.5 text-sm font-semibold">{label}</Label>
      ) : null}
      <HeroTextArea
        ref={ref}
        isInvalid={!!error}
        isDisabled={isDisabled}
        multiline
        numberOfLines={numberOfLines}
        style={[{ textAlignVertical: 'top' }, style]}
        className={inputClassName ?? 'min-h-28'}
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
