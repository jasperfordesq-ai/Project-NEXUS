// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, RefreshControl, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import RefreshFailedNotice from '@/components/ui/RefreshFailedNotice';
import { Card as HeroCard, Surface } from 'heroui-native';
import { Chip } from '@/components/ui/StatusChip';
import { Tabs } from '@/components/ui/NativeTabs';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { useTranslation } from 'react-i18next';

import {
  cancelJobInterview,
  createJobOffer,
  getJobApplications,
  proposeJobInterview,
  updateJobApplication,
  withdrawJobOffer,
} from '@/lib/api/jobs';
import { ApiResponseError } from '@/lib/api/client';
import { isRefusalStatus } from '@/lib/api/refusal';
import type { CreateJobOfferPayload, JobOwnerApplication, ProposeJobInterviewPayload } from '@/lib/api/jobs';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { useAuth } from '@/lib/hooks/useAuth';
import { withAlpha } from '@/lib/utils/color';
import * as Haptics from '@/lib/haptics';
import { describeApiError } from '@/lib/api/describeApiError';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import AccentIcon from '@/components/ui/AccentIcon';
import { useConfirm } from '@/components/ui/useConfirm';
import { withRouteGate } from '@/components/withRouteGate';
import BottomSheet from '@/components/ui/BottomSheet';
import Input from '@/components/ui/Input';
import ChoiceChips, { toOptions } from '@/components/ui/ChoiceChips';
import { parseDecimalInput } from '@/lib/utils/decimal';
import {
  completeJobHiringActionOperation,
  reserveJobHiringActionOperation,
} from '@/lib/jobHiringActionOperation';
import { responsiveActionStyle } from '@/lib/layout/responsiveActions';

const PIPELINE_COLUMNS = ['pending', 'screening', 'reviewed', 'shortlisted', 'interview', 'offer', 'accepted', 'rejected', 'withdrawn'] as const;
type PipelineStatus = (typeof PIPELINE_COLUMNS)[number];
type HiringAction = { kind: 'interview' | 'offer'; application: JobOwnerApplication };

function JobPipelineScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { tenant } = useTenant();
  return <JobPipelineContent key={`${tenant?.id ?? tenant?.slug ?? 'no-tenant'}:${user?.id ?? 'no-user'}:${id}`} />;
}

function JobPipelineContent() {
  const { t } = useTranslation(['jobs', 'common']);
  const { id } = useLocalSearchParams<{ id: string }>();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const jobId = Number(id);
  const safeId = Number.isFinite(jobId) && jobId > 0 ? jobId : 0;
  const [selectedStatus, setSelectedStatus] = useState<PipelineStatus>('pending');
  const [hiringAction, setHiringAction] = useState<HiringAction | null>(null);
  const { tenant } = useTenant();
  const interviewEnabled = tenant?.job_config?.['jobs.enable_interview_scheduling'] !== false;
  const offersEnabled = tenant?.job_config?.['jobs.enable_offers'] !== false;

  const applicationsApi = useApi(
    () => getJobApplications(safeId),
    [safeId],
    { enabled: safeId > 0 },
  );

  const applications = useMemo(
    () => Array.isArray(applicationsApi.data?.data) ? applicationsApi.data.data : [],
    [applicationsApi.data],
  );
  const grouped = useMemo(() => {
    return PIPELINE_COLUMNS.reduce<Record<PipelineStatus, JobOwnerApplication[]>>((acc, status) => {
      acc[status] = applications.filter((application) => normalizeStatus(application.stage ?? application.status) === status);
      return acc;
    }, {} as Record<PipelineStatus, JobOwnerApplication[]>);
  }, [applications]);

  if (safeId === 0) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('kanban.pipeline_title')} backLabel={t('common:back')} fallbackHref="/(modals)/jobs" />
        <EmptyState
          icon="git-network-outline"
          title={t('detail.invalidId')}
          subtitle={t('detail.invalidIdHint')}
          actionLabel={t('detail.browseJobs')}
          onAction={() => router.replace('/(modals)/jobs')}
        />
      </SafeAreaView>
    );
  }

  if (applicationsApi.isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('kanban.pipeline_title')} backLabel={t('common:back')} fallbackHref="/(modals)/jobs" />
        <View className="flex-1 items-center justify-center">
          <LoadingSpinner />
        </View>
      </SafeAreaView>
    );
  }

  /*
    🔴 A refusal is not a failure.

    This screen belongs to the vacancy's owner. Anyone else — including an owner who has
    transferred the vacancy — gets 403 or 404, and that was rendered as "could not load"
    with a Retry the member could press for ever without it ever succeeding. Found by the
    2026-09-07 audit (E/F-9); the same fault was fixed for hidden profiles and deleted
    conversations the day before, and these two screens were not in that pass.
  */
  const refused = applicationsApi.error && isRefusalStatus(applicationsApi.errorStatus);

  if (refused) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('kanban.pipeline_title')} backLabel={t('common:back')} fallbackHref="/(modals)/jobs" />
        <EmptyState
          icon="lock-closed-outline"
          title={t('owner.notYoursTitle')}
          subtitle={applicationsApi.errorStatus === 404 ? t('detail.notFound') : t('owner.notYoursHint')}
          actionLabel={t('detail.browseJobs')}
          onAction={() => router.replace('/(modals)/jobs')}
          testID="job-pipeline-refused"
        />
      </SafeAreaView>
    );
  }

  if (applicationsApi.error) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('kanban.pipeline_title')} backLabel={t('common:back')} fallbackHref="/(modals)/jobs" />
        <EmptyState
          icon="git-network-outline"
          title={applicationsApi.error}
          subtitle={t('kanban.load_error_hint')}
          actionLabel={t('retry')}
          onAction={applicationsApi.refresh}
          testID="job-pipeline-error"
        />
      </SafeAreaView>
    );
  }

  const selectedApplications = grouped[selectedStatus] ?? [];

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar
          title={t('kanban.pipeline_title')}
          backLabel={t('common:back')}
          fallbackHref={{ pathname: '/(modals)/job-detail', params: { id: String(safeId) } }}
          rightAction={{
            accessibilityLabel: t('retry'),
            icon: 'refresh-outline',
            onPress: applicationsApi.refresh,
          }}
        />

        <ScrollView contentContainerStyle={{ gap: 16, padding: 16, paddingBottom: 32 }} refreshControl={<RefreshControl refreshing={applicationsApi.isLoading && Boolean(applicationsApi.data)} onRefresh={applicationsApi.refresh} tintColor={primary} colors={[primary]} />}>
          <RefreshFailedNotice error={applicationsApi.data ? applicationsApi.error : null} onRetry={applicationsApi.refresh} />
          <HeroCard className="overflow-hidden rounded-panel p-0">
            <View className="h-1.5" style={{ backgroundColor: primary }} />
            <HeroCard.Body className="gap-4 p-4">
              <View className="flex-row items-start gap-3">
                <View className="size-12 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                  <Ionicons name="git-network-outline" size={24} color={primary} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>
                    {t('kanban.eyebrow')}
                  </Text>
                  <Text className="mt-1 text-2xl font-bold leading-8" style={{ color: theme.text }}>
                    {t('kanban.pipeline_title')}
                  </Text>
                  <Text className="mt-1 text-sm leading-5" style={{ color: theme.textSecondary }}>
                    {t('kanban.subtitle')}
                  </Text>
                </View>
              </View>
              <View className="flex-row flex-wrap gap-2">
                <Chip size="sm" variant="secondary">
                  <Chip.Label>{t('owner.applicationsCount', { count: applications.length })}</Chip.Label>
                </Chip>
                <Chip size="sm" variant="secondary">
                  <Chip.Label>{t('kanban.active_stage_count', { count: selectedApplications.length })}</Chip.Label>
                </Chip>
              </View>
            </HeroCard.Body>
          </HeroCard>

          <Tabs value={selectedStatus} onValueChange={(value) => setSelectedStatus(value as PipelineStatus)} variant="secondary">
            <Tabs.List>
              <Tabs.Indicator />
              {PIPELINE_COLUMNS.map((status) => (
                <Tabs.Trigger key={status} value={status}>
                  <Tabs.Label>{t(`applications.status.${status}`)}</Tabs.Label>
                </Tabs.Trigger>
              ))}
            </Tabs.List>
          </Tabs>

          <View className="flex-row flex-wrap gap-3">
            {PIPELINE_COLUMNS.map((status) => (
              <StageSummary
                key={status}
                status={status}
                count={grouped[status]?.length ?? 0}
                active={selectedStatus === status}
                primary={primary}
                theme={theme}
                t={t}
                onPress={() => setSelectedStatus(status)}
              />
            ))}
          </View>

          {selectedApplications.length === 0 ? (
            <HeroCard className="rounded-panel p-0">
              <HeroCard.Body className="items-center gap-3 p-6">
                <Ionicons name="file-tray-outline" size={34} color={theme.textMuted} />
                <Text className="text-base font-bold" style={{ color: theme.text }}>{t('kanban.empty_stage')}</Text>
                <Text className="text-center text-sm" style={{ color: theme.textSecondary }}>{t('kanban.empty_stage_hint')}</Text>
              </HeroCard.Body>
            </HeroCard>
          ) : (
            <View className="gap-3">
              {selectedApplications.map((application) => (
                <PipelineApplicationCard
                  key={application.id}
                  application={application}
                  primary={primary}
                  theme={theme}
                  t={t}
                  onUpdated={applicationsApi.refresh}
                  interviewEnabled={interviewEnabled}
                  offersEnabled={offersEnabled}
                  onOpenAction={(kind) => setHiringAction({ kind, application })}
                />
              ))}
            </View>
          )}
        </ScrollView>
        <HiringActionSheet
          key={hiringAction ? `${hiringAction.kind}:${hiringAction.application.id}` : 'closed'}
          action={hiringAction}
          defaultCurrency={tenant?.job_config?.['jobs.default_currency'] ?? tenant?.currency ?? 'EUR'}
          onClose={() => setHiringAction(null)}
          onSuccess={() => {
            setHiringAction(null);
            applicationsApi.refresh();
          }}
        />
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}

function StageSummary({
  status,
  count,
  active,
  primary,
  theme,
  t,
  onPress,
}: {
  status: PipelineStatus;
  count: number;
  active: boolean;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onPress: () => void;
}) {
  return (
    <View style={{ width: '100%' }}>
    <HeroButton
      style={{ width: '100%' }}
      variant={active ? 'primary' : 'secondary'}
      onPress={onPress}
      testID={`pipeline-stage-${status}`}
    >
      <HeroButton.Label>{t(`applications.status.${status}`)}</HeroButton.Label>
      <Chip size="sm" variant="secondary">
        <Chip.Label>{count}</Chip.Label>
      </Chip>
    </HeroButton>
    </View>
  );
}

function PipelineApplicationCard({
  application,
  primary,
  theme,
  t,
  onUpdated,
  interviewEnabled,
  offersEnabled,
  onOpenAction,
}: {
  application: JobOwnerApplication;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onUpdated: () => void;
  interviewEnabled: boolean;
  offersEnabled: boolean;
  onOpenAction: (kind: HiringAction['kind']) => void;
}) {
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const [isUpdating, setIsUpdating] = useState(false);
  const movePending = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const applicantName = application.applicant?.name?.trim() || t('owner.unknownApplicant');
  const currentStatus = normalizeStatus(application.stage ?? application.status);
  const terminal = ['accepted', 'rejected', 'withdrawn'].includes(currentStatus);
  const activeInterview = application.interview && ['proposed', 'accepted'].includes(application.interview.status)
    ? application.interview
    : null;
  const pendingOffer = application.offer?.status === 'pending' ? application.offer : null;

  /**
   * The stage that follows this one, or null at the end of the run.
   *
   * `rejected` is last in `PIPELINE_COLUMNS` but it is not what follows `accepted`, so an
   * accepted candidate is offered no "next".
   */
  const nextStatus: PipelineStatus | null = (() => {
    if (terminal) return null;
    const index = PIPELINE_COLUMNS.indexOf(currentStatus);
    const candidate = PIPELINE_COLUMNS[index + 1];
    return candidate && candidate !== 'rejected' ? candidate : null;
  })();

  /** Every other stage they could be moved to. Rejecting has its own confirmed button. */
  const otherStatuses = terminal ? [] : PIPELINE_COLUMNS.filter(
    (status) => status !== currentStatus && status !== nextStatus && status !== 'rejected' && status !== 'withdrawn',
  );

  function confirmReject() {
    confirm({
      title: t('owner.rejectConfirmTitle'),
      message: t('owner.rejectConfirmMessage', { name: applicantName }),
      confirmLabel: t('owner.reject'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      confirmTestID: `pipeline-confirm-reject-${application.id}`,
      onConfirm: () => moveTo('rejected'),
    });
  }

  async function moveTo(status: PipelineStatus) {
    if (movePending.current || terminal || status === currentStatus) return;
    movePending.current = true;
    setIsUpdating(true);
    try {
      try {
        await updateJobApplication(application.id, {
          status,
          expected_status: application.stage ?? application.status,
        });
      } catch (err) {
        if (!(err instanceof ApiResponseError) || err.status !== 0) throw err;
        const readback = await getJobApplications(application.vacancy_id);
        const authoritative = readback.data.find((candidate) => candidate.id === application.id);
        if ((authoritative?.stage ?? authoritative?.status) !== status) throw err;
      }
      if (!mountedRef.current) return;
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (!mountedRef.current) return;
      onUpdated();
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof ApiResponseError && (err.code === 'DECISION_CONFLICT' || err.status === 0)) onUpdated();
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('owner.updateError')), variant: 'danger' });
    } finally {
      movePending.current = false;
      if (mountedRef.current) setIsUpdating(false);
    }
  }

  function cancelInterview() {
    if (!activeInterview) return;
    confirm({
      title: t('owner.cancelInterviewConfirmTitle'),
      message: t('owner.cancelInterviewConfirmMessage', { name: applicantName }),
      confirmLabel: t('owner.cancelInterview'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      confirmTestID: `pipeline-confirm-cancel-interview-${application.id}`,
      onConfirm: () => void runLifecycleAction(
        () => cancelJobInterview(activeInterview.id),
        (latest) => latest.interview?.id === activeInterview.id && latest.interview.status === 'cancelled',
        t('owner.cancelInterviewError'),
      ),
    });
  }

  function withdrawOffer() {
    if (!pendingOffer) return;
    confirm({
      title: t('owner.withdrawOfferConfirmTitle'),
      message: t('owner.withdrawOfferConfirmMessage', { name: applicantName }),
      confirmLabel: t('owner.withdrawOffer'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      confirmTestID: `pipeline-confirm-withdraw-offer-${application.id}`,
      onConfirm: () => void runLifecycleAction(
        () => withdrawJobOffer(pendingOffer.id),
        (latest) => latest.offer?.id === pendingOffer.id && latest.offer.status === 'withdrawn',
        t('owner.withdrawOfferError'),
      ),
    });
  }

  async function runLifecycleAction(
    mutate: () => Promise<void>,
    confirms: (latest: JobOwnerApplication) => boolean,
    fallbackError: string,
  ) {
    if (movePending.current || terminal) return;
    movePending.current = true;
    setIsUpdating(true);
    try {
      try {
        await mutate();
      } catch (err) {
        if (!(err instanceof ApiResponseError) || err.status !== 0) throw err;
        const readback = await getJobApplications(application.vacancy_id);
        const latest = readback.data.find((candidate) => candidate.id === application.id);
        if (!latest || !confirms(latest)) throw err;
      }
      if (!mountedRef.current) return;
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (mountedRef.current) onUpdated();
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof ApiResponseError && err.status === 0) onUpdated();
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, fallbackError), variant: 'danger' });
    } finally {
      movePending.current = false;
      if (mountedRef.current) setIsUpdating(false);
    }
  }

  return (
    <HeroCard className="rounded-panel p-0">
      <HeroCard.Body className="gap-4 p-4">
        <View className="flex-row items-start gap-3">
          <Avatar uri={application.applicant?.avatar_url ?? null} name={applicantName} size={42} />
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-base font-bold" style={{ color: theme.text }} numberOfLines={1}>{applicantName}</Text>
            <Text className="text-xs" style={{ color: theme.textSecondary }}>
              {t(`applications.status.${currentStatus}`)}
            </Text>
          </View>
          <Chip size="sm" variant="secondary">
            <Chip.Label>{t(`applications.status.${currentStatus}`)}</Chip.Label>
          </Chip>
        </View>
        {application.message ? (
          <Surface variant="secondary" className="rounded-panel-inner p-3">
            <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={4}>
              {application.message}
            </Text>
          </Surface>
        ) : null}
        {!terminal && (interviewEnabled || offersEnabled) ? (
          <Surface variant="secondary" className="gap-3 rounded-panel-inner p-3" testID={`pipeline-hiring-actions-${application.id}`}>
            <Text className="text-sm font-bold" style={{ color: theme.text }}>{t('owner.hiringActions')}</Text>
            {activeInterview ? (
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                {t('owner.interviewSummary', {
                  date: new Date(activeInterview.scheduled_at).toLocaleString(),
                  status: t(`owner.interviewStatus.${activeInterview.status}`),
                })}
              </Text>
            ) : null}
            {application.offer ? (
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                {t('owner.offerSummary', { status: t(`owner.offerStatus.${application.offer.status}`) })}
              </Text>
            ) : null}
            <View className="flex-row flex-wrap gap-2">
              {interviewEnabled && !activeInterview ? (
                <HeroButton size="sm" variant="secondary" onPress={() => onOpenAction('interview')} testID={`pipeline-schedule-interview-${application.id}`}>
                  <Ionicons name="calendar-outline" size={15} color={primary} />
                  <HeroButton.Label>{t('owner.scheduleInterview')}</HeroButton.Label>
                </HeroButton>
              ) : null}
              {interviewEnabled && activeInterview ? (
                <HeroButton size="sm" variant="danger" isDisabled={isUpdating} onPress={() => void cancelInterview()} testID={`pipeline-cancel-interview-${application.id}`}>
                  <HeroButton.Label>{t('owner.cancelInterview')}</HeroButton.Label>
                </HeroButton>
              ) : null}
              {offersEnabled && !application.offer ? (
                <HeroButton size="sm" variant="secondary" onPress={() => onOpenAction('offer')} testID={`pipeline-create-offer-${application.id}`}>
                  <Ionicons name="document-text-outline" size={15} color={primary} />
                  <HeroButton.Label>{t('owner.sendOffer')}</HeroButton.Label>
                </HeroButton>
              ) : null}
              {offersEnabled && pendingOffer ? (
                <HeroButton size="sm" variant="danger" isDisabled={isUpdating} onPress={() => void withdrawOffer()} testID={`pipeline-withdraw-offer-${application.id}`}>
                  <HeroButton.Label>{t('owner.withdrawOffer')}</HeroButton.Label>
                </HeroButton>
              ) : null}
            </View>
          </Surface>
        ) : null}
        {/*
          🔴 Every stage is reachable now.

          This used to render `PIPELINE_COLUMNS.filter(…).slice(0, 4)`, which always takes
          the four LOWEST-indexed remaining stages — so Offer, Accepted and Rejected were
          unreachable for anyone past Shortlisted, and an employer who moved a candidate to
          Interview had no way to progress them at all. The fixed "Interview" button beside
          it did nothing once they were already there (`moveTo` returns early, silently),
          and for a pending applicant it rendered Interview twice. Found by the 2026-09-07
          audit (E/F-4).

          Rejecting is the one step that sends bad news, so it confirms first.
        */}
        <View className="flex-row flex-wrap gap-2">
          {nextStatus ? (
            <HeroButton size="sm" variant="primary" isDisabled={isUpdating} onPress={() => void moveTo(nextStatus)} testID={`pipeline-advance-${application.id}`}>
              <AccentIcon name="arrow-forward-outline" size={14} />
              <HeroButton.Label>{t(`applications.status.${nextStatus}`)}</HeroButton.Label>
            </HeroButton>
          ) : null}
          {otherStatuses.map((status) => (
            <HeroButton key={status} size="sm" variant="secondary" isDisabled={isUpdating} onPress={() => void moveTo(status)} testID={`pipeline-move-${status}-${application.id}`}>
              <HeroButton.Label>{t(`applications.status.${status}`)}</HeroButton.Label>
            </HeroButton>
          ))}
          {terminal ? null : (
            <HeroButton size="sm" variant="danger" isDisabled={isUpdating} onPress={confirmReject} testID={`pipeline-reject-${application.id}`}>
              <HeroButton.Label>{t('owner.reject')}</HeroButton.Label>
            </HeroButton>
          )}
        </View>
        {confirmDialog}
      </HeroCard.Body>
    </HeroCard>
  );
}

const INTERVIEW_TYPES = ['video', 'phone', 'in_person'] as const;
const INTERVIEW_DURATIONS = ['30', '45', '60', '90'] as const;
const OFFER_PAY_TYPES = ['hourly', 'monthly', 'annual'] as const;

function HiringActionSheet({
  action,
  defaultCurrency,
  onClose,
  onSuccess,
}: {
  action: HiringAction | null;
  defaultCurrency: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation(['jobs', 'common']);
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const mountedRef = useRef(true);
  const submitPending = useRef(false);
  const { width, fontScale } = useWindowDimensions();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [scheduledAt, setScheduledAt] = useState(() => new Date(Date.now() + 24 * 60 * 60 * 1000));
  const [interviewType, setInterviewType] = useState<(typeof INTERVIEW_TYPES)[number]>('video');
  const [duration, setDuration] = useState('60');
  const [locationNotes, setLocationNotes] = useState('');
  const [offerMessage, setOfferMessage] = useState('');
  const [salary, setSalary] = useState('');
  const [currency, setCurrency] = useState(defaultCurrency.toUpperCase());
  const [salaryType, setSalaryType] = useState<(typeof OFFER_PAY_TYPES)[number]>('annual');
  const [startDate, setStartDate] = useState<Date | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const applicantName = action?.application.applicant?.name?.trim() || t('owner.unknownApplicant');

  function requestClose() {
    if (isSubmitting) return;
    if (!dirty) {
      onClose();
      return;
    }
    confirm({
      title: t('owner.discardActionTitle'),
      message: t('owner.discardActionMessage'),
      confirmLabel: t('owner.discardAction'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      onConfirm: onClose,
    });
  }

  function chooseInterviewDate() {
    if (Platform.OS !== 'android') return;
    DateTimePickerAndroid.open({
      value: scheduledAt,
      mode: 'date',
      minimumDate: new Date(),
      onChange: (event, selectedDate) => {
        if (event.type !== 'set' || !selectedDate) return;
        const next = new Date(selectedDate);
        next.setHours(scheduledAt.getHours(), scheduledAt.getMinutes(), 0, 0);
        DateTimePickerAndroid.open({
          value: next,
          mode: 'time',
          onChange: (timeEvent, selectedTime) => {
            if (timeEvent.type !== 'set' || !selectedTime) return;
            next.setHours(selectedTime.getHours(), selectedTime.getMinutes(), 0, 0);
            setScheduledAt(next);
            setDirty(true);
          },
        });
      },
    });
  }

  function chooseStartDate() {
    if (Platform.OS !== 'android') return;
    DateTimePickerAndroid.open({
      value: startDate ?? new Date(),
      mode: 'date',
      minimumDate: new Date(),
      onChange: (event, selectedDate) => {
        if (event.type !== 'set' || !selectedDate) return;
        setStartDate(selectedDate);
        setDirty(true);
      },
    });
  }

  async function submit() {
    if (!action || submitPending.current) return;
    const application = action.application;
    const kind = action.kind;
    const parsedSalary = salary.trim() === '' ? null : parseDecimalInput(salary);
    if (kind === 'interview' && scheduledAt.getTime() <= Date.now()) {
      showToast({ title: t('owner.checkActionTitle'), description: t('owner.interviewFutureError'), variant: 'warning' });
      return;
    }
    if (kind === 'offer' && !offerMessage.trim()) {
      showToast({ title: t('owner.checkActionTitle'), description: t('owner.offerMessageRequired'), variant: 'warning' });
      return;
    }
    if (kind === 'offer' && salary.trim() !== '' && (parsedSalary === null || parsedSalary <= 0)) {
      showToast({ title: t('owner.checkActionTitle'), description: t('owner.offerSalaryInvalid'), variant: 'warning' });
      return;
    }
    if (kind === 'offer' && parsedSalary !== null && !/^[A-Z]{3}$/.test(currency.trim().toUpperCase())) {
      showToast({ title: t('owner.checkActionTitle'), description: t('owner.offerCurrencyInvalid'), variant: 'warning' });
      return;
    }

    const payload = kind === 'interview'
      ? {
          scheduled_at: scheduledAt.toISOString(),
          interview_type: interviewType,
          duration_mins: Number(duration),
          location_notes: locationNotes.trim() || null,
        }
      : {
          salary_offered: parsedSalary,
          salary_currency: parsedSalary === null ? null : currency.trim().toUpperCase(),
          salary_type: parsedSalary === null ? null : salaryType,
          start_date: startDate ? localDateString(startDate) : null,
          message: offerMessage.trim(),
        };

    submitPending.current = true;
    setIsSubmitting(true);
    try {
      const operation = await reserveJobHiringActionOperation(JSON.stringify([kind, application.id, payload]));
      try {
        if (kind === 'interview') {
          await proposeJobInterview(application.id, { ...payload, idempotency_key: operation.key } as ProposeJobInterviewPayload);
        } else {
          await createJobOffer(application.id, { ...payload, idempotency_key: operation.key } as CreateJobOfferPayload);
        }
      } catch (error) {
        if (!(error instanceof ApiResponseError) || error.status !== 0) throw error;
        const readback = await getJobApplications(application.vacancy_id);
        const latest = readback.data.find((candidate) => candidate.id === application.id);
        if (!latest || !hiringActionMatches(kind, latest, payload)) throw error;
      }
      await completeJobHiringActionOperation(operation);
      if (!mountedRef.current) return;
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (!mountedRef.current) return;
      showToast({
        title: kind === 'interview' ? t('owner.interviewCreated') : t('owner.offerCreated'),
        variant: 'success',
      });
      onSuccess();
    } catch (error) {
      if (!mountedRef.current) return;
      showToast({
        title: t('common:errors.alertTitle'),
        description: describeApiError(error, kind === 'interview' ? t('owner.interviewCreateError') : t('owner.offerCreateError')),
        variant: 'danger',
      });
    } finally {
      submitPending.current = false;
      if (mountedRef.current) setIsSubmitting(false);
    }
  }

  const footer = (
    <View className="flex-row flex-wrap gap-3">
      <HeroButton style={responsiveActionStyle(width, fontScale)} variant="secondary" isDisabled={isSubmitting} onPress={requestClose} testID="hiring-action-cancel">
        <HeroButton.Label>{t('common:buttons.cancel')}</HeroButton.Label>
      </HeroButton>
      <HeroButton style={responsiveActionStyle(width, fontScale)} variant="primary" isDisabled={isSubmitting} onPress={() => void submit()} testID="hiring-action-submit">
        <HeroButton.Label>{isSubmitting ? t('owner.sendingAction') : action?.kind === 'interview' ? t('owner.sendInterview') : t('owner.sendOffer')}</HeroButton.Label>
      </HeroButton>
    </View>
  );

  return (
    <>
      <BottomSheet
        visible={action !== null}
        onClose={requestClose}
        dismissible={!isSubmitting}
        title={action?.kind === 'interview' ? t('owner.scheduleInterviewFor', { name: applicantName }) : t('owner.sendOfferTo', { name: applicantName })}
        snapPoints={['72%', '94%']}
        scrollable
        footer={footer}
        testID="hiring-action-sheet"
      >
        <View className="gap-4 pt-4">
          {action?.kind === 'interview' ? (
            <>
              <View className="gap-2">
                <Text className="text-sm font-semibold" style={{ color: theme.text }}>{t('owner.interviewDateTime')}</Text>
                {Platform.OS === 'ios' ? (
                  <DateTimePicker
                    testID="hiring-interview-datetime-picker"
                    value={scheduledAt}
                    mode="datetime"
                    minimumDate={new Date()}
                    display="spinner"
                    accentColor={primary}
                    themeVariant={theme.bg.toLowerCase() === '#0a0a0f' ? 'dark' : 'light'}
                    onChange={(_event, value) => {
                      if (value) { setScheduledAt(value); setDirty(true); }
                    }}
                  />
                ) : (
                  <HeroButton variant="secondary" onPress={chooseInterviewDate} testID="hiring-interview-datetime">
                    <Ionicons name="calendar-outline" size={18} color={primary} />
                    <HeroButton.Label>{scheduledAt.toLocaleString()}</HeroButton.Label>
                  </HeroButton>
                )}
              </View>
              <ChoiceChips
                label={t('owner.interviewType')}
                options={toOptions(INTERVIEW_TYPES, (value) => t(`owner.interviewTypes.${value}`))}
                selected={interviewType}
                onSelect={(value) => { if (value) { setInterviewType(value); setDirty(true); } }}
              />
              <ChoiceChips
                label={t('owner.interviewDuration')}
                options={toOptions(INTERVIEW_DURATIONS, (value) => t('owner.interviewMinutes', { count: Number(value) }))}
                selected={duration}
                onSelect={(value) => { if (value) { setDuration(value); setDirty(true); } }}
              />
              <Input
                label={t('owner.interviewLocationNotes')}
                placeholder={t('owner.interviewLocationPlaceholder')}
                value={locationNotes}
                onChangeText={(value) => { setLocationNotes(value); setDirty(true); }}
                multiline
                editable={!isSubmitting}
                style={{ minHeight: 96, textAlignVertical: 'top', color: theme.text }}
              />
            </>
          ) : action?.kind === 'offer' ? (
            <>
              <Input
                label={t('owner.offerMessage')}
                placeholder={t('owner.offerMessagePlaceholder')}
                value={offerMessage}
                onChangeText={(value) => { setOfferMessage(value); setDirty(true); }}
                multiline
                editable={!isSubmitting}
                style={{ minHeight: 112, textAlignVertical: 'top', color: theme.text }}
              />
              <Input
                label={t('owner.offerSalary')}
                placeholder={t('owner.offerSalaryPlaceholder')}
                value={salary}
                onChangeText={(value) => { setSalary(value); setDirty(true); }}
                keyboardType="decimal-pad"
                editable={!isSubmitting}
              />
              {salary.trim() ? (
                <>
                  <Input
                    label={t('owner.offerCurrency')}
                    placeholder={t('owner.offerCurrencyPlaceholder')}
                    value={currency}
                    onChangeText={(value) => { setCurrency(value.toUpperCase()); setDirty(true); }}
                    maxLength={3}
                    autoCapitalize="characters"
                    editable={!isSubmitting}
                  />
                  <ChoiceChips
                    label={t('owner.offerPayType')}
                    options={toOptions(OFFER_PAY_TYPES, (value) => t(`create.salaryType.${value}`))}
                    selected={salaryType}
                    onSelect={(value) => { if (value) { setSalaryType(value); setDirty(true); } }}
                  />
                </>
              ) : null}
              <View className="gap-2">
                <Text className="text-sm font-semibold" style={{ color: theme.text }}>{t('owner.offerStartDate')}</Text>
                {Platform.OS === 'ios' ? (
                  <>
                    <HeroButton variant="secondary" onPress={() => { setStartDate(startDate ? null : new Date()); setDirty(true); }}>
                      <HeroButton.Label>{startDate ? t('owner.clearStartDate') : t('owner.addStartDate')}</HeroButton.Label>
                    </HeroButton>
                    {startDate ? (
                      <DateTimePicker
                        testID="hiring-offer-start-date-picker"
                        value={startDate}
                        mode="date"
                        minimumDate={new Date()}
                        display="compact"
                        accentColor={primary}
                        themeVariant={theme.bg.toLowerCase() === '#0a0a0f' ? 'dark' : 'light'}
                        onChange={(_event, value) => {
                          if (value) { setStartDate(value); setDirty(true); }
                        }}
                      />
                    ) : null}
                  </>
                ) : (
                  <HeroButton variant="secondary" onPress={chooseStartDate} testID="hiring-offer-start-date">
                    <Ionicons name="calendar-outline" size={18} color={primary} />
                    <HeroButton.Label>{startDate ? startDate.toLocaleDateString() : t('owner.addStartDate')}</HeroButton.Label>
                  </HeroButton>
                )}
              </View>
            </>
          ) : null}
        </View>
      </BottomSheet>
      {confirmDialog}
    </>
  );
}

function localDateString(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function hiringActionMatches(
  kind: HiringAction['kind'],
  latest: JobOwnerApplication,
  payload: Record<string, unknown>,
): boolean {
  if (kind === 'interview') {
    return Boolean(
      latest.interview
      && Math.abs(new Date(latest.interview.scheduled_at).getTime() - new Date(String(payload.scheduled_at)).getTime()) < 60_000
      && latest.interview.interview_type === payload.interview_type
      && latest.interview.duration_mins === payload.duration_mins,
    );
  }
  return Boolean(
    latest.offer
    && latest.offer.status === 'pending'
    && (latest.offer.message ?? '').trim() === String(payload.message ?? '').trim(),
  );
}

function normalizeStatus(status: string): PipelineStatus {
  if (status === 'applied') return 'pending';
  if (PIPELINE_COLUMNS.includes(status as PipelineStatus)) return status as PipelineStatus;
  return 'pending';
}

export default withRouteGate(JobPipelineScreen, 'job-pipeline');
