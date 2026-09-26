// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Shared Exchange Status Configuration
 * Used by ExchangesPage, ExchangeDetailPage, and other exchange-related components
 */

import Clock from 'lucide-react/icons/clock';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import ArrowRightLeft from 'lucide-react/icons/arrow-right-left';
import type { LucideIcon } from 'lucide-react';
import type { ExchangeStatus } from '@/types/api';

export interface ExchangeStatusConfig {
  /** Translation key in the `exchanges` namespace — render with t(). */
  label: string;
  color: 'warning' | 'primary' | 'success' | 'danger' | 'secondary' | 'default';
  icon: LucideIcon;
  /** Translation key in the `exchanges` namespace — render with t(). */
  description: string;
}

export const EXCHANGE_STATUS_CONFIG: Record<ExchangeStatus, ExchangeStatusConfig> = {
  pending_provider: {
    label: 'status_config.pending_provider.label',
    color: 'warning',
    icon: Clock,
    description: 'status_config.pending_provider.description',
  },
  pending_broker: {
    label: 'status_config.pending_broker.label',
    color: 'secondary',
    icon: Clock,
    description: 'status_config.pending_broker.description',
  },
  accepted: {
    label: 'status_config.accepted.label',
    color: 'primary',
    icon: CheckCircle,
    description: 'status_config.accepted.description',
  },
  in_progress: {
    label: 'status_config.in_progress.label',
    color: 'primary',
    icon: ArrowRightLeft,
    description: 'status_config.in_progress.description',
  },
  pending_confirmation: {
    label: 'status_config.pending_confirmation.label',
    color: 'warning',
    icon: AlertTriangle,
    description: 'status_config.pending_confirmation.description',
  },
  completed: {
    label: 'status_config.completed.label',
    color: 'success',
    icon: CheckCircle,
    description: 'status_config.completed.description',
  },
  disputed: {
    label: 'status_config.disputed.label',
    color: 'danger',
    icon: AlertTriangle,
    description: 'status_config.disputed.description',
  },
  cancelled: {
    label: 'status_config.cancelled.label',
    color: 'default',
    icon: XCircle,
    description: 'status_config.cancelled.description',
  },
};

/** Maximum hours allowed per exchange (typo protection) */
export const MAX_EXCHANGE_HOURS = 100;

/**
 * Get the color class for a status icon background
 */
export function getStatusIconBgClass(color: ExchangeStatusConfig['color']): string {
  switch (color) {
    case 'success':
      return 'bg-emerald-500/20 text-emerald-400';
    case 'warning':
      return 'bg-amber-500/20 text-amber-400';
    case 'danger':
      return 'bg-red-500/20 text-red-400';
    case 'primary':
      return 'bg-accent/20 text-accent';
    case 'secondary':
      return 'bg-accent/20 text-accent';
    default:
      return 'bg-theme-elevated text-theme-muted';
  }
}
