// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * One exchange, and the actions the signed-in member can take on it.
 *
 * 🔴 NEW on 2026-08-21. This screen is the missing half of the timebanking exchange on
 * mobile. The app could create a request (`POST /v2/exchanges`) and nothing else: the
 * provider had no way to accept, neither side could start, complete, confirm hours or
 * cancel, and the notification telling the provider a request had arrived linked to the
 * LISTING screen with the exchange's id, which showed "Listing not found".
 *
 * The credit transfer happens on the SECOND confirmation, server-side, inside a database
 * transaction. Two refusals are therefore ordinary rather than exceptional and are shown
 * with the server's own wording: not enough credits (422), and the other party having left
 * the community mid-exchange (409). Neither moves any credits.
 */

import { useConfirm } from '@/components/ui/useConfirm';
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Button as HeroButton, Chip, Surface } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import {
  acceptExchangeRequest,
  cancelExchangeRequest,
  completeExchangeRequest,
  confirmExchangeRequest,
  declineExchangeRequest,
  disputeExchangeRequest,
  DISPUTE_REASONS,
  exchangeRequestActions,
  getExchangeRequest,
  startExchangeRequest,
  type DisputeReason,
  type ExchangeRequest,
  type ExchangeRequestStatus,
} from '@/lib/api/exchangeRequests';
import { describeApiError } from '@/lib/api/describeApiError';
import { useApi } from '@/lib/hooks/useApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTheme } from '@/lib/hooks/useTheme';
import * as Haptics from '@/lib/haptics';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import BottomSheet from '@/components/ui/BottomSheet';
import TextArea from '@/components/ui/TextArea';
import ErrorState from '@/components/ui/ErrorState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { dateLocale } from '@/lib/utils/dateLocale';

import { parseDecimalInput } from '@/lib/utils/decimal';
function formatDateTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(dateLocale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function ExchangeRequestDetailScreen() {
  const { t } = useTranslation('exchanges');
  const theme = useTheme();
  const { user } = useAuth();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Number(params.id);

  const { data, isLoading, error, refresh } = useApi(
    () => getExchangeRequest(id),
    [id],
    { enabled: Number.isFinite(id) && id > 0 },
  );


  // 🔴 Re-read whenever the screen comes back into focus.
  //
  // An exchange is a TWO-PARTY record: the other member accepts, starts or confirms on
  // their own phone, and this screen would otherwise keep showing whatever it fetched when
  // it first opened. Measured on 2026-08-21: after the requester confirmed on the second
  // emulator, the provider's already-open screen still read "Awaiting confirmation" and
  // "Not confirmed yet" while the API and database both said completed. Deep-linking to the
  // same id does not remount the screen, so `useApi`'s dependency array never changes and
  // nothing refetches.
  //
  // No other screen in this app does this — there was no `useFocusEffect` anywhere before
  // these two. That is a known gap recorded in the mobile status document, not something
  // this change sweeps across 60 screens.
  useFocusEffect(
    useCallback(() => {
      refresh();
      // `refresh` is stable per useApi instance; listing it would re-run on every render.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const exchange = (data?.data ?? null) as ExchangeRequest | null;
  const viewerId = user?.id ?? null;

  const actions = useMemo(
    () =>
      exchange
        ? exchangeRequestActions(exchange, viewerId)
        : {
            canAccept: false,
            canDecline: false,
            canStart: false,
            canComplete: false,
            canConfirm: false,
            canCancel: false,
            awaitingOtherConfirmation: false,
            canReportProblem: false,
          },
    [exchange, viewerId],
  );

  const [busy, setBusy] = useState<string | null>(null);
  const [confirmSheetOpen, setConfirmSheetOpen] = useState(false);
  // Journey 3.20 — reporting a problem. No reason is pre-selected: a pre-ticked answer in
  // a report is a guess put in the member's mouth, and a broker reads these.
  const [reportSheetOpen, setReportSheetOpen] = useState(false);
  const [reportReason, setReportReason] = useState<DisputeReason | null>(null);
  const [reportDetails, setReportDetails] = useState('');
  // Pre-filled with the hours already agreed, because that is the answer in most cases and
  // an empty field invites a typo into the one step that moves credits.
  const [hoursInput, setHoursInput] = useState('');

  const run = useCallback(
    async (key: string, fn: () => Promise<unknown>, successMessage: string): Promise<boolean> => {
      setBusy(key);
      try {
        await fn();
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast({ title: successMessage, variant: 'success' });
        refresh();
        return true;
      } catch (err) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        showToast({
          variant: 'danger',
          title: t('requests.actionFailedTitle'),
          // The server's own sentence when it is fit to show — "not enough credits" is
          // worth far more to a member than "something went wrong".
          description: describeApiError(err, t('requests.actionFailedFallback')),
        });
        // 🔴 Resolving here used to look exactly like success to the caller, whose
        // `.then(() => router.back())` then popped the member back to the list with the
        // exchange still open (audit 2026-09-05, S2-01).
        return false;
      } finally {
        setBusy(null);
      }
    },
    [refresh, showToast, t],
  );

  const submitReport = useCallback(async () => {
    if (!exchange || !reportReason) return;
    /*
      The sheet closes FIRST, then the request runs. The other way round leaves a sheet
      sitting over the screen while a slow request finishes, and this app has already been
      bitten by a sheet outliving the screen underneath it.
    */
    setReportSheetOpen(false);
    await run(
      'report',
      () => disputeExchangeRequest(exchange.id, reportReason, reportDetails),
      // Matches the server's own message, which is translated for this member's language.
      t('requests.dispute.sent'),
    );
  }, [exchange, reportReason, reportDetails, run, t]);

  const openConfirmSheet = useCallback(() => {
    if (!exchange) return;
    const suggested = exchange.final_hours ?? exchange.proposed_hours;
    setHoursInput(suggested ? String(suggested) : '');
    setConfirmSheetOpen(true);
  }, [exchange]);

  const submitConfirmation = useCallback(async () => {
    if (!exchange) return;
    const hours = parseDecimalInput(hoursInput) ?? Number.NaN;
    if (!Number.isFinite(hours) || hours <= 0) {
      showToast({
        variant: 'danger',
        title: t('requests.hoursInvalidTitle'),
        description: t('requests.hoursInvalidBody'),
      });
      return;
    }
    setConfirmSheetOpen(false);
    await run(
      'confirm',
      () => confirmExchangeRequest(exchange.id, hours),
      t('requests.confirmedToast'),
    );
  }, [exchange, hoursInput, run, showToast, t]);

  /**
   * 🔴 There was no way to contact the other person about an exchange.
   *
   * Walked on a device 2026-08-22 (journey 3.9): this screen showed the status, the hours,
   * the confirmations and the history, and offered no route to the person on the other side
   * of it. Someone who needed to say "I'll be twenty minutes late" had to leave, find the
   * member, and start a conversation from scratch.
   *
   * Matches the website (`react-frontend/src/pages/exchanges/ExchangeDetailPage.tsx`), which
   * shows this only while the exchange is live — once it is completed, cancelled or expired
   * there is nothing to arrange, and an ordinary message is the right route instead.
   */
  const OPEN_STATUSES: ReadonlySet<ExchangeRequestStatus> = new Set([
    'pending_provider',
    'pending_broker',
    'accepted',
    'in_progress',
    'pending_confirmation',
    'disputed',
  ]);

  const renderMessageOtherParty = () => {
    if (!exchange || !viewerId) return null;
    if (!OPEN_STATUSES.has(exchange.status)) return null;

    const otherParty = exchange.requester?.id === viewerId ? exchange.provider : exchange.requester;
    if (!otherParty?.id || otherParty.id === viewerId) return null;

    return (
      <View className="mt-3">
        <HeroButton
          variant="secondary"
          onPress={() =>
            router.push({
              pathname: '/(modals)/thread',
              params: { recipientId: String(otherParty.id) },
            } as never)
          }
          accessibilityLabel={t('requests.messageOtherParty', {
            name: otherParty.name ?? t('requests.withMemberUnknown'),
          })}
        >
          <HeroButton.Label>
            {t('requests.messageOtherParty', {
              name: otherParty.name ?? t('requests.withMemberUnknown'),
            })}
          </HeroButton.Label>
        </HeroButton>
      </View>
    );
  };

  const renderActions = () => {
    if (!exchange) return null;

    const buttons: {
      key: string;
      label: string;
      onPress: () => void;
      variant?: 'primary' | 'secondary' | 'tertiary';
    }[] = [];

    if (actions.canAccept) {
      buttons.push({
        key: 'accept',
        label: t('requests.actions.accept'),
        onPress: () =>
          void run('accept', () => acceptExchangeRequest(exchange.id), t('requests.acceptedToast')),
      });
    }
    if (actions.canStart) {
      buttons.push({
        key: 'start',
        label: t('requests.actions.start'),
        onPress: () =>
          void run('start', () => startExchangeRequest(exchange.id), t('requests.startedToast')),
      });
    }
    if (actions.canComplete) {
      buttons.push({
        key: 'complete',
        label: t('requests.actions.complete'),
        onPress: () =>
          void run(
            'complete',
            () => completeExchangeRequest(exchange.id),
            t('requests.completedToast'),
          ),
      });
    }
    if (actions.canConfirm) {
      buttons.push({
        key: 'confirm',
        label: t('requests.actions.confirm'),
        onPress: openConfirmSheet,
      });
    }
    if (actions.canDecline) {
      buttons.push({
        key: 'decline',
        label: t('requests.actions.decline'),
        variant: 'secondary',
        onPress: () =>
          void run(
            'decline',
            () => declineExchangeRequest(exchange.id),
            t('requests.declinedToast'),
          ).then((ok) => {
            if (ok) router.back();
          }),
      });
    }
    if (actions.canReportProblem) {
      buttons.push({
        key: 'report',
        label: t('requests.dispute.action'),
        variant: 'secondary',
        onPress: () => {
          setReportReason(null);
          setReportDetails('');
          setReportSheetOpen(true);
        },
      });
    }
    if (actions.canCancel) {
      buttons.push({
        key: 'cancel',
        label: t('requests.actions.cancel'),
        variant: 'tertiary',
        onPress: () =>
          confirm({
            title: t('requests.cancelConfirmTitle'),
            message: t('requests.cancelConfirmMessage'),
            confirmLabel: t('requests.cancelConfirmAction'),
            cancelLabel: t('common:buttons.cancel'),
            variant: 'danger',
            onConfirm: () =>
              void run(
                'cancel',
                () => cancelExchangeRequest(exchange.id),
                t('requests.cancelledToast'),
              ).then((ok) => {
                if (ok) router.back();
              }),
          }),
      });
    }

    /*
      🔴 The waiting line is NOT an else-branch of "there are no buttons", and that
      distinction is a real defect this caught. Adding "Report a problem" gave this member
      a button, which silently removed "You have confirmed, waiting for the other member"
      — the one thing they needed to read. State and actions are separate things.
    */
    const statusLine = actions.awaitingOtherConfirmation
      ? t('requests.awaitingOther')
      : buttons.length === 0
        ? t('requests.noActions')
        : null;

    // Wrapping row with grow-to-fit buttons: the same shape as FormActionFooter, and for
    // the same reason — a fixed row clipped its last button at every screen width.
    return (
      <>
        {statusLine ? (
          <Text className="mt-4 text-sm text-muted-foreground">{statusLine}</Text>
        ) : null}
        {buttons.length > 0 ? (
          <View className="mt-4 flex-row flex-wrap gap-2">
            {buttons.map((button) => (
              <HeroButton
                key={button.key}
                variant={button.variant ?? 'primary'}
                isDisabled={busy !== null}
                onPress={button.onPress}
                style={{ flexGrow: 1, flexBasis: 'auto' }}
                testID={`exchange-action-${button.key}`}
              >
                <HeroButton.Label>{button.label}</HeroButton.Label>
              </HeroButton>
            ))}
          </View>
        ) : null}
      </>
    );
  };

  const confirmationLine = (label: string, at: string | null, hours: number | null) => (
    <View className="mt-1 flex-row flex-wrap items-center gap-x-2">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="text-sm text-foreground">
        {at
          ? t('requests.confirmedHoursAt', {
              count: hours ?? 0,
              when: formatDateTime(at) ?? '',
            })
          : t('requests.notConfirmedYet')}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={t('requests.detailTitle')} backLabel={t('common:back')} />

      {isLoading && !exchange ? (
        <LoadingSpinner />
      ) : error || !exchange ? (
        <View className="px-4">
          <ErrorState
            title={t('requests.detailLoadFailed')}
            subtitle={error ?? undefined}
            onRetry={refresh}
            testID="exchange-request-detail-error"
          />
        </View>
      ) : (
        <ScrollView
          className="flex-1 px-4"
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} />}
        >
          <Surface variant="secondary" className="mt-4 rounded-2xl p-4">
            <Chip size="sm" variant="soft">
              <Chip.Label>{t(`requests.status.${exchange.status}`)}</Chip.Label>
            </Chip>

            <Text className="mt-3 text-lg font-semibold text-foreground">
              {exchange.listing?.title ?? t('requests.untitledListing')}
            </Text>

            <Text className="mt-1 text-sm text-muted-foreground">
              {t('requests.between', {
                requester: exchange.requester?.name ?? t('requests.withMemberUnknown'),
                provider: exchange.provider?.name ?? t('requests.withMemberUnknown'),
              })}
            </Text>

            <View className="mt-3">
              <Text className="text-sm text-muted-foreground">
                {t('requests.proposedHours', { count: exchange.proposed_hours })}
              </Text>
              {exchange.final_hours !== null ? (
                <Text className="text-sm text-foreground">
                  {t('requests.finalHours', { count: exchange.final_hours })}
                </Text>
              ) : null}
            </View>

            {exchange.message ? (
              <View className="mt-3">
                <Text className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('requests.noteLabel')}
                </Text>
                <Text className="mt-1 text-sm text-foreground">{exchange.message}</Text>
              </View>
            ) : null}

            {renderActions()}
            {renderMessageOtherParty()}
          </Surface>

          <Surface variant="secondary" className="mt-4 rounded-2xl p-4">
            <Text className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('requests.confirmationsLabel')}
            </Text>
            {confirmationLine(
              t('requests.requesterLabel'),
              exchange.requester_confirmed_at,
              exchange.requester_confirmed_hours,
            )}
            {confirmationLine(
              t('requests.providerLabel'),
              exchange.provider_confirmed_at,
              exchange.provider_confirmed_hours,
            )}
          </Surface>

          {Array.isArray(exchange.status_history) && exchange.status_history.length > 0 ? (
            <Surface variant="secondary" className="mt-4 rounded-2xl p-4">
              <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('requests.historyLabel')}
              </Text>
              {exchange.status_history.map((entry, index) => (
                <View key={`${entry.action}-${index}`} className="mb-2">
                  <Text className="text-sm text-foreground">
                    {t(`requests.history.${entry.action}`, {
                      defaultValue: entry.action,
                    })}
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    {[entry.actor_name, formatDateTime(entry.created_at)]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
              ))}
            </Surface>
          ) : null}
        </ScrollView>
      )}

      <BottomSheet
        visible={reportSheetOpen}
        onClose={() => setReportSheetOpen(false)}
        title={t('requests.dispute.title')}
      >
        <View className="gap-3 pt-2">
          <Text className="text-sm text-muted-foreground">{t('requests.dispute.body')}</Text>
          {/*
            🔴 The safety line is not decoration. This routes to the community's brokers as
            an exchange problem; it is NOT a safeguarding case, and a member in danger must
            not be left thinking it is.
          */}
          <Text className="text-sm text-muted-foreground">{t('requests.dispute.safetyNote')}</Text>
          <View className="flex-row flex-wrap gap-2">
            {DISPUTE_REASONS.map((reason) => (
              <Chip
                key={reason}
                variant={reportReason === reason ? 'primary' : 'secondary'}
                onPress={() => setReportReason(reason)}
                testID={`exchange-dispute-reason-${reason}`}
                accessibilityLabel={t(`requests.dispute.reasons.${reason}`)}
              >
                <Chip.Label>{t(`requests.dispute.reasons.${reason}`)}</Chip.Label>
              </Chip>
            ))}
          </View>
          <TextArea
            value={reportDetails}
            onChangeText={setReportDetails}
            placeholder={t('requests.dispute.detailsPlaceholder')}
            accessibilityLabel={t('requests.dispute.detailsPlaceholder')}
            numberOfLines={4}
            containerClassName="mb-0"
            testID="exchange-dispute-details"
          />
          <View className="flex-row flex-wrap gap-2">
            <HeroButton
              variant="secondary"
              onPress={() => setReportSheetOpen(false)}
              style={{ flexGrow: 1, flexBasis: 'auto' }}
            >
              <HeroButton.Label>{t('requests.actions.cancelSheet')}</HeroButton.Label>
            </HeroButton>
            <HeroButton
              onPress={() => void submitReport()}
              // Disabled until a reason is chosen: the server refuses without one, and a
              // button that fails on purpose is worse than one that waits.
              isDisabled={busy !== null || reportReason === null}
              style={{ flexGrow: 1, flexBasis: 'auto' }}
              testID="exchange-dispute-submit"
            >
              <HeroButton.Label>{t('requests.dispute.submit')}</HeroButton.Label>
            </HeroButton>
          </View>
        </View>
      </BottomSheet>

      <BottomSheet
        visible={confirmSheetOpen}
        onClose={() => setConfirmSheetOpen(false)}
        title={t('requests.confirmSheetTitle')}
      >
        <View className="gap-3 pt-2">
          <Text className="text-sm text-muted-foreground">{t('requests.confirmSheetBody')}</Text>
          <Input
            value={hoursInput}
            onChangeText={setHoursInput}
            keyboardType="decimal-pad"
            placeholder={t('requests.hoursPlaceholder')}
            accessibilityLabel={t('requests.hoursFieldLabel')}
            testID="exchange-confirm-hours"
          />
          <View className="flex-row flex-wrap gap-2">
            <HeroButton
              variant="secondary"
              onPress={() => setConfirmSheetOpen(false)}
              style={{ flexGrow: 1, flexBasis: 'auto' }}
            >
              <HeroButton.Label>{t('requests.actions.cancelSheet')}</HeroButton.Label>
            </HeroButton>
            <HeroButton
              onPress={() => void submitConfirmation()}
              isDisabled={busy !== null}
              style={{ flexGrow: 1, flexBasis: 'auto' }}
              testID="exchange-confirm-submit"
            >
              <HeroButton.Label>{t('requests.actions.confirm')}</HeroButton.Label>
            </HeroButton>
          </View>
        </View>
      </BottomSheet>
      {confirmDialog}
    </SafeAreaView>
  );
}

export default function ExchangeRequestDetailModal() {
  return (
    <ModalErrorBoundary>
      <ExchangeRequestDetailScreen />
    </ModalErrorBoundary>
  );
}
