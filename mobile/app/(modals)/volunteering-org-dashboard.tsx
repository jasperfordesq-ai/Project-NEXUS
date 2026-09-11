// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Card as HeroCard, Spinner, Surface } from 'heroui-native';
import { Chip } from '@/components/ui/StatusChip';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { useTranslation } from 'react-i18next';

import {
  depositOrganisationWallet,
  getOrganisation,
  getOrganisationApplications,
  getOrganisationPendingHours,
  getOrganisationStats,
  getOrganisationVolunteers,
  getOrganisationWalletTransactions,
  handleVolunteerApplication,
  updateOrganisation,
  verifyVolunteerHours,
  type OrganisationPendingHour,
  type OrganisationVolunteer,
  type OrganisationVolunteerApplication,
  type OrganisationWalletTransaction,
  type VolunteerOrganisationStats,
  type VolunteeringOrganisation,
} from '@/lib/api/volunteering';
import * as Haptics from '@/lib/haptics';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { dateLocale } from '@/lib/utils/dateLocale';
import { formatDecimal, parseDecimalInput } from '@/lib/utils/decimal';
import { reserveWalletOperation, completeWalletOperation } from '@/lib/walletOperation';
import { describeApiError } from '@/lib/api/describeApiError';
import { isRefusalStatus } from '@/lib/api/refusal';
import { useConfirm } from '@/components/ui/useConfirm';
import AccentIcon from '@/components/ui/AccentIcon';
import { useParamTab } from '@/lib/hooks/useParamTab';
import { withRouteGate } from '@/components/withRouteGate';
import RefreshFailedNotice from '@/components/ui/RefreshFailedNotice';
import { useAuth } from '@/lib/hooks/useAuth';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';

type OrgTab = 'overview' | 'applications' | 'hours' | 'volunteers' | 'wallet' | 'settings';
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const ORG_TABS: { key: OrgTab; icon: IoniconName }[] = [
  { key: 'overview', icon: 'grid-outline' },
  { key: 'applications', icon: 'clipboard-outline' },
  { key: 'hours', icon: 'time-outline' },
  { key: 'volunteers', icon: 'people-outline' },
  { key: 'wallet', icon: 'wallet-outline' },
  { key: 'settings', icon: 'settings-outline' },
];
const resolveOrgTab = (raw: string | undefined): OrgTab | null =>
  ORG_TABS.some((item) => item.key === raw) ? raw as OrgTab : null;

function parseId(value?: string | string[]) {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function normaliseItems<T>(payload: { data?: { items?: T[] } | T[]; meta?: unknown } | null | undefined): T[] {
  const data = payload?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function StatCard({ icon, label, value, tone }: { icon: IoniconName; label: string; value: string; tone: string }) {
  const theme = useTheme();
  return (
    <Surface variant="secondary" className="min-w-[46%] flex-1 gap-2 rounded-panel-inner p-4">
      <View className="size-10 items-center justify-center rounded-panel-inner" style={{ backgroundColor: withAlpha(tone, 0.14) }}>
        <Ionicons name={icon} size={20} color={tone} />
      </View>
      <Text className="text-2xl font-bold" style={{ color: theme.text }} numberOfLines={1}>
        {value}
      </Text>
      <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }} numberOfLines={2}>
        {label}
      </Text>
    </Surface>
  );
}

function StatusChip({ status }: { status: string }) {
  const { t } = useTranslation('volunteering');
  const theme = useTheme();
  const color = status === 'approved' || status === 'active'
    ? theme.success
    : status === 'declined' || status === 'rejected'
      ? theme.error
      : theme.warning;
  return (
    <Chip size="sm" variant="secondary" color="default">
      <Ionicons name="ellipse" size={9} color={color} />
      <Chip.Label>{t(`org.status.${status}`, { defaultValue: status })}</Chip.Label>
    </Chip>
  );
}

function OverviewPanel({
  stats,
  org,
  onTab,
}: {
  stats: VolunteerOrganisationStats | null;
  org: VolunteeringOrganisation | null;
  onTab: (tab: OrgTab) => void;
}) {
  const { t } = useTranslation('volunteering');
  const primary = usePrimaryColor();
  const theme = useTheme();

  if (!stats) {
    return <EmptyState icon="analytics-outline" title={t('org.statsUnavailable')} />;
  }

  return (
    <View className="gap-4">
      <HeroCard className="overflow-hidden rounded-panel p-0">
        <View className="h-1.5" style={{ backgroundColor: primary }} />
        <HeroCard.Body className="gap-4 p-5">
          <View className="flex-row items-start gap-3">
            <Avatar uri={org?.logo_url ?? org?.avatar ?? undefined} name={org?.name ?? stats.org_name} size={48} />
            <View className="min-w-0 flex-1">
              <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>
                {t('org.dashboardEyebrow')}
              </Text>
              <Text className="mt-1 text-xl font-bold" style={{ color: theme.text }} numberOfLines={2}>
                {org?.name ?? stats.org_name}
              </Text>
              {org?.description ? (
                <Text className="mt-2 text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={3}>
                  {org.description}
                </Text>
              ) : null}
            </View>
          </View>
          <View className="flex-row flex-wrap gap-3">
            <StatCard icon="people-outline" label={t('org.stats.volunteers')} value={String(stats.total_volunteers)} tone="#0ea5e9" />
            <StatCard icon="clipboard-outline" label={t('org.stats.pendingApplications')} value={String(stats.pending_applications)} tone="#f59e0b" />
            <StatCard icon="time-outline" label={t('org.stats.pendingHours')} value={String(stats.pending_hours)} tone="#8b5cf6" />
            <StatCard icon="wallet-outline" label={t('org.stats.walletBalance')} value={t('hoursValue', { count: stats.wallet_balance })} tone="#10b981" />
            <StatCard icon="checkmark-circle-outline" label={t('org.stats.approvedHours')} value={t('hoursValue', { count: stats.total_approved_hours })} tone="#e11d48" />
            <StatCard icon="briefcase-outline" label={t('org.stats.activeOpportunities')} value={String(stats.active_opportunities)} tone={primary} />
          </View>
          <View className="flex-row flex-wrap gap-2">
            {stats.pending_applications > 0 ? (
              <HeroButton size="sm" variant="secondary" onPress={() => onTab('applications')}>
                <Ionicons name="clipboard-outline" size={16} color={primary} />
                <HeroButton.Label>{t('org.reviewApplications')}</HeroButton.Label>
              </HeroButton>
            ) : null}
            {stats.pending_hours > 0 ? (
              <HeroButton size="sm" variant="secondary" onPress={() => onTab('hours')}>
                <Ionicons name="time-outline" size={16} color={primary} />
                <HeroButton.Label>{t('org.reviewHours')}</HeroButton.Label>
              </HeroButton>
            ) : null}
            <HeroButton size="sm" variant="secondary" onPress={() => router.push('/(modals)/new-volunteering' as Href)}>
              <Ionicons name="add-outline" size={16} color={primary} />
              <HeroButton.Label>{t('org.postOpportunity')}</HeroButton.Label>
            </HeroButton>
          </View>
        </HeroCard.Body>
      </HeroCard>
    </View>
  );
}

function ApplicationsPanel({ applications, loading, error, onRefresh }: { applications: OrganisationVolunteerApplication[]; loading: boolean; error: string | null; onRefresh: () => void }) {
  const { t } = useTranslation('volunteering');
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const [actioningId, setActioningId] = useState<number | null>(null);
  const [decisionNotes, setDecisionNotes] = useState<Record<number, string>>({});
  const decisionPending = useRef(false);
  const { tenant } = useTenant();
  const declineNoteRequired = tenant?.volunteering_config?.['volunteering.require_org_note_on_decline'] === true;

  async function act(id: number, action: 'approve' | 'decline') {
    if (decisionPending.current) return;
    if (action === 'decline' && declineNoteRequired && !decisionNotes[id]?.trim()) return;
    decisionPending.current = true;
    setActioningId(id);
    try {
      const note = decisionNotes[id]?.trim();
      if (note) await handleVolunteerApplication(id, action, note);
      else await handleVolunteerApplication(id, action);
      onRefresh();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('org.applications.actionError')), variant: 'danger' });
    } finally {
      decisionPending.current = false;
      setActioningId(null);
    }
  }

  if (loading && applications.length === 0) return <LoadingSpinner />;
  if (error && applications.length === 0) return <RefreshFailedNotice error={error} onRetry={onRefresh} isRetrying={loading} testID="org-applications-error" />;

  return (
    <View className="gap-3">
      <RefreshFailedNotice error={error} onRetry={onRefresh} isRetrying={loading} testID="org-applications-error" />
      {applications.length === 0 ? <EmptyState icon="clipboard-outline" title={t('org.applications.empty')} /> : null}
      {applications.map((application) => (
        <HeroCard key={application.id} className="rounded-panel p-0">
          <HeroCard.Body className="gap-3 p-4">
            <View className="flex-row items-start gap-3">
              <Avatar uri={application.user.avatar_url ?? undefined} name={application.user.name} size={42} />
              <View className="min-w-0 flex-1">
                <View className="flex-row items-start justify-between gap-2">
                  <View className="min-w-0 flex-1">
                    <Text className="text-base font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                      {application.user.name}
                    </Text>
                    <Text className="text-sm" style={{ color: theme.textSecondary }} numberOfLines={2}>
                      {application.opportunity.title}
                    </Text>
                  </View>
                  <StatusChip status={application.status} />
                </View>
                {application.message ? (
                  <Text className="mt-2 text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={3}>
                    {application.message}
                  </Text>
                ) : null}
                <Text className="mt-2 text-xs" style={{ color: theme.textMuted }}>
                  {t('org.applications.applied', { date: formatDate(application.created_at) ?? '' })}
                </Text>
              </View>
            </View>
            {application.status === 'pending' ? (
              <Input
                label={t('applications.decisionNoteLabel')}
                accessibilityLabel={t('applications.decisionNoteLabel')}
                placeholder={t('applications.decisionNotePlaceholder')}
                value={decisionNotes[application.id] ?? ''}
                onChangeText={(value) => setDecisionNotes((notes) => ({ ...notes, [application.id]: value }))}
                editable={actioningId === null}
                multiline
                maxLength={2000}
              />
            ) : null}
            {application.status === 'pending' && declineNoteRequired ? (
              <Text style={{ color: theme.textSecondary }}>{t('applications.decisionNoteRequired')}</Text>
            ) : null}
            {application.status === 'pending' ? (
              <View className="flex-row gap-2">
                <HeroButton className="flex-1" size="sm" variant="secondary" isDisabled={actioningId !== null} onPress={() => void act(application.id, 'approve')}>
                  {actioningId === application.id ? <Spinner size="sm" /> : <Ionicons name="checkmark-outline" size={16} color={primary} />}
                  <HeroButton.Label>{t('applications.approve')}</HeroButton.Label>
                </HeroButton>
                <HeroButton className="flex-1" size="sm" variant="danger-soft" isDisabled={actioningId !== null || (declineNoteRequired && !decisionNotes[application.id]?.trim())} onPress={() => void act(application.id, 'decline')}>
                  <HeroButton.Label>{t('applications.decline')}</HeroButton.Label>
                </HeroButton>
              </View>
            ) : null}
          </HeroCard.Body>
        </HeroCard>
      ))}
    </View>
  );
}

function HoursPanel({ entries, loading, error, onRefresh }: { entries: OrganisationPendingHour[]; loading: boolean; error: string | null; onRefresh: () => void }) {
  const { t } = useTranslation('volunteering');
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const [actioningId, setActioningId] = useState<number | null>(null);
  const decisionPending = useRef(false);

  async function act(id: number, action: 'approve' | 'decline') {
    if (decisionPending.current) return;
    decisionPending.current = true;
    setActioningId(id);
    try {
      await verifyVolunteerHours(id, action);
      onRefresh();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('org.hours.actionError')), variant: 'danger' });
    } finally {
      decisionPending.current = false;
      setActioningId(null);
    }
  }

  if (loading && entries.length === 0) return <LoadingSpinner />;
  if (error && entries.length === 0) return <RefreshFailedNotice error={error} onRetry={onRefresh} isRetrying={loading} testID="org-hours-error" />;

  return (
    <View className="gap-3">
      <RefreshFailedNotice error={error} onRetry={onRefresh} isRetrying={loading} testID="org-hours-error" />
      {entries.length === 0 ? <EmptyState icon="time-outline" title={t('org.hours.empty')} /> : null}
      {entries.map((entry) => (
        <HeroCard key={entry.id} className="rounded-panel p-0">
          <HeroCard.Body className="gap-3 p-4">
            <View className="flex-row items-start gap-3">
              <Avatar uri={entry.user.avatar_url ?? undefined} name={entry.user.name} size={42} />
              <View className="min-w-0 flex-1">
                <Text className="text-base font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                  {entry.user.name}
                </Text>
                <Text className="mt-1 text-xl font-bold" style={{ color: theme.text }}>
                  {t('hoursValue', { count: entry.hours })}
                </Text>
                <Text className="text-xs" style={{ color: theme.textMuted }}>
                  {formatDate(entry.date) ?? entry.date}
                </Text>
                {entry.opportunity ? (
                  <Text className="mt-1 text-sm" style={{ color: theme.textSecondary }} numberOfLines={1}>
                    {entry.opportunity.title}
                  </Text>
                ) : null}
                {entry.description ? (
                  <Text className="mt-2 text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={3}>
                    {entry.description}
                  </Text>
                ) : null}
              </View>
            </View>
            <View className="flex-row gap-2">
              <HeroButton className="flex-1" size="sm" variant="secondary" isDisabled={actioningId !== null} onPress={() => void act(entry.id, 'approve')}>
                {actioningId === entry.id ? <Spinner size="sm" /> : <Ionicons name="checkmark-outline" size={16} color={primary} />}
                <HeroButton.Label>{t('org.hours.approve')}</HeroButton.Label>
              </HeroButton>
              <HeroButton className="flex-1" size="sm" variant="danger-soft" isDisabled={actioningId !== null} onPress={() => void act(entry.id, 'decline')}>
                <HeroButton.Label>{t('org.hours.decline')}</HeroButton.Label>
              </HeroButton>
            </View>
          </HeroCard.Body>
        </HeroCard>
      ))}
    </View>
  );
}

function VolunteersPanel({ volunteers, loading, error, onRefresh }: { volunteers: OrganisationVolunteer[]; loading: boolean; error: string | null; onRefresh: () => void }) {
  const { t } = useTranslation('volunteering');
  const theme = useTheme();
  if (loading && volunteers.length === 0) return <LoadingSpinner />;
  if (error && volunteers.length === 0) return <RefreshFailedNotice error={error} onRetry={onRefresh} isRetrying={loading} testID="org-volunteers-error" />;
  return (
    <View className="gap-3">
      <RefreshFailedNotice error={error} onRetry={onRefresh} isRetrying={loading} testID="org-volunteers-error" />
      {volunteers.length === 0 ? <EmptyState icon="people-outline" title={t('org.volunteers.empty')} /> : null}
      {volunteers.map((volunteer) => (
        <HeroCard key={volunteer.id} className="rounded-panel p-0">
          <HeroCard.Body className="flex-row items-center gap-3 p-4">
            <Avatar uri={volunteer.avatar_url ?? undefined} name={volunteer.name} size={42} />
            <View className="min-w-0 flex-1">
              <Text className="text-base font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                {volunteer.name}
              </Text>
              <Text className="text-sm" style={{ color: theme.textSecondary }} numberOfLines={1}>
                {t('org.volunteers.summary', {
                  hours: volunteer.total_hours,
                  count: volunteer.applications_count,
                })}
              </Text>
            </View>
            <HeroButton
              isIconOnly
              variant="secondary"
              accessibilityLabel={t('org.volunteers.openProfile', { name: volunteer.name })}
              onPress={() => router.push({ pathname: '/(modals)/member-profile', params: { id: String(volunteer.id) } })}
            >
              <Ionicons name="person-outline" size={18} color={theme.textSecondary} />
            </HeroButton>
          </HeroCard.Body>
        </HeroCard>
      ))}
    </View>
  );
}

function WalletPanel({
  orgId,
  orgName,
  stats,
  transactions,
  loading,
  error,
  onRefresh,
}: {
  orgId: number;
  orgName: string;
  stats: VolunteerOrganisationStats | null;
  transactions: OrganisationWalletTransaction[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const { t } = useTranslation('volunteering');
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  /*
    🔴 One id per deposit the member confirms, NOT per button press.

    This endpoint has read an `Idempotency-Key` since it was written
    (`VolunteerController::walletDeposit`), and the app sent none. A deposit that timed out
    — the app's own mutation timeout, or a dropped mobile signal — left the admin with no
    way to know whether it had gone through, and tapping Deposit again took the credits a
    SECOND time out of their personal wallet. Found by the 2026-09-07 audit (E/F-1).

    The key is thrown away once the deposit is confirmed saved, and whenever the amount or
    note changes, because that is a different deposit and must go through on its own.
  */
  const depositInFlight = useRef(false);

  async function runDeposit(parsed: number, trimmedNote: string) {
    const intent = JSON.stringify([orgId, parsed, trimmedNote]);
    if (depositInFlight.current) return;
    depositInFlight.current = true;

    setSaving(true);
    try {
      const operation = await reserveWalletOperation('organisation-deposit', intent);
      await depositOrganisationWallet(
        orgId,
        parsed,
        trimmedNote || undefined,
        operation.key,
      );
      await completeWalletOperation(operation);
      setAmount('');
      setNote('');
      onRefresh();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({
        title: t('org.wallet.depositDoneTitle'),
        description: t('org.wallet.depositDoneMessage', {
          amount: formatDecimal(parsed, 1),
          organisation: orgName,
        }),
        variant: 'success',
      });
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('org.wallet.depositError')), variant: 'danger' });
    } finally {
      depositInFlight.current = false;
      setSaving(false);
    }
  }

  function deposit() {
    // The shared parser: a German or French keypad produces "1,5", which `Number()`
    // rejected outright, so the journey simply could not be completed (E/F-7).
    const parsed = parseDecimalInput(amount);
    if (parsed === null || !Number.isFinite(parsed) || parsed <= 0) {
      showToast({ title: t('common:errors.alertTitle'), description: t('org.wallet.validation'), variant: 'warning' });
      return;
    }
    const trimmedNote = note.trim();
    // 🔴 Credits leave the member's OWN wallet. One tap used to be enough (E/F-2).
    confirm({
      title: t('org.wallet.confirmTitle'),
      message: t('org.wallet.confirmMessage', { amount: formatDecimal(parsed, 1), organisation: orgName }),
      confirmLabel: t('org.wallet.deposit'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'primary',
      confirmTestID: 'org-wallet-confirm-deposit',
      onConfirm: () => runDeposit(parsed, trimmedNote),
    });
  }

  return (
    <View className="gap-4">
      <HeroCard className="rounded-panel p-0">
        <HeroCard.Body className="gap-4 p-4">
          <View className="flex-row items-center justify-between gap-3">
            <View>
              <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>
                {t('org.wallet.balance')}
              </Text>
              <Text className="text-3xl font-bold" style={{ color: theme.text }}>
                {t('hoursValue', { count: stats?.wallet_balance ?? 0 })}
              </Text>
            </View>
          </View>
          {/*
            🔴 The auto-pay toggle was REMOVED here on 2026-08-21, mirroring React.
            It called `PUT /v2/volunteering/organisations/{id}/wallet/auto-pay`, which
            Laravel does not register — measured as **HTTP 404**, so tapping it could only
            ever fail. It also had nothing to govern: `VolunteerService` always mints
            credits on approval (deliberately — gating it on the flag once meant approved
            logs "were committed 'approved' but never minted", losing credits for good),
            and nothing outside seed data reads `auto_pay_enabled` any more.

            React removed the control for exactly this reason, with a test
            (react-frontend/src/pages/volunteering/OrgWalletTab.test.tsx). This was the
            single accepted drift in `npm run api:check`, recorded as needing a choice
            between "mirror React and remove the toggle" or "add the endpoint" — this is
            that choice, taken the same way React took it.
          */}
          <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
            {t('org.wallet.autoPayAlways')}
          </Text>
          <Input
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={setAmount}
            placeholder={t('org.wallet.amountPlaceholder')}
            placeholderTextColor={theme.textMuted}
            leftIcon={<Ionicons name="add-circle-outline" size={18} color={theme.textMuted} />}
            editable={!saving}
          />
          <Input
            value={note}
            onChangeText={setNote}
            placeholder={t('org.wallet.notePlaceholder')}
            placeholderTextColor={theme.textMuted}
            leftIcon={<Ionicons name="document-text-outline" size={18} color={theme.textMuted} />}
            editable={!saving}
          />
          <HeroButton isDisabled={saving} onPress={deposit} testID="org-wallet-deposit">
            {saving ? <Spinner size="sm" /> : <AccentIcon name="wallet-outline" size={16} />}
            <HeroButton.Label>{t('org.wallet.deposit')}</HeroButton.Label>
          </HeroButton>
        </HeroCard.Body>
      </HeroCard>

      <Text className="text-base font-semibold" style={{ color: theme.text }}>
        {t('org.wallet.transactions')}
      </Text>
      <RefreshFailedNotice error={error} onRetry={onRefresh} isRetrying={loading} testID="org-wallet-error" />
      {loading && transactions.length === 0 ? <LoadingSpinner /> : null}
      {!loading && !error && transactions.length === 0 ? <EmptyState icon="receipt-outline" title={t('org.wallet.empty')} /> : null}
      {!loading && transactions.map((transaction) => (
        <HeroCard key={transaction.id} className="rounded-panel p-0">
          <HeroCard.Body className="flex-row items-center justify-between gap-3 p-4">
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                {transaction.note || t('org.wallet.transactionFallback')}
              </Text>
              <Text className="text-xs" style={{ color: theme.textMuted }}>
                {formatDate(transaction.created_at) ?? ''}
              </Text>
            </View>
            <Text className="text-base font-bold" style={{ color: Number(transaction.amount) >= 0 ? theme.success : theme.error }}>
              {t('hoursValue', { count: Number(transaction.amount) || 0 })}
            </Text>
          </HeroCard.Body>
        </HeroCard>
      ))}
      {confirmDialog}
    </View>
  );
}

type SettingsDraftState = { isDirty: boolean; isSaving: boolean };

function SettingsPanel({
  org,
  onRefresh,
  onDraftStateChange,
}: {
  org: VolunteeringOrganisation | null;
  onRefresh: () => void;
  onDraftStateChange: (state: SettingsDraftState) => void;
}) {
  const { t } = useTranslation('volunteering');
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const [name, setName] = useState(org?.name ?? '');
  const [description, setDescription] = useState(org?.description ?? '');
  const [contactEmail, setContactEmail] = useState(org?.contact_email ?? '');
  const [website, setWebsite] = useState(org?.website ?? '');
  const [saving, setSaving] = useState(false);
  const savePending = useRef(false);
  const mountedRef = useRef(true);
  const hydratedOrgIdRef = useRef<number | null>(null);
  const snapshot = JSON.stringify({ name, description, contactEmail, website });
  const [baseline, setBaseline] = useState(snapshot);
  const isDirty = snapshot !== baseline;

  useEffect(() => {
    if (!org || hydratedOrgIdRef.current === org.id) return;
    hydratedOrgIdRef.current = org.id;
    setName(org?.name ?? '');
    setDescription(org?.description ?? '');
    setContactEmail(org?.contact_email ?? '');
    setWebsite(org?.website ?? '');
    setBaseline(JSON.stringify({
      name: org?.name ?? '',
      description: org?.description ?? '',
      contactEmail: org?.contact_email ?? '',
      website: org?.website ?? '',
    }));
  }, [org]);

  useEffect(() => {
    onDraftStateChange({ isDirty, isSaving: saving });
  }, [isDirty, onDraftStateChange, saving]);

  useEffect(() => () => { mountedRef.current = false; }, []);

  async function save() {
    if (savePending.current) return;
    if (!org || !name.trim()) {
      showToast({ title: t('common:errors.alertTitle'), description: t('org.settings.validation'), variant: 'warning' });
      return;
    }
    savePending.current = true;
    setSaving(true);
    const submitted = {
      name: name.trim(),
      description: description.trim(),
      contactEmail: contactEmail.trim(),
      website: website.trim(),
    };
    try {
      await updateOrganisation(org.id, {
        name: submitted.name,
        description: submitted.description || null,
        contact_email: submitted.contactEmail || null,
        website: submitted.website || null,
      });
      if (mountedRef.current) {
        setName(submitted.name);
        setDescription(submitted.description);
        setContactEmail(submitted.contactEmail);
        setWebsite(submitted.website);
        setBaseline(JSON.stringify(submitted));
        onRefresh();
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      if (mountedRef.current) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('org.settings.saveError')), variant: 'danger' });
      }
    } finally {
      savePending.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }

  return (
    <HeroCard className="rounded-panel p-0">
      <HeroCard.Body className="gap-3 p-4">
        <Text className="text-base font-semibold" style={{ color: theme.text }}>
          {t('org.settings.heading')}
        </Text>
        <Input value={name} onChangeText={setName} placeholder={t('org.settings.namePlaceholder')} placeholderTextColor={theme.textMuted} editable={!saving} />
        <Input value={description} onChangeText={setDescription} placeholder={t('org.settings.descriptionPlaceholder')} placeholderTextColor={theme.textMuted} multiline editable={!saving} />
        <Input value={contactEmail} onChangeText={setContactEmail} placeholder={t('org.settings.emailPlaceholder')} placeholderTextColor={theme.textMuted} keyboardType="email-address" autoCapitalize="none" editable={!saving} />
        <Input value={website} onChangeText={setWebsite} placeholder={t('org.settings.websitePlaceholder')} placeholderTextColor={theme.textMuted} autoCapitalize="none" editable={!saving} />
        <HeroButton isDisabled={saving} onPress={() => void save()}>
          {saving ? <Spinner size="sm" /> : <AccentIcon name="save-outline" size={16} />}
          <HeroButton.Label>{t('org.settings.save')}</HeroButton.Label>
        </HeroButton>
      </HeroCard.Body>
    </HeroCard>
  );
}

function VolunteeringOrgDashboardInner() {
  const { t } = useTranslation(['volunteering', 'common']);
  const params = useLocalSearchParams<{ id?: string; tab?: string | string[] }>();
  const orgId = parseId(params.id);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const [tab, setTab] = useParamTab<OrgTab>(params.tab, resolveOrgTab, 'overview');
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraftState>({ isDirty: false, isSaving: false });
  const [settingsDraftVersion, setSettingsDraftVersion] = useState(0);
  const { confirm: confirmSettingsLeave, confirmDialog: settingsLeaveDialog } = useConfirm();
  const updateSettingsDraft = useCallback((state: SettingsDraftState) => setSettingsDraft(state), []);

  useUnsavedChangesGuard({
    isDirty: settingsDraft.isDirty,
    isSaving: settingsDraft.isSaving,
    confirm: confirmSettingsLeave,
    title: t('common:unsavedChanges.title'),
    message: t('common:unsavedChanges.message'),
    discardLabel: t('common:unsavedChanges.discard'),
    cancelLabel: t('common:buttons.cancel'),
  });

  const selectTab = useCallback((next: OrgTab) => {
    if (next === tab) return;
    const leaveSettings = () => {
      setSettingsDraft({ isDirty: false, isSaving: false });
      if (tab === 'settings') setSettingsDraftVersion((version) => version + 1);
      setTab(next);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    };
    if (tab === 'settings' && settingsDraft.isSaving) {
      confirmSettingsLeave({
        title: t('common:unsavedSaving.title'),
        message: t('common:unsavedSaving.message'),
        confirmLabel: t('common:unsavedSaving.leave'),
        cancelLabel: t('common:unsavedSaving.wait'),
        confirmTestID: 'org-settings-leave-saving-confirm',
        variant: 'danger',
        onConfirm: leaveSettings,
      });
      return;
    }
    if (tab === 'settings' && settingsDraft.isDirty) {
      confirmSettingsLeave({
        title: t('common:unsavedChanges.title'),
        message: t('common:unsavedChanges.message'),
        confirmLabel: t('common:unsavedChanges.discard'),
        cancelLabel: t('common:buttons.cancel'),
        confirmTestID: 'org-settings-discard-confirm',
        variant: 'danger',
        onConfirm: leaveSettings,
      });
      return;
    }
    leaveSettings();
  }, [confirmSettingsLeave, setTab, settingsDraft.isDirty, settingsDraft.isSaving, t, tab]);

  const orgApi = useApi(() => (orgId ? getOrganisation(orgId) : Promise.reject(new Error('invalid-org'))), [orgId], { enabled: Boolean(orgId) });
  const statsApi = useApi(() => (orgId ? getOrganisationStats(orgId) : Promise.reject(new Error('invalid-org'))), [orgId], { enabled: Boolean(orgId) });
  const applicationsApi = useApi(() => (orgId ? getOrganisationApplications(orgId) : Promise.reject(new Error('invalid-org'))), [orgId], { enabled: Boolean(orgId) });
  const hoursApi = useApi(() => (orgId ? getOrganisationPendingHours(orgId) : Promise.reject(new Error('invalid-org'))), [orgId], { enabled: Boolean(orgId) });
  const volunteersApi = useApi(() => (orgId ? getOrganisationVolunteers(orgId) : Promise.reject(new Error('invalid-org'))), [orgId], { enabled: Boolean(orgId) });
  const walletApi = useApi(() => (orgId ? getOrganisationWalletTransactions(orgId) : Promise.reject(new Error('invalid-org'))), [orgId], { enabled: Boolean(orgId) });

  const org = orgApi.data?.data ?? null;
  const stats = statsApi.data?.data ?? null;
  const applications = useMemo(() => normaliseItems<OrganisationVolunteerApplication>(applicationsApi.data), [applicationsApi.data]);
  const pendingHours = useMemo(() => normaliseItems<OrganisationPendingHour>(hoursApi.data), [hoursApi.data]);
  const volunteers = useMemo(() => normaliseItems<OrganisationVolunteer>(volunteersApi.data), [volunteersApi.data]);
  const transactions = useMemo(() => normaliseItems<OrganisationWalletTransaction>(walletApi.data), [walletApi.data]);

  function refreshAll() {
    orgApi.refresh();
    statsApi.refresh();
    applicationsApi.refresh();
    hoursApi.refresh();
    volunteersApi.refresh();
    walletApi.refresh();
  }

  if (!orgId) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('org.title')} backLabel={t('common:back')} fallbackHref="/(modals)/volunteering" />
        <EmptyState icon="business-outline" title={t('org.invalid')} />
      </SafeAreaView>
    );
  }

  /*
    🔴 "No pending applications" was not true — access had been refused.

    `getOrganisation` succeeds for anybody, because it is the public organisation record.
    The five organiser calls behind it all answer 403 to a member who does not manage the
    organisation (`VolunteerController::ensureOrgAccess`). The screen showed a generic
    "could not load" card with a Retry that could never succeed, AND below it every tab
    rendered a cheerful empty state — "No pending applications", "No hours to review",
    "No transactions" — each of which is a factual claim the app could not support.
    Found by the 2026-09-07 audit (E/F-8).
  */
  // One list of refusal statuses for the whole app — see lib/api/refusal.ts. This one
  // deliberately covers 404 as well: an organisation that is not the member's answers it.
  const accessRefused = isRefusalStatus(statsApi.errorStatus) || isRefusalStatus(applicationsApi.errorStatus);

  if (accessRefused) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={org?.name ?? t('org.title')} backLabel={t('common:back')} fallbackHref="/(modals)/volunteering" />
        <EmptyState
          icon="lock-closed-outline"
          title={t('org.notYoursTitle')}
          subtitle={t('org.notYoursHint')}
          actionLabel={t('org.backToVolunteering')}
          onAction={() => router.replace('/(modals)/volunteering')}
          testID="org-dashboard-refused"
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={org?.name ?? t('org.title')} backLabel={t('common:back')} fallbackHref="/(modals)/volunteering" />
      <ScrollView
        // iOS only: without it the keyboard covers the fields below. Android is already
        // covered by the manifest's windowSoftInputMode="adjustResize". Audit 2026-09-09.
        automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={orgApi.isLoading || statsApi.isLoading} onRefresh={refreshAll} tintColor={primary} colors={[primary]} />}
        contentContainerClassName="gap-4 px-4 pb-8"
      >
        <Surface variant="secondary" className="rounded-panel p-1">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1">
            {ORG_TABS.map((item) => {
              const selected = tab === item.key;
              return (
                <HeroButton
                  key={item.key}
                  size="sm"
                  variant={selected ? 'primary' : 'ghost'}
                  className="h-11 min-w-[126px] rounded-panel-inner"
                  style={{ backgroundColor: selected ? withAlpha(primary, 0.18) : 'transparent' }}
                  onPress={() => {
                    selectTab(item.key);
                  }}
                >
                  <Ionicons name={item.icon} size={16} color={selected ? primary : theme.textSecondary} />
                  <HeroButton.Label style={{ color: selected ? primary : theme.textSecondary }}>
                    {t(`org.tabs.${item.key}`)}
                  </HeroButton.Label>
                </HeroButton>
              );
            })}
          </ScrollView>
        </Surface>

        {orgApi.error || statsApi.error ? (
          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="items-center gap-3 p-6">
              <Ionicons name="warning-outline" size={28} color={theme.error} />
              <Text className="text-center text-sm" style={{ color: theme.textSecondary }}>
                {t('org.loadError')}
              </Text>
              <HeroButton variant="secondary" onPress={refreshAll}>
                <HeroButton.Label>{t('tryAgain')}</HeroButton.Label>
              </HeroButton>
            </HeroCard.Body>
          </HeroCard>
        ) : null}

        {orgApi.isLoading && !org ? <LoadingSpinner /> : null}
        {tab === 'overview' && !orgApi.isLoading ? <OverviewPanel stats={stats} org={org} onTab={selectTab} /> : null}
        {tab === 'applications' ? <ApplicationsPanel applications={applications} loading={applicationsApi.isLoading} error={applicationsApi.error} onRefresh={refreshAll} /> : null}
        {tab === 'hours' ? <HoursPanel entries={pendingHours} loading={hoursApi.isLoading} error={hoursApi.error} onRefresh={refreshAll} /> : null}
        {tab === 'volunteers' ? <VolunteersPanel volunteers={volunteers} loading={volunteersApi.isLoading} error={volunteersApi.error} onRefresh={refreshAll} /> : null}
        {tab === 'wallet' ? <WalletPanel orgId={orgId} orgName={org?.name ?? stats?.org_name ?? ''} stats={stats} transactions={transactions} loading={walletApi.isLoading} error={walletApi.error} onRefresh={refreshAll} /> : null}
        <View
          style={{ display: tab === 'settings' ? 'flex' : 'none' }}
          accessibilityElementsHidden={tab !== 'settings'}
          importantForAccessibility={tab === 'settings' ? 'auto' : 'no-hide-descendants'}
        >
          <SettingsPanel
            key={settingsDraftVersion}
            org={org}
            onRefresh={refreshAll}
            onDraftStateChange={updateSettingsDraft}
          />
        </View>
        {settingsLeaveDialog}
      </ScrollView>
    </SafeAreaView>
  );
}

function VolunteeringOrgDashboard() {
  const params = useLocalSearchParams<{ id?: string }>();
  const { user } = useAuth();
  const { tenant } = useTenant();
  return (
    <ModalErrorBoundary key={`${tenant?.id ?? tenant?.slug ?? 'no-tenant'}:${user?.id ?? 'no-user'}:${parseId(params.id) ?? 'invalid'}`}>
      <VolunteeringOrgDashboardInner />
    </ModalErrorBoundary>
  );
}

export default withRouteGate(VolunteeringOrgDashboard, 'volunteering-org-dashboard');
