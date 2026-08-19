// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FlatList,
  View,
  Text,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button as HeroButton, Card as HeroCard, Chip, Surface } from 'heroui-native';
import * as Haptics from '@/lib/haptics';
import { useTranslation } from 'react-i18next';

import {
  getJobs,
  getMyApplications,
  getMyPostings,
  getJobAlerts,
  createJobAlert,
  deleteJobAlert,
  pauseJobAlert,
  resumeJobAlert,
  getJobApplicationHistory,
  withdrawJobApplication,
  acceptInterview,
  declineInterview,
  acceptOffer,
  rejectOffer,
  type JobVacancy,
  type JobApplication,
  type JobAlert,
  type JobApplicationHistoryEntry,
  type JobsResponse,
  type ApplicationsResponse,
  type CreateJobAlertPayload,
} from '@/lib/api/jobs';
import { useApi } from '@/lib/hooks/useApi';
import { usePaginatedApi } from '@/lib/hooks/usePaginatedApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import NativePressable from '@/components/ui/NativePressable';
import SearchInput from '@/components/ui/SearchInput';
import Toggle from '@/components/ui/Toggle';
import { dateLocale } from '@/lib/utils/dateLocale';

// ---------------------------------------------------------------------------
// Type filter options
// ---------------------------------------------------------------------------

const JOB_TYPES = ['', 'paid', 'volunteer', 'timebank'] as const;
const ALERT_JOB_TYPES = ['paid', 'volunteer', 'timebank'] as const;
const COMMITMENT_TYPES = ['', 'full_time', 'part_time', 'flexible', 'one_off'] as const;
const ALERT_COMMITMENT_TYPES = ['full_time', 'part_time', 'flexible', 'one_off'] as const;
type JobsTab = 'browse' | 'myApplications' | 'myPostings' | 'alerts';

// ---------------------------------------------------------------------------
// Job card component
// ---------------------------------------------------------------------------

function JobCard({
  item,
  primary,
  theme,
  t,
  onPress,
}: {
  item: JobVacancy;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onPress: () => void;
}) {
  const successColor = theme.success ?? '#22c55e';
  const warningColor = theme.warning ?? '#f59e0b';
  const typeColor =
    item.type === 'paid'
      ? successColor
      : item.type === 'volunteer'
        ? primary
        : warningColor;

  const deadlineStr = item.deadline
    ? t('card.deadline', {
        date: new Date(item.deadline).toLocaleDateString(dateLocale(), {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
      })
    : null;

  const displayName = item.organization?.name ?? item.creator.name;

  const salaryStr = (() => {
    if (item.salary_min !== null && item.salary_max !== null && item.salary_type) {
      const currency = item.salary_currency ?? '€';
      const fmt = (n: number) =>
        n >= 1000 ? `${currency}${Math.round(n / 1000)}k` : `${currency}${n}`;
      const typeKey =
        item.salary_type === 'annual'
          ? 'yr'
          : item.salary_type === 'monthly'
            ? 'mo'
            : 'hr';
      return `${fmt(item.salary_min)} – ${fmt(item.salary_max)} / ${typeKey}`;
    }
    return null;
  })();

  const allSkills = item.skills ?? [];
  const visibleSkills = allSkills.slice(0, 3);

  return (
    <NativePressable
      className="w-full p-0"
      onPress={onPress}
      accessibilityLabel={item.title}
      feedback="highlight"
    >
      <HeroCard className="mb-3 overflow-hidden rounded-panel p-0">
        <View className="h-1.5" style={{ backgroundColor: item.is_featured ? warningColor : typeColor }} />
        <HeroCard.Body className="gap-3 p-4">
          <View className="flex-row items-start gap-3">
            <View className="size-12 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(typeColor, 0.14) }}>
              <Ionicons name="briefcase-outline" size={23} color={typeColor} />
            </View>
            <View className="min-w-0 flex-1 gap-1">
              <View className="flex-row flex-wrap gap-2">
                {item.is_featured ? (
                  <Chip size="sm" variant="secondary" color="warning">
                    <Ionicons name="star-outline" size={12} color={warningColor} />
                    <Chip.Label>{t('card.featured')}</Chip.Label>
                  </Chip>
                ) : null}
                <Chip size="sm" variant="secondary">
                  <Chip.Label>{t(`filters.type.${item.type}`)}</Chip.Label>
                </Chip>
              </View>
              <Text className="text-base font-bold" style={{ color: theme.text }} numberOfLines={2}>
                {item.title}
              </Text>
              <Text className="text-sm" style={{ color: theme.textSecondary }} numberOfLines={1}>
                {displayName}
              </Text>
            </View>
            <Ionicons name="chevron-forward-outline" size={18} color={primary} />
          </View>

          <View className="flex-row flex-wrap gap-2">
            {item.is_remote ? (
              <Chip size="sm" variant="secondary">
                <Ionicons name="wifi-outline" size={12} color={primary} />
                <Chip.Label>{t('card.remote')}</Chip.Label>
              </Chip>
            ) : item.location ? (
              <Chip size="sm" variant="secondary">
                <Ionicons name="location-outline" size={12} color={primary} />
                <Chip.Label>{item.location}</Chip.Label>
              </Chip>
            ) : null}

            {salaryStr ? (
              <Chip size="sm" variant="secondary">
                <Ionicons name="cash-outline" size={12} color={successColor} />
                <Chip.Label>{salaryStr}</Chip.Label>
              </Chip>
            ) : null}

            {deadlineStr ? (
              <Chip size="sm" variant="secondary">
                <Ionicons name="calendar-outline" size={12} color={theme.textSecondary} />
                <Chip.Label>{deadlineStr}</Chip.Label>
              </Chip>
            ) : null}

            <Chip size="sm" variant="secondary">
              <Ionicons name="people-outline" size={12} color={theme.textSecondary} />
              <Chip.Label>{t('card.applications', { count: item.applications_count })}</Chip.Label>
            </Chip>
          </View>

          {visibleSkills.length > 0 ? (
            <View className="flex-row flex-wrap gap-1.5">
              {visibleSkills.map((skill) => (
                <Chip key={skill} size="sm" variant="secondary">
                  <Chip.Label>{skill}</Chip.Label>
                </Chip>
              ))}
              {allSkills.length > 3 ? (
                <Chip size="sm" variant="secondary">
                  <Chip.Label>+{allSkills.length - 3}</Chip.Label>
                </Chip>
              ) : null}
            </View>
          ) : null}
        </HeroCard.Body>
      </HeroCard>
    </NativePressable>
  );
}

function JobsHero({
  primary,
  theme,
  t,
}: {
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string) => string;
}) {
  return (
    <HeroCard className="mb-3 overflow-hidden rounded-panel p-0">
      <View className="h-1.5" style={{ backgroundColor: primary }} />
      <HeroCard.Body className="gap-4 p-4 pt-0">
        <View className="flex-row items-start gap-3">
          <View className="size-13 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
            <Ionicons name="briefcase-outline" size={25} color={primary} />
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('eyebrow')}</Text>
            <Text className="text-2xl font-bold" style={{ color: theme.text }}>{t('title')}</Text>
            <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('subtitle')}</Text>
          </View>
        </View>
      </HeroCard.Body>
    </HeroCard>
  );
}

function FilterPill({
  label,
  selected,
  onPress,
  primary,
  theme,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  primary: string;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <HeroButton
      size="sm"
      variant={selected ? 'primary' : 'secondary'}
      onPress={onPress}
    >
      <HeroButton.Label>{label}</HeroButton.Label>
      {selected ? <Ionicons name="checkmark-outline" size={13} color="#fff" /> : <Ionicons name="add-outline" size={13} color={theme.textSecondary} />}
    </HeroButton>
  );
}

// ---------------------------------------------------------------------------
// Application card component
// ---------------------------------------------------------------------------

function ApplicationCard({
  item,
  theme,
  t,
  primary,
  onApplicationChanged,
  onInterviewAccepted,
  onInterviewDeclined,
  onOfferAccepted,
  onOfferRejected,
}: {
  item: JobApplication;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
  primary: string;
  onApplicationChanged: () => void;
  onInterviewAccepted: (interviewId: number) => void;
  onInterviewDeclined: (interviewId: number) => void;
  onOfferAccepted: (offerId: number) => void;
  onOfferRejected: (offerId: number) => void;
}) {
  const [actionLoading, setActionLoading] = useState(false);
  const [messageExpanded, setMessageExpanded] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [history, setHistory] = useState<JobApplicationHistoryEntry[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const statusColor: Record<JobApplication['status'], string> = {
    pending: theme.warning,
    screening: theme.info,
    reviewed: theme.info,
    interview: theme.info,
    offer: theme.warning,
    accepted: theme.success,
    rejected: theme.error,
    withdrawn: theme.textMuted,
  };

  const color = statusColor[item.status];
  const jobTitle = item.vacancy?.title ?? String(item.vacancy_id);
  const orgName = item.vacancy?.organization?.name ?? item.vacancy?.creator?.name ?? null;

  const appliedStr = t('applications.appliedOn', {
    date: new Date(item.created_at).toLocaleDateString(dateLocale(), {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
  });

  const interview = item.interview ?? null;
  const offer = item.offer ?? null;
  const isActive = ['pending', 'screening', 'reviewed', 'interview', 'offer'].includes(item.status);

  const handleToggleHistory = async () => {
    const nextOpen = !historyExpanded;
    setHistoryExpanded(nextOpen);
    if (!nextOpen || history.length > 0) return;

    setHistoryLoading(true);
    try {
      const response = await getJobApplicationHistory(item.id);
      setHistory(Array.isArray(response.data) ? response.data : []);
    } catch {
      setStatusMessage(t('applications.historyError'));
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleWithdraw = async () => {
    setActionLoading(true);
    setStatusMessage(null);
    try {
      await withdrawJobApplication(item.id);
      setStatusMessage(t('applications.withdrawSuccess'));
      onApplicationChanged();
    } catch {
      setStatusMessage(t('applications.withdrawError'));
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <View className="bg-surface rounded-2xl p-4 mb-3 border border-border/50 gap-2">
      <View className="flex-row items-start gap-2">
        <Text className="flex-1 text-sm font-semibold text-foreground" numberOfLines={2}>
          {jobTitle}
        </Text>
        <View style={{ backgroundColor: color + '22' }} className="rounded px-2 py-0.5 self-start">
          <Text style={{ color }} className="text-[11px] font-semibold">
            {t(`applications.status.${item.status}`)}
          </Text>
        </View>
      </View>
      {orgName ? (
        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
          {orgName}
        </Text>
      ) : null}
      <View className="flex-row items-center gap-1">
        <Ionicons name="calendar-outline" size={13} color={theme.textMuted} />
        <Text className="text-[11px] text-muted-foreground">{appliedStr}</Text>
      </View>

      {item.message ? (
        <View className="gap-2">
          <HeroButton
            size="sm"
            variant="ghost"
            className="self-start rounded-lg"
            onPress={() => setMessageExpanded((value) => !value)}
            accessibilityLabel={messageExpanded ? t('applications.hideMessage') : t('applications.showMessage')}
          >
            <Ionicons name={messageExpanded ? 'chevron-up-outline' : 'chevron-down-outline'} size={15} color={theme.textSecondary} />
            <HeroButton.Label>{messageExpanded ? t('applications.hideMessage') : t('applications.showMessage')}</HeroButton.Label>
          </HeroButton>
          {messageExpanded ? (
            <Surface variant="secondary" className="rounded-panel-inner p-3">
              <Text className="text-sm leading-5 text-foreground">{item.message}</Text>
            </Surface>
          ) : null}
        </View>
      ) : null}

      {/* Interview actions */}
      {interview?.status === 'proposed' ? (
        <View className="mt-2.5 pt-2.5 border-t border-border">
          <Text className="text-xs font-medium text-muted-foreground mb-1.5">
            {t('applications.interview_proposed')}
          </Text>
          <View className="flex-row gap-2">
            <HeroButton
              size="sm"
              variant="primary"
              className="rounded-lg"
              isDisabled={actionLoading}
              onPress={async () => {
                setActionLoading(true);
                const ok = await acceptInterview(interview.id);
                setActionLoading(false);
                if (ok) onInterviewAccepted(interview.id);
              }}
              accessibilityLabel={t('applications.accept_interview')}
            >
              <HeroButton.Label>{t('applications.accept_interview')}</HeroButton.Label>
            </HeroButton>
            <HeroButton
              size="sm"
              variant="danger"
              className="rounded-lg"
              isDisabled={actionLoading}
              onPress={async () => {
                setActionLoading(true);
                const ok = await declineInterview(interview.id);
                setActionLoading(false);
                if (ok) onInterviewDeclined(interview.id);
              }}
              accessibilityLabel={t('applications.decline_interview')}
            >
              <HeroButton.Label>{t('applications.decline_interview')}</HeroButton.Label>
            </HeroButton>
          </View>
        </View>
      ) : interview?.status === 'accepted' ? (
        <View className="mt-2">
          <View style={{ backgroundColor: theme.success + '22' }} className="rounded px-2 py-0.5 self-start">
            <Text style={{ color: theme.success }} className="text-[11px] font-semibold">
              {t('applications.interview_confirmed')}
            </Text>
          </View>
        </View>
      ) : null}

      {/* Offer actions */}
      {offer?.status === 'pending' ? (
        <View className="mt-2.5 pt-2.5 border-t border-border">
          <Text className="text-xs font-medium text-muted-foreground mb-1.5">
            {t('applications.offer_received')}
          </Text>
          <View className="flex-row gap-2">
            <HeroButton
              size="sm"
              variant="primary"
              className="rounded-lg"
              style={{ backgroundColor: theme.success }}
              isDisabled={actionLoading}
              onPress={async () => {
                setActionLoading(true);
                const ok = await acceptOffer(offer.id);
                setActionLoading(false);
                if (ok) onOfferAccepted(offer.id);
              }}
              accessibilityLabel={t('applications.accept_offer')}
            >
              <HeroButton.Label>{t('applications.accept_offer')}</HeroButton.Label>
            </HeroButton>
            <HeroButton
              size="sm"
              variant="danger"
              className="rounded-lg"
              isDisabled={actionLoading}
              onPress={async () => {
                setActionLoading(true);
                const ok = await rejectOffer(offer.id);
                setActionLoading(false);
                if (ok) onOfferRejected(offer.id);
              }}
              accessibilityLabel={t('applications.decline_offer')}
            >
              <HeroButton.Label>{t('applications.decline_offer')}</HeroButton.Label>
            </HeroButton>
          </View>
        </View>
      ) : offer?.status === 'accepted' ? (
        <View className="mt-2">
          <View style={{ backgroundColor: theme.success + '22' }} className="rounded px-2 py-0.5 self-start">
            <Text style={{ color: theme.success }} className="text-[11px] font-semibold">
              {t('applications.offer_accepted')}
            </Text>
          </View>
        </View>
      ) : null}

      {statusMessage ? (
        <Text className="text-xs text-muted-foreground" accessibilityLiveRegion="polite">{statusMessage}</Text>
      ) : null}

      <View className="mt-1 flex-row flex-wrap gap-2 border-t border-border pt-2.5">
        <HeroButton
          size="sm"
          variant="secondary"
          className="rounded-lg"
          onPress={handleToggleHistory}
          accessibilityLabel={t('applications.history')}
        >
          <Ionicons name="time-outline" size={15} color={theme.textSecondary} />
          <HeroButton.Label>{t('applications.history')}</HeroButton.Label>
        </HeroButton>
        {isActive ? (
          <HeroButton
            size="sm"
            variant="danger"
            className="rounded-lg"
            isDisabled={actionLoading}
            onPress={handleWithdraw}
            accessibilityLabel={t('applications.withdraw')}
          >
            <Ionicons name="close-circle-outline" size={15} color="#fff" />
            <HeroButton.Label>{t('applications.withdraw')}</HeroButton.Label>
          </HeroButton>
        ) : null}
      </View>

      {historyExpanded ? (
        <Surface variant="secondary" className="mt-1 rounded-panel-inner p-3">
          <Text className="mb-2 text-xs font-bold uppercase text-muted-foreground">{t('applications.history')}</Text>
          {historyLoading ? (
            <LoadingSpinner />
          ) : history.length === 0 ? (
            <Text className="text-xs text-muted-foreground">{t('applications.historyEmpty')}</Text>
          ) : (
            <View className="gap-2">
              {history.map((entry) => (
                <View key={entry.id} className="gap-0.5 border-l-2 border-border pl-3">
                  <Text className="text-sm font-semibold text-foreground">
                    {t('applications.historyTransition', {
                      from: entry.from_status ? t(`applications.status.${entry.from_status}`) : t('applications.historyStart'),
                      to: t(`applications.status.${entry.to_status}`),
                    })}
                  </Text>
                  <Text className="text-[11px] text-muted-foreground">
                    {new Date(entry.changed_at).toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </Surface>
      ) : null}
    </View>
  );
}

function JobAlertCard({
  alert,
  theme,
  t,
  onToggle,
  onDelete,
  isBusy,
}: {
  alert: JobAlert;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onToggle: (alert: JobAlert) => void;
  onDelete: (id: number) => void;
  isBusy: boolean;
}) {
  const created = t('alerts.createdDate', {
    date: new Date(alert.created_at).toLocaleDateString(dateLocale(), {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
  });
  const notified = t('alerts.lastNotified', {
    date: alert.last_notified_at
      ? new Date(alert.last_notified_at).toLocaleDateString(dateLocale(), {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : t('alerts.never'),
  });

  return (
    <HeroCard className="mb-3 rounded-panel p-0">
      <HeroCard.Body className="gap-3 p-4">
        <View className="flex-row items-start gap-3">
          <View className="size-11 items-center justify-center rounded-3xl bg-primary/10">
            <Ionicons name="notifications-outline" size={21} color={alert.is_active ? theme.success : theme.textMuted} />
          </View>
          <View className="min-w-0 flex-1 gap-2">
            <View className="flex-row flex-wrap gap-2">
              <Chip size="sm" variant="secondary" color={alert.is_active ? 'success' : 'warning'}>
                <Chip.Label>{alert.is_active ? t('alerts.active') : t('alerts.paused')}</Chip.Label>
              </Chip>
              {alert.type ? (
                <Chip size="sm" variant="secondary">
                  <Chip.Label>{t(`filters.type.${alert.type}`)}</Chip.Label>
                </Chip>
              ) : null}
              {alert.commitment ? (
                <Chip size="sm" variant="secondary">
                  <Chip.Label>{t(`filters.commitment.${alert.commitment}`)}</Chip.Label>
                </Chip>
              ) : null}
              {alert.is_remote_only ? (
                <Chip size="sm" variant="secondary">
                  <Ionicons name="wifi-outline" size={12} color={theme.textSecondary} />
                  <Chip.Label>{t('alerts.remoteOnlyShort')}</Chip.Label>
                </Chip>
              ) : null}
            </View>

            <View className="gap-1">
              {alert.keywords ? (
                <Text className="text-sm font-semibold text-foreground">{alert.keywords}</Text>
              ) : null}
              {alert.categories ? (
                <Text className="text-xs text-muted-foreground">{alert.categories}</Text>
              ) : null}
              {alert.location ? (
                <Text className="text-xs text-muted-foreground">{alert.location}</Text>
              ) : null}
              {!alert.keywords && !alert.categories && !alert.location ? (
                <Text className="text-sm font-semibold text-foreground">{t('alerts.anyMatch')}</Text>
              ) : null}
            </View>

            <Text className="text-[11px] text-muted-foreground">{created} - {notified}</Text>
          </View>
        </View>

        <View className="flex-row gap-2">
          <HeroButton
            size="sm"
            variant="secondary"
            isDisabled={isBusy}
            onPress={() => onToggle(alert)}
            accessibilityLabel={alert.is_active ? t('alerts.pause') : t('alerts.resume')}
          >
            <Ionicons name={alert.is_active ? 'pause-outline' : 'play-outline'} size={15} color={theme.textSecondary} />
            <HeroButton.Label>{alert.is_active ? t('alerts.pause') : t('alerts.resume')}</HeroButton.Label>
          </HeroButton>
          <HeroButton
            size="sm"
            variant="danger"
            isDisabled={isBusy}
            onPress={() => onDelete(alert.id)}
            accessibilityLabel={t('alerts.delete')}
          >
            <Ionicons name="trash-outline" size={15} color="#fff" />
            <HeroButton.Label>{t('alerts.delete')}</HeroButton.Label>
          </HeroButton>
        </View>
      </HeroCard.Body>
    </HeroCard>
  );
}

function JobAlertsPanel({
  alerts,
  isLoading,
  error,
  onRefresh,
  theme,
  primary,
  t,
}: {
  alerts: JobAlert[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  theme: ReturnType<typeof useTheme>;
  primary: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const [keywords, setKeywords] = useState('');
  const [categories, setCategories] = useState('');
  const [location, setLocation] = useState('');
  const [alertType, setAlertType] = useState<JobAlert['type']>(null);
  const [alertCommitment, setAlertCommitment] = useState<JobAlert['commitment']>(null);
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const resetForm = () => {
    setKeywords('');
    setCategories('');
    setLocation('');
    setAlertType(null);
    setAlertCommitment(null);
    setRemoteOnly(false);
  };

  const handleCreate = async () => {
    const payload: CreateJobAlertPayload = {};
    if (keywords.trim()) payload.keywords = keywords.trim();
    if (categories.trim()) payload.categories = categories.trim();
    if (location.trim()) payload.location = location.trim();
    if (alertType) payload.type = alertType;
    if (alertCommitment) payload.commitment = alertCommitment;
    if (remoteOnly) payload.is_remote_only = true;

    setBusyKey('create');
    setStatusMessage(null);
    try {
      await createJobAlert(payload);
      resetForm();
      setStatusMessage(t('alerts.createSuccess'));
      onRefresh();
    } catch {
      setStatusMessage(t('alerts.createError'));
    } finally {
      setBusyKey(null);
    }
  };

  const handleToggle = async (alert: JobAlert) => {
    setBusyKey(`toggle-${alert.id}`);
    setStatusMessage(null);
    try {
      if (alert.is_active) {
        await pauseJobAlert(alert.id);
        setStatusMessage(t('alerts.pauseSuccess'));
      } else {
        await resumeJobAlert(alert.id);
        setStatusMessage(t('alerts.resumeSuccess'));
      }
      onRefresh();
    } catch {
      setStatusMessage(t('alerts.toggleError'));
    } finally {
      setBusyKey(null);
    }
  };

  const handleDelete = async (id: number) => {
    setBusyKey(`delete-${id}`);
    setStatusMessage(null);
    try {
      await deleteJobAlert(id);
      setStatusMessage(t('alerts.deleteSuccess'));
      onRefresh();
    } catch {
      setStatusMessage(t('alerts.deleteError'));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <FlatList<JobAlert>
      data={alerts}
      keyExtractor={(item) => String(item.id)}
      onRefresh={onRefresh}
      refreshing={isLoading && alerts.length > 0}
      renderItem={({ item }) => (
        <JobAlertCard
          alert={item}
          theme={theme}
          t={t}
          isBusy={busyKey === `toggle-${item.id}` || busyKey === `delete-${item.id}`}
          onToggle={handleToggle}
          onDelete={handleDelete}
        />
      )}
      ListHeaderComponent={(
        <View className="gap-3 pb-3">
          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="gap-4 p-4">
              <View className="flex-row items-start gap-3">
                <View className="size-11 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                  <Ionicons name="notifications-outline" size={21} color={primary} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-base font-bold text-foreground">{t('alerts.title')}</Text>
                  <Text className="text-sm text-muted-foreground">{t('alerts.subtitle')}</Text>
                </View>
              </View>

              <Input
                label={t('alerts.keywordsLabel')}
                placeholder={t('alerts.keywordsPlaceholder')}
                value={keywords}
                onChangeText={setKeywords}
                autoCorrect={false}
                autoCapitalize="none"
              />
              <Input
                label={t('alerts.categoriesLabel')}
                placeholder={t('alerts.categoriesPlaceholder')}
                value={categories}
                onChangeText={setCategories}
                autoCorrect={false}
              />
              <Input
                label={t('alerts.locationLabel')}
                placeholder={t('alerts.locationPlaceholder')}
                value={location}
                onChangeText={setLocation}
                autoCorrect={false}
              />

              <View className="gap-2">
                <Text className="text-xs font-bold uppercase text-muted-foreground">{t('alerts.typeLabel')}</Text>
                <View className="flex-row flex-wrap gap-2">
                  {ALERT_JOB_TYPES.map((type) => (
                    <FilterPill
                      key={type}
                      label={t(`filters.type.${type}`)}
                      selected={alertType === type}
                      onPress={() => setAlertType(alertType === type ? null : type)}
                      primary={primary}
                      theme={theme}
                    />
                  ))}
                </View>
              </View>

              <View className="gap-2">
                <Text className="text-xs font-bold uppercase text-muted-foreground">{t('alerts.commitmentLabel')}</Text>
                <View className="flex-row flex-wrap gap-2">
                  {ALERT_COMMITMENT_TYPES.map((commitment) => (
                    <FilterPill
                      key={commitment}
                      label={t(`filters.commitment.${commitment}`)}
                      selected={alertCommitment === commitment}
                      onPress={() => setAlertCommitment(alertCommitment === commitment ? null : commitment)}
                      primary={primary}
                      theme={theme}
                    />
                  ))}
                </View>
              </View>

              <Toggle value={remoteOnly} onValueChange={setRemoteOnly} label={t('alerts.remoteOnly')} />

              {statusMessage ? (
                <Text className="text-sm text-muted-foreground" accessibilityLiveRegion="polite">{statusMessage}</Text>
              ) : null}

              <HeroButton
                variant="primary"
                onPress={handleCreate}
                isDisabled={busyKey === 'create'}
                accessibilityLabel={t('alerts.create')}
              >
                <Ionicons name="add-outline" size={17} color="#fff" />
                <HeroButton.Label>{busyKey === 'create' ? t('alerts.creating') : t('alerts.create')}</HeroButton.Label>
              </HeroButton>
            </HeroCard.Body>
          </HeroCard>

          {error ? (
            <EmptyState
              icon="warning-outline"
              title={t('alerts.loadError')}
              subtitle={error}
              actionLabel={t('retry')}
              onAction={onRefresh}
            />
          ) : null}
        </View>
      )}
      ListEmptyComponent={
        isLoading ? (
          <LoadingSpinner />
        ) : error ? null : (
          <EmptyState
            icon="notifications-outline"
            title={t('alerts.emptyTitle')}
            subtitle={t('alerts.emptyDescription')}
          />
        )
      }
      contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingBottom: 112, paddingTop: 4 }}
    />
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function JobsScreen() {
  const { t } = useTranslation(['jobs', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();

  const [activeTab, setActiveTab] = useState<JobsTab>('browse');
  const [search, setSearch] = useState('');
  const [committedSearch, setCommittedSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [commitmentFilter, setCommitmentFilter] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleSearchChange(text: string) {
    setSearch(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setCommittedSearch(text.trim());
    }, 400);
  }

  function handleClear() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearch('');
    setCommittedSearch('');
  }

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Browse tab — paginated job list
  const jobFetchFn = useCallback(
    (cursor: string | null) =>
      getJobs({
        cursor,
        search: committedSearch || undefined,
        type: typeFilter || undefined,
        commitment: commitmentFilter || undefined,
      }),
    [committedSearch, typeFilter, commitmentFilter],
  );

  const jobExtractor = useCallback(
    (response: JobsResponse) => ({
      items: response.data,
      cursor: response.meta.cursor,
      hasMore: response.meta.has_more,
    }),
    [],
  );

  const {
    items: jobs,
    isLoading: jobsLoading,
    isLoadingMore: jobsLoadingMore,
    error: jobsError,
    hasMore: jobsHasMore,
    loadMore: loadMoreJobs,
    refresh: refreshJobs,
  } = usePaginatedApi<JobVacancy, JobsResponse>(jobFetchFn, jobExtractor, [
    committedSearch,
    typeFilter,
    commitmentFilter,
  ]);

  // My Applications tab — paginated
  const appFetchFn = useCallback(
    (cursor: string | null) => getMyApplications({ cursor }),
    [],
  );

  const appExtractor = useCallback(
    (response: ApplicationsResponse) => ({
      items: response.data,
      cursor: response.meta.cursor,
      hasMore: response.meta.has_more,
    }),
    [],
  );

  const {
    items: applications,
    isLoading: appsLoading,
    isLoadingMore: appsLoadingMore,
    error: appsError,
    hasMore: appsHasMore,
    loadMore: loadMoreApps,
    refresh: refreshApps,
  } = usePaginatedApi<JobApplication, ApplicationsResponse>(appFetchFn, appExtractor, []);

  // My Postings tab — owner-facing parity with the React web jobs page.
  const postingsFetchFn = useCallback(
    (cursor: string | null) => getMyPostings({ cursor }),
    [],
  );

  const {
    items: postings,
    isLoading: postingsLoading,
    isLoadingMore: postingsLoadingMore,
    error: postingsError,
    hasMore: postingsHasMore,
    loadMore: loadMorePostings,
    refresh: refreshPostings,
  } = usePaginatedApi<JobVacancy, JobsResponse>(postingsFetchFn, jobExtractor, []);

  const alertsApi = useApi(() => getJobAlerts(), []);
  const alerts = alertsApi.data?.data ?? [];

  const renderJob = useCallback(
    ({ item }: { item: JobVacancy }) => (
      <JobCard
        item={item}
        primary={primary}
        theme={theme}
        t={t}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push({
            pathname: '/(modals)/job-detail',
            params: { id: String(item.id) },
          });
        }}
      />
    ),
    [primary, theme, t],
  );

  // Update an application's interview status locally (avoid full refresh)
  const handleInterviewAccepted = useCallback((interviewId: number) => {
    // The FlatList data comes from usePaginatedApi — trigger a refresh
    void refreshApps();
    void interviewId; // used to potentially update local state in future
  }, [refreshApps]);

  const handleInterviewDeclined = useCallback((interviewId: number) => {
    void refreshApps();
    void interviewId;
  }, [refreshApps]);

  const handleOfferAccepted = useCallback((offerId: number) => {
    void refreshApps();
    void offerId;
  }, [refreshApps]);

  const handleOfferRejected = useCallback((offerId: number) => {
    void refreshApps();
    void offerId;
  }, [refreshApps]);

  const renderApplication = useCallback(
    ({ item }: { item: JobApplication }) => (
      <ApplicationCard
        item={item}
        theme={theme}
        t={t}
        primary={primary}
        onApplicationChanged={refreshApps}
        onInterviewAccepted={handleInterviewAccepted}
        onInterviewDeclined={handleInterviewDeclined}
        onOfferAccepted={handleOfferAccepted}
        onOfferRejected={handleOfferRejected}
      />
    ),
    [theme, t, primary, refreshApps, handleInterviewAccepted, handleInterviewDeclined, handleOfferAccepted, handleOfferRejected],
  );

  return (
    <ModalErrorBoundary>
    <SafeAreaView className="flex-1 bg-background">
      <AppTopBar
        title={t('title')}
        backLabel={t('common:back')}
        fallbackHref="/(tabs)/profile"
        rightAction={{
          accessibilityLabel: t('createJob'),
          icon: 'add-outline',
          onPress: () => router.push('/(modals)/new-job' as Href),
        }}
      />

      <View className="px-4">
        <JobsHero primary={primary} theme={theme} t={t} />
      </View>

      <Surface variant="secondary" className="mx-4 mb-3 rounded-panel-inner p-1">
        {/* Tab bar */}
        <View className="min-w-0 flex-row gap-1">
          {(['browse', 'myApplications', 'myPostings', 'alerts'] as const).map((tab) => {
            const selected = activeTab === tab;
            return (
              <HeroButton
                key={tab}
                size="sm"
                variant={selected ? 'primary' : 'ghost'}
                className="min-w-0 flex-1 rounded-panel-inner"
                style={{ backgroundColor: selected ? primary : 'transparent' }}
                onPress={() => setActiveTab(tab)}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={t(`tabs.${tab}`)}
              >
                <HeroButton.Label
                  style={{ color: selected ? '#fff' : theme.textSecondary }}
                  numberOfLines={1}
                >
                  {t(`tabs.${tab}`)}
                </HeroButton.Label>
              </HeroButton>
            );
          })}
        </View>
      </Surface>

      {activeTab === 'browse' ? (
        <>
          {/* Search bar */}
          <Surface variant="secondary" className="mx-4 mb-3 rounded-panel-inner px-3 pt-3">
            <SearchInput
              placeholder={t('search.placeholder')}
              value={search}
              onChangeText={(value) => {
                if (value.length === 0) {
                  handleClear();
                  return;
                }
                handleSearchChange(value);
              }}
              clearLabel={t('common:actions.clear')}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
              accessibilityLabel={t('search.placeholder')}
              containerClassName="mb-0"
            />
          </Surface>

          {/* Filter row */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8, gap: 8, flexDirection: 'row', alignItems: 'center' }}
          >
            {JOB_TYPES.map((type) => (
              <FilterPill
                key={type || 'all-type'}
                label={t(type ? `filters.type.${type}` : 'filters.type.all')}
                selected={typeFilter === type}
                onPress={() => setTypeFilter(type)}
                primary={primary}
                theme={theme}
              />
            ))}
            <View className="w-px h-5 bg-border mx-1" />
            {COMMITMENT_TYPES.map((commitment) => (
              <FilterPill
                key={commitment || 'all-commitment'}
                label={t(
                    commitment
                      ? `filters.commitment.${commitment}`
                      : 'filters.commitment.all',
                )}
                selected={commitmentFilter === commitment}
                onPress={() => setCommitmentFilter(commitment)}
                primary={primary}
                theme={theme}
              />
            ))}
          </ScrollView>

          <FlatList<JobVacancy>
            data={jobs}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderJob}
            onEndReached={jobsHasMore ? loadMoreJobs : undefined}
            onEndReachedThreshold={0.3}
            refreshControl={
              <RefreshControl
                refreshing={jobsLoading && jobs.length > 0}
                onRefresh={refreshJobs}
                tintColor={primary}
              />
            }
            ListEmptyComponent={
              jobsLoading ? (
                <LoadingSpinner />
              ) : jobsError ? (
                <View className="flex-1 justify-center items-center p-10">
                  <Text className="text-sm text-danger text-center">{jobsError}</Text>
                  <HeroButton variant="secondary" size="sm" onPress={refreshJobs} className="mt-3">
                    <HeroButton.Label>{t('retry')}</HeroButton.Label>
                  </HeroButton>
                </View>
              ) : (
                <EmptyState
                  icon="briefcase-outline"
                  title={t('empty')}
                  subtitle={t('emptyHint')}
                />
              )
            }
            ListFooterComponent={
              jobsLoadingMore ? (
                <View className="py-4">
                  <LoadingSpinner />
                </View>
              ) : null
            }
            contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingBottom: 112, paddingTop: 4 }}
          />
        </>
      ) : activeTab === 'myApplications' ? (
        <FlatList<JobApplication>
          data={applications}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderApplication}
          onEndReached={appsHasMore ? loadMoreApps : undefined}
          onEndReachedThreshold={0.3}
          refreshControl={
            <RefreshControl
              refreshing={appsLoading && applications.length > 0}
              onRefresh={refreshApps}
              tintColor={primary}
            />
          }
          ListEmptyComponent={
            appsLoading ? (
              <LoadingSpinner />
            ) : appsError ? (
              <View className="flex-1 justify-center items-center p-10">
                <Text className="text-sm text-danger text-center">{appsError}</Text>
                <HeroButton variant="secondary" size="sm" onPress={refreshApps} className="mt-3">
                  <HeroButton.Label>{t('retry')}</HeroButton.Label>
                </HeroButton>
              </View>
            ) : (
              <EmptyState
                icon="document-text-outline"
                title={t('applications.empty')}
                subtitle={t('applications.emptyHint')}
              />
            )
          }
          ListFooterComponent={
            appsLoadingMore ? (
              <View className="py-4">
                <LoadingSpinner />
              </View>
            ) : null
          }
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingBottom: 112, paddingTop: 4 }}
        />
      ) : activeTab === 'myPostings' ? (
        <FlatList<JobVacancy>
          data={postings}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderJob}
          onEndReached={postingsHasMore ? loadMorePostings : undefined}
          onEndReachedThreshold={0.3}
          refreshControl={
            <RefreshControl
              refreshing={postingsLoading && postings.length > 0}
              onRefresh={refreshPostings}
              tintColor={primary}
            />
          }
          ListEmptyComponent={
            postingsLoading ? (
              <LoadingSpinner />
            ) : postingsError ? (
              <View className="flex-1 justify-center items-center p-10">
                <Text className="text-sm text-danger text-center">{postingsError}</Text>
                <HeroButton variant="secondary" size="sm" onPress={refreshPostings} className="mt-3">
                  <HeroButton.Label>{t('retry')}</HeroButton.Label>
                </HeroButton>
              </View>
            ) : (
              <EmptyState
                icon="briefcase-outline"
                title={t('postings.empty')}
                subtitle={t('postings.emptyHint')}
              />
            )
          }
          ListFooterComponent={
            postingsLoadingMore ? (
              <View className="py-4">
                <LoadingSpinner />
              </View>
            ) : null
          }
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingBottom: 112, paddingTop: 4 }}
        />
      ) : (
        <JobAlertsPanel
          alerts={alerts}
          isLoading={alertsApi.isLoading}
          error={alertsApi.error}
          onRefresh={alertsApi.refresh}
          theme={theme}
          primary={primary}
          t={t}
        />
      )}
    </SafeAreaView>
    </ModalErrorBoundary>
  );
}
