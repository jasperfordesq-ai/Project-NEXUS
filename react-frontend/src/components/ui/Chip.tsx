// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { type ElementType, type HTMLAttributes, type ReactNode } from 'react';
import { Chip as HeroUIChip, type ChipProps as HeroUIChipProps } from '@heroui/react/chip';
import { CloseButton } from '@heroui/react/close-button';
import { useTranslation } from 'react-i18next';

type V2ChipColor =
  | 'default'
  | 'primary'
  | 'secondary'
  | 'success'
  | 'warning'
  | 'danger';

type V2ChipVariant =
  | 'solid'
  | 'bordered'
  | 'light'
  | 'flat'
  | 'faded'
  | 'shadow'
  | 'dot';

type V3ChipColor = NonNullable<HeroUIChipProps['color']>;
type V3ChipVariant = NonNullable<HeroUIChipProps['variant']>;

export type ChipProps = Omit<
  HeroUIChipProps,
  'color' | 'variant' | 'children' | 'className'
> &
  Omit<HTMLAttributes<HTMLSpanElement>, 'color' | 'children'> & {
    as?: ElementType;
    children?: ReactNode;
    color?: V2ChipColor | V3ChipColor;
    variant?: V2ChipVariant | V3ChipVariant;
    avatar?: ReactNode;
    startContent?: ReactNode;
    endContent?: ReactNode;
    onClose?: () => void;
    radius?: 'none' | 'sm' | 'md' | 'lg' | 'full';
    isDisabled?: boolean;
    className?: string;
    classNames?: {
      base?: string;
      content?: string;
      closeButton?: string;
    };
    href?: string;
    to?: unknown;
  };

function mapColor(color?: ChipProps['color']): V3ChipColor {
  switch (color) {
    case 'primary':
      return 'accent';
    case 'secondary':
      return 'default';
    case 'success':
    case 'warning':
    case 'danger':
    case 'accent':
      return color;
    default:
      return 'default';
  }
}

function mapVariant(variant?: ChipProps['variant']): V3ChipVariant {
  switch (variant) {
    case 'solid':
    case 'shadow':
      return 'primary';
    case 'bordered':
    case 'faded':
      return 'secondary';
    case 'light':
    case 'dot':
      return 'tertiary';
    case 'flat':
      return 'soft';
    case 'primary':
    case 'secondary':
    case 'tertiary':
    case 'soft':
      return variant;
    default:
      return 'secondary';
  }
}

function radiusClass(radius?: ChipProps['radius']): string | undefined {
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

function ChipRoot({
  as: Component,
  avatar,
  children,
  className,
  classNames,
  color,
  endContent,
  isDisabled,
  onClose,
  radius,
  startContent,
  variant,
  ...props
}: ChipProps) {
  const { t } = useTranslation('common');
  const isDot = variant === 'dot';

  const content = (
    <>
      {avatar}
      {isDot && !startContent ? (
        <span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-current" />
      ) : null}
      {startContent}
      <HeroUIChip.Label className={classNames?.content}>{children}</HeroUIChip.Label>
      {endContent}
      {onClose ? (
        <CloseButton
          className={classNames?.closeButton}
          onPress={onClose}
          aria-label={t('aria.remove')}
        />
      ) : null}
    </>
  );

  const sharedProps = {
    className: combineClasses(
      // A status chip must never break inside its word ("Visib/le") when a
      // table column gets narrow — the column should widen or scroll instead.
      'whitespace-nowrap',
      classNames?.base,
      radiusClass(radius),
      isDisabled && 'opacity-50 pointer-events-none',
      variant === 'shadow' && 'shadow-md',
      className,
    ),
    color: mapColor(color),
    variant: mapVariant(variant),
    ...props,
  } as HeroUIChipProps;

  if (Component) {
    return (
      <HeroUIChip
        {...sharedProps}
        render={(renderProps) => (
          <Component {...renderProps} {...props}>
            {renderProps.children}
          </Component>
        )}
      >
        {content}
      </HeroUIChip>
    );
  }

  return (
    <HeroUIChip
      {...sharedProps}
    >
      {content}
    </HeroUIChip>
  );
}

export const Chip = Object.assign(ChipRoot, {
  Label: HeroUIChip.Label,
});
export const ChipLabel = HeroUIChip.Label;
