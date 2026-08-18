// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ProfileCardWidget - Shows authenticated user's profile summary in sidebar
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

import Heart from 'lucide-react/icons/heart';
import HandHelping from 'lucide-react/icons/hand-helping';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { GlassCard } from '@/components/ui/GlassCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { useAuth, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { resolveAvatarUrl } from '@/lib/helpers';
import { logError } from '@/lib/logger';

interface ProfileStats {
  listings_count: number;
  given_count: number;
  received_count: number;
  offers_count: number;
  requests_count: number;
  wallet_balance?: number;
}

export function ProfileCardWidget() {
  const { isAuthenticated, user } = useAuth();
  const { tenantPath } = useTenant();
  const { t } = useTranslation('feed');
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) return;

    const loadStats = async () => {
      try {
        setIsLoading(true);
        const response = await api.get<ProfileStats>('/v2/me/stats');
        if (response.success && response.data) {
          setStats(response.data);
        }
      } catch (err) {
        logError('Failed to load profile stats', err);
      } finally {
        setIsLoading(false);
      }
    };
    loadStats();
  }, [isAuthenticated]);

  if (!isAuthenticated || !user) return null;

  const displayName = user.first_name && user.last_name
    ? `${user.first_name} ${user.last_name}`
    : user.first_name || user.username || 'Member';

  const handle = user.username ? `@${user.username}` : user.first_name || '';

  return (
    <GlassCard className="p-4">
      {/* Profile header */}
      <Link to={tenantPath('/profile')} className="flex flex-col items-center text-center group">
        <Avatar
          src={resolveAvatarUrl(user.avatar)}
          name={displayName}
          size="lg"
          isBordered
          className="ring-2 ring-accent/30 mb-2"
        />
        <h3 className="font-semibold text-sm text-[var(--text-primary)] group-hover:text-accent transition-colors duration-200">
          {displayName}
        </h3>
        {handle && (
          <p className="text-xs text-[var(--text-muted)]">{handle}</p>
        )}
      </Link>

      {/* Stats row */}
      {isLoading ? (
        <div className="flex justify-center gap-6 mt-3 pt-3 border-t border-[var(--border-default)]">
          {[1, 2, 3].map((i) => (
            <div key={i} className="text-center">
              <Skeleton className="h-4 w-6 rounded mx-auto mb-1" />
              <Skeleton className="h-3 w-10 rounded" />
            </div>
          ))}
        </div>
      ) : stats && (
        <>
          <div className="flex justify-center gap-6 mt-3 pt-3 border-t border-[var(--border-default)]">
            <Link to={tenantPath('/listings')} className="text-center group">
              <p className="text-sm font-bold text-[var(--text-primary)] group-hover:text-accent">
                {stats.listings_count}
              </p>
              <p className="text-xs text-[var(--text-muted)]">{t('sidebar.profile.listings')}</p>
            </Link>
            <div className="text-center">
              <p className="text-sm font-bold text-emerald-700">{stats.given_count}</p>
              <p className="text-xs text-[var(--text-muted)]">{t('sidebar.profile.given')}</p>
            </div>
            <div className="text-center">
              <p className="text-sm font-bold text-orange-500">{stats.received_count}</p>
              <p className="text-xs text-[var(--text-muted)]">{t('sidebar.profile.received')}</p>
            </div>
          </div>

          {/* Offers / Requests mini grid */}
          <div className="grid grid-cols-2 gap-2 mt-3">
            <Link
              to={tenantPath('/listings?type=offer')}
              className="flex items-center gap-2 p-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors duration-200"
            >
              <Heart className="w-3.5 h-3.5 text-emerald-500" aria-hidden="true" />
              <div>
                <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                  {stats.offers_count}
                </p>
                <p className="text-[10px] text-[var(--text-muted)]">{t('sidebar.profile.offers')}</p>
              </div>
            </Link>
            <Link
              to={tenantPath('/listings?type=request')}
              className="flex items-center gap-2 p-2 rounded-lg bg-orange-500/10 hover:bg-orange-500/20 transition-colors duration-200"
            >
              <HandHelping className="w-3.5 h-3.5 text-orange-500" aria-hidden="true" />
              <div>
                <p className="text-xs font-semibold text-orange-600 dark:text-orange-400">
                  {stats.requests_count}
                </p>
                <p className="text-[10px] text-[var(--text-muted)]">{t('sidebar.profile.requests')}</p>
              </div>
            </Link>
          </div>
        </>
      )}
    </GlassCard>
  );
}

export default ProfileCardWidget;
