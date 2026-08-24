// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@/components/ui/Icon';
import { Chip } from '@/components/ui/StatusChip';
import { useTranslation } from 'react-i18next';

import { getUserVerificationBadges, type VerificationBadge } from '@/lib/api/verification';
import { useTheme } from '@/lib/hooks/useTheme';

type BadgeSize = 'sm' | 'md';

interface VerificationBadgeRowProps {
  userId?: number | string | null;
  badges?: VerificationBadge[];
  size?: BadgeSize;
  showUnverified?: boolean;
  disabled?: boolean;
}

type BadgeTone = {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: 'accent' | 'default' | 'success' | 'warning' | 'danger';
  iconColor: string;
  labelKey: string;
};

function getBadgeTone(type: string, theme: ReturnType<typeof useTheme>): BadgeTone {
  switch (type) {
    case 'email_verified':
      return { icon: 'mail-outline', color: 'accent', iconColor: theme.info, labelKey: 'verification.badge.email_verified' };
    case 'phone_verified':
      return { icon: 'call-outline', color: 'success', iconColor: theme.success, labelKey: 'verification.badge.phone_verified' };
    case 'id_verified':
      return { icon: 'shield-checkmark-outline', color: 'success', iconColor: theme.success, labelKey: 'verification.badge.id_verified' };
    case 'dbs_checked':
      return { icon: 'document-text-outline', color: 'warning', iconColor: theme.warning, labelKey: 'verification.badge.dbs_checked' };
    case 'admin_verified':
      return { icon: 'person-circle-outline', color: 'accent', iconColor: theme.info, labelKey: 'verification.badge.admin_verified' };
    default:
      return { icon: 'shield-outline', color: 'default', iconColor: theme.textMuted, labelKey: 'verification.badge.unknown' };
  }
}

function normalizeBadgeType(badge: VerificationBadge): string {
  return badge.type || badge.badge_type || '';
}

export default function VerificationBadgeRow({
  userId,
  badges: propBadges,
  size = 'sm',
  showUnverified = true,
  disabled = false,
}: VerificationBadgeRowProps) {
  const { t } = useTranslation('common');
  const theme = useTheme();
  const numericUserId = typeof userId === 'string' ? Number(userId) : userId;
  const [badges, setBadges] = useState<VerificationBadge[]>(propBadges ?? []);
  const [loaded, setLoaded] = useState(Boolean(propBadges) || disabled || !numericUserId);

  useEffect(() => {
    if (disabled) {
      setLoaded(true);
      return;
    }

    if (propBadges) {
      setBadges(propBadges);
      setLoaded(true);
      return;
    }

    if (!numericUserId || !Number.isFinite(numericUserId)) {
      setLoaded(true);
      return;
    }

    let cancelled = false;
    setLoaded(false);

    void getUserVerificationBadges(numericUserId)
      .then((nextBadges) => {
        if (!cancelled) setBadges(nextBadges);
      })
      .catch(() => {
        if (!cancelled) setBadges([]);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [disabled, numericUserId, propBadges]);

  const visibleBadges = useMemo(() => {
    const normalized = badges.map((badge) => ({ ...badge, type: normalizeBadgeType(badge) })).filter((badge) => badge.type);
    const hasIdVerified = normalized.some((badge) => badge.type === 'id_verified');

    if (!hasIdVerified && showUnverified) {
      return [...normalized, { type: '__unverified__', label: t('verification.not_id_verified') }];
    }

    return normalized;
  }, [badges, showUnverified, t]);

  if (!loaded || visibleBadges.length === 0) {
    return null;
  }

  return (
    <View className="flex-row flex-wrap items-center gap-1.5" accessibilityLabel={t('aria.verification_badges')}>
      {visibleBadges.map((badge) => {
        const isUnverified = badge.type === '__unverified__';
        const tone = isUnverified
          ? { icon: 'shield-outline' as const, color: 'default' as const, iconColor: theme.textMuted, labelKey: 'verification.not_id_verified' }
          : getBadgeTone(badge.type ?? '', theme);
        const label = isUnverified ? t(tone.labelKey) : t(tone.labelKey, { defaultValue: badge.label || badge.type });

        return (
          <Chip key={badge.type} size={size} variant="soft" color={tone.color}>
            <Ionicons name={tone.icon} size={size === 'sm' ? 12 : 14} color={tone.iconColor} />
            <Chip.Label>{label}</Chip.Label>
          </Chip>
        );
      })}
    </View>
  );
}
