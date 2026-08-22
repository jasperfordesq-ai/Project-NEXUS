// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React, { forwardRef } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import { FieldError, Input as HeroInput, Label, TextField } from 'heroui-native';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  containerClassName?: string;
  inputClassName?: string;
}

const Input = forwardRef<TextInput, InputProps>(function Input(
  {
    label,
    error,
    leftIcon,
    rightIcon,
    containerClassName,
    inputClassName,
    style,
    editable,
    ...rest
  },
  ref,
) {
  const isDisabled = editable === false;

  /**
   * 🔴 `w-full` FIRST, always, then the caller's classes.
   *
   * Without it this component is sized by its CONTENT, and two live screens shipped with a
   * field the width of a pill: the wallet's "send credits" recipient search, and the group
   * "start a discussion" title. Both were measured on a device on 2026-08-22, and in both
   * cases the source looked fine — the caller had simply not thought to add a width, because
   * a form field being full width is the obvious default.
   *
   * Why it happens here and not in `TextArea`, which is full width with the same
   * `containerClassName` handling: this component wraps its field in an intermediate
   * `flex-row` (for the left/right icons) and gives the inner field `flex-1`. `flex-1` fills
   * the row, the row fills the container — and the container was never told to fill
   * anything, so the whole stack collapsed to the text inside it. The third distinct way
   * `flex-1` does nothing in this app, and the same shape as the other two: the class is on
   * a different element from the one that decides the size.
   *
   * A caller that genuinely wants a narrower field still can: `flex-1`, `basis-*` and an
   * explicit `w-*` all take precedence over `w-full` on the main axis, which is exactly how
   * the wallet's search field sits beside its button.
   */
  const containerClasses = `w-full ${containerClassName ?? 'mb-3'}`;

  return (
    <TextField isInvalid={!!error} isDisabled={isDisabled} className={containerClasses}>
      {label ? (
        <Label className="mb-1.5 text-sm font-semibold">{label}</Label>
      ) : null}
      <View className="w-full flex-row items-center">
        {leftIcon ? (
          <View className="pl-3 absolute left-0 z-10">{leftIcon}</View>
        ) : null}
        <HeroInput
          ref={ref}
          isInvalid={!!error}
          isDisabled={isDisabled}
          style={[
            // 🔴 The fill lives in `style`, not in a class, and that is deliberate.
            //
            // `className="flex-1"` here did nothing: HeroUI Native animates some style
            // properties on its Input and its own start-up notice says animated styles take
            // precedence over className. The result was a field sized to its placeholder
            // text — the wallet's recipient search and the group discussion title both
            // shipped as narrow pills — while the container around it was full width, which
            // is why it looked like a container problem and was not.
            //
            // Measured on a device on 2026-08-22 by painting the container red: the
            // container filled the row, the field did not.
            { flexGrow: 1, flexBasis: 0 },
            leftIcon ? { paddingLeft: 40 } : undefined,
            rightIcon ? { paddingRight: 40 } : undefined,
            // Caller's style last, so an explicit width still wins.
            style,
          ]}
          className={inputClassName ?? 'flex-1'}
          {...rest}
        />
        {rightIcon ? (
          <View className="pr-3 absolute right-0 z-10">{rightIcon}</View>
        ) : null}
      </View>
      {error ? (
        <FieldError className="mt-1 text-xs">{error}</FieldError>
      ) : null}
    </TextField>
  );
});

export default Input;
