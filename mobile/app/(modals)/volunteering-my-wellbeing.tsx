// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Wellbeing check-in — mood, an optional note, and the same "Let someone get in touch
 * with me" choice the website offers (`WellbeingTab.tsx`): shown only at a low mood,
 * ticked by default, sent as `share_with_team`. The score, risk band, warnings, rest
 * days and recent check-ins come from `GET /v2/volunteering/wellbeing`.
 *
 * The check-in form is usable even when the summary fails to load: the summary is a
 * courtesy, the check-in is the point.
 */

import { useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Card as HeroCard, Spinner, Surface } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import Checkbox from '@/components/ui/Checkbox';
import ChoiceChips from '@/components/ui/ChoiceChips';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import RefreshFailedNotice from '@/components/ui/RefreshFailedNotice';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { Chip } from '@/components/ui/StatusChip';
import { Ionicons } from '@/components/ui/Icon';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { useAppToast } from '@/components/ui/AppToast';
import { withRouteGate } from '@/components/withRouteGate';
import { describeApiError } from '@/lib/api/describeApiError';
import {
  getWellbeing,
  LOW_MOOD_MAX,
  submitWellbeingCheckin,
  volunteerSwitchOn,
  WELLBEING_MOODS,
  type WellbeingMood,
} from '@/lib/api/volunteeringVolunteer';
import * as Haptics from '@/lib/haptics';
import { useApi } from '@/lib/hooks/useApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { dateLocale } from '@/lib/utils/dateLocale';

const VOLUNTEERING_HUB = '/(modals)/volunteering' as Href;
const NOTE_MAX = 500;
const MOOD_KEYS: Record<WellbeingMood, 'struggling' | 'low' | 'okay' | 'good' | 'great'> = {
  1: 'struggling', 2: 'low', 3: 'okay', 4: 'good', 5: 'great',
};
type MoodValue = '1' | '2' | '3' | '4' | '5';

function formatDate(value?: string | null, withTime = false) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(dateLocale(), {
    day: 'numeric', month: 'short', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : { year: 'numeric' }),
  }).format(date);
}

/** The website's bands: ≥80 excellent, ≥70 good, ≥50 fair, ≥30 needs attention, else critical. */
function scoreLabelKey(score: number) {
  if (score >= 80) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'fair';
  if (score >= 30) return 'attention';
  return 'critical';
}

function moodKey(mood: number) {
  return MOOD_KEYS[(mood >= 1 && mood <= 5 ? mood : 3) as WellbeingMood];
}

function MyWellbeingScreen() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  return (
    <ModalErrorBoundary key={`${tenant?.id ?? 'no-tenant'}:${user?.id ?? 'no-user'}`}>
      <MyWellbeingContent />
    </ModalErrorBoundary>
  );
}

function StatTile({ label, value, tone, testID }: { label: string; value: string; tone: string; testID?: string }) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;
  return (
    <Surface variant="secondary" testID={testID} className="min-w-[45%] flex-1 rounded-panel-inner p-3.5" style={{ borderWidth: 1, borderColor: withAlpha(tone, 0.14), ...(largeText ? { width: '100%' } : {}) }}>
      <Text className="text-xl font-bold" style={{ color: theme.text }} numberOfLines={largeText ? 0 : 1}>{value}</Text>
      <Text className="mt-1 text-xs font-semibold uppercase leading-4" style={{ color: theme.textSecondary }} numberOfLines={largeText ? 0 : 2}>{label}</Text>
    </Surface>
  );
}

function MyWellbeingContent() {
  const { t } = useTranslation(['volunteeringVolunteer', 'common']);
  const { tenant } = useTenant();
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { show: showToast } = useAppToast();
  const switchedOn = volunteerSwitchOn(tenant?.volunteering_config, 'tab_wellbeing');

  const summaryApi = useApi(() => getWellbeing(), [], { enabled: switchedOn });
  const summary = summaryApi.data?.data ?? null;

  const [mood, setMood] = useState<MoodValue>('3');
  const [note, setNote] = useState('');
  // Ticked by default, as the website's box is: a low mood that is not shared is the
  // member's explicit choice, never the app's silence.
  const [shareWithTeam, setShareWithTeam] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);

  const moodNumber = Number(mood) as WellbeingMood;
  const isLowMood = moodNumber <= LOW_MOOD_MAX;

  async function handleSubmit() {
    if (pending.current) return;
    pending.current = true;
    setSubmitting(true);
    try {
      const result = await submitWellbeingCheckin({ mood: moodNumber, note: note.trim(), share_with_team: isLowMood ? shareWithTeam : false });
      setNote('');
      setMood('3');
      setShareWithTeam(true);
      summaryApi.refresh();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({
        title: t('volunteeringVolunteer:wellbeing.recordedTitle'),
        description: result.data?.team_notified ? t('volunteeringVolunteer:wellbeing.teamNotified') : t('volunteeringVolunteer:wellbeing.recorded'),
        variant: 'success',
      });
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('volunteeringVolunteer:wellbeing.submitError')), variant: 'danger' });
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  }

  if (!switchedOn) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('volunteeringVolunteer:wellbeing.title')} backLabel={t('common:back')} fallbackHref={VOLUNTEERING_HUB} />
        <EmptyState
          icon="heart-circle-outline"
          title={t('volunteeringVolunteer:unavailable.title')}
          subtitle={t('volunteeringVolunteer:unavailable.body')}
          actionLabel={t('volunteeringVolunteer:unavailable.back')}
          onAction={() => router.push(VOLUNTEERING_HUB)}
          testID="wellbeing-switched-off"
        />
      </SafeAreaView>
    );
  }

  const riskKey = summary?.burnout_risk === 'moderate' || summary?.burnout_risk === 'high' ? summary.burnout_risk : 'low';
  const riskTone = riskKey === 'high' ? theme.error : riskKey === 'moderate' ? theme.warning : theme.success;
  const moodOptions = WELLBEING_MOODS.map((value) => ({
    value: String(value) as MoodValue,
    label: t(`volunteeringVolunteer:wellbeing.moods.${MOOD_KEYS[value]}`),
    accessibilityLabel: t('volunteeringVolunteer:wellbeing.moodLabel', { label: t(`volunteeringVolunteer:wellbeing.moods.${MOOD_KEYS[value]}`) }),
  }));

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('volunteeringVolunteer:wellbeing.title')} backLabel={t('common:back')} fallbackHref={VOLUNTEERING_HUB} />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 110, gap: 16 }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={(
          <RefreshControl refreshing={summaryApi.isLoading && summary !== null} onRefresh={summaryApi.refresh} tintColor={primary} colors={[primary]} />
        )}
      >
        <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('volunteeringVolunteer:wellbeing.intro')}</Text>

        <RefreshFailedNotice error={summaryApi.error} onRetry={summaryApi.refresh} isRetrying={summaryApi.isLoading} testID="wellbeing-error" />

        {summaryApi.isLoading && !summary && !summaryApi.error ? <ListSkeleton rows={2} testID="wellbeing-skeleton" /> : null}

        {summary ? (
          <>
            <HeroCard className="overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: withAlpha(riskTone, 0.3) }}>
              <View className="h-1" style={{ backgroundColor: riskTone }} />
              <HeroCard.Body className="gap-3 p-4">
                <View className="flex-row flex-wrap items-center justify-between gap-2">
                  <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>{t('volunteeringVolunteer:wellbeing.score')}</Text>
                  <Chip size="sm" variant="secondary" color="default" testID="wellbeing-risk">
                    <Ionicons name="pulse-outline" size={12} color={riskTone} />
                    <Chip.Label>{t(`volunteeringVolunteer:wellbeing.risk.${riskKey}`)}</Chip.Label>
                  </Chip>
                </View>
                <Text className="text-2xl font-bold" style={{ color: theme.text }} testID="wellbeing-score">
                  {t('volunteeringVolunteer:wellbeing.scoreOutOf', { score: summary.score, label: t(`volunteeringVolunteer:wellbeing.scoreLabels.${scoreLabelKey(summary.score)}`) })}
                </Text>
                <View
                  className="h-2 overflow-hidden rounded-full"
                  style={{ backgroundColor: withAlpha(primary, 0.12) }}
                  accessibilityRole="progressbar"
                  accessibilityValue={{ min: 0, max: 100, now: Math.max(0, Math.min(100, summary.score)) }}
                >
                  <View className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, summary.score))}%`, backgroundColor: riskTone }} />
                </View>
                <View className="flex-row flex-wrap gap-3">
                  <StatTile label={t('volunteeringVolunteer:wellbeing.thisWeek')} value={t('volunteeringVolunteer:wellbeing.hours', { count: summary.hours_this_week })} tone={primary} />
                  <StatTile label={t('volunteeringVolunteer:wellbeing.thisMonth')} value={t('volunteeringVolunteer:wellbeing.hours', { count: summary.hours_this_month })} tone={primary} />
                  <StatTile label={t('volunteeringVolunteer:wellbeing.streak')} value={String(summary.streak_days)} tone="#f59e0b" />
                </View>
              </HeroCard.Body>
            </HeroCard>

            {summary.score < 40 ? (
              <HeroCard className="rounded-panel p-0" style={{ borderWidth: 1, borderColor: withAlpha(theme.warning, 0.3) }} testID="wellbeing-low-score">
                <HeroCard.Body className="gap-2 p-4">
                  <Text className="text-base font-semibold" style={{ color: theme.text }}>{t('volunteeringVolunteer:wellbeing.lowScoreTitle')}</Text>
                  <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('volunteeringVolunteer:wellbeing.lowScoreBody')}</Text>
                </HeroCard.Body>
              </HeroCard>
            ) : null}

            {summary.warnings?.length ? (
              <View className="gap-2">
                <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>{t('volunteeringVolunteer:wellbeing.warningsHeading')}</Text>
                {summary.warnings.map((warning, index) => (
                  <Surface key={`${index}-${warning}`} variant="secondary" className="flex-row items-start gap-2 rounded-panel-inner p-3">
                    <Ionicons name="alert-circle-outline" size={16} color={theme.warning} />
                    <Text className="min-w-0 flex-1 text-sm leading-5" style={{ color: theme.text }}>{warning}</Text>
                  </Surface>
                ))}
              </View>
            ) : null}

            {summary.suggested_rest_days?.length ? (
              <View className="gap-2">
                <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>{t('volunteeringVolunteer:wellbeing.restDays')}</Text>
                <View className="flex-row flex-wrap gap-2">
                  {summary.suggested_rest_days.map((day) => (
                    <Chip key={day} size="md" variant="secondary" color="default">
                      <Ionicons name="bed-outline" size={12} color={primary} />
                      <Chip.Label>{formatDate(day) ?? day}</Chip.Label>
                    </Chip>
                  ))}
                </View>
              </View>
            ) : null}
          </>
        ) : null}

        <HeroCard className="rounded-panel p-0">
          <HeroCard.Body className="gap-4 p-4">
            <Text className="text-base font-semibold" style={{ color: theme.text }} accessibilityRole="header">
              {t('volunteeringVolunteer:wellbeing.checkinHeading')}
            </Text>
            <ChoiceChips<MoodValue>
              options={moodOptions}
              selected={mood}
              onSelect={(value) => { if (value) setMood(value); }}
              testID="wellbeing-mood"
            />
            <Input
              label={t('volunteeringVolunteer:wellbeing.noteLabel')}
              value={note}
              onChangeText={(value) => setNote(value.slice(0, NOTE_MAX))}
              placeholder={t('volunteeringVolunteer:wellbeing.notePlaceholder')}
              placeholderTextColor={theme.textMuted}
              multiline
              maxLength={NOTE_MAX}
              className="min-h-[92px] text-base"
              style={{ color: theme.text, textAlignVertical: 'top' }}
              accessibilityLabel={t('volunteeringVolunteer:wellbeing.noteLabel')}
              editable={!submitting}
              testID="wellbeing-note"
            />
            {isLowMood ? (
              <View className="gap-2" testID="wellbeing-share">
                <Checkbox
                  checked={shareWithTeam}
                  onPress={() => setShareWithTeam((value) => !value)}
                  label={t('volunteeringVolunteer:wellbeing.shareLabel')}
                  disabled={submitting}
                  testID="wellbeing-share-checkbox"
                />
                <Text className="text-xs leading-4" style={{ color: theme.textSecondary }}>
                  {shareWithTeam ? t('volunteeringVolunteer:wellbeing.shareOn') : t('volunteeringVolunteer:wellbeing.shareOff')}
                </Text>
              </View>
            ) : null}
            <HeroButton isDisabled={submitting} onPress={() => void handleSubmit()} testID="wellbeing-submit" accessibilityState={{ busy: submitting }}>
              {submitting ? <Spinner size="sm" /> : null}
              <HeroButton.Label>{t('volunteeringVolunteer:wellbeing.submit')}</HeroButton.Label>
            </HeroButton>
          </HeroCard.Body>
        </HeroCard>

        {summary ? (
          <View className="gap-2">
            <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>{t('volunteeringVolunteer:wellbeing.historyHeading')}</Text>
            {summary.recent_checkins?.length ? summary.recent_checkins.map((item) => (
              <HeroCard key={item.id} className="rounded-panel p-0" testID={`wellbeing-checkin-${item.id}`}>
                <HeroCard.Body className="gap-1 p-4">
                  <View className="flex-row flex-wrap items-center justify-between gap-2">
                    <Text className="text-sm font-semibold" style={{ color: theme.text }}>{t(`volunteeringVolunteer:wellbeing.moods.${moodKey(item.mood)}`)}</Text>
                    <Text className="text-xs" style={{ color: theme.textMuted }}>{formatDate(item.created_at, true) ?? t('volunteeringVolunteer:common.dateUnknown')}</Text>
                  </View>
                  {item.note ? <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{item.note}</Text> : null}
                  {item.shared ? (
                    <Text className="text-xs" style={{ color: primary }}>{t('volunteeringVolunteer:wellbeing.shared')}</Text>
                  ) : null}
                </HeroCard.Body>
              </HeroCard>
            )) : (
              <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('volunteeringVolunteer:wellbeing.historyEmpty')}</Text>
            )}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

export default withRouteGate(MyWellbeingScreen, 'volunteering-my-wellbeing');
