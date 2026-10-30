// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * VerificationBadge — Displays labeled verification badges across the platform.
 *
 * Used on: profiles, listings, members, exchanges, marketplace, messages, mobile menu.
 * Always shows labels — never just icons. Green = ID Verified (trust signal).
 */

import { useState, useEffect } from 'react';import ShieldCheck from 'lucide-react/icons/shield-check';
import ShieldOff from 'lucide-react/icons/shield-off';
import Mail from 'lucide-react/icons/mail';
import Phone from 'lucide-react/icons/phone';
import UserCheck from 'lucide-react/icons/user-check';
import Shield from 'lucide-react/icons/shield';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { Chip } from '@/components/ui';
import { useTenant } from '@/contexts';

/**
 * Verification badges follow the community's `identity_verification` switch,
 * as the navbar always did. A community that turned verification off shows
 * no "Verified" / "Not ID verified" badges anywhere (AWID pilot, Oct 2026).
 */
function useVerificationBadgesEnabled(): boolean {
  return useTenant().hasFeature('identity_verification');
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface VerificationBadgeData {
  type: string;
  badge_type?: string;
  label: string;
  description?: string;
  verified?: boolean;
  verified_at?: string;
  granted_at?: string;
  verified_by?: string;
  verified_by_name?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Badge Config — GREEN for ID Verified (trust signal)
// ─────────────────────────────────────────────────────────────────────────────

type BadgeConfigEntry = {
  icon: React.ReactNode;
  iconSm: React.ReactNode;
  color: string;
  bgColor: string;
  label: string;
};

function getBadgeConfig(t: (key: string) => string): Record<string, BadgeConfigEntry> {
  return {
    email_verified: {
      icon: <Mail className="w-3.5 h-3.5" />,
      iconSm: <Mail className="w-3 h-3" />,
      color: 'text-blue-600 dark:text-blue-400',
      bgColor: 'bg-blue-500/10',
      label: t('verification.badge.email_verified'),
    },
    phone_verified: {
      icon: <Phone className="w-3.5 h-3.5" />,
      iconSm: <Phone className="w-3 h-3" />,
      color: 'text-emerald-600 dark:text-emerald-400',
      bgColor: 'bg-emerald-500/10',
      label: t('verification.badge.phone_verified'),
    },
    id_verified: {
      icon: <ShieldCheck className="w-3.5 h-3.5" />,
      iconSm: <ShieldCheck className="w-3 h-3" />,
      color: 'text-emerald-700 dark:text-emerald-300',
      bgColor: 'bg-emerald-500/15 dark:bg-emerald-500/20',
      label: t('verification.badge.id_verified'),
    },
    admin_verified: {
      icon: <UserCheck className="w-3.5 h-3.5" />,
      iconSm: <UserCheck className="w-3 h-3" />,
      color: 'text-accent dark:text-accent',
      bgColor: 'bg-accent/10',
      label: t('verification.badge.admin_verified'),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — normalize API response
// ─────────────────────────────────────────────────────────────────────────────

const PUBLIC_VERIFICATION_BADGE_TYPES = new Set([
  'email_verified',
  'phone_verified',
  'id_verified',
  'address_verified',
  'admin_verified',
  'organization_vouched',
  'peer_endorsed',
]);

function normalizeBadges(data: VerificationBadgeData[]): VerificationBadgeData[] {
  return data
    .map((b) => ({
      ...b,
      type: b.type || b.badge_type || '',
      verified_at: b.verified_at || b.granted_at,
    }))
    .filter((badge) => PUBLIC_VERIFICATION_BADGE_TYPES.has(badge.type));
}

const sizeClasses = {
  sm: 'w-6 h-6',
  md: 'w-8 h-8',
  lg: 'w-10 h-10',
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared badge loading — one fetch per consumer, reusable outside the row
// ─────────────────────────────────────────────────────────────────────────────

export function useVerificationBadges(
  userId?: number,
  propBadges?: VerificationBadgeData[]
): { badges: VerificationBadgeData[]; isLoaded: boolean } {
  const enabled = useVerificationBadgesEnabled();
  const [badges, setBadges] = useState<VerificationBadgeData[]>(normalizeBadges(propBadges || []));
  const [isLoaded, setIsLoaded] = useState(!!propBadges);

  useEffect(() => {
    if (!enabled) return;
    if (propBadges) {
      setBadges(normalizeBadges(propBadges));
      setIsLoaded(true);
      return;
    }

    if (!userId) return;

    const loadBadges = async () => {
      try {
        const response = await api.get<VerificationBadgeData[]>(`/v2/users/${userId}/verification-badges`);
        if (response?.success && response.data) {
          setBadges(normalizeBadges(Array.isArray(response.data) ? response.data : []));
        }
      } catch (err) {
        logError('Failed to load verification badges', err);
      } finally {
        setIsLoaded(true);
      }
    };
    loadBadges();
  }, [enabled, userId, propBadges]);

  // Switched off: report "loaded, nothing to show" so no caller waits or renders.
  return enabled ? { badges, isLoaded } : { badges: [], isLoaded: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Single Badge Icon (for tooltip-only compact spaces)
// ─────────────────────────────────────────────────────────────────────────────

export function VerificationBadgeIcon({
  badge,
  size = 'sm',
}: {
  badge: VerificationBadgeData;
  size?: 'sm' | 'md' | 'lg';
}) {
  const { t } = useTranslation('common');
  const enabled = useVerificationBadgesEnabled();
  if (!enabled || !PUBLIC_VERIFICATION_BADGE_TYPES.has(badge.type || badge.badge_type || '')) {
    return null;
  }
  const badgeConfig = getBadgeConfig(t);
  const config = badgeConfig[badge.type] || {
    icon: <ShieldCheck className="w-3.5 h-3.5" />,
    iconSm: <ShieldCheck className="w-3 h-3" />,
    color: 'text-theme-subtle',
    bgColor: 'bg-theme-elevated',
    label: badge.label || badge.type,
  };

  return (
    <div
      className={`${sizeClasses[size]} rounded-full ${config.bgColor} ${config.color} flex items-center justify-center`}
      aria-label={config.label}
      role="img"
      title={config.label}
    >
      {config.icon}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Badge Row — LABELED chips (primary display component used everywhere)
// ─────────────────────────────────────────────────────────────────────────────

export function VerificationBadgeRow({
  userId,
  badges: propBadges,
  size = 'sm',
}: {
  userId?: number;
  badges?: VerificationBadgeData[];
  size?: 'sm' | 'md' | 'lg';
}) {
  const { t } = useTranslation('common');
  const badgeConfig = getBadgeConfig(t);
  const enabled = useVerificationBadgesEnabled();
  const { badges, isLoaded } = useVerificationBadges(userId, propBadges);

  if (!enabled || !isLoaded) return null;

  const hasIdVerified = badges.some((b) => b.type === 'id_verified');
  const unverifiedConfig = {
    icon: <ShieldOff className="w-3.5 h-3.5" />,
    iconSm: <ShieldOff className="w-3 h-3" />,
    color: 'text-theme-muted',
    bgColor: 'bg-theme-elevated',
    label: t('verification.not_id_verified'),
  };

  const allBadges = hasIdVerified ? badges : [
    ...badges,
    { type: '__unverified__', label: unverifiedConfig.label },
  ];

  return (
    <div className="flex items-center gap-1.5 flex-wrap" aria-label={t('aria.verification_badges')}>
      {allBadges.map((badge) => {
        const isUnverified = badge.type === '__unverified__';
        const config = isUnverified ? unverifiedConfig : (badgeConfig[badge.type] || {
          icon: <ShieldCheck className="w-3.5 h-3.5" />,
          iconSm: <ShieldCheck className="w-3 h-3" />,
          color: 'text-theme-subtle',
          bgColor: 'bg-theme-elevated',
          label: badge.label || badge.type,
        });

        if (size === 'sm') {
          return (
            <span
              key={badge.type}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${config.bgColor} ${config.color}`}
            >
              {config.iconSm}
              {config.label}
            </span>
          );
        }

        // Medium/large: bigger chip for profile and detail pages
        return (
          <Chip
            key={badge.type}
            size="md"
            variant="flat"
            className={`${config.bgColor} ${config.color} font-semibold`}
            startContent={config.icon}
          >
            {config.label}
          </Chip>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Badge Summary Card (for profile sidebar/details section)
// ─────────────────────────────────────────────────────────────────────────────

export function VerificationBadgeSummary({
  userId,
}: {
  userId: number;
}) {
  const { t } = useTranslation('common');
  const badgeConfig = getBadgeConfig(t);
  const enabled = useVerificationBadgesEnabled();
  const [badges, setBadges] = useState<VerificationBadgeData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    const loadBadges = async () => {
      try {
        const response = await api.get<VerificationBadgeData[]>(`/v2/users/${userId}/verification-badges`);
        if (response?.success && response.data) {
          setBadges(normalizeBadges(Array.isArray(response.data) ? response.data : []));
        }
      } catch (err) {
        logError('Failed to load verification badges', err);
      } finally {
        setIsLoading(false);
      }
    };
    loadBadges();
  }, [enabled, userId]);

  if (!enabled || isLoading) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Shield className="w-4 h-4 text-emerald-500" aria-hidden="true" />
        <span className="text-sm font-semibold text-theme-primary">{t('verification_status')}</span>
      </div>
      {badges.length === 0 ? (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-theme-elevated">
          <ShieldOff className="w-4 h-4 text-theme-muted shrink-0" aria-hidden="true" />
          <span className="text-xs text-theme-muted">{t('identity_not_verified')}</span>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {badges.map((badge) => {
            const config = badgeConfig[badge.type];
            return (
              <Chip
                key={badge.type}
                size="md"
                variant="flat"
                className={`${config?.bgColor || 'bg-theme-elevated'} ${config?.color || 'text-theme-muted'} font-semibold`}
                startContent={config?.icon || <ShieldCheck className="w-3.5 h-3.5" />}
              >
                {config?.label || badge.label}
              </Chip>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default VerificationBadgeRow;
