// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button as HeroButton } from 'heroui-native';
import { forwardRef, type ComponentProps, type ComponentRef } from 'react';

const NativeButtonLabel = forwardRef<ComponentRef<typeof HeroButton.Label>, ComponentProps<typeof HeroButton.Label>>(
  function NativeButtonLabel({ style, ...props }, ref) {
    return <HeroButton.Label ref={ref} {...props} style={[{ flexShrink: 1, textAlign: 'center' }, style]} />;
  },
);

/** Let scaled and translated labels wrap without losing the minimum touch target. */
const NativeButton = forwardRef<ComponentRef<typeof HeroButton>, ComponentProps<typeof HeroButton>>(
  function NativeButton({ style, children, ...props }, ref) {
    const sizing = {
      minWidth: 48,
      minHeight: props.size === 'lg' ? 56 : 48,
      ...(!props.isIconOnly ? { height: 'auto' as const, paddingVertical: 10 } : {}),
    };
    return (
      <HeroButton ref={ref} {...props} style={typeof style === 'function'
        ? (state) => [style(state), sizing]
        : [style, sizing]}>
        {typeof children === 'string' || typeof children === 'number'
          ? <NativeButtonLabel>{children}</NativeButtonLabel>
          : children}
      </HeroButton>
    );
  },
);

export const Button = Object.assign(NativeButton, { Label: NativeButtonLabel });
