// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { ComponentProps, ReactNode } from 'react';
import { Label } from '@heroui/react/label';
import { ProgressBar } from '@heroui/react/progress-bar';
import { cn } from '@/lib/helpers';

type ProgressBarProps = ComponentProps<typeof ProgressBar>;
type LegacyProgressColor = 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger';

interface LegacyProgressClassNames {
  base?: string;
  indicator?: string;
  label?: string;
  track?: string;
  value?: string;
}

export interface ProgressProps extends Omit<ProgressBarProps, 'children' | 'className' | 'color'> {
  className?: string;
  classNames?: LegacyProgressClassNames;
  color?: LegacyProgressColor;
  disableAnimation?: boolean;
  isDisabled?: boolean;
  isStriped?: boolean;
  label?: ReactNode;
  radius?: string;
  showValueLabel?: boolean;
}

const colorMap: Record<LegacyProgressColor, ProgressBarProps['color']> = {
  default: 'default',
  primary: 'accent',
  secondary: 'default',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

export function Progress({
  className,
  classNames,
  color = 'primary',
  disableAnimation: _disableAnimation,
  isDisabled: _isDisabled,
  isStriped,
  label,
  radius: _radius,
  showValueLabel,
  ...props
}: ProgressProps) {
  return (
    <ProgressBar
      {...props}
      className={cn(classNames?.base, className)}
      color={colorMap[color] ?? 'accent'}
    >
      {label && <Label className={classNames?.label}>{label}</Label>}
      {showValueLabel && <ProgressBar.Output className={classNames?.value} />}
      <ProgressBar.Track className={classNames?.track}>
        <ProgressBar.Fill className={cn('rtl:left-auto rtl:right-0', isStriped && 'bg-stripes', classNames?.indicator)} />
      </ProgressBar.Track>
    </ProgressBar>
  );
}
