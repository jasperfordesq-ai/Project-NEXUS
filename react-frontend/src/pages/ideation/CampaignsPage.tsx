// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Campaigns Page (I7)
 *
 * Lists all ideation campaigns - grouped collections of related challenges.
 * Admin can create new campaigns.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import ArrowLeft from 'lucide-react/icons/arrow-left';
import Layers from 'lucide-react/icons/layers';
import Plus from 'lucide-react/icons/plus';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Lightbulb from 'lucide-react/icons/lightbulb';
import Calendar from 'lucide-react/icons/calendar';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { EmptyState } from '@/components/feedback';
import { useAuth, useToast, useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveThumbnailUrl, getFormattingLocale } from '@/lib/helpers';

/* ───────────────────────── Types ───────────────────────── */

interface Campaign {
  id: number;
  title: string;
  description: string | null;
  cover_image: string | null;
  challenges_count: number;
  status: string;
  created_at: string;
}

/* ───────────────────────── Main Component ───────────────────────── */

const formatDate = (dateStr: string) => {
  try {
    return new Date(dateStr).toLocaleDateString(getFormattingLocale(), {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
};

export function CampaignsPage() {
  const { t } = useTranslation('ideation');
  usePageTitle(t('campaigns.page_title'));
  const { user } = useAuth();
  const { tenantPath, hasFeature } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { isOpen, onOpen, onClose } = useDisclosure();
  const [newCampaign, setNewCampaign] = useState({ name: '', description: '' });
  const [isCreating, setIsCreating] = useState(false);

  const isAdmin = user?.role && ['admin', 'tenant_admin', 'tenant_super_admin', 'super_admin'].includes(user.role);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const fetchCampaigns = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setIsLoading(true);
      setError(null);
      const response = await api.get<Campaign[]>('/v2/ideation-campaigns');
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setCampaigns(Array.isArray(response.data) ? response.data : []);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to fetch campaigns', err);
      setError(tRef.current('challenges.load_error'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  if (!hasFeature('ideation_challenges')) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 py-16 text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-100 to-yellow-100 dark:from-amber-900/30 dark:to-yellow-900/30 flex items-center justify-center mb-4">
          <Lightbulb className="w-8 h-8 text-[var(--color-warning)]" aria-hidden="true" />
        </div>
        <h2 className="text-xl font-semibold text-[var(--color-text)] mb-2">{t('campaigns.feature_not_available')}</h2>
        <p className="text-[var(--color-text-muted)] max-w-sm">
          {t('campaigns.feature_not_available_desc')}
        </p>
      </div>
    );
  }

  const handleCreate = async () => {
    if (!newCampaign.name.trim()) return;

    setIsCreating(true);
    try {
      const response = await api.post<Campaign>('/v2/ideation-campaigns', {
        title: newCampaign.name.trim(),
        description: newCampaign.description.trim() || null,
      });

      if (response.success && response.data) {
        toastRef.current.success(tRef.current('toast.campaign_created'));
        setNewCampaign({ name: '', description: '' });
        onClose();
        navigate(tenantPath(`/ideation/campaigns/${response.data.id}`));
      }
    } catch (err) {
      logError('Failed to create campaign', err);
      toastRef.current.error(tRef.current('toast.error_generic'));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <PageMeta title={t('page_meta.campaigns.title')} noIndex />
      {/* Back link */}
      <Button
        variant="light"
        startContent={<ArrowLeft className="w-4 h-4" />}
        className="mb-4 -ml-2"
        onPress={() => navigate(tenantPath('/ideation'))}
      >
        {t('title')}
      </Button>

      {/* The same soft panel in the community colour that opens the offers,
          events and groups pages (AWID: warmer, more inviting). */}
      <div className="mb-6">
        <PublicPageHero
          size="compact"
          title={t('campaigns.title')}
          icon={<Layers className="h-6 w-6" aria-hidden="true" />}
          accent="amber"
          action={isAdmin ? (
            <Button
              color="primary"
              startContent={<Plus className="w-4 h-4" />}
              onPress={onOpen}
            >
              {t('campaigns.create')}
            </Button>
          ) : undefined}
        />
      </div>

      {/* Loading */}
      {isLoading && (
        <div role="status" aria-busy="true" aria-label={t('loading')} className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <div role="alert">
          <EmptyState
            icon={<AlertTriangle className="w-10 h-10 text-theme-subtle" />}
            title={t('challenges.load_error')}
            action={
              <Button
                color="primary"
                variant="flat"
                startContent={<RefreshCw className="w-4 h-4" />}
                onPress={fetchCampaigns}
              >
                {t('campaigns.retry')}
              </Button>
            }
          />
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && campaigns.length === 0 && (
        <EmptyState
          icon={<Layers className="w-10 h-10 text-theme-subtle" />}
          title={t('campaigns.empty_title')}
          description={t('campaigns.empty_description')}
        />
      )}

      {/* Campaign List */}
      {!isLoading && !error && campaigns.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {campaigns.map((campaign) => (
            <Link
              key={campaign.id}
              to={tenantPath(`/ideation/campaigns/${campaign.id}`)}
              className="block"
            >
              <GlassCard className="h-full hover:shadow-lg transition-shadow cursor-pointer overflow-hidden">
                {campaign.cover_image && (
                  <div className="w-full h-32 overflow-hidden">
                    <img
                      src={resolveThumbnailUrl(campaign.cover_image, { width: 640, height: 320 })}
                      alt={campaign.title}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                )}
                <div className="p-5">
                  <h3 className="text-lg font-semibold text-[var(--color-text)] mb-2">
                    {campaign.title}
                  </h3>
                  {campaign.description && (
                    <p className="text-sm text-[var(--color-text-secondary)] mb-3 line-clamp-2">
                      {campaign.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 text-xs text-[var(--color-text-tertiary)]">
                    <span className="flex items-center gap-1">
                      <Lightbulb className="w-3.5 h-3.5" />
                      {t('campaigns.challenges_count', { count: campaign.challenges_count })}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      {formatDate(campaign.created_at)}
                    </span>
                  </div>
                </div>
              </GlassCard>
            </Link>
          ))}
        </div>
      )}

      {/* Create Campaign Modal */}
      <Modal isOpen={isOpen} onClose={onClose} size="lg">
        <ModalContent>
          <ModalHeader>{t('campaigns.create')}</ModalHeader>
          <ModalBody>
            <Input
              label={t('form.title_label')}
              placeholder={t('form.title_placeholder')}
              value={newCampaign.name}
              onValueChange={(val) => setNewCampaign(prev => ({ ...prev, name: val }))}
              variant="bordered"
              isRequired
            />
            <Textarea
              label={t('form.description_label')}
              placeholder={t('form.description_placeholder')}
              value={newCampaign.description}
              onValueChange={(val) => setNewCampaign(prev => ({ ...prev, description: val }))}
              variant="bordered"
              minRows={3}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onClose}>
              {t('form.cancel')}
            </Button>
            <Button
              color="primary"
              isLoading={isCreating}
              isDisabled={!newCampaign.name.trim()}
              onPress={handleCreate}
            >
              {isCreating ? t('form.creating') : t('campaigns.create')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default CampaignsPage;
