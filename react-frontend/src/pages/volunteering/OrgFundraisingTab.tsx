// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * OrgFundraisingTab — the organisation dashboard's Fundraising tab.
 *
 * An organisation's owners and admins run fundraising campaigns for their own
 * organisation (owner decisions, 5 Oct 2026): campaigns go live straight away,
 * gifts are held by the community and passed on, and the organisation
 * confirms each hand-over. The organisation is never sent by this page — the
 * server takes it from the URL.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import HandCoins from 'lucide-react/icons/hand-coins';
import Plus from 'lucide-react/icons/plus';
import ChevronDown from 'lucide-react/icons/chevron-down';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { useTenant, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { formatCurrency, getFormattingLocale } from '@/lib/helpers';
import { FundraisingHistoryList } from '@/components/fundraising/FundraisingHistoryList';
import { HandoverList } from '@/components/fundraising/HandoverList';
import type { CampaignGift, Handover, HandoverListData, HistoryItem } from '@/lib/fundraisingTypes';

interface OrgFundraisingTabProps {
  orgId: number;
}

interface Campaign {
  id: number;
  title?: string;
  name?: string;
  description?: string | null;
  start_date: string;
  end_date: string;
  goal_amount?: string | number;
  target_amount?: number;
  raised_amount?: number;
  is_active: boolean | number;
  status?: string;
}

type CampaignStatus = 'active' | 'upcoming' | 'paused' | 'ended';

const STATUS_COLOR: Record<CampaignStatus, 'success' | 'accent' | 'warning' | 'default'> = {
  active: 'success',
  upcoming: 'accent',
  paused: 'warning',
  ended: 'default',
};

interface FormState {
  title: string;
  description: string;
  start_date: string;
  end_date: string;
  goal_amount: string;
}

const emptyForm: FormState = { title: '', description: '', start_date: '', end_date: '', goal_amount: '' };

function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function formatDay(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(getFormattingLocale(), { dateStyle: 'medium' }).format(date);
}

function campaignStatus(campaign: Campaign): CampaignStatus {
  const status = campaign.status as CampaignStatus | undefined;
  return status && status in STATUS_COLOR ? status : (campaign.is_active ? 'active' : 'ended');
}

function errorOf(res: { error?: string; errors?: { message?: string }[] }): string | undefined {
  return res.error || res.errors?.[0]?.message;
}

export default function OrgFundraisingTab({ orgId }: OrgFundraisingTabProps) {
  const { t } = useTranslation('fundraising');
  const { t: tc } = useTranslation('common');
  const toast = useToast();
  const { tenant } = useTenant();
  const currency = (tenant?.currency || 'EUR').toUpperCase();
  const base = `/v2/volunteering/organisations/${orgId}`;

  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [endTarget, setEndTarget] = useState<Campaign | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await api.get<{ items: Campaign[] }>(`${base}/campaigns`);
      if (res.success && res.data) {
        setCampaigns(res.data.items);
      } else {
        setFailed(true);
      }
    } catch (err) {
      logError('Failed to load organisation campaigns', err);
      setFailed(true);
    }
  }, [base]);

  useEffect(() => { void load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (campaign: Campaign) => {
    setEditing(campaign);
    setForm({
      title: campaign.title ?? campaign.name ?? '',
      description: campaign.description ?? '',
      start_date: campaign.start_date.slice(0, 10),
      end_date: campaign.end_date.slice(0, 10),
      goal_amount: String(Number(campaign.goal_amount ?? campaign.target_amount ?? 0)),
    });
    setFormError(null);
    setFormOpen(true);
  };

  const save = async () => {
    setSaving(true);
    setFormError(null);
    const body = {
      title: form.title.trim(),
      description: form.description.trim(),
      start_date: form.start_date,
      end_date: form.end_date,
      goal_amount: Number(form.goal_amount),
    };
    try {
      const res = editing
        ? await api.put(`${base}/campaigns/${editing.id}`, body)
        : await api.post(`${base}/campaigns`, body);
      if (res.success) {
        toast.success(t('org.saved'));
        setFormOpen(false);
        await load();
      } else {
        setFormError(errorOf(res) || t('load_failed'));
      }
    } catch (err) {
      logError('Failed to save organisation campaign', err);
      setFormError(t('load_failed'));
    } finally {
      setSaving(false);
    }
  };

  const update = async (campaign: Campaign, changes: Record<string, unknown>) => {
    setBusyId(campaign.id);
    try {
      const res = await api.put(`${base}/campaigns/${campaign.id}`, changes);
      if (res.success) {
        toast.success(t('org.saved'));
        await load();
      } else {
        toast.error(errorOf(res) || t('load_failed'));
      }
    } catch (err) {
      logError('Failed to update organisation campaign', err);
      toast.error(t('load_failed'));
    } finally {
      setBusyId(null);
    }
  };

  if (failed) {
    return (
      <GlassCard className="flex flex-col items-center gap-3 p-6 text-center">
        <p className="text-sm text-muted">{t('org.load_failed')}</p>
        <Button size="sm" variant="tertiary" onPress={() => void load()}>{t('retry')}</Button>
      </GlassCard>
    );
  }

  if (campaigns === null) {
    return (
      <div role="status" aria-busy="true" className="flex justify-center py-10">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-2xl text-sm text-muted">{t('org.intro')}</p>
        <Button className="shrink-0" startContent={<Plus className="h-4 w-4" aria-hidden="true" />} onPress={openCreate}>
          {t('org.new_campaign')}
        </Button>
      </div>

      {campaigns.length === 0 ? (
        <GlassCard className="flex flex-col items-center gap-2 p-8 text-center">
          <HandCoins className="h-8 w-8 text-muted" aria-hidden="true" />
          <p className="text-sm text-muted">{t('org.empty')}</p>
        </GlassCard>
      ) : (
        campaigns.map((campaign) => {
          const status = campaignStatus(campaign);
          const goal = Number(campaign.goal_amount ?? campaign.target_amount ?? 0);
          const raised = Number(campaign.raised_amount ?? 0);
          const expanded = expandedId === campaign.id;
          const live = status === 'active' || status === 'upcoming';

          return (
            <GlassCard key={campaign.id} className="flex flex-col gap-3 p-4 sm:p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-foreground">{campaign.title ?? campaign.name}</h3>
                    <Chip size="sm" variant="soft" color={STATUS_COLOR[status]}>{t(`org.status.${status}`)}</Chip>
                  </div>
                  <p className="text-sm text-foreground">
                    {t('org.raised_of_goal', { raised: formatCurrency(raised, currency), goal: formatCurrency(goal, currency) })}
                  </p>
                  <p className="text-xs text-muted">{formatDay(campaign.start_date)} – {formatDay(campaign.end_date)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="tertiary" isDisabled={busyId === campaign.id} onPress={() => openEdit(campaign)}>
                    {t('org.edit_campaign')}
                  </Button>
                  {live && (
                    <Button size="sm" variant="tertiary" isDisabled={busyId === campaign.id} onPress={() => void update(campaign, { is_active: false })}>
                      {t('org.pause')}
                    </Button>
                  )}
                  {status === 'paused' && (
                    <Button size="sm" variant="tertiary" isDisabled={busyId === campaign.id} onPress={() => void update(campaign, { is_active: true })}>
                      {t('org.resume')}
                    </Button>
                  )}
                  {status !== 'ended' && (
                    <Button size="sm" variant="danger-soft" isDisabled={busyId === campaign.id} onPress={() => setEndTarget(campaign)}>
                      {t('org.end')}
                    </Button>
                  )}
                </div>
              </div>

              <Button
                size="sm"
                variant="ghost"
                className="self-start"
                aria-expanded={expanded}
                endContent={<ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />}
                onPress={() => setExpandedId(expanded ? null : campaign.id)}
              >
                {expanded ? t('org.hide_details') : t('org.show_details')}
              </Button>

              {expanded && <CampaignDetails base={base} campaignId={campaign.id} />}
            </GlassCard>
          );
        })
      )}

      <Modal isOpen={formOpen} onClose={() => { if (!saving) setFormOpen(false); }} size="lg">
        <ModalContent>
          <ModalHeader>{editing ? t('org.edit_campaign') : t('org.new_campaign')}</ModalHeader>
          <ModalBody>
            <div className="flex flex-col gap-4">
              <Input label={t('history.field.title')} value={form.title} isRequired variant="secondary"
                onValueChange={(v) => setForm((f) => ({ ...f, title: v }))} />
              <Textarea label={t('history.field.description')} value={form.description} variant="secondary"
                onValueChange={(v) => setForm((f) => ({ ...f, description: v }))} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label={t('history.field.start_date')} type="date" value={form.start_date} isRequired variant="secondary"
                  onValueChange={(v) => setForm((f) => ({ ...f, start_date: v }))} />
                <Input label={t('history.field.end_date')} type="date" value={form.end_date} isRequired variant="secondary"
                  onValueChange={(v) => setForm((f) => ({ ...f, end_date: v }))} />
              </div>
              <Input label={t('history.field.goal_amount')} type="number" min="1" step="0.01" value={form.goal_amount} isRequired
                variant="secondary" endContent={<span className="text-xs font-semibold text-muted">{currency}</span>}
                onValueChange={(v) => setForm((f) => ({ ...f, goal_amount: v }))} />
              {formError && <p role="alert" className="text-sm text-danger">{formError}</p>}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setFormOpen(false)} isDisabled={saving}>{tc('cancel')}</Button>
            <Button
              onPress={() => void save()}
              isLoading={saving}
              isDisabled={form.title.trim() === '' || !form.start_date || !form.end_date || !(Number(form.goal_amount) > 0)}
            >
              {t('org.save')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={endTarget !== null} onClose={() => { if (busyId === null) setEndTarget(null); }} size="sm">
        <ModalContent>
          <ModalHeader>{t('org.end')}</ModalHeader>
          <ModalBody>
            <p className="text-sm text-foreground">{t('org.end_confirm')}</p>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setEndTarget(null)} isDisabled={busyId !== null}>{tc('cancel')}</Button>
            <Button
              variant="danger"
              isLoading={busyId !== null}
              onPress={() => {
                const target = endTarget;
                setEndTarget(null);
                if (target) void update(target, { is_active: false, end_date: today() });
              }}
            >
              {t('org.end')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

/** Gifts, hand-overs and history of one campaign, loaded when it is expanded. */
function CampaignDetails({ base, campaignId }: { base: string; campaignId: number }) {
  const { t } = useTranslation('fundraising');
  const toast = useToast();
  const [gifts, setGifts] = useState<CampaignGift[] | null>(null);
  const [handovers, setHandovers] = useState<HandoverListData | null>(null);
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [g, h, hi] = await Promise.all([
        api.get<{ items: CampaignGift[] }>(`${base}/campaigns/${campaignId}/gifts`),
        api.get<HandoverListData>(`${base}/campaigns/${campaignId}/handovers`),
        api.get<{ items: HistoryItem[] }>(`${base}/campaigns/${campaignId}/history`),
      ]);
      if (g.success && g.data && h.success && h.data && hi.success && hi.data) {
        setGifts(g.data.items);
        setHandovers(h.data);
        setHistory(hi.data.items);
      } else {
        setFailed(true);
      }
    } catch (err) {
      logError('Failed to load campaign details', err);
      setFailed(true);
    }
  }, [base, campaignId]);

  useEffect(() => { void load(); }, [load]);

  const confirm = async (handover: Handover) => {
    setBusyId(handover.id);
    try {
      const res = await api.post(`${base}/handovers/${handover.id}/confirm`);
      if (res.success) {
        toast.success(t('handovers.confirmed'));
        await load();
      } else {
        toast.error(errorOf(res) || t('load_failed'));
      }
    } catch (err) {
      logError('Failed to confirm hand-over', err);
      toast.error(t('load_failed'));
    } finally {
      setBusyId(null);
    }
  };

  if (failed) {
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <p className="text-sm text-muted">{t('load_failed')}</p>
        <Button size="sm" variant="tertiary" onPress={() => void load()}>{t('retry')}</Button>
      </div>
    );
  }
  if (gifts === null || handovers === null || history === null) {
    return (
      <div role="status" aria-busy="true" className="flex justify-center py-6">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 border-t border-[var(--border-default)] pt-4">
      <section className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold text-foreground">{t('org.gifts')}</h4>
        {gifts.length === 0 ? (
          <p className="text-sm text-muted">{t('org.no_gifts')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border-default)]">
            {gifts.map((gift) => (
              <li key={gift.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-sm text-foreground">{gift.display_name ?? t('org.anonymous')}</span>
                <span className="flex items-center gap-2 text-sm">
                  <span className="text-muted">{formatDay(gift.created_at)} · {t(`org.method.${gift.payment_method}`)}</span>
                  <span className="font-semibold text-foreground">{formatCurrency(gift.amount, gift.currency)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold text-foreground">{t('handovers.title')}</h4>
        <HandoverList data={handovers} onConfirm={(h) => void confirm(h)} busyId={busyId} />
      </section>

      <section className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold text-foreground">{t('history.title')}</h4>
        <FundraisingHistoryList items={history} />
      </section>
    </div>
  );
}
