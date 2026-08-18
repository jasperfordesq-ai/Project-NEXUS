// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
/**
 * CommunityFundCard - Displays community fund balance and recent activity
 */

import { useState, useEffect, useCallback } from 'react';import Landmark from 'lucide-react/icons/landmark';
import TrendingUp from 'lucide-react/icons/trending-up';
import TrendingDown from 'lucide-react/icons/trending-down';
import Heart from 'lucide-react/icons/heart';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import type { CommunityFundBalance } from '@/types/api';

interface CommunityFundCardProps {
  onDonateClick?: () => void;
  compact?: boolean;
}

export function CommunityFundCard({ onDonateClick, compact = false }: CommunityFundCardProps) {
  const { t } = useTranslation('wallet');
  const [fund, setFund] = useState<CommunityFundBalance | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadFund = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(false);
      const response = await api.get<CommunityFundBalance>('/v2/wallet/community-fund');
      if (response.success && response.data) {
        setFund(response.data);
      } else {
        setError(true);
      }
    } catch (err) {
      logError('Failed to load community fund', err);
      setError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFund();
  }, [loadFund]);

  if (isLoading) {
    return (
      <CardRowsSkeleton className="p-4" />
    );
  }

  if (error) {
    return (
      <GlassCard className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/20">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            </div>
            <p className="text-sm text-theme-muted">{t('error.load_community_fund')}</p>
          </div>
          <Button
            size="sm"
            variant="tertiary"
            className="bg-theme-elevated text-theme-muted"
            startContent={<RefreshCw className="w-3 h-3" />}
            onPress={loadFund}
          >
            {t('try_again')}
          </Button>
        </div>
      </GlassCard>
    );
  }

  if (!fund) return null;

  if (compact) {
    return (
      <GlassCard className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/20">
              <Landmark className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <p className="text-xs text-theme-muted">{t('community_fund')}</p>
              <p className="text-lg font-bold text-theme-primary">{t('hours_value', { count: fund.balance })}</p>
            </div>
          </div>
          {onDonateClick && (
            <Button
              size="sm"
              variant="secondary"
              // 🔴 -700, not -600. On rose-500/10 over white (#ffe9ee) the -600
              // shade measures 3.89 against the 4.5:1 WCAG AA minimum; -700
              // measures 5.22. Matches the wallet page's own colour map.
              className="bg-rose-500/10 text-rose-700 dark:text-rose-400"
              startContent={<Heart className="w-3 h-3" />}
              onPress={onDonateClick}
            >
              {t('donate')}
            </Button>
          )}
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-3 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20">
          <Landmark className="w-6 h-6 text-amber-400" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-theme-primary">{t('community_fund')}</h3>
          <p className="text-sm text-theme-muted">{t('community_fund_desc')}</p>
        </div>
      </div>

      <div className="text-center mb-4">
        <p className="text-3xl font-bold text-theme-primary">{fund.balance}</p>
        <p className="text-sm text-theme-muted">{t('community_fund_hours')}</p>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="text-center p-2 rounded-lg bg-theme-elevated">
          <TrendingUp className="w-4 h-4 text-emerald-400 mx-auto mb-1" />
          <p className="text-xs text-theme-muted">{t('community_fund_deposited')}</p>
          <p className="text-sm font-semibold text-theme-primary">{t('hours_value', { count: fund.total_deposited })}</p>
        </div>
        <div className="text-center p-2 rounded-lg bg-theme-elevated">
          <TrendingDown className="w-4 h-4 text-rose-400 mx-auto mb-1" />
          <p className="text-xs text-theme-muted">{t('community_fund_withdrawn')}</p>
          <p className="text-sm font-semibold text-theme-primary">{t('hours_value', { count: fund.total_withdrawn })}</p>
        </div>
        <div className="text-center p-2 rounded-lg bg-theme-elevated">
          <Heart className="w-4 h-4 text-pink-400 mx-auto mb-1" />
          <p className="text-xs text-theme-muted">{t('donated')}</p>
          <p className="text-sm font-semibold text-theme-primary">{t('hours_value', { count: fund.total_donated })}</p>
        </div>
      </div>

      {onDonateClick && (
        <Button
          className="w-full bg-gradient-to-r from-rose-500 to-pink-600 text-white"
          startContent={<Heart className="w-4 h-4" />}
          onPress={onDonateClick}
        >
          {t('donate_to_community')}
        </Button>
      )}
    </GlassCard>
  );
}
