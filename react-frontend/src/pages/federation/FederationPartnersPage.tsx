// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Federation Partners Page - Browse partner communities in the federation network
 *
 * Features:
 * - Partner cards grid (2-col desktop, 1-col mobile)
 * - Federation level badges (Discovery, Social, Economic, Integrated)
 * - Partner detail modal with available features and navigation links
 * - Loading skeletons and error states
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from '@/lib/motion';

import Globe from 'lucide-react/icons/globe';
import MapPin from 'lucide-react/icons/map-pin';
import Users from 'lucide-react/icons/users';
import Eye from 'lucide-react/icons/eye';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
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
import { Modal, ModalContent, ModalHeader, ModalHeading, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { Breadcrumbs } from '@/components/navigation';
import { EmptyState } from '@/components/feedback';
import { PageMeta } from '@/components/seo';
import { PublicPageHero } from '@/components/public/PublicPageHero';
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
  color: 'primary' | 'success' | 'secondary' | 'warning';
  className: string;
}

const FEDERATION_LEVELS: Record<number, FederationLevelMeta> = {
  1: {
    label: 'partners.level_discovery',
    color: 'primary',
    className: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  },
  2: {
    label: 'partners.level_social',
    color: 'success',
    className: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
  },
  3: {
    label: 'partners.level_economic',
    color: 'secondary',
    className: 'bg-accent/20 text-accent dark:text-accent',
  },
  4: {
    label: 'partners.level_integrated',
    color: 'warning',
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

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export function FederationPartnersPage() {
  const { t } = useTranslation('federation');
  usePageTitle(t('partners.page_title'));
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { tenantPath } = useTenant();

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable ref for t — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;

  const [partners, setPartners] = useState<FederationPartner[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedPartner, setSelectedPartner] = useState<FederationPartner | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const loadPartners = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setIsLoading(true);
      setLoadError(null);

      const response = await api.get<FederationPartner[]>('/v2/federation/partners', { signal: controller.signal });

      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setPartners(response.data);
      } else {
        setPartners([]);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      logError('Failed to load federation partners', error);
      setLoadError(tRef.current('partners.load_error'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPartners();
  }, [loadPartners]);

  function openDetail(partner: FederationPartner) {
    setSelectedPartner(partner);
    setIsDetailOpen(true);
  }

  function closeDetail() {
    setIsDetailOpen(false);
    setSelectedPartner(null);
  }

  return (
    <div className="space-y-6">
      <PageMeta title={t('partners.page_title')} noIndex />
      {/* Breadcrumbs */}
      <Breadcrumbs
        items={[
          { label: t('partners.breadcrumb_federation'), href: tenantPath('/federation') },
          { label: t('partners.breadcrumb_partners') },
        ]}
      />

      {/* Header — the same soft panel in the community colour that opens the
          offers, events and groups pages (AWID: warmer, more inviting). */}
      <PublicPageHero
        size="compact"
        title={t('partners.heading')}
        description={t('partners.subheading')}
        icon={<Handshake className="h-6 w-6" aria-hidden="true" />}
        accent="indigo"
      />

      {/* Loading State */}
      {isLoading && (
        <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="grid md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <CardRowsSkeleton key={i} className="p-6" />
          ))}
        </div>
      )}

      {/* Error State */}
      {!isLoading && loadError && (
        <GlassCard role="alert" className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">
            {t('partners.unable_to_load')}
          </h2>
          <p className="text-theme-muted mb-4">{loadError}</p>
          <Button
            className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={loadPartners}
          >
            {t('partners.try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Empty State */}
      {!isLoading && !loadError && partners.length === 0 && (
        <EmptyState
          icon={<Globe className="w-12 h-12" />}
          title={t('partners.empty_title')}
          description={t('partners.empty_description')}
        />
      )}

      {/* Partners Grid */}
      {!isLoading && !loadError && partners.length > 0 && (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid md:grid-cols-2 gap-4"
        >
          {partners.map((partner) => (
            <motion.div key={partner.id} variants={itemVariants}>
              <PartnerCard partner={partner} onViewDetails={() => openDetail(partner)} />
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Partner Detail Modal */}
      <Modal
        isOpen={isDetailOpen}
        onOpenChange={(open) => { if (!open) closeDetail(); }}
        size="2xl"
        backdrop="blur"
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          body: 'py-4',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          {selectedPartner && (
            <>
              <ModalHeader className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3">
                <Avatar
                  name={selectedPartner.name[0]}
                  src={resolveAvatarUrl(selectedPartner.logo)}
                  size="md"
                  className="row-span-2 bg-gradient-to-br from-accent-strong to-accent-strong-end text-white flex-shrink-0"
                />
                <ModalHeading className="text-lg font-bold text-theme-primary">
                  {selectedPartner.name}
                </ModalHeading>
                {selectedPartner.tagline && (
                  <p className="text-sm text-theme-muted font-normal">
                    {selectedPartner.tagline}
                  </p>
                )}
              </ModalHeader>
              <ModalBody>
                <div className="space-y-5">
                  {/* Stats Row */}
                  <div className="flex flex-wrap gap-4 text-sm">
                    {selectedPartner.location && (
                      <span className="flex items-center gap-1.5 text-theme-muted">
                        <MapPin className="w-4 h-4" aria-hidden="true" />
                        {selectedPartner.location}
                        {selectedPartner.country && `, ${selectedPartner.country}`}
                      </span>
                    )}
                    <span className="flex items-center gap-1.5 text-theme-muted">
                      <Users className="w-4 h-4" aria-hidden="true" />
                      {t('partners.member_count', { count: selectedPartner.member_count })}
                    </span>
                    {selectedPartner.partnership_since && (
                      <span className="flex items-center gap-1.5 text-theme-muted">
                        <Shield className="w-4 h-4" aria-hidden="true" />
                        {t('partners.partner_since', {
                          date: new Date(selectedPartner.partnership_since).toLocaleDateString(getFormattingLocale(), {
                            month: 'long',
                            year: 'numeric',
                          }),
                        })}
                      </span>
                    )}
                  </div>

                  {/* Federation Level */}
                  <div>
                    <h3 className="text-sm font-semibold text-theme-primary mb-2">
                      {t('partners.federation_level')}
                    </h3>
                    <Chip
                      variant="flat"
                      className={
                        FEDERATION_LEVELS[selectedPartner.federation_level]?.className ||
                        'bg-theme-hover text-theme-muted'
                      }
                    >
                      {t('partners.level_prefix', { level: selectedPartner.federation_level })} &mdash;{' '}
                      {selectedPartner.is_external
                        ? t('external')
                        : FEDERATION_LEVELS[selectedPartner.federation_level]
                          ? t(FEDERATION_LEVELS[selectedPartner.federation_level]!.label)
                          : selectedPartner.federation_level_name || t('partners.level_unknown')}
                    </Chip>
                  </div>

                  {/* Available Features */}
                  {selectedPartner.permissions && selectedPartner.permissions.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-theme-primary mb-2">
                        {t('partners.available_features')}
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {selectedPartner.permissions.map((perm) => {
                          const meta = PERMISSION_META[perm];
                          const Icon = meta?.icon || Globe;
                          return (
                            <Chip
                              key={perm}
                              variant="flat"
                              size="sm"
                              className="bg-theme-hover text-theme-muted"
                              startContent={
                                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                              }
                            >
                              {meta ? t(`partners.permission_${perm}`) : perm}
                            </Chip>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </ModalBody>
              <ModalFooter className="flex gap-2">
                {isAuthenticated && (
                  <>
                    <Button
                      variant="flat"
                      className="bg-theme-elevated text-theme-primary"
                      startContent={<Users className="w-4 h-4" aria-hidden="true" />}
                      onPress={() => {
                        const path = tenantPath(`/federation/members?partner_id=${selectedPartner.id}`);
                        closeDetail();
                        navigate(path);
                      }}
                    >
                      {t('partners.browse_members')}
                    </Button>
                    <Button
                      className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
                      startContent={<ListTodo className="w-4 h-4" aria-hidden="true" />}
                      onPress={() => {
                        const path = tenantPath(`/federation/listings?partner_id=${selectedPartner.id}`);
                        closeDetail();
                        navigate(path);
                      }}
                    >
                      {t('partners.browse_listings')}
                    </Button>
                  </>
                )}
                {!isAuthenticated && (
                  <Button
                    variant="flat"
                    className="bg-theme-elevated text-theme-muted"
                    onPress={closeDetail}
                  >
                    {t('partners.close')}
                  </Button>
                )}
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Partner Card Component
// ─────────────────────────────────────────────────────────────────────────────

interface PartnerCardProps {
  partner: FederationPartner;
  onViewDetails: () => void;
}

function PartnerCard({ partner, onViewDetails }: PartnerCardProps) {
  const { t } = useTranslation('federation');
  const levelMeta = FEDERATION_LEVELS[partner.federation_level];

  return (
    <GlassCard className="p-5 hover:scale-[1.01] transition-transform h-full flex flex-col">
      <div className="flex items-start gap-4 mb-4">
        {/* Logo / Avatar */}
        <Avatar
          name={partner.name}
          src={resolveAvatarUrl(partner.logo)}
          size="lg"
          className="bg-gradient-to-br from-accent-strong to-accent-strong-end text-white flex-shrink-0"
        />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-theme-primary text-lg truncate">
            {partner.name}
          </h3>
          {partner.tagline && (
            <p className="text-theme-muted text-sm line-clamp-2 mt-0.5">
              {partner.tagline}
            </p>
          )}
        </div>
      </div>

      {/* Meta Info */}
      <div className="flex flex-wrap items-center gap-3 text-sm text-theme-subtle mb-4 flex-1">
        {partner.location && (
          <span className="flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
            {partner.location}
          </span>
        )}
        <span className="flex items-center gap-1">
          <Users className="w-3.5 h-3.5" aria-hidden="true" />
          {t('partners.member_count', { count: partner.member_count })}
        </span>
      </div>

      {/* Footer: Level + Action */}
      <div className="flex items-center justify-between pt-3 border-t border-theme-default">
        <div className="flex items-center gap-2">
          <Chip
            size="sm"
            variant="flat"
            className={levelMeta?.className || 'bg-theme-hover text-theme-muted'}
          >
            {partner.is_external
              ? t('external')
              : levelMeta
                ? t(levelMeta.label)
                : partner.federation_level_name || t('partners.level_unknown')}
          </Chip>
          {partner.is_external && (
            <Chip
              size="sm"
              variant="flat"
              className="bg-accent/10 text-accent dark:text-accent"
              startContent={<Globe className="w-3 h-3" aria-hidden="true" />}
            >
              {t('external')}
            </Chip>
          )}
          {partner.partnership_since && (
            <span className="text-xs text-theme-subtle">
              {t('partners.since_date', {
                date: new Date(partner.partnership_since).toLocaleDateString(getFormattingLocale(), {
                  month: 'short',
                  year: 'numeric',
                }),
              })}
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="flat"
          className="bg-theme-elevated text-theme-primary"
          startContent={<Eye className="w-3.5 h-3.5" aria-hidden="true" />}
          onPress={onViewDetails}
        >
          {t('partners.view_details')}
        </Button>
      </div>
    </GlassCard>
  );
}

export default FederationPartnersPage;
