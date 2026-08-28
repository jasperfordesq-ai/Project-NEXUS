import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Select, SelectItem } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui/Table';
import { Textarea } from '@/components/ui/Textarea';
import { useDisclosure } from '@/components/ui/useDisclosure';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MyPushCampaignsPage — Member-facing self-serve portal for managing push campaigns.
 *
 * Allows local businesses / Gemeinden to create and send targeted push
 * notification campaigns to nearby opted-in members.
 *
 * Route: /advertise/push-campaigns
 * Gate: feature "local_advertising"
 */

import { useState, useEffect, useCallback } from 'react';

import { useTranslation } from 'react-i18next';
import BellRing from 'lucide-react/icons/bell-ring';
import Plus from 'lucide-react/icons/plus';
import Users from 'lucide-react/icons/users';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import { useAuth, useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { getFormattingLocale } from '@/lib/helpers';
import { logError } from '@/lib/logger';
import { usePageTitle } from '@/hooks/usePageTitle';
import { PageMeta } from '@/components/seo';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type TrustTier = 'any' | 'member' | 'trusted' | 'verified';
type CampaignStatus = 'draft' | 'scheduled' | 'sent' | 'cancelled' | 'failed';

interface PushCampaign {
  id: number;
  name: string;
  title: string;
  body: string;
  status: CampaignStatus;
  schedule_at: string | null;
  // i18next-instrument-ignore-next-line -- API contract field, not user-facing copy.
  audience_radius_km: number;
  audience_min_trust_tier: TrustTier;
  created_at: string;
}

interface AudienceEstimate {
  estimated_reach: number;
}

interface CreatePushCampaignForm {
  name: string;
  title: string;
  body: string;
  schedule_at: string;
  audience_radius_km: string;
  audience_min_trust_tier: TrustTier;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status chip color map
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<CampaignStatus, 'default' | 'primary' | 'success' | 'warning' | 'danger'> = {
  draft: 'default',
  scheduled: 'primary',
  sent: 'success',
  cancelled: 'default',
  failed: 'danger',
};

const dateTimeFormatter = () => new Intl.DateTimeFormat(getFormattingLocale(), {
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  month: 'short',
  year: 'numeric',
});

function formatDateTime(value: string): string {
  return dateTimeFormatter().format(new Date(value));
}

const defaultForm: CreatePushCampaignForm = {
  name: '',
  title: '',
  body: '',
  schedule_at: '',
  audience_radius_km: '',
  audience_min_trust_tier: 'any',
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function MyPushCampaignsPage() {
  const { t } = useTranslation('common');
  usePageTitle(t('push_campaign.page_title'));
  const { isAuthenticated } = useAuth();
  const { hasFeature } = useTenant();
  const toast = useToast();

  const createModal = useDisclosure();

  const [campaigns, setCampaigns] = useState<PushCampaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isEstimating, setIsEstimating] = useState(false);
  const [audienceEstimate, setAudienceEstimate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<CreatePushCampaignForm>(defaultForm);

  const fetchCampaigns = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<PushCampaign[]>('/v2/me/push-campaigns');
      if (res.success && res.data) {
        setCampaigns(Array.isArray(res.data) ? res.data : []);
      }
    } catch (err) {
      logError('MyPushCampaignsPage.fetchCampaigns', err);
      setError(t('push_campaign.load_error'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!isAuthenticated || !hasFeature('local_advertising')) return;
    fetchCampaigns();
  }, [isAuthenticated, hasFeature, fetchCampaigns]);

  const handleEstimateAudience = async () => {
    setIsEstimating(true);
    setAudienceEstimate(null);
    try {
      const payload: Record<string, unknown> = {
        audience_min_trust_tier: form.audience_min_trust_tier,
      };
      if (form.audience_radius_km) {
        payload.audience_radius_km = parseFloat(form.audience_radius_km);
      }
      const res = await api.post<AudienceEstimate>('/v2/me/push-campaigns/estimate-audience', payload);
      if (res.success && res.data) {
        const estimate = (res.data as AudienceEstimate).estimated_reach;
        setAudienceEstimate(estimate);
      }
    } catch (err) {
      logError('MyPushCampaignsPage.handleEstimateAudience', err);
      toast.showToast(t('push_campaign.estimate_error'), 'error');
    } finally {
      setIsEstimating(false);
    }
  };

  const handleCreate = async () => {
    if (!form.name.trim() || !form.title.trim() || !form.body.trim()) {
      toast.showToast(t('push_campaign.validation_required'), 'error');
      return;
    }
    setIsCreating(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        title: form.title.trim(),
        body: form.body.trim(),
        audience_min_trust_tier: form.audience_min_trust_tier,
      };
      if (form.schedule_at) payload.schedule_at = form.schedule_at;
      if (form.audience_radius_km) {
        payload.audience_radius_km = parseFloat(form.audience_radius_km);
      }
      const res = await api.post<PushCampaign>('/v2/me/push-campaigns', payload);
      if (res.success) {
        toast.showToast(t('push_campaign.created_success'), 'success');
        createModal.onClose();
        setForm(defaultForm);
        setAudienceEstimate(null);
        fetchCampaigns();
      } else {
        toast.showToast(t('push_campaign.create_error'), 'error');
      }
    } catch (err) {
      logError('MyPushCampaignsPage.handleCreate', err);
      toast.showToast(t('push_campaign.create_error'), 'error');
    } finally {
      setIsCreating(false);
    }
  };

  const handleModalClose = () => {
    createModal.onClose();
    setForm(defaultForm);
    setAudienceEstimate(null);
  };

  if (!hasFeature('local_advertising')) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <PageMeta title={t('push_campaign.page_title')} noIndex />
        <BellRing size={48} className="mb-4 text-muted" aria-hidden="true" />
        <p className="text-muted">{t('push_campaign.feature_disabled')}</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <PageMeta title={t('push_campaign.page_title')} noIndex />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BellRing size={28} className="text-accent" aria-hidden="true" />
          <div>
            <h1 className="text-2xl font-bold text-theme-primary">{t('push_campaign.page_title')}</h1>
            <p className="text-sm text-theme-subtle">{t('push_campaign.page_subtitle')}</p>
          </div>
        </div>
        <Button
          color="primary"
          startContent={<Plus size={16} aria-hidden="true" />}
          onPress={createModal.onOpen}
        >
          {t('push_campaign.create_campaign')}
        </Button>
      </div>

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
            <Button variant="flat" onPress={fetchCampaigns}>{t('push_campaign.retry')}</Button>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center gap-3">
            <BellRing size={40} className="text-muted" aria-hidden="true" />
            <p className="text-muted">{t('push_campaign.empty.title')}</p>
            <Button color="primary" onPress={createModal.onOpen}>
              {t('push_campaign.create_first')}
            </Button>
          </div>
        ) : (
          <Table aria-label={t('push_campaign.table_aria')} mobileCards removeWrapper>
            <TableHeader>
              <TableColumn>{t('push_campaign.col_name')}</TableColumn>
              <TableColumn>{t('push_campaign.col_title')}</TableColumn>
              <TableColumn>{t('push_campaign.col_status')}</TableColumn>
              <TableColumn>{t('push_campaign.col_scheduled')}</TableColumn>
              <TableColumn>{t('push_campaign.col_radius')}</TableColumn>
              <TableColumn>{t('push_campaign.col_trust_tier')}</TableColumn>
            </TableHeader>
            <TableBody>
              {campaigns.map((campaign) => (
                <TableRow key={campaign.id}>
                  <TableCell className="font-medium text-theme-primary">{campaign.name}</TableCell>
                  <TableCell className="text-foreground max-w-[200px] truncate">{campaign.title}</TableCell>
                  <TableCell>
                    <Chip
                      size="sm"
                      color={STATUS_COLOR[campaign.status] ?? 'default'}
                      variant="flat"
                    >
                      {t(`push_campaign.status_${campaign.status}`)}
                    </Chip>
                  </TableCell>
                  <TableCell className="text-muted whitespace-nowrap">
                    {campaign.schedule_at ? formatDateTime(campaign.schedule_at) : t('empty_dash')}
                  </TableCell>
                  <TableCell className="text-muted">
                    {campaign.audience_radius_km ? t('push_campaign.radius_km', { radius: campaign.audience_radius_km }) : t('empty_dash')}
                  </TableCell>
                  <TableCell className="text-muted capitalize">
                    {t(`push_campaign.tier_${campaign.audience_min_trust_tier}`)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </GlassCard>

      {/* Create Push Campaign Modal */}
      <Modal isOpen={createModal.isOpen} onClose={handleModalClose} size="lg" scrollBehavior="inside">
        <ModalContent>
          <ModalHeader>{t('push_campaign.create_campaign')}</ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              <Input
                label={t('push_campaign.field_name')}
                placeholder={t('push_campaign.field_name_placeholder')}
                value={form.name}
                onValueChange={(v) => setForm((p) => ({ ...p, name: v }))}
                variant="bordered"
                isRequired
              />

              <Input
                label={t('push_campaign.field_title')}
                placeholder={t('push_campaign.field_title_placeholder')}
                value={form.title}
                onValueChange={(v) => setForm((p) => ({ ...p, title: v }))}
                variant="bordered"
                isRequired
                description={t('push_campaign.field_title_desc')}
              />

              <Textarea
                label={t('push_campaign.field_body')}
                placeholder={t('push_campaign.field_body_placeholder')}
                value={form.body}
                onValueChange={(v) => setForm((p) => ({ ...p, body: v }))}
                variant="bordered"
                isRequired
                minRows={3}
                description={t('push_campaign.field_body_desc')}
              />

              <Input
                label={t('push_campaign.field_schedule_at')}
                type="datetime-local"
                value={form.schedule_at}
                onValueChange={(v) => setForm((p) => ({ ...p, schedule_at: v }))}
                variant="bordered"
                description={t('push_campaign.field_schedule_at_desc')}
              />

              <Input
                label={t('push_campaign.field_radius')}
                placeholder="25"
                type="number"
                min="1"
                /* eslint-disable-next-line i18next/no-literal-string */
                endContent={<span className="text-muted text-sm" aria-hidden="true">km</span>}
                value={form.audience_radius_km}
                onValueChange={(v) => setForm((p) => ({ ...p, audience_radius_km: v }))}
                variant="bordered"
                description={t('push_campaign.field_radius_desc')}
              />

              <Select
                label={t('push_campaign.field_trust_tier')}
                selectedKeys={[form.audience_min_trust_tier]}
                onSelectionChange={(keys) => {
                  const v = Array.from(keys)[0] as TrustTier;
                  if (v) setForm((p) => ({ ...p, audience_min_trust_tier: v }));
                }}
                variant="bordered"
                description={t('push_campaign.field_trust_tier_desc')}
              >
                <SelectItem key="any" id="any">{t('push_campaign.tier_any')}</SelectItem>
                <SelectItem key="member" id="member">{t('push_campaign.tier_member')}</SelectItem>
                <SelectItem key="trusted" id="trusted">{t('push_campaign.tier_trusted')}</SelectItem>
                <SelectItem key="verified" id="verified">{t('push_campaign.tier_verified')}</SelectItem>
              </Select>

              {/* Audience estimate */}
              <div className="rounded-lg border border-divider p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-muted">
                    <Users size={16} aria-hidden="true" />
                    <span>{t('push_campaign.estimate_label')}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="flat"
                    onPress={handleEstimateAudience}
                    isLoading={isEstimating}
                  >
                    {t('push_campaign.estimate_button')}
                  </Button>
                </div>
                {audienceEstimate !== null && (
                  <p className="text-sm font-medium text-accent">
                    {t('push_campaign.estimate_result', { count: audienceEstimate })}
                  </p>
                )}
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={handleModalClose} isDisabled={isCreating}>
              {t('cancel')}
            </Button>
            <Button color="primary" onPress={handleCreate} isLoading={isCreating}>
              {t('push_campaign.submit_create')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default MyPushCampaignsPage;
