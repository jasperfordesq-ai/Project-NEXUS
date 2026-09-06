// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { contrastText } from '@/lib/utils/color';
import React from 'react';
import { Chip } from 'heroui-native';
import type { ChipSize } from 'heroui-native';
import { usePrimaryColor } from '@/lib/hooks/useTenant';

type BadgeSize = 'sm' | 'md';
type BadgeVariant = 'solid' | 'outline';

const SIZE_MAP: Record<BadgeSize, ChipSize> = {
  sm: 'sm',
  md: 'md',
};

interface BadgeProps {
  label: string;
  color?: string;
  size?: BadgeSize;
  variant?: BadgeVariant;
}

export default function Badge({ label, color, size = 'md', variant = 'solid' }: BadgeProps) {
  const primary = usePrimaryColor();
  // When a custom color is provided we can't pass it directly to HeroUI's color prop
  // (it only accepts named tokens). Fall back to inline style for custom tenant colors.
  const useCustomColor = !!color;
  const resolvedColor = color ?? primary;

  const chipVariant = variant === 'solid' ? 'primary' : 'tertiary';

  if (useCustomColor) {
    return (
      <Chip
        variant={chipVariant}
        size={SIZE_MAP[size]}
        style={
          variant === 'solid'
            ? { backgroundColor: resolvedColor }
            : { borderWidth: 1, borderColor: resolvedColor, backgroundColor: 'transparent' }
        }
      >
        <Chip.Label
          style={variant === 'solid' ? { color: contrastText(resolvedColor) } : { color: resolvedColor }}
        >
          {label}
        </Chip.Label>
      </Chip>
    );
  }

  return (
    <Chip variant={chipVariant} size={SIZE_MAP[size]}>
      <Chip.Label>{label}</Chip.Label>
    </Chip>
  );
}
