// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The organisation dashboard's Fundraising tab, on a phone — the website's
 * OrgFundraisingTab.
 *
 * An organisation's owners and admins run fundraising campaigns for their own
 * organisation (owner decisions, 5 Oct 2026): campaigns go live straight away, gifts are
 * held by the community and passed on, and the organisation confirms each hand-over.
 * The organisation is never sent by this screen — the server takes it from the URL.
 *
 * Creating and editing a campaign happen on volunteering-org-campaign-form; this list
 * refreshes when it regains focus. Pause, resume and end are one-tap updates here
 * (end asks first, because members can no longer give once it is ended).
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Card as HeroCard, Spinner, Surface } from 'heroui-native';

import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { Chip } from '@/components/ui/StatusChip';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import RefreshFailedNotice from '@/components/ui/RefreshFailedNotice';
import { useConfirm } from '@/components/ui/useConfirm';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { withRouteGate } from '@/components/withRouteGate';
import {
  campaignStatus,
  confirmHandover,
  getCampaignGifts,
  getCampaignHandovers,
  getCampaignHistory,
  getOrganisationCampaigns,
  todayDateOnly,
  unwrapList,
  updateOrganisationCampaign,
  type CampaignGift,
  type CampaignHistoryItem,
  type Handover,
  type HandoverListData,
  type OrgCampaign,
  type OrgCampaignPayload,
} from '@/lib/api/volunteeringOrganiser';
import { describeApiError } from '@/lib/api/describeApiError';
import { isRefusalStatus } from '@/lib/api/refusal';
import * as Haptics from '@/lib/haptics';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { dateLocale } from '@/lib/utils/dateLocale';
import { formatMarketplaceCurrency } from '@/lib/utils/marketplaceCurrency';

function parseId(value?: string | string[]): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function formatDay(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function formatWhen(value: string): string {
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function campaignTitle(campaign: OrgCampaign): string {
  return campaign.title ?? campaign.name ?? '';
}

function SectionHeading({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }} accessibilityRole="header">
      {children}
    </Text>
  );
}

/** Gifts, hand-overs and history of one campaign, loaded when it is expanded. */
function CampaignDetails({ orgId, campaignId, onConfirmHandover, busyHandoverId }: {
  orgId: number;
  campaignId: number;
  onConfirmHandover: (handover: Handover, reload: () => void) => void;
  busyHandoverId: number | null;
}) {
  const { t } = useTranslation(['volunteeringOrganiser', 'common']);
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;

  const giftsApi = useApi(() => getCampaignGifts(orgId, campaignId), [orgId, campaignId]);
  const handoversApi = useApi(() => getCampaignHandovers(orgId, campaignId), [orgId, campaignId]);
  const historyApi = useApi(() => getCampaignHistory(orgId, campaignId), [orgId, campaignId]);

  const reload = useCallback(() => {
    giftsApi.refresh();
    handoversApi.refresh();
    historyApi.refresh();
  }, [giftsApi, handoversApi, historyApi]);

  const gifts = useMemo(() => unwrapList<CampaignGift>(giftsApi.data?.data, 'items'), [giftsApi.data]);
  const history = useMemo(() => unwrapList<CampaignHistoryItem>(historyApi.data?.data, 'items'), [historyApi.data]);
  const handovers: HandoverListData | null = handoversApi.data?.data ?? null;

  const loading = (giftsApi.isLoading && !giftsApi.data) || (handoversApi.isLoading && !handoversApi.data) || (historyApi.isLoading && !historyApi.data);
  const failed = Boolean(giftsApi.error && !giftsApi.data) || Boolean(handoversApi.error && !handoversApi.data) || Boolean(historyApi.error && !historyApi.data);

  if (loading) return <LoadingSpinner />;
  if (failed) {
    return (
      <EmptyState icon="cloud-offline-outline" title={t('fundraising.detailsError')} actionLabel={t('common:buttons.retry')} onAction={reload} testID={`campaign-${campaignId}-details-error`} />
    );
  }

  const value = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? t('fundraising.emptyValue') : String(v));

  return (
    <View className="gap-4" testID={`campaign-${campaignId}-details`}>
      <View className="gap-2">
        <SectionHeading>{t('fundraising.gifts')}</SectionHeading>
        {gifts.length === 0 ? (
          <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('fundraising.noGifts')}</Text>
        ) : gifts.map((gift) => (
          <View key={gift.id} className={`${largeText ? 'gap-1' : 'flex-row items-center justify-between gap-2'} py-1`} testID={`campaign-gift-${gift.id}`}>
            <Text className="min-w-0 flex-1 text-sm font-semibold" style={{ color: theme.text }}>{gift.display_name ?? t('fundraising.anonymous')}</Text>
            <View className={`${largeText ? '' : 'items-end'}`}>
              <Text className="text-sm font-bold" style={{ color: theme.text }}>{formatMarketplaceCurrency(gift.amount, gift.currency)}</Text>
              <Text className="text-xs" style={{ color: theme.textMuted }}>
                {`${formatDay(gift.created_at)} · ${t(`fundraising.method.${gift.payment_method}`, { defaultValue: gift.payment_method })} · ${t(`fundraising.giftStatus.${gift.status}`, { defaultValue: gift.status })}`}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {handovers ? (
        <View className="gap-2">
          <SectionHeading>{t('fundraising.handovers')}</SectionHeading>
          <View testID={`campaign-${campaignId}-handover-summary`} className={`gap-2 ${largeText ? '' : 'flex-row'}`}>
            {[
              { label: t('fundraising.raised'), amount: handovers.summary.raised },
              { label: t('fundraising.handedOver'), amount: handovers.summary.handed_over },
              { label: t('fundraising.stillHeld'), amount: handovers.summary.still_held },
            ].map((figure) => (
              <Surface key={figure.label} variant="secondary" className={`${largeText ? 'w-full' : 'flex-1'} gap-0.5 rounded-panel-inner p-3`}>
                <Text className="text-xs" style={{ color: theme.textSecondary }}>{figure.label}</Text>
                <Text className="text-base font-bold" style={{ color: theme.text }}>{formatMarketplaceCurrency(figure.amount, handovers.summary.currency)}</Text>
              </Surface>
            ))}
          </View>
          {handovers.items.length === 0 ? (
            <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('fundraising.noHandovers')}</Text>
          ) : handovers.items.map((handover) => {
            const open = handover.status === 'recorded';
            const amount = formatMarketplaceCurrency(handover.amount, handover.currency);
            const colour = handover.status === 'confirmed' ? theme.success : handover.status === 'cancelled' ? theme.textMuted : theme.warning;
            return (
              <View key={handover.id} className="gap-1 py-2" testID={`campaign-handover-${handover.id}`}>
                <View className="flex-row flex-wrap items-center gap-2">
                  <Text className="text-base font-semibold" style={{ color: theme.text }}>{amount}</Text>
                  <Chip size="sm" variant="secondary" color="default">
                    <Ionicons name="ellipse" size={9} color={colour} />
                    <Chip.Label>{t(`fundraising.handoverStatus.${handover.status}`)}</Chip.Label>
                  </Chip>
                </View>
                <Text className="text-sm" style={{ color: theme.textSecondary }}>
                  {[formatDay(handover.handed_over_on), t(`fundraising.handoverMethod.${handover.method}`, { defaultValue: handover.method }), handover.reference].filter(Boolean).join(' · ')}
                </Text>
                {handover.note ? <Text className="text-sm" style={{ color: theme.text }}>{handover.note}</Text> : null}
                {handover.recorded_by_name ? <Text className="text-xs" style={{ color: theme.textMuted }}>{t('fundraising.recordedBy', { name: handover.recorded_by_name })}</Text> : null}
                {handover.confirmed_by_name ? <Text className="text-xs" style={{ color: theme.textMuted }}>{t('fundraising.confirmedBy', { name: handover.confirmed_by_name })}</Text> : null}
                {handover.cancelled_by_name ? <Text className="text-xs" style={{ color: theme.textMuted }}>{t('fundraising.cancelledBy', { name: handover.cancelled_by_name })}</Text> : null}
                {handover.cancel_reason ? <Text className="text-sm" style={{ color: theme.text }}>{t('fundraising.reason', { reason: handover.cancel_reason })}</Text> : null}
                {open ? (
                  <HeroButton
                    size="sm"
                    className="mt-1 self-start"
                    isDisabled={busyHandoverId !== null}
                    accessibilityLabel={t('fundraising.confirmReceivedLabel', { amount })}
                    onPress={() => onConfirmHandover(handover, reload)}
                    testID={`campaign-handover-${handover.id}-confirm`}
                  >
                    {busyHandoverId === handover.id ? <Spinner size="sm" /> : <Ionicons name="checkmark-outline" size={16} color={theme.bg} />}
                    <HeroButton.Label>{t('fundraising.confirmReceived')}</HeroButton.Label>
                  </HeroButton>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      <View className="gap-2">
        <SectionHeading>{t('fundraising.history')}</SectionHeading>
        {history.length === 0 ? (
          <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('fundraising.noHistory')}</Text>
        ) : history.map((item) => {
          const who = item.actor_name ? t('fundraising.by', { name: item.actor_name }) : t(`fundraising.actor.${item.actor_kind}`, { defaultValue: item.actor_kind });
          const changes = Object.entries(item.details?.changes ?? {});
          return (
            <View key={item.id} className="gap-0.5 py-1" testID={`campaign-history-${item.id}`}>
              <View className={`${largeText ? '' : 'flex-row items-baseline justify-between gap-2'}`}>
                <Text className="text-sm font-semibold" style={{ color: theme.text }}>{t(`fundraising.event.${item.event}`, { defaultValue: item.event })}</Text>
                <Text className="text-xs" style={{ color: theme.textMuted }}>{formatWhen(item.created_at)}</Text>
              </View>
              <Text className="text-xs" style={{ color: theme.textSecondary }}>
                {[
                  item.amount !== null && item.currency ? formatMarketplaceCurrency(item.amount, item.currency) : null,
                  item.donation_id !== null ? t('fundraising.giftNumber', { number: item.donation_id }) : null,
                  who,
                ].filter(Boolean).join(' · ')}
              </Text>
              {changes.map(([field, change]) => (
                <Text key={field} className="text-xs" style={{ color: theme.text }}>
                  {t('fundraising.change', {
                    field: t(`fundraising.field.${field}`, { defaultValue: field }),
                    from: value(change.from_label ?? change.from),
                    to: value(change.to_label ?? change.to),
                  })}
                </Text>
              ))}
              {item.details?.reason ? <Text className="text-xs" style={{ color: theme.text }}>{t('fundraising.reason', { reason: item.details.reason })}</Text> : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function OrgFundraisingScreen() {
  const { t } = useTranslation(['volunteeringOrganiser', 'common']);
  const params = useLocalSearchParams<{ id?: string }>();
  const orgId = parseId(params.id);
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { tenant } = useTenant();
  const currency = (tenant?.currency || 'EUR').toUpperCase();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [busyHandoverId, setBusyHandoverId] = useState<number | null>(null);
  const actionPending = useRef(false);
  const hasFocusedOnceRef = useRef(false);

  const campaignsApi = useApi(() => (orgId ? getOrganisationCampaigns(orgId) : Promise.reject(new Error('invalid-org'))), [orgId], { enabled: Boolean(orgId) });
  const campaigns = useMemo(() => unwrapList<OrgCampaign>(campaignsApi.data?.data, 'items'), [campaignsApi.data]);
  const refresh = useCallback(() => campaignsApi.refresh(), [campaignsApi]);

  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedOnceRef.current) {
        hasFocusedOnceRef.current = true;
        return;
      }
      refresh();
    }, [refresh]),
  );

  async function update(campaign: OrgCampaign, changes: OrgCampaignPayload) {
    if (actionPending.current || !orgId) return;
    actionPending.current = true;
    setBusyId(campaign.id);
    try {
      await updateOrganisationCampaign(orgId, campaign.id, changes);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ title: t('fundraising.saved'), variant: 'success' });
      refresh();
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('fundraising.updateFailed')), variant: 'danger' });
    } finally {
      actionPending.current = false;
      setBusyId(null);
    }
  }

  function askEnd(campaign: OrgCampaign) {
    confirm({
      title: t('fundraising.endTitle'),
      message: t('fundraising.endMessage'),
      confirmLabel: t('fundraising.end'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      confirmTestID: 'campaign-end-confirm',
      onConfirm: () => update(campaign, { is_active: false, end_date: todayDateOnly() }),
    });
  }

  function askConfirmHandover(handover: Handover, reload: () => void) {
    if (!orgId) return;
    const amount = formatMarketplaceCurrency(handover.amount, handover.currency);
    confirm({
      title: t('fundraising.confirmReceivedTitle'),
      message: t('fundraising.confirmReceivedMessage', { amount }),
      confirmLabel: t('fundraising.confirmReceived'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'primary',
      confirmTestID: 'campaign-handover-confirm',
      onConfirm: async () => {
        if (actionPending.current) return;
        actionPending.current = true;
        setBusyHandoverId(handover.id);
        try {
          await confirmHandover(orgId, handover.id);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          showToast({ title: t('fundraising.handoverConfirmed'), variant: 'success' });
          reload();
          refresh();
        } catch (err) {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('fundraising.handoverFailed')), variant: 'danger' });
        } finally {
          actionPending.current = false;
          setBusyHandoverId(null);
        }
      },
    });
  }

  function openForm(campaignId?: number) {
    if (!orgId) return;
    router.push({
      pathname: '/(modals)/volunteering-org-campaign-form',
      params: { id: String(orgId), ...(campaignId ? { campaignId: String(campaignId) } : {}) },
    } as Href);
  }

  if (!orgId) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('fundraising.title')} backLabel={t('common:back')} fallbackHref="/(modals)/volunteering" />
        <EmptyState icon="gift-outline" title={t('common:errors.notFound')} />
      </SafeAreaView>
    );
  }

  if (isRefusalStatus(campaignsApi.errorStatus)) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('fundraising.title')} backLabel={t('common:back')} fallbackHref="/(modals)/volunteering" />
        <EmptyState icon="lock-closed-outline" title={t('fundraising.notYoursTitle')} subtitle={t('fundraising.notYoursHint')} testID="org-fundraising-refused" />
      </SafeAreaView>
    );
  }

  const loaded = campaignsApi.data !== null;

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('fundraising.title')} backLabel={t('common:back')} fallbackHref="/(modals)/volunteering" />
      <ScrollView
        refreshControl={<RefreshControl refreshing={campaignsApi.isLoading && loaded} onRefresh={refresh} tintColor={primary} colors={[primary]} />}
        contentContainerClassName="gap-4 px-4 pb-8"
      >
        <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('fundraising.intro')}</Text>
        <HeroButton onPress={() => openForm()} testID="org-fundraising-new">
          <Ionicons name="add-outline" size={16} color={theme.bg} />
          <HeroButton.Label>{t('fundraising.newCampaign')}</HeroButton.Label>
        </HeroButton>

        {campaignsApi.isLoading && !loaded ? <LoadingSpinner /> : null}
        {campaignsApi.error && !loaded ? (
          <EmptyState icon="cloud-offline-outline" title={t('fundraising.loadError')} actionLabel={t('common:buttons.retry')} onAction={refresh} testID="org-fundraising-error" />
        ) : null}
        {loaded ? <RefreshFailedNotice error={campaignsApi.error} onRetry={refresh} isRetrying={campaignsApi.isLoading} testID="org-fundraising-refresh-failed" /> : null}
        {loaded && !campaignsApi.error && campaigns.length === 0 ? (
          <EmptyState icon="gift-outline" title={t('fundraising.empty')} testID="org-fundraising-empty" />
        ) : null}

        {campaigns.map((campaign) => {
          const status = campaignStatus(campaign);
          const goal = Number(campaign.goal_amount ?? campaign.target_amount ?? 0);
          const raised = Number(campaign.raised_amount ?? 0);
          const expanded = expandedId === campaign.id;
          const live = status === 'active' || status === 'upcoming';
          const title = campaignTitle(campaign);
          const busy = busyId === campaign.id;
          const colour = status === 'active' ? theme.success : status === 'upcoming' ? primary : status === 'paused' ? theme.warning : theme.textMuted;
          return (
            <HeroCard key={campaign.id} className="rounded-panel p-0" testID={`campaign-${campaign.id}`}>
              <HeroCard.Body className="gap-3 p-4">
                <View className="gap-1">
                  <View className="flex-row flex-wrap items-center gap-2">
                    <Text className="text-base font-semibold" style={{ color: theme.text }}>{title}</Text>
                    <Chip size="sm" variant="secondary" color="default">
                      <Ionicons name="ellipse" size={9} color={colour} />
                      <Chip.Label>{t(`fundraising.status.${status}`)}</Chip.Label>
                    </Chip>
                  </View>
                  <Text className="text-sm" style={{ color: theme.text }}>
                    {t('fundraising.raisedOfGoal', { raised: formatMarketplaceCurrency(raised, currency), goal: formatMarketplaceCurrency(goal, currency) })}
                  </Text>
                  <Text className="text-xs" style={{ color: theme.textMuted }}>
                    {t('fundraising.dateRange', { start: formatDay(campaign.start_date), end: formatDay(campaign.end_date) })}
                  </Text>
                </View>
                <View testID={`campaign-${campaign.id}-actions`} className={`gap-2 ${largeText ? '' : 'flex-row flex-wrap'}`}>
                  <HeroButton size="sm" variant="secondary" isDisabled={busy} accessibilityLabel={t('fundraising.editCampaignLabel', { title })} onPress={() => openForm(campaign.id)} testID={`campaign-${campaign.id}-edit`}>
                    <Ionicons name="create-outline" size={16} color={primary} />
                    <HeroButton.Label>{t('fundraising.editCampaign')}</HeroButton.Label>
                  </HeroButton>
                  {live ? (
                    <HeroButton size="sm" variant="secondary" isDisabled={busy} accessibilityLabel={t('fundraising.pauseLabel', { title })} onPress={() => void update(campaign, { is_active: false })} testID={`campaign-${campaign.id}-pause`}>
                      {busy ? <Spinner size="sm" /> : <Ionicons name="pause-outline" size={16} color={primary} />}
                      <HeroButton.Label>{t('fundraising.pause')}</HeroButton.Label>
                    </HeroButton>
                  ) : null}
                  {status === 'paused' ? (
                    <HeroButton size="sm" variant="secondary" isDisabled={busy} accessibilityLabel={t('fundraising.resumeLabel', { title })} onPress={() => void update(campaign, { is_active: true })} testID={`campaign-${campaign.id}-resume`}>
                      {busy ? <Spinner size="sm" /> : <Ionicons name="play-outline" size={16} color={primary} />}
                      <HeroButton.Label>{t('fundraising.resume')}</HeroButton.Label>
                    </HeroButton>
                  ) : null}
                  {status !== 'ended' ? (
                    <HeroButton size="sm" variant="danger-soft" isDisabled={busy} accessibilityLabel={t('fundraising.endLabel', { title })} onPress={() => askEnd(campaign)} testID={`campaign-${campaign.id}-end`}>
                      <HeroButton.Label>{t('fundraising.end')}</HeroButton.Label>
                    </HeroButton>
                  ) : null}
                </View>
                <HeroButton
                  size="sm"
                  variant="ghost"
                  className="self-start"
                  accessibilityState={{ expanded }}
                  onPress={() => setExpandedId(expanded ? null : campaign.id)}
                  testID={`campaign-${campaign.id}-toggle-details`}
                >
                  <Ionicons name={expanded ? 'chevron-up-outline' : 'chevron-down-outline'} size={16} color={theme.textSecondary} />
                  <HeroButton.Label style={{ color: theme.textSecondary }}>{expanded ? t('fundraising.hideDetails') : t('fundraising.showDetails')}</HeroButton.Label>
                </HeroButton>
                {expanded ? (
                  <CampaignDetails orgId={orgId} campaignId={campaign.id} onConfirmHandover={askConfirmHandover} busyHandoverId={busyHandoverId} />
                ) : null}
              </HeroCard.Body>
            </HeroCard>
          );
        })}
      </ScrollView>
      {confirmDialog}
    </SafeAreaView>
  );
}

function OrgFundraisingRoute() {
  return (
    <ModalErrorBoundary>
      <OrgFundraisingScreen />
    </ModalErrorBoundary>
  );
}

export default withRouteGate(OrgFundraisingRoute, 'volunteering-org-fundraising');
