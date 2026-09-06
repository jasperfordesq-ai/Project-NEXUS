// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useMemo, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  Share,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Chip, Spinner, Surface } from 'heroui-native';
import * as Haptics from '@/lib/haptics';
import { useTranslation } from 'react-i18next';

import {
  cancelShiftSignup,
  expressInterest,
  getMyShifts,
  getOpportunityApplications,
  getOpportunity,
  handleVolunteerApplication,
  type MyShiftsResponse,
  type OpportunityApplication,
  signUpForShift,
  type VolunteerOpportunity,
  type VolunteerShift,
  type VolunteerShiftRegistration,
  type VolunteeringOrganisation,
} from '@/lib/api/volunteering';
import { describeApiError } from '@/lib/api/describeApiError';
import { useAuth } from '@/lib/hooks/useAuth';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { buildWebUrl } from '@/lib/utils/webUrl';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import Avatar from '@/components/ui/Avatar';
import BottomSheet from '@/components/ui/BottomSheet';
import ErrorState from '@/components/ui/ErrorState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { useConfirm } from '@/components/ui/useConfirm';
import { dateLocale } from '@/lib/utils/dateLocale';
import AccentIcon from '@/components/ui/AccentIcon';

type ApiOpportunity = VolunteerOpportunity & {
  organization?: VolunteeringOrganisation | null;
};

function formatDate(value?: string | null, mode: 'short' | 'long' = 'long') {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(dateLocale(), mode === 'short'
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

function formatTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(dateLocale(), { hour: '2-digit', minute: '2-digit' }).format(date);
}

function stripHtml(value?: string | null) {
  return (value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function organizationFor(opportunity: ApiOpportunity) {
  return opportunity.organisation ?? opportunity.organization ?? null;
}

function normalizedSkills(skills: VolunteerOpportunity['skills_needed']): string[] {
  if (Array.isArray(skills)) return skills;
  if (typeof skills === 'string') return skills.split(',').map((skill) => skill.trim()).filter(Boolean);
  return [];
}

function isOpenOpportunity(opportunity: ApiOpportunity) {
  if (typeof opportunity.is_active === 'boolean') return opportunity.is_active;
  return opportunity.status !== 'closed' && opportunity.status !== 'filled';
}

function statusLabelKey(opportunity: ApiOpportunity) {
  if (!isOpenOpportunity(opportunity)) {
    return opportunity.status === 'filled' ? 'status.filled' : 'status.closed';
  }
  return 'status.open';
}

function StateMessage({
  title,
  action,
  primary,
}: {
  title: string;
  action: string;
  primary: string;
}) {
  const theme = useTheme();
  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={title} backLabel={action} fallbackHref="/(modals)/volunteering" />
      <View className="flex-1 items-center justify-center px-6" style={{ flex: 1 }}>
        <Surface variant="secondary" className="items-center gap-4 rounded-panel p-8">
          <View className="size-12 items-center justify-center rounded-full" style={{ backgroundColor: withAlpha(primary, 0.12) }}>
            <Ionicons name="heart-outline" size={24} color={primary} />
          </View>
          <Text className="text-center text-sm" style={{ color: theme.textSecondary }}>{title}</Text>
          <HeroButton variant="secondary" onPress={() => router.back()}>
            <HeroButton.Label>{action}</HeroButton.Label>
          </HeroButton>
        </Surface>
      </View>
    </SafeAreaView>
  );
}

function MetaRow({
  icon,
  label,
  value,
  tint,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  tint?: string;
}) {
  const theme = useTheme();
  return (
    <Surface variant="secondary" className="flex-row items-center gap-3 rounded-panel-inner p-3">
      <View className="size-9 items-center justify-center rounded-full" style={{ backgroundColor: withAlpha(tint ?? theme.textMuted, 0.12) }}>
        <Ionicons name={icon} size={17} color={tint ?? theme.textSecondary} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-[11px] font-semibold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>
          {label}
        </Text>
        <Text className="mt-0.5 text-sm font-semibold" style={{ color: theme.text }} numberOfLines={2}>
          {value}
        </Text>
      </View>
    </Surface>
  );
}

function ShiftCard({
  shift,
  onSignUp,
  onCancel,
  signingUp,
  cancelling,
  canSignUp,
  isMine,
}: {
  shift: VolunteerShift;
  onSignUp: () => void;
  onCancel: () => void;
  signingUp: boolean;
  cancelling: boolean;
  canSignUp: boolean;
  /**
   * 🔴 The shift this member is actually on. Without it every card looked
   * identical, including the one they had just joined — see the block comment
   * on `myShiftForThisOpportunity`.
   */
  isMine: boolean;
}) {
  const { t } = useTranslation('volunteering');
  const theme = useTheme();
  const primary = usePrimaryColor();
  const date = formatDate(shift.start_time, 'short');
  const start = formatTime(shift.start_time);
  const end = formatTime(shift.end_time);

  return (
    <HeroCard className="rounded-panel p-0">
      <HeroCard.Body className="gap-3 p-4" style={{ minHeight: 128 }}>
        <View className="flex-row items-start gap-3">
          <View className="size-12 items-center justify-center rounded-panel-inner" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
            <Ionicons name="calendar-outline" size={22} color={primary} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-base font-semibold" style={{ color: theme.text }} numberOfLines={1}>
              {date ?? t('shiftDateUnavailable')}
            </Text>
            <Text className="mt-1 text-sm" style={{ color: theme.textSecondary }} numberOfLines={1}>
              {[start, end].filter(Boolean).join(' - ')}
            </Text>
            <Text className="mt-1 text-xs" style={{ color: theme.textMuted }} numberOfLines={1}>
              {shift.spots_available === null
                ? t('shiftCapacity', { count: shift.signup_count })
                : t('shiftSpots', { count: shift.spots_available })}
            </Text>
          </View>
          {isMine ? (
            <Chip size="sm" color="success" testID={`shift-mine-${shift.id}`}>
              <Chip.Label>{t('myShifts.confirmed')}</Chip.Label>
            </Chip>
          ) : null}
        </View>
        {canSignUp && isMine ? (
          <HeroButton
            size="sm"
            variant="tertiary"
            isDisabled={cancelling}
            onPress={onCancel}
            testID={`shift-cancel-${shift.id}`}
            accessibilityState={{ busy: cancelling }}
          >
            {cancelling ? <Spinner size="sm" /> : null}
            <HeroButton.Label>{t('myShifts.cancel')}</HeroButton.Label>
          </HeroButton>
        ) : null}
        {canSignUp && !isMine ? (
          <HeroButton size="sm" variant="secondary" isDisabled={signingUp} onPress={onSignUp} accessibilityState={{ busy: signingUp }}>
            {signingUp ? <Spinner size="sm" /> : null}
            <HeroButton.Label>{t('signUpForShift')}</HeroButton.Label>
          </HeroButton>
        ) : null}
      </HeroCard.Body>
    </HeroCard>
  );
}

function opportunityApplicationItems(data: unknown): OpportunityApplication[] {
  const response = data as { data?: { items?: OpportunityApplication[] } } | null;
  return Array.isArray(response?.data?.items) ? response.data.items : [];
}

function applicationStatusLabelKey(status: OpportunityApplication['status']) {
  return status === 'pending' || status === 'approved' || status === 'declined'
    ? `applicationStatus.${status}`
    : 'applicationStatus.unknown';
}

function ApplicationCard({
  application,
  actionId,
  onAction,
}: {
  application: OpportunityApplication;
  actionId: number | null;
  onAction: (applicationId: number, action: 'approve' | 'decline') => void;
}) {
  const { t } = useTranslation('volunteering');
  const theme = useTheme();
  const primary = usePrimaryColor();
  const isPending = application.status === 'pending';
  const isActing = actionId === application.id;
  const statusKey = applicationStatusLabelKey(application.status);

  return (
    <HeroCard className="rounded-panel p-0">
      <HeroCard.Body className="gap-3 p-4">
        <View className="flex-row items-start gap-3">
          <Avatar uri={application.user.avatar_url ?? undefined} name={application.user.name} size={42} />
          <View className="min-w-0 flex-1">
            <View className="flex-row items-start justify-between gap-2">
              <Text className="min-w-0 flex-1 text-sm font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                {application.user.name}
              </Text>
              <Chip size="sm" variant="secondary" color={isPending ? 'warning' : 'default'}>
                <Chip.Label>{t(statusKey)}</Chip.Label>
              </Chip>
            </View>
            {application.message ? (
              <Text className="mt-2 text-sm leading-5" style={{ color: theme.textSecondary }}>
                {application.message}
              </Text>
            ) : (
              <Text className="mt-2 text-sm italic" style={{ color: theme.textMuted }}>
                {t('applications.messageFallback')}
              </Text>
            )}
          </View>
        </View>

        {application.shift ? (
          <Surface variant="secondary" className="flex-row items-center gap-2 rounded-panel-inner px-3 py-2">
            <Ionicons name="calendar-outline" size={16} color={primary} />
            <Text className="min-w-0 flex-1 text-xs font-medium" style={{ color: theme.textSecondary }} numberOfLines={1}>
              {[formatDate(application.shift.start_time, 'short'), formatTime(application.shift.start_time), formatTime(application.shift.end_time)]
                .filter(Boolean)
                .join(' - ')}
            </Text>
          </Surface>
        ) : null}

        {isPending ? (
          <View className="flex-row gap-2">
            <HeroButton
              className="flex-1"
              size="sm"
              variant="secondary"
              isDisabled={isActing}
              onPress={() => onAction(application.id, 'decline')}
              accessibilityState={{ busy: isActing }}
            >
              {isActing ? <Spinner size="sm" /> : null}
              <HeroButton.Label>{t('applications.decline')}</HeroButton.Label>
            </HeroButton>
            <HeroButton
              className="flex-1"
              size="sm"
              isDisabled={isActing}
              onPress={() => onAction(application.id, 'approve')}
              accessibilityState={{ busy: isActing }}
            >
              {isActing ? <Spinner size="sm" /> : null}
              <HeroButton.Label>{t('applications.approve')}</HeroButton.Label>
            </HeroButton>
          </View>
        ) : null}
      </HeroCard.Body>
    </HeroCard>
  );
}

export default function VolunteeringDetailScreen() {
  return (
    <ModalErrorBoundary>
      <VolunteeringDetailScreenInner />
    </ModalErrorBoundary>
  );
}

function VolunteeringDetailScreenInner() {
  const { t } = useTranslation(['volunteering', 'common']);
  const { isAuthenticated } = useAuth();
  const { tenant } = useTenant();
  const { id } = useLocalSearchParams<{ id: string }>();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const [interestSent, setInterestSent] = useState(false);
  const [interestLoading, setInterestLoading] = useState(false);
  const [applySheetOpen, setApplySheetOpen] = useState(false);
  const [applyMessage, setApplyMessage] = useState('');
  const [signingShiftId, setSigningShiftId] = useState<number | null>(null);
  const [cancellingShiftId, setCancellingShiftId] = useState<number | null>(null);
  const [applicationActionId, setApplicationActionId] = useState<number | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const opportunityId = Number(id);
  const safeId = Number.isFinite(opportunityId) && opportunityId > 0 ? opportunityId : 0;

  const { data, isLoading, error, refresh } = useApi(
    () => getOpportunity(safeId),
    [safeId],
    { enabled: safeId > 0 },
  );

  // 🔴 No whole-list fallback fetch (S4-28). It loaded every opportunity on every visit to
  // paper over a failed detail request; the error state below is the honest answer.
  const opportunity = (data?.data ?? null) as ApiOpportunity | null;

  const ownerApplicationsApi = useApi(
    () => getOpportunityApplications(safeId, 'pending'),
    [safeId, Boolean(opportunity?.is_owner)],
    { enabled: safeId > 0 && Boolean(opportunity?.is_owner) },
  );
  const ownerApplications = opportunityApplicationItems(ownerApplicationsApi.data);

  const org = opportunity ? organizationFor(opportunity) : null;
  const skills = useMemo(() => normalizedSkills(opportunity?.skills_needed ?? null), [opportunity?.skills_needed]);
  const shifts = opportunity?.shifts ?? [];
  const hasApplied = interestSent || Boolean(opportunity?.has_applied || opportunity?.application);
  const open = opportunity ? isOpenOpportunity(opportunity) : false;
  const canSignUpForShifts = Boolean(opportunity?.application?.status === 'approved' && !opportunity.is_owner);

  /**
   * 🔴 A volunteer can hold exactly ONE shift per opportunity, and nothing said so.
   *
   * The server stores the sign-up as `vol_applications.shift_id` — a single column on
   * the application, not a row per shift — so `signUpForShift()` on a second shift
   * silently moves the volunteer off the first. Walked on a device 2026-08-23: joined
   * Mon Aug 24 (shift 65), then Wed Aug 26 (shift 66); the toast said "Shift joined —
   * You have signed up for this shift" both times, Monday's card went back to "4 spots
   * available", and `vol_applications.shift_id` had simply changed 65 → 66. The
   * volunteer was dropped from Monday and told nothing.
   *
   * The opportunity payload carries no per-viewer flag on its shifts (no
   * `is_signed_up`), so the shift they hold has to come from `GET /v2/volunteering/shifts`,
   * which returns it with `opportunity_id` and is therefore filterable to this screen.
   */
  const myShiftsApi = useApi<MyShiftsResponse>(
    () => getMyShifts(),
    [safeId, canSignUpForShifts],
    { enabled: safeId > 0 && canSignUpForShifts },
  );
  const myShiftForThisOpportunity: VolunteerShiftRegistration | null = useMemo(() => {
    const items = myShiftsApi.data?.data?.items;
    if (!Array.isArray(items)) return null;
    return items.find((item) => item.opportunity_id === safeId) ?? null;
  }, [myShiftsApi.data, safeId]);

  async function handleShare() {
    if (!opportunity) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await Share.share({
        message: `${opportunity.title} - ${buildWebUrl(tenant?.slug, `/volunteering/opportunities/${opportunity.id}`)}`,
      });
    } catch {
      // Native share can be cancelled.
    }
  }

  async function handleApply() {
    if (!opportunity || interestLoading || hasApplied) return;
    if (!isAuthenticated) {
      showToast({ title: t('signInRequiredTitle'), description: t('signInRequiredMessage'), variant: 'warning' });
      return;
    }

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInterestLoading(true);
    setInterestSent(true); // optimistic — reverted in catch
    try {
      await expressInterest(opportunity.id, applyMessage.trim() || undefined);
      setApplyMessage('');
      setApplySheetOpen(false);
      refresh();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ title: t('interestSentTitle'), description: t('interestSentMessage'), variant: 'success' });
    } catch (err) {
      setInterestSent(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({
        title: t('common:errors.alertTitle'),
        description: err instanceof Error && err.message ? err.message : t('interestError'),
        variant: 'danger',
      });
    } finally {
      setInterestLoading(false);
    }
  }

  async function performSignUpForShift(shiftId: number) {
    setSigningShiftId(shiftId);
    try {
      await signUpForShift(shiftId);
      refresh();
      myShiftsApi.refresh();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ title: t('shiftSignupTitle'), description: t('shiftSignupMessage'), variant: 'success' });
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({
        title: t('common:errors.alertTitle'),
        description: describeApiError(err, t('shiftSignupError')),
        variant: 'danger',
      });
    } finally {
      setSigningShiftId(null);
    }
  }

  function handleSignUpForShift(shiftId: number) {
    if (!isAuthenticated) {
      showToast({ title: t('signInRequiredTitle'), description: t('signInRequiredMessage'), variant: 'warning' });
      return;
    }

    // Already holding a different shift here: say what will be lost before doing it.
    const held = myShiftForThisOpportunity;
    if (held && held.id !== shiftId) {
      confirm({
        title: t('shiftMove.title'),
        message: t('shiftMove.message', {
          date: formatDate(held.start_time, 'short') ?? t('myShifts.dateUnknown'),
        }),
        confirmLabel: t('shiftMove.confirm'),
        cancelLabel: t('common:buttons.cancel'),
        variant: 'primary',
        confirmTestID: 'shift-move-confirm',
        cancelTestID: 'shift-move-cancel',
        onConfirm: () => performSignUpForShift(shiftId),
      });
      return;
    }

    void performSignUpForShift(shiftId);
  }

  function handleCancelShift(shiftId: number) {
    // 🔴 Destructive: one tap used to release the place with no way back (S4-16).
    confirm({
      title: t('myShifts.cancelConfirmTitle'),
      message: t('myShifts.cancelConfirmMessage'),
      confirmLabel: t('myShifts.cancel'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      confirmTestID: 'shift-cancel-confirm',
      onConfirm: () => performCancelShift(shiftId),
    });
  }

  async function performCancelShift(shiftId: number) {
    setCancellingShiftId(shiftId);
    try {
      await cancelShiftSignup(shiftId);
      refresh();
      myShiftsApi.refresh();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ title: t('shiftCancelledTitle'), description: t('shiftCancelledMessage'), variant: 'success' });
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({
        title: t('common:errors.alertTitle'),
        description: describeApiError(err, t('myShifts.cancelError')),
        variant: 'danger',
      });
    } finally {
      setCancellingShiftId(null);
    }
  }

  async function handleApplicationAction(applicationId: number, action: 'approve' | 'decline') {
    setApplicationActionId(applicationId);
    try {
      await handleVolunteerApplication(applicationId, action);
      ownerApplicationsApi.refresh();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({
        title: t(action === 'approve' ? 'applications.approvedTitle' : 'applications.declinedTitle'),
        description: t(action === 'approve' ? 'applications.approvedMessage' : 'applications.declinedMessage'),
        variant: 'success',
      });
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('applications.actionFailed')), variant: 'danger' });
    } finally {
      setApplicationActionId(null);
    }
  }

  if (!safeId) {
    return <StateMessage title={t('detail.invalidId')} action={t('detail.goBack')} primary={primary} />;
  }

  // `&& !opportunity`: a pull-to-refresh used to swap the whole screen for a spinner (S4-07).
  if (isLoading && !opportunity) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar title={t('detail.title')} backLabel={t('common:back')} fallbackHref="/(modals)/volunteering" />
        <View className="flex-1 items-center justify-center" style={{ flex: 1 }}>
          <LoadingSpinner />
        </View>
      </SafeAreaView>
    );
  }

  // 🔴 A network failure used to read as "not found" (S4-06). It gets a retry instead.
  if (!opportunity && error) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar title={t('detail.title')} backLabel={t('common:back')} fallbackHref="/(modals)/volunteering" />
        <View className="flex-1 justify-center" style={{ flex: 1 }}>
          <ErrorState subtitle={error} onRetry={refresh} isRetrying={isLoading} testID="volunteering-detail-error" />
        </View>
      </SafeAreaView>
    );
  }

  if (!opportunity) {
    return <StateMessage title={t('detail.notFound')} action={t('detail.goBack')} primary={primary} />;
  }

  const statusTone = open ? theme.success : opportunity.status === 'filled' ? theme.warning : theme.textMuted;
  const startDate = formatDate(opportunity.start_date);
  const endDate = formatDate(opportunity.end_date);
  const createdDate = formatDate(opportunity.created_at);

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar
        title={t('detail.title')}
        backLabel={t('common:back')}
        fallbackHref="/(modals)/volunteering"
        rightAction={{
          accessibilityLabel: t('share'),
          icon: 'share-outline',
          onPress: handleShare,
        }}
      />

      <ScrollView
        className="flex-1"
        style={{ flex: 1, backgroundColor: theme.bg }}
        contentContainerStyle={{ flexGrow: 1, gap: 16, paddingHorizontal: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} tintColor={primary} colors={[primary]} />}
      >
        <HeroCard className="overflow-hidden rounded-panel p-0">
          <View className="h-1.5" style={{ backgroundColor: '#e11d48' }} />
          <HeroCard.Body className="gap-5 p-5">
            <View className="flex-row items-start justify-between gap-3">
              <View className="min-w-0 flex-1">
                <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>
                  {t('opportunityEyebrow')}
                </Text>
                <Text className="mt-1 text-2xl font-bold" style={{ color: theme.text }} numberOfLines={3}>
                  {opportunity.title}
                </Text>
              </View>
              <Chip size="sm" variant="secondary" color="default">
                <Ionicons name="radio-button-on-outline" size={12} color={statusTone} />
                <Chip.Label>{t(statusLabelKey(opportunity))}</Chip.Label>
              </Chip>
            </View>

            {org ? (
              <View className="flex-row items-center gap-3">
                <Avatar uri={org.avatar ?? org.logo_url ?? undefined} name={org.name} size={46} />
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                    {org.name}
                  </Text>
                  <Text className="text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>
                    {t('detail.organisation')}
                  </Text>
                </View>
              </View>
            ) : null}

            <View className="flex-row flex-wrap gap-2">
              {opportunity.is_remote ? (
                <Chip size="sm" variant="secondary" color="default">
                  <Ionicons name="wifi-outline" size={12} color={primary} />
                  <Chip.Label>{t('remote')}</Chip.Label>
                </Chip>
              ) : null}
              {opportunity.category ? (
                <Chip size="sm" variant="secondary" color="default">
                  <Chip.Label>{opportunity.category}</Chip.Label>
                </Chip>
              ) : null}
              {hasApplied ? (
                <Chip size="sm" variant="secondary" color="success">
                  <Ionicons name="checkmark-circle-outline" size={12} color={theme.success} />
                  <Chip.Label>{t('interestSent')}</Chip.Label>
                </Chip>
              ) : null}
              {opportunity.is_owner ? (
                <Chip size="sm" variant="secondary" color="default">
                  <Ionicons name="briefcase-outline" size={12} color={theme.textSecondary} />
                  <Chip.Label>{t('yourOpportunity')}</Chip.Label>
                </Chip>
              ) : null}
            </View>
          </HeroCard.Body>
        </HeroCard>

        <HeroCard className="rounded-panel p-0">
          <HeroCard.Body className="gap-3 p-4">
            {opportunity.is_remote ? (
              <MetaRow icon="wifi-outline" label={t('meta.location')} value={t('remote')} tint={primary} />
            ) : opportunity.location ? (
              <MetaRow icon="location-outline" label={t('meta.location')} value={opportunity.location} />
            ) : null}
            {opportunity.commitment ? (
              <MetaRow icon="repeat-outline" label={t('meta.commitment')} value={opportunity.commitment} />
            ) : null}
            {startDate ? (
              <MetaRow icon="calendar-outline" label={t('meta.starts')} value={startDate} />
            ) : null}
            {endDate ? (
              <MetaRow icon="calendar-outline" label={t('meta.ends')} value={endDate} />
            ) : null}
            {typeof opportunity.spots_available === 'number' ? (
              <MetaRow icon="people-outline" label={t('meta.spots')} value={t('spots', { count: opportunity.spots_available })} />
            ) : null}
            {createdDate ? (
              <MetaRow icon="briefcase-outline" label={t('meta.posted')} value={createdDate} />
            ) : null}
          </HeroCard.Body>
        </HeroCard>

        <HeroCard className="rounded-panel p-0">
          <HeroCard.Body className="gap-3 p-4">
            <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>
              {t('detail.about')}
            </Text>
            <Text className="text-sm leading-6" style={{ color: theme.text }}>
              {stripHtml(opportunity.description) || t('noDescription')}
            </Text>
          </HeroCard.Body>
        </HeroCard>

        {skills.length > 0 ? (
          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="gap-3 p-4">
              <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>
                {t('skills')}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {skills.map((skill) => (
                  <Chip key={skill} size="sm" variant="secondary" color="default">
                    <Chip.Label>{skill}</Chip.Label>
                  </Chip>
                ))}
              </View>
            </HeroCard.Body>
          </HeroCard>
        ) : null}

        {shifts.length > 0 ? (
          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="gap-3 p-4">
              <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>
                {t('shifts')}
              </Text>
              {shifts.map((shift) => (
                <ShiftCard
                  key={shift.id}
                  shift={shift}
                  signingUp={signingShiftId === shift.id}
                  cancelling={cancellingShiftId === shift.id}
                  canSignUp={canSignUpForShifts}
                  isMine={myShiftForThisOpportunity?.id === shift.id}
                  onSignUp={() => handleSignUpForShift(shift.id)}
                  onCancel={() => handleCancelShift(shift.id)}
                />
              ))}
            </HeroCard.Body>
          </HeroCard>
        ) : null}

        {opportunity.is_owner ? (
          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="gap-4 p-4">
              <View className="gap-2">
                <Text className="text-base font-semibold" style={{ color: theme.text }}>
                  {t('ownerOpportunityTitle')}
                </Text>
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                  {t('ownerOpportunityHint')}
                </Text>
              </View>
              <HeroButton
                variant="secondary"
                onPress={() => router.push({ pathname: '/(modals)/edit-volunteering', params: { id: String(opportunity.id) } } as never)}
              >
                <Ionicons name="create-outline" size={16} color={primary} />
                <HeroButton.Label>{t('editOpportunity')}</HeroButton.Label>
              </HeroButton>

              <View className="gap-3">
                <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>
                  {t('applications.heading')}
                </Text>
                {ownerApplicationsApi.isLoading ? (
                  <View className="items-center py-4">
                    <Spinner size="sm" />
                  </View>
                ) : ownerApplicationsApi.error ? (
                  <Surface variant="secondary" className="gap-3 rounded-panel-inner p-4">
                    <Text className="text-sm" style={{ color: theme.textSecondary }}>
                      {t('applications.loadFailed')}
                    </Text>
                    <HeroButton size="sm" variant="secondary" onPress={ownerApplicationsApi.refresh}>
                      <HeroButton.Label>{t('tryAgain')}</HeroButton.Label>
                    </HeroButton>
                  </Surface>
                ) : ownerApplications.length > 0 ? (
                  ownerApplications.map((application) => (
                    <ApplicationCard
                      key={application.id}
                      application={application}
                      actionId={applicationActionId}
                      onAction={(applicationId, action) => void handleApplicationAction(applicationId, action)}
                    />
                  ))
                ) : (
                  <Surface variant="secondary" className="rounded-panel-inner p-4">
                    <Text className="text-sm" style={{ color: theme.textSecondary }}>
                      {t('applications.emptyOwner')}
                    </Text>
                  </Surface>
                )}
              </View>
            </HeroCard.Body>
          </HeroCard>
        ) : (
          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="gap-4 p-4">
              <View>
                <Text className="text-base font-semibold" style={{ color: theme.text }}>
                  {hasApplied ? t('applicationSubmitted') : t('applyToVolunteer')}
                </Text>
                <Text className="mt-1 text-sm" style={{ color: theme.textSecondary }}>
                  {hasApplied ? t('applicationSubmittedHint') : t('coverMessageHint')}
                </Text>
              </View>
              <HeroButton
                isDisabled={!open || hasApplied || interestLoading}
                onPress={() => setApplySheetOpen(true)}
                accessibilityState={{ busy: interestLoading }}
              >
                {interestLoading
                  ? <Spinner size="sm" />
                  : <AccentIcon name={hasApplied ? 'checkmark-circle-outline' : 'send-outline'} size={18} />}
                <HeroButton.Label>
                  {hasApplied ? t('interestSent') : open ? t('expressInterest') : t('status.closed')}
                </HeroButton.Label>
              </HeroButton>
            </HeroCard.Body>
          </HeroCard>
        )}
      </ScrollView>
      <BottomSheet visible={!opportunity.is_owner && applySheetOpen} onClose={() => setApplySheetOpen(false)} snapPoints={['52%', '84%']}>
        <View className="gap-4 py-2">
          <View>
            <Text className="text-lg font-bold" style={{ color: theme.text }}>
              {t('applyToVolunteer')}
            </Text>
            <Text className="mt-1 text-sm leading-5" style={{ color: theme.textSecondary }}>
              {t('coverMessageHint')}
            </Text>
          </View>
          <Input
            value={applyMessage}
            onChangeText={setApplyMessage}
            placeholder={t('coverMessagePlaceholder')}
            placeholderTextColor={theme.textMuted}
            multiline
            className="min-h-[124px] text-base"
            style={{ color: theme.text, textAlignVertical: 'top' }}
            accessibilityLabel={t('coverMessagePlaceholder')}
          />
          <View className="flex-row gap-3">
            <HeroButton className="flex-1" variant="secondary" isDisabled={interestLoading} onPress={() => setApplySheetOpen(false)}>
              <HeroButton.Label>{t('common:buttons.cancel')}</HeroButton.Label>
            </HeroButton>
            <HeroButton
              className="flex-1"
              isDisabled={!open || hasApplied || interestLoading}
              onPress={() => void handleApply()}
            >
              {interestLoading ? <Spinner size="sm" /> : <AccentIcon name="send-outline" size={18} />}
              <HeroButton.Label>{t('expressInterest')}</HeroButton.Label>
            </HeroButton>
          </View>
        </View>
      </BottomSheet>
      {confirmDialog}
    </SafeAreaView>
  );
}
