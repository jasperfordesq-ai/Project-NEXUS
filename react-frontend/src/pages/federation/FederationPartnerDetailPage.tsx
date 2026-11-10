// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Federation Partner Detail Page
 *
 * Shows a partner community's profile from the federation network.
 * Route: /federation/partners/:id
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion } from '@/lib/motion';

import Globe from 'lucide-react/icons/globe';
import MapPin from 'lucide-react/icons/map-pin';
import Users from 'lucide-react/icons/users';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Shield from 'lucide-react/icons/shield';
import MessageSquare from 'lucide-react/icons/message-square';
import ArrowRightLeft from 'lucide-react/icons/arrow-right-left';
import ListTodo from 'lucide-react/icons/list-todo';
import Calendar from 'lucide-react/icons/calendar';
import UserCheck from 'lucide-react/icons/user-check';
import Handshake from 'lucide-react/icons/handshake';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { Breadcrumbs } from '@/components/navigation';
import { PageMeta } from '@/components/seo';
import { useAuth, useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { resolveAvatarUrl, getFormattingLocale } from '@/lib/helpers';
import { logError } from '@/lib/logger';
import type { FederationPartner } from '@/types/api';

// ─────────────────────────────────────────────────────────────────────────────
// Federation Level Metadata
// ─────────────────────────────────────────────────────────────────────────────

interface FederationLevelMeta {
  label: string;
  className: string;
}

const FEDERATION_LEVELS: Record<number, FederationLevelMeta> = {
  1: {
    label: 'partners.level_discovery',
    className: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  },
  2: {
    label: 'partners.level_social',
    className: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
  },
  3: {
    label: 'partners.level_economic',
    className: 'bg-accent/20 text-accent-soft-foreground',
  },
  4: {
    label: 'partners.level_integrated',
    className: 'bg-amber-500/20 text-amber-600 dark:text-amber-400',
  },
};

/** Map permission keys to display labels and icons */
const PERMISSION_META: Record<string, { icon: typeof Globe }> = {
  profiles: { icon: UserCheck },
  messaging: { icon: MessageSquare },
  transactions: { icon: ArrowRightLeft },
  listings: { icon: ListTodo },
  events: { icon: Calendar },
  groups: { icon: Users },
};

// ─────────────────────────────────────────────────────────────────────────────
// Page Component
// ─────────────────────────────────────────────────────────────────────────────

export function FederationPartnerDetailPage() {
  const { t } = useTranslation('federation');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { tenantPath } = useTenant();

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable ref for t — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;

  const [partner, setPartner] = useState<FederationPartner | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  usePageTitle(partner?.name ?? t('partner_detail.page_title'));

  const loadPartner = useCallback(async () => {
    if (!id) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setIsLoading(true);
      setError(null);
      const response = await api.get<FederationPartner>(`/v2/federation/partners/${id}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setPartner(response.data);
      } else {
        setError(tRef.current('partner_detail.not_found_error'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load federation partner', err);
      setError(tRef.current('partner_detail.load_error'));
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadPartner();
  }, [loadPartner]);

  // Loading
  if (isLoading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('partner_detail.loading')} className="flex items-center justify-center py-20">
        <PageMeta title={t('partner_detail.loading')} noIndex />
        <Spinner size="lg" label={t('partner_detail.loading')} />
      </div>
    );
  }

  // Error / Not found
  if (error || !partner) {
    return (
      <div className="space-y-6">
        <PageMeta title={t('partner_detail.not_found_heading')} noIndex />
        <Breadcrumbs
          items={[
            { label: t('partner_detail.breadcrumb_federation'), href: tenantPath('/federation') },
            { label: t('partner_detail.breadcrumb_partners'), href: tenantPath('/federation/partners') },
            { label: t('partner_detail.breadcrumb_not_found') },
          ]}
        />
        <GlassCard role="alert" className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">
            {t('partner_detail.not_found_heading')}
          </h2>
          <p className="text-theme-muted mb-4">
            {error || t('partner_detail.not_found_description')}
          </p>
          <div className="flex gap-3 justify-center">
            <Button
              variant="flat"
              className="bg-theme-elevated text-theme-primary"
              startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
              onPress={() => navigate(tenantPath('/federation/partners'))}
            >
              {t('partner_detail.back_to_partners')}
            </Button>
            <Button
              className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
              startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
              onPress={loadPartner}
            >
              {t('partner_detail.try_again')}
            </Button>
          </div>
        </GlassCard>
      </div>
    );
  }

  const levelMeta = FEDERATION_LEVELS[partner.federation_level];

  return (
    <div className="space-y-6">
      <PageMeta title={t('partner_detail.page_title')} noIndex />
      {/* Breadcrumbs */}
      <Breadcrumbs
        items={[
          { label: t('partner_detail.breadcrumb_federation'), href: tenantPath('/federation') },
          { label: t('partner_detail.breadcrumb_partners'), href: tenantPath('/federation/partners') },
          { label: partner.name },
        ]}
      />

      {/* Profile Header */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <GlassCard className="p-6 md:p-8">
          <div className="flex flex-col sm:flex-row items-start gap-6">
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              <Avatar
                name={partner.name}
                src={resolveAvatarUrl(partner.logo)}
                className="w-24 h-24 ring-4 ring-accent/20 bg-gradient-to-br from-accent-strong to-accent-strong-end text-white text-3xl"
              />
              <div
                className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-accent-strong flex items-center justify-center ring-2 ring-white dark:ring-gray-900"
                title={t('partner_detail.federation_partner_badge')}
              >
                <Handshake className="w-4 h-4 text-white" aria-hidden="true" />
              </div>
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-theme-primary">
                {partner.name}
              </h1>

              {partner.tagline && (
                <p className="text-theme-muted mt-1">{partner.tagline}</p>
              )}

              {/* Federation Level */}
              <Chip
                size="sm"
                variant="flat"
                className={`mt-3 ${levelMeta?.className || 'bg-theme-hover text-theme-muted'}`}
              >
                {t('partner_detail.level_prefix', { level: partner.federation_level })} &mdash;{' '}
                {levelMeta ? t(levelMeta.label) : partner.federation_level_name || t('partners.level_unknown')}
              </Chip>

              {/* Meta row */}
              <div className="flex flex-wrap items-center gap-4 mt-3 text-sm text-theme-muted">
                {partner.location && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="w-4 h-4" aria-hidden="true" />
                    {partner.location}
                    {partner.country && `, ${partner.country}`}
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <Users className="w-4 h-4" aria-hidden="true" />
                  {t('partner_detail.member_count', { count: partner.member_count })}
                </span>
                {partner.partnership_since && (
                  <span className="flex items-center gap-1.5">
                    <Shield className="w-4 h-4" aria-hidden="true" />
                    {t('partner_detail.partner_since', {
                      date: new Date(partner.partnership_since).toLocaleDateString(getFormattingLocale(), {
                        month: 'long',
                        year: 'numeric',
                      }),
                    })}
                  </span>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-3 mt-4">
                {isAuthenticated && (
                  <>
                    <Button as={Link} to={tenantPath(`/federation/members?partner_id=${partner.id}`)}
                      className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
                      startContent={<Users className="w-4 h-4" aria-hidden="true" />}
                    >
                      {t('partner_detail.browse_members')}
                    </Button>
                    <Button as={Link} to={tenantPath(`/federation/listings?partner_id=${partner.id}`)}
                      variant="flat"
                      className="bg-theme-elevated text-theme-primary"
                      startContent={<ListTodo className="w-4 h-4" aria-hidden="true" />}
                    >
                      {t('partner_detail.browse_listings')}
                    </Button>
                  </>
                )}
                <Button
                  variant="flat"
                  className="bg-theme-elevated text-theme-primary"
                  startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
                  onPress={() => navigate(tenantPath('/federation/partners'))}
                >
                  {t('partner_detail.back_to_partners')}
                </Button>
              </div>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* Available Features */}
      {partner.permissions && partner.permissions.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <GlassCard className="p-6">
            <h2 className="text-lg font-semibold text-theme-primary mb-3 flex items-center gap-2">
              <Globe className="w-5 h-5 text-accent" aria-hidden="true" />
              {t('partner_detail.available_features')}
            </h2>
            <div className="flex flex-wrap gap-2">
              {partner.permissions.map((perm) => {
                const meta = PERMISSION_META[perm];
                const Icon = meta?.icon || Globe;
                return (
                  <Chip
                    key={perm}
                    variant="flat"
                    className="bg-theme-hover text-theme-muted"
                    startContent={<Icon className="w-3.5 h-3.5" aria-hidden="true" />}
                  >
                    {meta ? t(`partners.permission_${perm}`) : perm}
                  </Chip>
                );
              })}
            </div>
          </GlassCard>
        </motion.div>
      )}
    </div>
  );
}

export default FederationPartnerDetailPage;
