import { getFormattingLocale } from '@/lib/helpers';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Select, SelectItem } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui/Table';
import { useDisclosure } from '@/components/ui/useDisclosure';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MyAdCampaignsPage — Member-facing self-serve portal for managing ad campaigns.
 *
 * Allows local businesses / Gemeinden to create and track their own ad
 * campaigns against the feed and discovery surfaces.
 *
 * Route: /advertise/campaigns
 * Gate: feature "local_advertising"
 */

import { useState, useEffect, useCallback } from 'react';

import { useTranslation } from 'react-i18next';
import Megaphone from 'lucide-react/icons/megaphone';
import Plus from 'lucide-react/icons/plus';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import { useAuth, useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { usePageTitle } from '@/hooks/usePageTitle';
import { PageMeta } from '@/components/seo';
import { PublicPageHero } from '@/components/public/PublicPageHero';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type CampaignType = 'feed' | 'discovery';
type CampaignStatus = 'draft' | 'pending' | 'active' | 'paused' | 'ended' | 'rejected';

interface AdCampaign {
  id: number;
  name: string;
  type: CampaignType;
  status: CampaignStatus;
  start_date: string;
  end_date: string;
  budget_cents: number;
  // i18next-instrument-ignore-next-line -- API contract field, not user-facing copy.
  targeting_radius_km?: number | null;
  created_at: string;
}

interface AdCampaignStats {
  impressions: number;
  clicks: number;
  ctr: number;
}

interface CreateCampaignForm {
  name: string;
  type: CampaignType;
  start_date: string;
  end_date: string;
  budget_cents: string; // string for input, converted on submit
  targeting_radius_km: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status chip color map
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<CampaignStatus, 'default' | 'primary' | 'success' | 'warning' | 'danger'> = {
  draft: 'default',
  pending: 'warning',
  active: 'success',
  paused: 'warning',
  ended: 'default',
  rejected: 'danger',
};

const formatBudget = (cents: number) =>
  `€${(cents / 100).toFixed(2)}`;

const formatCtr = (ctr: number) =>
  `${(ctr * 100).toFixed(2)}%`;

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function MyAdCampaignsPage() {
  const { t } = useTranslation('common');
  usePageTitle(t('advertise.page_title'));
  const { isAuthenticated } = useAuth();
  const { hasFeature } = useTenant();
  const toast = useToast();

  const createModal = useDisclosure();

  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [stats, setStats] = useState<Record<number, AdCampaignStats>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<CreateCampaignForm>({
    name: '',
    type: 'feed',
    start_date: '',
    end_date: '',
    budget_cents: '',
    targeting_radius_km: '',
  });

  const fetchCampaigns = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<AdCampaign[]>('/v2/me/ad-campaigns');
      if (res.success && res.data) {
        setCampaigns(Array.isArray(res.data) ? res.data : []);
      }
    } catch (err) {
      logError('MyAdCampaignsPage.fetchCampaigns', err);
      setError(t('advertise.load_error'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  const fetchStats = useCallback(async (id: number) => {
    try {
      const res = await api.get<AdCampaignStats>(`/v2/me/ad-campaigns/${id}/stats`);
      if (res.success && res.data) {
        setStats((prev) => ({ ...prev, [id]: res.data as AdCampaignStats }));
      }
    } catch {
      // Stats are non-critical — silently ignore
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !hasFeature('local_advertising')) return;
    fetchCampaigns();
  }, [isAuthenticated, hasFeature, fetchCampaigns]);

  // Fetch stats for active campaigns once the list is loaded
  useEffect(() => {
    for (const c of campaigns) {
      if (c.status === 'active') {
        fetchStats(c.id);
      }
    }
  }, [campaigns, fetchStats]);

  const handleCreate = async () => {
    if (!form.name.trim() || !form.start_date || !form.end_date || !form.budget_cents) {
      toast.showToast(t('advertise.validation_required'), 'error');
      return;
    }
    setIsCreating(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        type: form.type,
        start_date: form.start_date,
        end_date: form.end_date,
        budget_cents: Math.round(parseFloat(form.budget_cents) * 100),
      };
      if (form.targeting_radius_km) {
        payload.targeting_radius_km = parseFloat(form.targeting_radius_km);
      }
      const res = await api.post<AdCampaign>('/v2/me/ad-campaigns', payload);
      if (res.success) {
        toast.showToast(t('advertise.created_success'), 'success');
        createModal.onClose();
        setForm({ name: '', type: 'feed', start_date: '', end_date: '', budget_cents: '', targeting_radius_km: '' });
        fetchCampaigns();
      } else {
        toast.showToast(t('advertise.create_error'), 'error');
      }
    } catch (err) {
      logError('MyAdCampaignsPage.handleCreate', err);
      toast.showToast(t('advertise.create_error'), 'error');
    } finally {
      setIsCreating(false);
    }
  };

  const formatMetric = (value: number | undefined) =>
    value == null ? t('empty_dash') : value.toLocaleString(getFormattingLocale());

  if (!hasFeature('local_advertising')) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <PageMeta title={t('advertise.page_title')} noIndex />
        <Megaphone size={48} className="mb-4 text-muted" aria-hidden="true" />
        <p className="text-muted">{t('advertise.feature_disabled')}</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <PageMeta title={t('advertise.page_title')} noIndex />
      {/* Header — the same soft panel in the community colour that opens the
          offers, events and groups pages (AWID: warmer, more inviting). */}
      <PublicPageHero
        size="compact"
        title={t('advertise.page_title')}
        description={t('advertise.page_subtitle')}
        icon={<Megaphone className="h-6 w-6" aria-hidden="true" />}
        accent="indigo"
        action={
          <Button
            color="primary"
            startContent={<Plus size={16} aria-hidden="true" />}
            onPress={createModal.onOpen}
          >
            {t('advertise.create_campaign')}
          </Button>
        }
      />

      {/* Campaign list */}
      <GlassCard className="overflow-hidden">
        {isLoading ? (
          <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center py-12 text-center gap-4">
            <AlertTriangle size={40} className="text-warning" aria-hidden="true" />
            <p className="text-muted">{error}</p>
            <Button variant="flat" onPress={fetchCampaigns}>{t('advertise.retry')}</Button>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center gap-3">
            <Megaphone size={40} className="text-muted" aria-hidden="true" />
            <p className="text-muted">{t('advertise.empty.title')}</p>
            <Button color="primary" onPress={createModal.onOpen}>
              {t('advertise.create_first')}
            </Button>
          </div>
        ) : (
          <Table aria-label={t('advertise.table_aria')} mobileCards removeWrapper>
            <TableHeader>
              <TableColumn>{t('advertise.col_name')}</TableColumn>
              <TableColumn>{t('advertise.col_type')}</TableColumn>
              <TableColumn>{t('advertise.col_status')}</TableColumn>
              <TableColumn>{t('advertise.col_budget')}</TableColumn>
              <TableColumn>{t('advertise.col_dates')}</TableColumn>
              <TableColumn>{t('advertise.col_impressions')}</TableColumn>
              <TableColumn>{t('advertise.col_clicks')}</TableColumn>
              <TableColumn>{t('advertise.col_ctr')}</TableColumn>
            </TableHeader>
            <TableBody>
              {campaigns.map((campaign) => {
                const s = stats[campaign.id];
                return (
                  <TableRow key={campaign.id}>
                    <TableCell className="font-medium text-theme-primary">{campaign.name}</TableCell>
                    <TableCell className="capitalize text-muted">
                      {t(`advertise.type_${campaign.type}`)}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="sm"
                        color={STATUS_COLOR[campaign.status] ?? 'default'}
                        variant="flat"
                      >
                        {t(`advertise.status_${campaign.status}`)}
                      </Chip>
                    </TableCell>
                    <TableCell className="text-foreground">{formatBudget(campaign.budget_cents)}</TableCell>
                    <TableCell className="text-muted whitespace-nowrap">
                      {t('advertise.date_range', { start: campaign.start_date, end: campaign.end_date })}
                    </TableCell>
                    <TableCell className="text-foreground">{formatMetric(s?.impressions)}</TableCell>
                    <TableCell className="text-foreground">{formatMetric(s?.clicks)}</TableCell>
                    <TableCell className="text-foreground">{s ? formatCtr(s.ctr) : t('empty_dash')}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </GlassCard>

      {/* Create Campaign Modal */}
      <Modal isOpen={createModal.isOpen} onClose={createModal.onClose} size="lg">
        <ModalContent>
          <ModalHeader>{t('advertise.create_campaign')}</ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              <Input
                label={t('advertise.field_name')}
                placeholder={t('advertise.field_name_placeholder')}
                value={form.name}
                onValueChange={(v) => setForm((p) => ({ ...p, name: v }))}
                variant="bordered"
                isRequired
              />

              <Select
                label={t('advertise.field_type')}
                selectedKeys={[form.type]}
                onSelectionChange={(keys) => {
                  const v = Array.from(keys)[0] as CampaignType;
                  if (v) setForm((p) => ({ ...p, type: v }));
                }}
                variant="bordered"
              >
                <SelectItem key="feed" id="feed">{t('advertise.type_feed')}</SelectItem>
                <SelectItem key="discovery" id="discovery">{t('advertise.type_discovery')}</SelectItem>
              </Select>

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label={t('advertise.field_start_date')}
                  type="date"
                  value={form.start_date}
                  onValueChange={(v) => setForm((p) => ({ ...p, start_date: v }))}
                  variant="bordered"
                  isRequired
                />
                <Input
                  label={t('advertise.field_end_date')}
                  type="date"
                  value={form.end_date}
                  onValueChange={(v) => setForm((p) => ({ ...p, end_date: v }))}
                  variant="bordered"
                  isRequired
                />
              </div>

              <Input
                label={t('advertise.field_budget')}
                placeholder="50.00"
                type="number"
                min="1"
                step="0.01"
                startContent={<span className="text-muted text-sm">€</span>}
                value={form.budget_cents}
                onValueChange={(v) => setForm((p) => ({ ...p, budget_cents: v }))}
                variant="bordered"
                isRequired
                description={t('advertise.field_budget_desc')}
              />

              <Input
                label={t('advertise.field_radius')}
                placeholder="25"
                type="number"
                min="1"
                /* eslint-disable-next-line i18next/no-literal-string */
                endContent={<span className="text-muted text-sm" aria-hidden="true">km</span>}
                value={form.targeting_radius_km}
                onValueChange={(v) => setForm((p) => ({ ...p, targeting_radius_km: v }))}
                variant="bordered"
                description={t('advertise.field_radius_desc')}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={createModal.onClose} isDisabled={isCreating}>
              {t('cancel')}
            </Button>
            <Button color="primary" onPress={handleCreate} isLoading={isCreating}>
              {t('advertise.submit_create')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default MyAdCampaignsPage;
