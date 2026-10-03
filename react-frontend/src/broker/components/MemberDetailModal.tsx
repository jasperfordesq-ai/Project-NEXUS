// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Member Detail Modal (broker panel) — "the member window".
 *
 * A single-member view giving brokers the operational actions the admin Users
 * area used to be needed for: approve/suspend/reactivate, resend verification,
 * send a password reset, reset 2FA, adjust the time balance, edit safe profile
 * fields, and review vetting / insurance / consent status. Privileged actions
 * (role/status change, ban, delete) are intentionally absent — the backend also
 * rejects them for brokers (see AdminUsersController@update).
 *
 * Mounted once in BrokerLayout and driven by `?member=<id>`
 * (see BrokerMemberWindow). Organised into tabs: Overview, Compliance, Notes,
 * then the member's records across the panel — Exchanges, Message copies,
 * Monitoring (with Add / Extend), Risk tags, Support needs — and Actions.
 * Record tabs load when opened, not when the window opens.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Avatar, Button, Chip,
  Modal, ModalContent, ModalHeader, ModalHeading, ModalBody, ModalFooter,
  Tabs, Tab,
} from '@/components/ui';
import type { LucideIcon } from 'lucide-react';
import AlertCircle from 'lucide-react/icons/circle-alert';
import ShieldCheck from 'lucide-react/icons/shield-check';
import IdCard from 'lucide-react/icons/id-card';
import StickyNote from 'lucide-react/icons/sticky-note';
import Wrench from 'lucide-react/icons/wrench';
import ArrowRightLeft from 'lucide-react/icons/arrow-right-left';
import MessageSquare from 'lucide-react/icons/message-square';
import Eye from 'lucide-react/icons/eye';
import Tag from 'lucide-react/icons/tag';
import LifeBuoy from 'lucide-react/icons/life-buoy';
import CheckCircle2 from 'lucide-react/icons/circle-check-big';
import Circle from 'lucide-react/icons/circle';
import { useToast } from '@/contexts';
import { adminUsers, adminVetting, adminInsurance } from '@/admin/api/adminApi';
import type { AdminUserDetail, VettingAttestation, InsuranceCertificate } from '@/admin/api/types';
import { resolveAvatarUrl, getFormattingLocale } from '@/lib/helpers';
import { formatServerDate } from '@/lib/serverTime';
import { BrokerStatusChip } from './BrokerStatusChip';
import { BrokerSkeleton } from './BrokerSkeleton';
import { BrokerEmptyState } from './BrokerEmptyState';
import { useMemberNotes } from './member/useMemberNotes';
import { MemberNotesPanel } from './member/MemberNotesPanel';
import { MemberActionsTab } from './member/MemberActionsTab';
import { MemberExchangesTab } from './member/MemberExchangesTab';
import { MemberMessagesTab } from './member/MemberMessagesTab';
import { MemberMonitoringTab } from './member/MemberMonitoringTab';
import { MemberRiskTagsTab } from './member/MemberRiskTagsTab';
import { MemberSupportNeedsTab } from './member/MemberSupportNeedsTab';

type MemberDetail = AdminUserDetail;

interface ConsentRow {
  consent_type?: string;
  type?: string;
  name?: string;
  granted?: boolean;
  is_granted?: boolean;
  status?: string;
}

interface MemberDetailModalProps {
  userId: number | null;
  onClose: () => void;
  /** Called after any mutation so the parent list can refresh. */
  onChanged: () => void;
}

function asArray<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)) {
    return (payload as { data: T[] }).data;
  }
  return [];
}

export function MemberDetailModal({ userId, onClose, onChanged }: MemberDetailModalProps) {
  const { t } = useTranslation('broker');
  const toast = useToast();

  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [loading, setLoading] = useState(false);
  // A failed load used to leave the skeleton up for ever; this drives the
  // honest error state with a Retry button instead.
  const [loadError, setLoadError] = useState(false);
  const [vetting, setVetting] = useState<VettingAttestation[]>([]);
  const [insurance, setInsurance] = useState<InsuranceCertificate[]>([]);
  const [consents, setConsents] = useState<ConsentRow[]>([]);

  // Notes load with the window so the tab can show its count.
  const notes = useMemberNotes(userId);

  const load = useCallback(async (id: number) => {
    setLoading(true);
    setLoadError(false);
    setDetail(null);
    setVetting([]);
    setInsurance([]);
    setConsents([]);
    try {
      const res = await adminUsers.get(id);
      if (res.success && res.data) {
        setDetail(res.data as MemberDetail);
      } else {
        setLoadError(true);
        toast.error(t('member_detail.load_failed'));
      }
    } catch {
      setLoadError(true);
      toast.error(t('member_detail.load_failed'));
    } finally {
      setLoading(false);
    }
    // Compliance data is best-effort — failures shouldn't block the modal.
    try {
      const [v, i, c] = await Promise.all([
        adminVetting.getUserRecords(id).catch(() => null),
        adminInsurance.getUserCertificates(id).catch(() => null),
        adminUsers.getConsents(id).catch(() => null),
      ]);
      if (v?.success) setVetting(asArray<VettingAttestation>(v.data));
      if (i?.success) setInsurance(asArray<InsuranceCertificate>(i.data));
      if (c?.success) setConsents(asArray<ConsentRow>(c.data));
    } catch { /* ignore */ }
  }, [toast, t]);

  useEffect(() => {
    if (userId != null) load(userId);
    // `load` is intentionally NOT a dependency: it closes over toast/t, which
    // are not guaranteed to be referentially stable, so keying the effect on
    // its identity would re-run on every render and loop. The member id is the
    // only thing that should trigger a (re)fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const reload = useCallback(async () => {
    if (detail) await load(detail.id);
  }, [detail, load]);

  const consentLabel = (c: ConsentRow) => c.consent_type || c.type || c.name || '';
  const consentGranted = (c: ConsentRow) => c.granted ?? c.is_granted ?? (c.status === 'granted' || c.status === 'active');

  return (
    <Modal isOpen={userId != null} onClose={onClose} size="2xl" scrollBehavior="inside">
      <ModalContent>
        {loading || (!detail && !loadError) ? (
          <ModalBody>
            <BrokerSkeleton variant="detail" className="py-2" />
          </ModalBody>
        ) : !detail ? (
          <>
            <ModalBody>
              <BrokerEmptyState
                bare
                icon={AlertCircle}
                color="danger"
                title={t('member_detail.load_error_title')}
                hint={t('member_detail.load_error_hint')}
                action={
                  <Button size="sm" variant="secondary" onPress={() => { if (userId != null) void load(userId); }}>
                    {t('member_detail.retry')}
                  </Button>
                }
              />
            </ModalBody>
            <ModalFooter>
              <Button variant="flat" onPress={onClose}>{t('member_detail.close')}</Button>
            </ModalFooter>
          </>
        ) : (
          <>
            <ModalHeader className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3">
              <Avatar
                src={resolveAvatarUrl(detail.avatar_url || detail.avatar) || undefined}
                name={detail.name}
                size="md"
                className="row-span-2"
              />
              <ModalHeading className="min-w-0 truncate text-base font-semibold tracking-tight">
                {detail.name}
              </ModalHeading>
              <div className="row-span-2 flex flex-wrap items-center gap-1">
                <BrokerStatusChip status={detail.status} />
                <Chip size="sm" variant="tertiary" color={detail.role === 'member' ? 'default' : 'accent'}>
                  {t(`members.role_${detail.role}`, { defaultValue: detail.role })}
                </Chip>
                <Chip size="sm" variant="tertiary" color={detail.email_verified_at ? 'success' : 'warning'}>
                  {detail.email_verified_at ? t('members.email_verified') : t('members.email_unverified')}
                </Chip>
              </div>
              <p className="col-start-2 min-w-0 truncate text-xs font-normal text-muted">{detail.email}</p>
            </ModalHeader>

            <ModalBody className="gap-3">
              <Tabs
                aria-label={t('member_detail.tabs_aria')}
                variant="underlined"
                size="sm"
                defaultSelectedKey="overview"
              >
                {/* ── Overview ──────────────────────────────────────────── */}
                <Tab key="overview" title={<TabTitle icon={IdCard} label={t('member_detail.tab_overview')} />}>
                  <div className="space-y-4 pt-3">
                    <StatusTimeline detail={detail} />

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Overview label={t('member_detail.label_balance')} value={`${typeof detail.balance === 'number' ? detail.balance.toLocaleString(getFormattingLocale()) : '0'} ${t('members.hours_short')}`} />
                      <Overview label={t('member_detail.label_joined')} value={formatServerDate(detail.created_at)} />
                      <Overview label={t('member_detail.label_last_active')} value={detail.last_active_at ? formatServerDate(detail.last_active_at) : t('members.time_never')} />
                      <Overview label={t('member_detail.label_onboarding')} value={detail.onboarding_completed ? t('member_detail.onboarding_complete') : t('member_detail.onboarding_incomplete')} />
                    </div>

                    {(detail.tagline || detail.bio || detail.location) && (
                      <p className="text-sm leading-6 text-muted">
                        {detail.tagline || detail.bio || detail.location}
                      </p>
                    )}
                  </div>
                </Tab>

                {/* ── Compliance ────────────────────────────────────────── */}
                <Tab key="compliance" title={<TabTitle icon={ShieldCheck} label={t('member_detail.tab_compliance')} />}>
                  <div className="space-y-4 pt-3">
                    <div className="grid grid-cols-2 gap-3">
                      <Overview
                        label={t('member_detail.label_contact_attestation')}
                        value={t(`vetting.filter_${vetting[0]?.decision ?? 'not_confirmed'}`)}
                      />
                      <Overview label={t('member_detail.label_insurance')} value={t(`member_detail.compliance_${detail.insurance_status ?? 'none'}`, { defaultValue: detail.insurance_status ?? '—' })} />
                    </div>

                    <ComplianceList
                      title={t('member_detail.contact_attestations_title')}
                      empty={t('member_detail.contact_attestations_none')}
                      items={vetting.map((v) => ({
                        key: `v-${v.id}`,
                        label: t(`vetting.attestation_${v.attestation_code}`, { defaultValue: t('vetting.attestation_other') }),
                        status: v.decision,
                        expiry: null,
                      }))}
                    />
                    <ComplianceList
                      title={t('member_detail.insurance_title')}
                      empty={t('member_detail.insurance_none')}
                      items={insurance.map((i) => ({
                        key: `i-${i.id}`,
                        label: t(`insurance.type_${i.insurance_type}`, { defaultValue: i.insurance_type }),
                        status: i.status,
                        expiry: i.expiry_date ?? null,
                      }))}
                    />
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">{t('member_detail.consents_title')}</p>
                      {consents.length === 0 ? (
                        <p className="text-sm text-muted">{t('member_detail.consents_none')}</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {consents.map((c, idx) => (
                            <Chip key={`c-${idx}`} size="sm" variant="tertiary" color={consentGranted(c) ? 'success' : 'default'}>
                              {consentLabel(c) || t('member_detail.consent_generic')}
                            </Chip>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </Tab>

                {/* ── Notes ─────────────────────────────────────────────── */}
                <Tab
                  key="notes"
                  title={
                    <TabTitle icon={StickyNote} label={t('members.notes')}>
                      {notes.notes.length > 0 && (
                        <Chip size="sm" variant="soft" color="accent" className="tabular-nums">
                          {notes.notes.length}
                        </Chip>
                      )}
                    </TabTitle>
                  }
                >
                  <MemberNotesPanel key={detail.id} state={notes} className="pt-3" />
                </Tab>

                {/* ── Records across the panel (each loads when opened) ──── */}
                <Tab key="exchanges" title={<TabTitle icon={ArrowRightLeft} label={t('member_detail.tab_exchanges')} />}>
                  <MemberExchangesTab userId={detail.id} />
                </Tab>
                <Tab key="messages" title={<TabTitle icon={MessageSquare} label={t('member_detail.tab_messages')} />}>
                  <MemberMessagesTab userId={detail.id} memberName={detail.name} />
                </Tab>
                <Tab key="monitoring" title={<TabTitle icon={Eye} label={t('member_detail.tab_monitoring')} />}>
                  <MemberMonitoringTab userId={detail.id} onChanged={onChanged} />
                </Tab>
                <Tab key="risk_tags" title={<TabTitle icon={Tag} label={t('member_detail.tab_risk_tags')} />}>
                  <MemberRiskTagsTab userId={detail.id} memberName={detail.name} />
                </Tab>
                <Tab key="support_needs" title={<TabTitle icon={LifeBuoy} label={t('member_detail.tab_support_needs')} />}>
                  <MemberSupportNeedsTab userId={detail.id} />
                </Tab>

                {/* ── Actions ───────────────────────────────────────────── */}
                <Tab key="actions" title={<TabTitle icon={Wrench} label={t('member_detail.section_actions')} />}>
                  <MemberActionsTab detail={detail} onChanged={onChanged} reload={reload} />
                </Tab>
              </Tabs>
            </ModalBody>

            <ModalFooter>
              <Button variant="flat" onPress={onClose}>{t('member_detail.close')}</Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

function TabTitle({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={14} aria-hidden="true" />
      <span>{label}</span>
      {children}
    </div>
  );
}

/**
 * Membership journey strip: registered → email verified → approved.
 * Built purely from fields the modal already loads — no extra requests.
 */
function StatusTimeline({ detail }: { detail: MemberDetail }) {
  const { t } = useTranslation('broker');
  const steps: { key: string; label: string; done: boolean; date: string | null }[] = [
    { key: 'registered', label: t('member_detail.timeline_registered'), done: true, date: detail.created_at ?? null },
    { key: 'email_verified', label: t('member_detail.timeline_email_verified'), done: !!detail.email_verified_at, date: detail.email_verified_at ?? null },
    // Suspended/banned members were approved at some point — only a literal
    // 'pending' status means the approval step hasn't happened yet.
    { key: 'approved', label: t('member_detail.timeline_approved'), done: detail.status !== 'pending', date: null },
  ];

  return (
    <ol
      aria-label={t('member_detail.timeline_title')}
      className="flex items-center rounded-xl bg-surface-secondary px-3 py-2.5"
    >
      {steps.map((step, i) => (
        <li key={step.key} className={`flex min-w-0 items-center ${i > 0 ? 'flex-1' : ''}`}>
          {i > 0 && (
            <span
              aria-hidden="true"
              className={`mx-2 h-px flex-1 ${step.done ? 'bg-success/50' : 'bg-divider'}`}
            />
          )}
          <span className="flex shrink-0 items-center gap-1.5">
            {step.done ? (
              <CheckCircle2 size={15} className="text-success" aria-hidden="true" />
            ) : (
              <Circle size={15} className="text-muted/60" aria-hidden="true" />
            )}
            <span className={`text-xs font-medium ${step.done ? 'text-foreground' : 'text-muted'}`}>
              {step.label}
            </span>
            {step.done && step.date && (
              <span className="hidden text-xs tabular-nums text-muted sm:inline">
                {formatServerDate(step.date)}
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Overview({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-secondary p-2.5">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 text-sm font-medium tabular-nums text-foreground">{value}</p>
    </div>
  );
}

interface ComplianceItem { key: string; label: string; status?: string; expiry: string | null }

function ComplianceList({ title, empty, items }: { title: string; empty: string; items: ComplianceItem[] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <div className="space-y-1">
          {items.map((it) => (
            <div key={it.key} className="flex items-center justify-between rounded-md bg-surface-secondary px-2.5 py-1.5 text-sm">
              <span className="truncate">{it.label}</span>
              <span className="flex items-center gap-2">
                {it.status && <BrokerStatusChip status={it.status} />}
                {/* An expiry is a day, not a moment — never render a time of day. */}
                {it.expiry && <span className="text-xs tabular-nums text-muted">{formatServerDate(it.expiry)}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default MemberDetailModal;
