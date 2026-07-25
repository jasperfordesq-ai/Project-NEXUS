// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import {
  type ChangeEvent,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';
import { useTranslation } from 'react-i18next';
import { CloseButton as HeroUICloseButton } from '@heroui/react/close-button';
import { Description } from '@heroui/react/description';
import { FieldError } from '@heroui/react/field-error';
import { Input as HeroUIInput, type InputProps as HeroUIInputProps } from '@heroui/react/input';
import { Label } from '@heroui/react/label';
import { TextField, type TextFieldProps } from '@heroui/react/textfield';

type LegacyVariant = 'flat' | 'bordered' | 'underlined' | 'faded';
type V3Variant = NonNullable<HeroUIInputProps['variant']>;

export type InputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'color' | 'onChange' | 'size'
> & {
  className?: string;
  classNames?: {
    base?: string;
    input?: string;
    inputWrapper?: string;
    label?: string;
    description?: string;
    errorMessage?: string;
  };
  clearButtonLabel?: string;
  color?: 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger';
  description?: ReactNode;
  errorMessage?: ReactNode | ((value: string) => ReactNode);
  fullWidth?: boolean;
  isDisabled?: boolean;
  isClearable?: boolean;
  isInvalid?: boolean;
  isReadOnly?: boolean;
  isRequired?: boolean;
  label?: ReactNode;
  labelPlacement?: 'inside' | 'outside' | 'outside-left';
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  onClear?: () => void;
  onValueChange?: (value: string) => void;
  radius?: 'none' | 'sm' | 'md' | 'lg' | 'full';
  size?: 'sm' | 'md' | 'lg';
  startContent?: ReactNode;
  endContent?: ReactNode;
  validate?: TextFieldProps['validate'];
  variant?: LegacyVariant | V3Variant;
};

function mapVariant(variant?: InputProps['variant']): V3Variant {
  return variant === 'bordered' || variant === 'underlined' || variant === 'faded'
    ? 'secondary'
    : 'primary';
}

function sizeClass(size?: InputProps['size']): string | undefined {
  switch (size) {
    case 'sm':
      return 'min-h-8 px-3 py-1 text-sm';
    case 'lg':
      return 'min-h-12 px-4 py-3 text-base';
    default:
      return undefined;
  }
}

function radiusClass(radius?: InputProps['radius']): string | undefined {
  switch (radius) {
    case 'none':
      return 'rounded-none';
    case 'sm':
      return 'rounded-sm';
    case 'md':
      return 'rounded-md';
    case 'lg':
      return 'rounded-lg';
    case 'full':
      return 'rounded-full';
    default:
      return undefined;
  }
}

function combineClasses(...classes: Array<string | false | undefined>): string | undefined {
  const className = classes.filter(Boolean).join(' ');

  return className || undefined;
}

function decoratedInputClass(className?: string): string | undefined {
  return combineClasses(
    'h-full min-h-7 w-full min-w-0 flex-1 self-stretch rounded-none border-0 bg-transparent px-0 py-0 text-base leading-7 shadow-none outline-none sm:text-sm',
    'focus-visible:border-transparent focus-visible:ring-0',
    className,
  );
}

function decoratedWrapperClass(
  className: string | undefined,
  size: InputProps['size'],
  radius: InputProps['radius'],
): string | undefined {
  return combineClasses(
    'flex min-h-10 w-full items-center gap-2 px-3 py-2',
    // The inner input is chrome-stripped (ring-0/outline-none), so this wrapper
    // is the field shell and must draw the visible focus indicator itself
    // (WCAG 2.4.7). Styled by the unlayered .nexus-field-shell rule in
    // index.css — utility rings/outlines lose to unlayered caller CSS
    // (e.g. .glass-card) and HeroUI's focus-within outline resets.
    'nexus-field-shell',
    sizeClass(size),
    radiusClass(radius),
    className,
  );
}

function InputClearButton({
  label,
  onClear,
  onValueChange,
}: {
  label?: string;
  onClear?: () => void;
  onValueChange?: (value: string) => void;
}) {
  const { t } = useTranslation('common');

  return (
    <HeroUICloseButton
      aria-label={label ?? t('accessibility.clear_input')}
      className="shrink-0"
      onPress={() => {
        onClear?.();
        onValueChange?.('');
      }}
    />
  );
}

export function Input({
  className,
  classNames,
  clearButtonLabel,
  color: _color,
  description,
  errorMessage,
  fullWidth,
  isClearable,
  isDisabled,
  isInvalid,
  isReadOnly,
  isRequired,
  label,
  labelPlacement: _labelPlacement,
  onChange,
  onClear,
  onValueChange,
  radius,
  size,
  startContent,
  endContent,
  style,
  validate,
  variant,
  ref,
  ...props
}: InputProps & { ref?: Ref<HTMLInputElement> }) {
  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange?.(event);
    onValueChange?.(event.target.value);
  };

  const clearButton = isClearable ? (
    <InputClearButton
      label={clearButtonLabel}
      onClear={onClear}
      onValueChange={onValueChange}
    />
  ) : null;
  const trailingContent = endContent ?? clearButton;

  const inputElement = (
    <HeroUIInput
      className={combineClasses(
        startContent || trailingContent
          ? decoratedInputClass(classNames?.input)
          : classNames?.input,
        !startContent && !endContent && classNames?.inputWrapper,
        !(startContent || trailingContent) && sizeClass(size),
        !startContent && !endContent && radiusClass(radius),
        'text-base sm:text-sm',
      )}
      disabled={isDisabled}
      fullWidth={fullWidth}
      readOnly={isReadOnly}
      required={isRequired}
      ref={ref}
      variant={mapVariant(variant)}
      onChange={handleInputChange}
      {...props}
    />
  );

  const input = startContent || trailingContent ? (
    <div
      className={decoratedWrapperClass(
        classNames?.inputWrapper,
        size,
        radius,
      )}
    >
      {startContent ? <span className="shrink-0">{startContent}</span> : null}
      {inputElement}
      {trailingContent ? <span className="shrink-0">{trailingContent}</span> : null}
    </div>
  ) : inputElement;

  const fieldStyle = style as CSSProperties | undefined;

  if (!label && !description && !errorMessage && !isInvalid && !isRequired && !validate) {
    if (startContent || trailingContent) {
      return (
        <div
          className={combineClasses(
            decoratedWrapperClass(
              classNames?.inputWrapper,
              size,
              radius,
            ),
            classNames?.base,
            className,
          )}
          style={fieldStyle}
        >
          {startContent ? <span className="shrink-0">{startContent}</span> : null}
          <HeroUIInput
            aria-invalid={isInvalid || undefined}
            className={decoratedInputClass(classNames?.input)}
            disabled={isDisabled}
            fullWidth={fullWidth}
            readOnly={isReadOnly}
            required={isRequired}
            ref={ref}
            variant={mapVariant(variant)}
            onChange={handleInputChange}
            {...props}
          />
          {trailingContent ? <span className="shrink-0">{trailingContent}</span> : null}
        </div>
      );
    }

    return (
      <HeroUIInput
        aria-invalid={isInvalid || undefined}
        className={combineClasses(
          classNames?.base,
          classNames?.inputWrapper,
          classNames?.input,
          sizeClass(size),
          radiusClass(radius),
          'text-base sm:text-sm',
          className,
        )}
        disabled={isDisabled}
        fullWidth={fullWidth}
        readOnly={isReadOnly}
        required={isRequired}
        ref={ref}
        style={fieldStyle}
        variant={mapVariant(variant)}
        onChange={handleInputChange}
        {...props}
      />
    );
  }

  return (
    <TextField
      className={combineClasses('flex w-full flex-col gap-1', classNames?.base, className)}
      fullWidth={fullWidth}
      isDisabled={isDisabled}
      isInvalid={isInvalid}
      isReadOnly={isReadOnly}
      isRequired={isRequired}
      name={props.name}
      style={fieldStyle}
      validate={validate}
      variant={mapVariant(variant)}
    >
      {label ? <Label className={classNames?.label}>{label}</Label> : null}
      {input}
      {description ? (
        <Description className={classNames?.description}>{description}</Description>
      ) : null}
      {errorMessage ? (
        <FieldError className={classNames?.errorMessage}>
          {typeof errorMessage === 'function'
            ? errorMessage(String(props.value ?? ''))
            : errorMessage}
        </FieldError>
      ) : null}
    </TextField>
  );
}
