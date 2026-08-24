// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Chip, CloseButton, Surface } from 'heroui-native';
import * as Haptics from '@/lib/haptics';
import { useTranslation } from 'react-i18next';

import { getJobApplications, getJobDetail, applyToJob, saveJob, unsaveJob, getSavedProfile, updateJobApplication, updateJobStatus } from '@/lib/api/jobs';
import { ApiResponseError } from '@/lib/api/client';
import { describeApiError } from '@/lib/api/describeApiError';
import type { JobOwnerApplication, JobVacancy } from '@/lib/api/jobs';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { useAuth } from '@/lib/hooks/useAuth';
import { withAlpha } from '@/lib/utils/color';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import Avatar from '@/components/ui/Avatar';
import BottomSheet from '@/components/ui/BottomSheet';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { dateLocale } from '@/lib/utils/dateLocale';
import AccentIcon from '@/components/ui/AccentIcon';

const WEB_URL = 'https://app.project-nexus.ie';

export default function JobDetailScreen() {
  const { t } = useTranslation(['jobs', 'common']);
  const { id } = useLocalSearchParams<{ id: string }>();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { user } = useAuth();
  const { show: showToast } = useAppToast();

  const jobId = Number(id);
  const safeId = isNaN(jobId) || jobId <= 0 ? 0 : jobId;

  const { data, isLoading, refresh: refreshJob } = useApi(
    () => getJobDetail(safeId),
    [safeId],
    { enabled: safeId > 0 },
  );

  const job = data?.data ?? null;

  const [isSaved, setIsSaved] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [applyModalVisible, setApplyModalVisible] = useState(false);
  const [coverMessage, setCoverMessage] = useState('');
  const [applyLoading, setApplyLoading] = useState(false);
  const [applySuccess, setApplySuccess] = useState(false);
  const [hasApplied, setHasApplied] = useState(false);

  // Saved profile (one-click apply)
  const [savedProfile, setSavedProfile] = useState<{ cv_filename?: string; cover_text?: string } | null>(null);

  // Sync saved/applied state from fetched job
  useEffect(() => {
    if (job) {
      setIsSaved(job.is_saved ?? false);
      setHasApplied(job.has_applied ?? false);
    }
  }, [job]);

  // Load saved profile when apply modal opens
  useEffect(() => {
    if (!applyModalVisible) return;
    getSavedProfile().then((profile) => {
      setSavedProfile(profile);
    }).catch(() => {
      // Silently ignore — saved profile is optional
    });
  }, [applyModalVisible]);

  const isOwner = !!job && user?.id === (job.user_id ?? job.creator.id);
  const ownerApplicationsApi = useApi(
    () => getJobApplications(safeId),
    [safeId, user?.id, job?.user_id, job?.creator?.id],
    { enabled: safeId > 0 && isOwner },
  );

  if (safeId === 0) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar title={t('detailTitle')} backLabel={t('common:back')} fallbackHref="/(modals)/jobs" />
        <EmptyState
          icon="briefcase-outline"
          title={t('detail.invalidId')}
          subtitle={t('detail.invalidIdHint')}
          actionLabel={t('detail.browseJobs')}
          onAction={() => router.replace('/(modals)/jobs')}
        />
      </SafeAreaView>
    );
  }

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar title={t('detailTitle')} backLabel={t('common:back')} fallbackHref="/(modals)/jobs" />
        <View className="flex-1 items-center justify-center" style={{ flex: 1 }}>
          <LoadingSpinner />
        </View>
      </SafeAreaView>
    );
  }

  if (!job) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar title={t('detailTitle')} backLabel={t('common:back')} fallbackHref="/(modals)/jobs" />
        <EmptyState
          icon="briefcase-outline"
          title={t('detail.notFound')}
          subtitle={t('detail.notFoundHint')}
          actionLabel={t('detail.browseJobs')}
          onAction={() => router.replace('/(modals)/jobs')}
        />
      </SafeAreaView>
    );
  }

  async function handleToggleSave() {
    if (!job || saveLoading) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSaveLoading(true);
    try {
      if (isSaved) {
        await unsaveJob(job.id);
        setIsSaved(false);
      } else {
        await saveJob(job.id);
        setIsSaved(true);
      }
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('detail.saveError')), variant: 'danger' });
    } finally {
      setSaveLoading(false);
    }
  }

  async function handleSubmitApplication() {
    if (!job || applyLoading || !coverMessage.trim()) return;
    setApplyLoading(true);
    try {
      await applyToJob(job.id, coverMessage.trim());
      setApplySuccess(true);
      setHasApplied(true);
    } catch (err) {
      // 🔴 The application row is written in the first second of a request that then spends
      // several more sending two emails, so a timeout here does NOT mean nothing happened.
      // Telling the member it failed sends them back to a duplicate refusal. Measured at
      // 9.5s against a 15s mutation timeout on 2026-08-23; see TIMEOUTS.API_JOB_APPLY.
      const noAnswer = err instanceof ApiResponseError && err.status === 0;
      showToast({
        title: t('common:errors.alertTitle'),
        description: noAnswer
          ? t('apply.noAnswerFromServer')
          : describeApiError(err, t('apply.error')),
        variant: 'danger',
      });
    } finally {
      setApplyLoading(false);
    }
  }

  function handleCloseModal() {
    setApplyModalVisible(false);
    setCoverMessage('');
    setApplySuccess(false);
  }

  async function handleShare() {
    if (!job) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await Share.share({
        title: job.title,
        message: `${job.title}\n\n${WEB_URL}/jobs/${job.id}`,
        url: `${WEB_URL}/jobs/${job.id}`,
      });
    } catch {
      // User dismissed share sheet — no error needed
    }
  }

  async function handleToggleVacancyStatus() {
    if (!job) return;
    try {
      await updateJobStatus(job.id, job.status === 'open' ? 'closed' : 'open');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      refreshJob();
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('owner.statusUpdateError')), variant: 'danger' });
    }
  }

  const successColor = theme.success;
  const warningColor = theme.warning;
  const typeColor: Record<JobVacancy['type'], string> = {
    paid: successColor,
    volunteer: primary,
    timebank: warningColor,
  };

  const deadlineDaysLeft = (() => {
    if (!job.deadline) return null;
    const diff = Math.ceil(
      (new Date(job.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );
    return diff;
  })();

  const deadlineLabel = (() => {
    if (deadlineDaysLeft === null) return null;
    if (deadlineDaysLeft < 0) return t('detail.closedBadge');
    if (deadlineDaysLeft === 0) return t('detail.closesToday');
    return t('detail.closesIn', { count: deadlineDaysLeft });
  })();

  const isClosed = job.status !== 'open';

  const matchPct = job.match_percentage ?? null;
  const matchColor =
    matchPct !== null
      ? matchPct >= 70
        ? successColor
        : matchPct >= 40
          ? warningColor
          : theme.error
      : primary;

  const salaryLabel = (() => {
    if (
      job.salary_min !== null &&
      job.salary_max !== null &&
      job.salary_type
    ) {
      const currency = job.salary_currency ?? '€';
      const fmt = (n: number) => `${currency}${n.toLocaleString()}`;
      const typeLabel =
        job.salary_type === 'annual'
          ? t('detail.salaryAnnual')
          : job.salary_type === 'monthly'
            ? t('detail.salaryMonthly')
            : t('detail.salaryHourly');
      return `${fmt(job.salary_min)} – ${fmt(job.salary_max)} / ${typeLabel}`;
    }
    return null;
  })();
  const displayName = job.organization?.name ?? job.creator.name;
  const displayAvatar = job.organization?.logo_url ?? job.creator.avatar_url;
  const compensationLabel = salaryLabel
    ?? (job.time_credits !== null ? t('detail.timeCredits', { count: job.time_credits }) : null);

  return (
    <ModalErrorBoundary>
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar
        title={t('detailTitle')}
        backLabel={t('common:back')}
        fallbackHref="/(modals)/jobs"
        rightAction={{
          accessibilityLabel: t('detail.share'),
          icon: 'share-outline',
          onPress: handleShare,
        }}
      />

      <ScrollView style={{ flex: 1, backgroundColor: theme.bg }} contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingBottom: 132 }}>
        <HeroCard className="mb-4 overflow-hidden rounded-panel p-0">
          <View className="h-1.5" style={{ backgroundColor: isClosed ? theme.textMuted : typeColor[job.type] }} />
          <HeroCard.Body className="gap-4 p-4">
            <View className="flex-row items-start gap-3">
              <View className="size-14 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(typeColor[job.type], 0.14) }}>
                <Ionicons name="briefcase-outline" size={27} color={typeColor[job.type]} />
              </View>
              <View className="min-w-0 flex-1 gap-2">
                <View className="flex-row flex-wrap gap-2">
                  <Chip size="sm" variant="secondary">
                    <Chip.Label>{t(`filters.type.${job.type}`)}</Chip.Label>
                  </Chip>
                  <Chip size="sm" variant="secondary">
                    <Chip.Label>{t(`filters.commitment.${job.commitment}`)}</Chip.Label>
                  </Chip>
                  {job.is_featured ? (
                    <Chip size="sm" variant="secondary" color="warning">
                      <Ionicons name="star-outline" size={12} color={warningColor} />
                      <Chip.Label>{t('card.featured')}</Chip.Label>
                    </Chip>
                  ) : null}
                  {isClosed ? (
                    <Chip size="sm" variant="secondary" color="danger">
                      <Chip.Label>{t('detail.closedBadge')}</Chip.Label>
                    </Chip>
                  ) : null}
                </View>
                <Text className="text-2xl font-bold leading-8" style={{ color: theme.text }}>
                  {job.title}
                </Text>
              </View>
            </View>

            <Surface variant="secondary" className="flex-row items-center gap-3 rounded-panel-inner p-3">
              <Avatar uri={displayAvatar} name={displayName} size={40} />
              <View className="min-w-0 flex-1">
                <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>
                  {t('detail.postedBy')}
                </Text>
                <Text className="text-base font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                  {displayName}
                </Text>
              </View>
            </Surface>

            <View className="flex-row flex-wrap gap-2">
              {matchPct !== null ? (
                <Chip size="sm" variant="secondary">
                  <Ionicons name="sparkles-outline" size={12} color={matchColor} />
                  <Chip.Label>{t('detail.matchPercentage', { percentage: matchPct })}</Chip.Label>
                </Chip>
              ) : null}
              <Chip size="sm" variant="secondary">
                <Ionicons name="people-outline" size={12} color={theme.textSecondary} />
                <Chip.Label>{t('card.applications', { count: job.applications_count })}</Chip.Label>
              </Chip>
              <Chip size="sm" variant="secondary">
                <Ionicons name="eye-outline" size={12} color={theme.textSecondary} />
                <Chip.Label>{t('detail.views', { count: job.views_count })}</Chip.Label>
              </Chip>
            </View>
          </HeroCard.Body>
        </HeroCard>

        <HeroCard className="mb-4 rounded-panel p-0">
          <HeroCard.Body className="gap-3 p-4">
            <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>
              {t('detail.keyDetails')}
            </Text>
            <MetaRow icon="briefcase-outline" text={t(`filters.type.${job.type}`)} tint={typeColor[job.type]} theme={theme} />
            <MetaRow icon="repeat-outline" text={t(`filters.commitment.${job.commitment}`)} theme={theme} />
            {job.is_remote ? (
              <MetaRow icon="wifi-outline" text={t('card.remote')} theme={theme} tint={primary} />
            ) : job.location ? (
              <MetaRow icon="location-outline" text={job.location} theme={theme} />
            ) : null}
            {compensationLabel ? (
              <MetaRow
                icon={salaryLabel ? 'cash-outline' : 'time-outline'}
                text={compensationLabel}
                theme={theme}
                tint={salaryLabel ? successColor : warningColor}
              />
            ) : null}
            {deadlineLabel ? (
              <MetaRow
                icon="calendar-outline"
                text={deadlineLabel}
                theme={theme}
                tint={deadlineDaysLeft !== null && deadlineDaysLeft < 7 ? theme.error : undefined}
              />
            ) : null}
            {job.category ? (
              <MetaRow icon="folder-open-outline" text={job.category} theme={theme} />
            ) : null}
          </HeroCard.Body>
        </HeroCard>

        {(job.skills ?? []).length > 0 ? (
          <DetailSection title={t('detail.skills')} theme={theme}>
            <View className="flex-row flex-wrap gap-2">
              {(job.skills ?? []).map((skill) => (
                <Chip key={skill} size="sm" variant="secondary">
                  <Chip.Label>{skill}</Chip.Label>
                </Chip>
              ))}
            </View>
          </DetailSection>
        ) : null}

        {job.description ? (
          <DetailSection title={t('detail.description')} theme={theme}>
            <Text className="text-sm leading-6" style={{ color: theme.text }}>
              {job.description}
            </Text>
          </DetailSection>
        ) : null}

        {isOwner ? (
          <>
            <OwnerToolsSection
              job={job}
              primary={primary}
              theme={theme}
              t={t}
              onEdit={() => router.push({ pathname: '/(modals)/edit-job', params: { id: String(job.id) } } as unknown as Href)}
              onAnalytics={() => router.push({ pathname: '/(modals)/job-analytics', params: { id: String(job.id) } } as unknown as Href)}
              onPipeline={() => router.push({ pathname: '/(modals)/job-pipeline', params: { id: String(job.id) } } as unknown as Href)}
              onToggleStatus={() => void handleToggleVacancyStatus()}
            />
            <OwnerApplicationsSection
              applications={Array.isArray(ownerApplicationsApi.data?.data) ? ownerApplicationsApi.data.data : []}
              isLoading={ownerApplicationsApi.isLoading}
              error={ownerApplicationsApi.error}
              onRefresh={ownerApplicationsApi.refresh}
              primary={primary}
              theme={theme}
              t={t}
            />
          </>
        ) : null}
      </ScrollView>

      <Surface variant="default" className="absolute bottom-0 left-0 right-0 gap-3 border-t border-border px-4 pb-5 pt-3">
        <View className="flex-row gap-2">
          {isOwner ? (
            <HeroButton
              className="flex-1"
              variant="secondary"
              accessibilityLabel={t('detail.edit')}
              onPress={() => router.push({ pathname: '/(modals)/edit-job', params: { id: String(job.id) } } as unknown as Href)}
            >
              <Ionicons name="create-outline" size={17} color={primary} />
              <HeroButton.Label>{t('detail.edit')}</HeroButton.Label>
            </HeroButton>
          ) : null}
          <HeroButton
            className="flex-1"
            variant="secondary"
            accessibilityLabel={t('detail.share')}
            onPress={() => void handleShare()}
          >
            <Ionicons name="share-outline" size={17} color={theme.textSecondary} />
            <HeroButton.Label>{t('detail.share')}</HeroButton.Label>
          </HeroButton>
          <HeroButton
            className="flex-1"
            variant="secondary"
            accessibilityLabel={isSaved ? t('detail.saved') : t('detail.save')}
            isDisabled={saveLoading}
            onPress={() => void handleToggleSave()}
          >
            <Ionicons name={isSaved ? 'bookmark' : 'bookmark-outline'} size={17} color={primary} />
            <HeroButton.Label>{isSaved ? t('detail.saved') : t('detail.save')}</HeroButton.Label>
          </HeroButton>
        </View>
        {/* Only the DISABLED tone is set below. The enabled branch used to repeat the
            community colour, which variant="primary" already paints — and repeating it meant
            the fill and the label came from different sources. */}
        <HeroButton
          variant="primary"
          accessibilityLabel={hasApplied ? t('detail.applied') : t('detail.apply')}
          isDisabled={hasApplied || isClosed}
          onPress={() => {
            if (!hasApplied && !isClosed) setApplyModalVisible(true);
          }}
          style={hasApplied || isClosed ? { backgroundColor: theme.textMuted } : undefined}
        >
          <AccentIcon name={hasApplied ? 'checkmark-circle' : 'send-outline'} size={18} />
          <HeroButton.Label>{hasApplied ? t('detail.applied') : t('detail.apply')}</HeroButton.Label>
        </HeroButton>
      </Surface>

      {/* Apply sheet */}
      <BottomSheet visible={applyModalVisible} onClose={handleCloseModal} snapPoints={['72%', '92%']}>
        <View style={{ flex: 1, backgroundColor: theme.bg }}>
            <View className="flex-row items-center justify-between px-5 py-3 border-b border-border/50">
              <CloseButton onPress={handleCloseModal} accessibilityLabel={t('common:close')} iconProps={{ size: 24, color: theme.text }} />
              <Text className="text-base font-bold text-foreground flex-1 text-center mx-2">
                {t('apply.title', { jobTitle: job.title })}
              </Text>
              <View style={{ width: 44 }} />
            </View>

            {applySuccess ? (
              <View className="items-center justify-center p-10">
                <Ionicons name="checkmark-circle" size={64} color={successColor} />
                <Text className="text-xl font-bold text-foreground mt-5">{t('apply.success')}</Text>
                <Text className="text-sm text-muted-foreground text-center mt-2">{t('apply.successMessage')}</Text>
                <HeroButton
                  className="mt-6 w-full"
                  variant="primary"
                  onPress={handleCloseModal}
                >
                  <HeroButton.Label>{t('detail.goBack')}</HeroButton.Label>
                </HeroButton>
              </View>
            ) : (
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: 20, paddingBottom: 32 }}
                keyboardShouldPersistTaps="handled"
              >
                {/* Saved profile one-click apply */}
                {savedProfile?.cover_text ? (
                  <HeroButton
                    variant="secondary"
                    style={{
                      backgroundColor: withAlpha(primary, 0.10),
                      alignSelf: 'flex-start',
                      marginBottom: 12,
                    }}
                    onPress={() => setCoverMessage(savedProfile.cover_text ?? '')}
                  >
                    <Ionicons name="flash-outline" size={14} color={primary} />
                    <HeroButton.Label>{t('saved_profile.use')}</HeroButton.Label>
                  </HeroButton>
                ) : null}

                <Text className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
                  {t('apply.messageLabel')}
                </Text>
                <Input
                  style={{ color: theme.text, textAlignVertical: 'top' }}
                  className="min-h-[140px] text-sm"
                  placeholder={t('apply.messagePlaceholder')}
                  placeholderTextColor={theme.textMuted}
                  value={coverMessage}
                  onChangeText={setCoverMessage}
                  multiline
                  numberOfLines={6}
                  textAlignVertical="top"
                  autoFocus
                  accessibilityLabel={t('apply.messageLabel')}
                />

                <HeroButton
                  className="mt-5"
                  variant="primary"
                  style={{
                    backgroundColor:
                      coverMessage.trim().length === 0 || applyLoading
                        ? theme.textMuted
                        : primary,
                  }}
                  onPress={() => void handleSubmitApplication()}
                  isDisabled={coverMessage.trim().length === 0 || applyLoading}
                >
                  {applyLoading ? (
                    <LoadingSpinner />
                  ) : (
                    <HeroButton.Label>{t('apply.submit')}</HeroButton.Label>
                  )}
                </HeroButton>
              </ScrollView>
            )}
        </View>
      </BottomSheet>
    </SafeAreaView>
    </ModalErrorBoundary>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function MetaRow({
  icon,
  text,
  theme,
  tint,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  text: string;
  theme: ReturnType<typeof useTheme>;
  tint?: string;
}) {
  return (
    <View className="flex-row items-center gap-2.5">
      <Ionicons name={icon} size={16} color={tint ?? theme.textSecondary} />
      <Text style={{ color: tint ?? theme.text }} className="flex-1 text-sm">{text}</Text>
    </View>
  );
}

function DetailSection({
  title,
  children,
  theme,
}: {
  title: string;
  children: React.ReactNode;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <HeroCard className="mb-4 rounded-panel p-0">
      <HeroCard.Body className="gap-3 p-4">
        <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>
          {title}
        </Text>
        {children}
      </HeroCard.Body>
    </HeroCard>
  );
}

function OwnerToolsSection({
  job,
  primary,
  theme,
  t,
  onEdit,
  onAnalytics,
  onPipeline,
  onToggleStatus,
}: {
  job: JobVacancy;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onEdit: () => void;
  onAnalytics: () => void;
  onPipeline: () => void;
  onToggleStatus: () => void;
}) {
  const statusTone = job.status === 'open' ? theme.success : theme.warning;
  return (
    <HeroCard className="mb-4 rounded-panel p-0">
      <HeroCard.Body className="gap-4 p-4">
        <View className="flex-row items-start gap-3">
          <View className="size-11 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
            <Ionicons name="briefcase-outline" size={21} color={primary} />
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('owner.toolsTitle')}</Text>
            <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
              {job.applications_count > 0
                ? t('owner.hasApplicants', { count: job.applications_count })
                : t('owner.noApplicants')}
            </Text>
          </View>
          <Chip size="sm" variant="secondary">
            <Ionicons name={job.status === 'open' ? 'checkmark-circle-outline' : 'pause-circle-outline'} size={13} color={statusTone} />
            <Chip.Label>{t(`owner.status.${job.status}`)}</Chip.Label>
          </Chip>
        </View>

        <View className="flex-row flex-wrap gap-2">
          <HeroButton size="sm" variant="secondary" onPress={onEdit}>
            <Ionicons name="create-outline" size={14} color={primary} />
            <HeroButton.Label>{t('detail.edit')}</HeroButton.Label>
          </HeroButton>
          <HeroButton size="sm" variant="secondary" onPress={onAnalytics}>
            <Ionicons name="analytics-outline" size={14} color={primary} />
            <HeroButton.Label>{t('detail.analytics')}</HeroButton.Label>
          </HeroButton>
          <HeroButton size="sm" variant="secondary" onPress={onPipeline}>
            <Ionicons name="git-network-outline" size={14} color={primary} />
            <HeroButton.Label>{t('detail.kanban_board')}</HeroButton.Label>
          </HeroButton>
          <HeroButton size="sm" variant={job.status === 'open' ? 'secondary' : 'primary'} onPress={onToggleStatus}>
            <Ionicons name={job.status === 'open' ? 'close-circle-outline' : 'refresh-outline'} size={14} color={job.status === 'open' ? theme.error : '#fff'} />
            <HeroButton.Label>{job.status === 'open' ? t('detail.close_vacancy') : t('detail.reopen_vacancy')}</HeroButton.Label>
          </HeroButton>
        </View>
      </HeroCard.Body>
    </HeroCard>
  );
}

function OwnerApplicationsSection({
  applications,
  isLoading,
  error,
  onRefresh,
  primary,
  theme,
  t,
}: {
  applications: JobOwnerApplication[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  return (
    <HeroCard className="mb-4 rounded-panel p-0">
      <HeroCard.Body className="gap-3 p-4">
        <View className="flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>
              {t('owner.applicationsTitle')}
            </Text>
            <Text className="text-sm" style={{ color: theme.textSecondary }}>
              {t('owner.applicationsSubtitle')}
            </Text>
          </View>
          <Chip size="sm" variant="secondary">
            <Chip.Label>{t('owner.applicationsCount', { count: applications.length })}</Chip.Label>
          </Chip>
        </View>

        {isLoading ? (
          <LoadingSpinner />
        ) : error ? (
          <View className="gap-2">
            <Text className="text-sm" style={{ color: theme.error }}>{error}</Text>
            <HeroButton size="sm" variant="secondary" onPress={onRefresh}>
              <HeroButton.Label>{t('retry')}</HeroButton.Label>
            </HeroButton>
          </View>
        ) : applications.length === 0 ? (
          <Surface variant="secondary" className="rounded-panel-inner p-4">
            <Text className="text-sm font-semibold" style={{ color: theme.text }}>{t('owner.noApplications')}</Text>
            <Text className="mt-1 text-sm" style={{ color: theme.textSecondary }}>{t('owner.noApplicationsHint')}</Text>
          </Surface>
        ) : (
          <View className="gap-3">
            {applications.slice(0, 5).map((application) => (
              <OwnerApplicationCard
                key={application.id}
                application={application}
                primary={primary}
                theme={theme}
                t={t}
                onUpdated={onRefresh}
              />
            ))}
          </View>
        )}
      </HeroCard.Body>
    </HeroCard>
  );
}

function OwnerApplicationCard({
  application,
  primary,
  theme,
  t,
  onUpdated,
}: {
  application: JobOwnerApplication;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onUpdated: () => void;
}) {
  const { show: showToast } = useAppToast();
  const [isUpdating, setIsUpdating] = useState(false);
  const applicantName = application.applicant?.name?.trim() || t('owner.unknownApplicant');
  const submitted = application.created_at
    ? new Date(application.created_at).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
    : '';

  async function updateStatus(status: JobOwnerApplication['status']) {
    if (isUpdating) return;
    setIsUpdating(true);
    try {
      await updateJobApplication(application.id, { status });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onUpdated();
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('owner.updateError')), variant: 'danger' });
    } finally {
      setIsUpdating(false);
    }
  }

  return (
    <Surface variant="secondary" className="gap-3 rounded-panel-inner p-3">
      <View className="flex-row items-start gap-3">
        <Avatar uri={application.applicant?.avatar_url ?? null} name={applicantName} size={38} />
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-sm font-bold" style={{ color: theme.text }} numberOfLines={1}>{applicantName}</Text>
          {submitted ? <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('owner.appliedOn', { date: submitted })}</Text> : null}
        </View>
        <Chip size="sm" variant="secondary">
          <Chip.Label>{t(`applications.status.${application.status}`)}</Chip.Label>
        </Chip>
      </View>
      {application.message ? (
        <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={3}>
          {application.message}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        <HeroButton size="sm" variant="secondary" isDisabled={isUpdating} onPress={() => void updateStatus('reviewed')}>
          <HeroButton.Label>{t('owner.markReviewed')}</HeroButton.Label>
        </HeroButton>
        <HeroButton size="sm" variant="secondary" isDisabled={isUpdating} onPress={() => void updateStatus('shortlisted')}>
          <HeroButton.Label>{t('owner.shortlist')}</HeroButton.Label>
        </HeroButton>
        <HeroButton size="sm" variant="secondary" isDisabled={isUpdating} onPress={() => void updateStatus('rejected')}>
          <Ionicons name="close-circle-outline" size={14} color={theme.error} />
          <HeroButton.Label>{t('owner.reject')}</HeroButton.Label>
        </HeroButton>
        <HeroButton size="sm" variant="primary" isDisabled={isUpdating} onPress={() => void updateStatus('interview')}>
          <AccentIcon name="calendar-outline" size={14} />
          <HeroButton.Label>{t('owner.moveToInterview')}</HeroButton.Label>
        </HeroButton>
      </View>
    </Surface>
  );
}
