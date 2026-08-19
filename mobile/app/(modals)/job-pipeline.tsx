// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button as HeroButton, Card as HeroCard, Chip, Surface, Tabs } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import { getJobApplications, updateJobApplication } from '@/lib/api/jobs';
import type { JobOwnerApplication } from '@/lib/api/jobs';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import * as Haptics from '@/lib/haptics';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import AccentIcon from '@/components/ui/AccentIcon';

const PIPELINE_COLUMNS = ['pending', 'screening', 'reviewed', 'shortlisted', 'interview', 'offer', 'accepted', 'rejected'] as const;
type PipelineStatus = (typeof PIPELINE_COLUMNS)[number];

export default function JobPipelineScreen() {
  const { t } = useTranslation(['jobs', 'common']);
  const { id } = useLocalSearchParams<{ id: string }>();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const jobId = Number(id);
  const safeId = Number.isFinite(jobId) && jobId > 0 ? jobId : 0;
  const [selectedStatus, setSelectedStatus] = useState<PipelineStatus>('pending');

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
      acc[status] = applications.filter((application) => normalizeStatus(application.status) === status);
      return acc;
    }, {} as Record<PipelineStatus, JobOwnerApplication[]>);
  }, [applications]);

  if (safeId === 0) {
    return (
      <SafeAreaView className="flex-1 bg-background">
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
      <SafeAreaView className="flex-1 bg-background">
        <AppTopBar title={t('kanban.pipeline_title')} backLabel={t('common:back')} fallbackHref="/(modals)/jobs" />
        <View className="flex-1 items-center justify-center">
          <LoadingSpinner />
        </View>
      </SafeAreaView>
    );
  }

  if (applicationsApi.error) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <AppTopBar title={t('kanban.pipeline_title')} backLabel={t('common:back')} fallbackHref="/(modals)/jobs" />
        <EmptyState
          icon="git-network-outline"
          title={applicationsApi.error}
          subtitle={t('kanban.load_error_hint')}
          actionLabel={t('retry')}
          onAction={applicationsApi.refresh}
        />
      </SafeAreaView>
    );
  }

  const selectedApplications = grouped[selectedStatus] ?? [];

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background">
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

        <ScrollView contentContainerStyle={{ gap: 16, padding: 16, paddingBottom: 32 }}>
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
                />
              ))}
            </View>
          )}
        </ScrollView>
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
    <HeroButton
      className="min-w-[46%] flex-1"
      variant={active ? 'primary' : 'secondary'}
      onPress={onPress}
    >
      <HeroButton.Label>{t(`applications.status.${status}`)}</HeroButton.Label>
      <Chip size="sm" variant="secondary">
        <Chip.Label>{count}</Chip.Label>
      </Chip>
    </HeroButton>
  );
}

function PipelineApplicationCard({
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
  const currentStatus = normalizeStatus(application.status);

  async function moveTo(status: PipelineStatus) {
    if (isUpdating || status === currentStatus) return;
    setIsUpdating(true);
    try {
      await updateJobApplication(application.id, { status });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onUpdated();
    } catch {
      showToast({ title: t('common:errors.alertTitle'), description: t('owner.updateError'), variant: 'danger' });
    } finally {
      setIsUpdating(false);
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
        <View className="flex-row flex-wrap gap-2">
          {PIPELINE_COLUMNS.filter((status) => status !== currentStatus).slice(0, 4).map((status) => (
            <HeroButton key={status} size="sm" variant="secondary" isDisabled={isUpdating} onPress={() => void moveTo(status)}>
              <HeroButton.Label>{t(`applications.status.${status}`)}</HeroButton.Label>
            </HeroButton>
          ))}
          <HeroButton size="sm" variant="primary" isDisabled={isUpdating} onPress={() => void moveTo('interview')}>
            <AccentIcon name="calendar-outline" size={14} />
            <HeroButton.Label>{t('owner.moveToInterview')}</HeroButton.Label>
          </HeroButton>
        </View>
      </HeroCard.Body>
    </HeroCard>
  );
}

function normalizeStatus(status: JobOwnerApplication['status']): PipelineStatus {
  if (status === 'applied') return 'pending';
  if (PIPELINE_COLUMNS.includes(status as PipelineStatus)) return status as PipelineStatus;
  return 'pending';
}
