// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BrokerStatusChip — one status → color/label mapping for the whole broker
 * panel, so "pending" is always warning-amber and "rejected" always danger-red
 * no matter which page renders it. Labels come from the broker.status.* i18n
 * namespace; unknown statuses use a localized generic label on a neutral chip
 * rather than leaking a raw snake_case key.
 */

import { useTranslation } from 'react-i18next';
import { Chip } from '@/components/ui';

type ChipColor = 'success' | 'warning' | 'danger' | 'accent' | 'default';
type ChipVariant = 'soft' | 'primary';

const STATUS_COLOR: Record<string, ChipColor> = {
  // healthy / complete
  active: 'success',
  approved: 'success',
  verified: 'success',
  confirmed: 'success',
  completed: 'success',
  accepted: 'success',
  reviewed: 'success',
  // awaiting action
  pending: 'warning',
  submitted: 'warning',
  unreviewed: 'warning',
  pending_broker: 'warning',
  pending_provider: 'warning',
  pending_confirmation: 'warning',
  review_requested: 'warning',
  in_progress: 'accent',
  // problems
  rejected: 'danger',
  expired: 'danger',
  revoked: 'danger',
  suspended: 'danger',
  banned: 'danger',
  disputed: 'danger',
  // severity scale (risk tags, safeguarding)
  low: 'default',
  medium: 'warning',
  high: 'danger',
  critical: 'danger',
  // message-flag severity scale (broker message copies) and the archive's
  // "flagged" decision — the Messages, Message detail and Archive pages all
  // read this one map, so a concern is the same red on every page.
  info: 'accent',
  warning: 'warning',
  concern: 'danger',
  urgent: 'danger',
  flagged: 'danger',
  // dormant
  inactive: 'default',
  cancelled: 'default',
  not_confirmed: 'default',
};

// Everything is a soft chip except the one status that must stand out from
// its neighbour: urgent and concern share danger-red, so urgent is filled.
const STATUS_VARIANT: Record<string, ChipVariant> = {
  urgent: 'primary',
};

export function brokerStatusColor(status: string): ChipColor {
  return STATUS_COLOR[status] ?? 'default';
}

export function brokerStatusVariant(status: string): ChipVariant {
  return STATUS_VARIANT[status] ?? 'soft';
}

interface BrokerStatusChipProps {
  status: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function BrokerStatusChip({ status, size = 'sm', className }: BrokerStatusChipProps) {
  const { t } = useTranslation('broker');
  const normalized = (status || '').toLowerCase();
  const label = t(`status.${normalized}`, {
    defaultValue: t('status.unknown'),
  });

  return (
    <Chip
      size={size}
      variant={brokerStatusVariant(normalized)}
      color={brokerStatusColor(normalized)}
      className={className}
    >
      {label}
    </Chip>
  );
}

export default BrokerStatusChip;
