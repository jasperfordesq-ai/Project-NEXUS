// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Set up or change REPEATING shifts on an opportunity the member manages.
 *
 * Same rules as the website's PatternFormModal: weekly and fortnightly patterns need at
 * least one chosen weekday (the server refuses an empty list — before 6 Oct 2026 it made
 * a shift every day instead), times are "HH:MM", places is a whole number of 1 or more.
 *
 * Editing: the server applies a change to WHEN the pattern repeats to its future shifts
 * straight away and answers with shifts_removed / shifts_kept / shifts_generated. That is
 * shown to the organiser rather than swallowed — a booked shift is kept, which they
 * would otherwise only learn from the list.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import ChoiceChips from '@/components/ui/ChoiceChips';
import EmptyState from '@/components/ui/EmptyState';
import FormActionFooter from '@/components/ui/FormActionFooter';
import { FormHero, FormSection } from '@/components/ui/FormSection';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { useConfirm } from '@/components/ui/useConfirm';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { withRouteGate } from '@/components/withRouteGate';
import {
  createRecurringPattern,
  getRecurringPatterns,
  isValidDateOnly,
  normaliseClock,
  todayDateOnly,
  unwrapList,
  updateRecurringPattern,
  type PatternFrequency,
  type PatternPayload,
  type RecurringPattern,
} from '@/lib/api/volunteeringOrganiser';
import { describeApiError } from '@/lib/api/describeApiError';
import { isRefusal } from '@/lib/api/refusal';
import * as Haptics from '@/lib/haptics';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import { dateLocale } from '@/lib/utils/dateLocale';

const VOLUNTEERING_TONE = '#e11d48';
const FREQUENCIES: PatternFrequency[] = ['daily', 'weekly', 'biweekly', 'monthly'];
/** ISO weekday numbers, Monday first, as the server stores them. */
const WEEKDAYS = ['1', '2', '3', '4', '5', '6', '7'] as const;
type WeekdayKey = (typeof WEEKDAYS)[number];

function parseId(value?: string | string[]): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** Weekday names in the member's language. 2024-01-01 was a Monday. */
function weekdayName(iso: number, style: 'short' | 'long'): string {
  return new Intl.DateTimeFormat(dateLocale(), { weekday: style }).format(new Date(2024, 0, iso));
}

function PatternFormScreen() {
  const { t } = useTranslation(['volunteeringOrganiser', 'common']);
  const params = useLocalSearchParams<{ opportunityId?: string; patternId?: string }>();
  const opportunityId = parseId(params.opportunityId);
  const patternId = parseId(params.patternId);
  const isEditing = patternId !== null;
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();

  const [frequency, setFrequency] = useState<PatternFrequency>('weekly');
  const [days, setDays] = useState<WeekdayKey[]>([]);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [capacity, setCapacity] = useState('1');
  const [startDate, setStartDate] = useState(() => todayDateOnly());
  const [endDate, setEndDate] = useState('');
  const [maxOccurrences, setMaxOccurrences] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);
  const [hydrated, setHydrated] = useState(!isEditing);
  const [loadFailed, setLoadFailed] = useState<'refused' | 'missing' | 'failed' | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const submitPending = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!isEditing || !opportunityId || !patternId) return;
    let cancelled = false;
    setLoadFailed(null);
    getRecurringPatterns(opportunityId)
      .then((response) => {
        if (cancelled || !mountedRef.current) return;
        const pattern = unwrapList<RecurringPattern>(response?.data, 'patterns').find((p) => p.id === patternId);
        if (!pattern) {
          setLoadFailed('missing');
          return;
        }
        setFrequency(pattern.frequency);
        setDays(pattern.days_of_week.map(String).filter((d): d is WeekdayKey => (WEEKDAYS as readonly string[]).includes(d)));
        setStart(normaliseClock(pattern.start_time) ?? pattern.start_time.slice(0, 5));
        setEnd(normaliseClock(pattern.end_time) ?? pattern.end_time.slice(0, 5));
        setCapacity(String(pattern.capacity || 1));
        setStartDate(pattern.start_date.slice(0, 10));
        setEndDate(pattern.end_date ? pattern.end_date.slice(0, 10) : '');
        setMaxOccurrences(pattern.max_occurrences ? String(pattern.max_occurrences) : '');
        setHydrated(true);
      })
      .catch((err: unknown) => {
        if (cancelled || !mountedRef.current) return;
        setLoadFailed(isRefusal(err) ? 'refused' : 'failed');
      });
    return () => { cancelled = true; };
  }, [isEditing, opportunityId, patternId, retryToken]);

  const usesDays = frequency === 'weekly' || frequency === 'biweekly';

  const fingerprint = JSON.stringify([frequency, days, start, end, capacity, startDate, endDate, maxOccurrences]);
  const baselineRef = useRef<string | null>(null);
  if (!isEditing && baselineRef.current === null) baselineRef.current = fingerprint;
  useEffect(() => {
    if (isEditing && hydrated && baselineRef.current === null) baselineRef.current = fingerprint;
  }, [fingerprint, hydrated, isEditing]);
  const isDirty = baselineRef.current !== null && fingerprint !== baselineRef.current;
  useUnsavedChangesGuard({
    isDirty,
    isSaving: isSubmitting,
    hasSaved,
    confirm,
    title: t('patternForm.unsavedTitle'),
    message: t('patternForm.unsavedMessage'),
    discardLabel: t('patternForm.discard'),
    cancelLabel: t('common:buttons.cancel'),
  });

  const validation = useMemo((): string | null => {
    if (!startDate.trim() || !start.trim() || !end.trim()) return t('patternForm.required');
    if (!isValidDateOnly(startDate) || (endDate.trim() !== '' && !isValidDateOnly(endDate))) return t('patternForm.invalidDate');
    const startClock = normaliseClock(start);
    const endClock = normaliseClock(end);
    if (!startClock || !endClock) return t('patternForm.invalidTime');
    if (endClock <= startClock) return t('patternForm.endBeforeStart');
    if (endDate.trim() !== '' && endDate.trim() < startDate.trim()) return t('patternForm.endDateBeforeStart');
    if (!/^\d+$/.test(capacity.trim()) || Number(capacity) < 1) return t('patternForm.invalidPlaces');
    if (maxOccurrences.trim() !== '' && (!/^\d+$/.test(maxOccurrences.trim()) || Number(maxOccurrences) < 1)) return t('patternForm.invalidPlaces');
    if (usesDays && days.length === 0) return t('patternForm.daysRequired');
    return null;
  }, [capacity, days.length, end, endDate, maxOccurrences, start, startDate, t, usesDays]);

  const requiredFilled = startDate.trim().length > 0 && start.trim().length > 0 && end.trim().length > 0 && hydrated;

  async function submit() {
    if (submitPending.current || !opportunityId) return;
    if (validation) {
      showToast({ title: t('common:errors.alertTitle'), description: validation, variant: 'warning' });
      return;
    }
    const payload: PatternPayload = {
      frequency,
      start_time: `${normaliseClock(start) as string}:00`,
      end_time: `${normaliseClock(end) as string}:00`,
      capacity: Number(capacity.trim()),
      start_date: startDate.trim(),
      // Weekdays only mean something for weekly and fortnightly patterns — the website sends them only then.
      ...(usesDays ? { days_of_week: days.map(Number).sort((a, b) => a - b) } : {}),
      end_date: endDate.trim() || null,
      max_occurrences: maxOccurrences.trim() ? Number(maxOccurrences.trim()) : null,
    };
    submitPending.current = true;
    setIsSubmitting(true);
    try {
      if (isEditing && patternId) {
        const result = await updateRecurringPattern(patternId, payload);
        const data = result?.data;
        const reconciled = data && typeof data.shifts_removed === 'number';
        showToast({
          title: reconciled
            ? t('patternForm.reconciled', { removed: data.shifts_removed ?? 0, kept: data.shifts_kept ?? 0, generated: data.shifts_generated ?? 0 })
            : t('patternForm.updated'),
          variant: 'success',
        });
      } else {
        const result = await createRecurringPattern(opportunityId, payload);
        showToast({ title: t('patternForm.created', { count: result?.data?.shifts_generated ?? 0 }), variant: 'success' });
      }
      setHasSaved(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('patternForm.saveFailed')), variant: 'danger' });
    } finally {
      submitPending.current = false;
      if (mountedRef.current) setIsSubmitting(false);
    }
  }

  const title = isEditing ? t('patternForm.editTitle') : t('patternForm.newTitle');

  if (!opportunityId) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={title} backLabel={t('common:back')} fallbackHref="/(modals)/volunteering" />
        <EmptyState icon="repeat-outline" title={t('common:errors.notFound')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={title} backLabel={t('common:back')} fallbackHref="/(modals)/volunteering" />
      {loadFailed ? (
        <View className="flex-1 justify-center" style={{ flex: 1 }} testID="pattern-form-load-failed">
          <EmptyState
            icon={loadFailed === 'refused' ? 'lock-closed-outline' : 'repeat-outline'}
            title={loadFailed === 'refused' ? t('common:errors.notAvailableTitle') : loadFailed === 'missing' ? t('patternForm.notFound') : t('patternForm.loadFailed')}
            subtitle={loadFailed === 'refused' ? t('common:errors.notAvailableHint') : undefined}
            actionLabel={loadFailed === 'failed' ? t('common:buttons.retry') : undefined}
            onAction={loadFailed === 'failed' ? () => setRetryToken((v) => v + 1) : undefined}
          />
        </View>
      ) : !hydrated ? (
        <View className="flex-1 items-center justify-center" style={{ flex: 1 }} testID="pattern-form-loading">
          <LoadingSpinner />
        </View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.bg }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView
            className="flex-1"
            style={{ flex: 1, backgroundColor: theme.bg }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120, gap: 14 }}
            keyboardShouldPersistTaps="handled"
          >
            <FormHero
              icon="repeat-outline"
              eyebrow={t('patternForm.eyebrow')}
              title={title}
              subtitle={isEditing ? t('patternForm.editIntro') : t('patternForm.intro')}
              tone={VOLUNTEERING_TONE}
            />

            <FormSection title={t('patternForm.frequencyLabel')} icon="repeat-outline" testID="pattern-form-frequency">
              <ChoiceChips
                label={t('patternForm.frequencyLabel')}
                options={FREQUENCIES.map((f) => ({ value: f, label: t(`shifts.frequency.${f}`) }))}
                selected={frequency}
                onSelect={(value) => { if (value) setFrequency(value); }}
              />
              {usesDays ? (
                <ChoiceChips
                  selectionMode="multiple"
                  label={t('patternForm.daysLabel')}
                  options={WEEKDAYS.map((d) => ({ value: d, label: weekdayName(Number(d), 'short'), accessibilityLabel: weekdayName(Number(d), 'long') }))}
                  selected={days}
                  onSelectionChange={setDays}
                  testID="pattern-form-days"
                />
              ) : null}
              {usesDays ? <Text className="text-xs leading-5" style={{ color: theme.textMuted }}>{t('patternForm.daysHint')}</Text> : null}
            </FormSection>

            <FormSection title={t('patternForm.timesSection')} icon="time-outline" testID="pattern-form-times">
              <View testID="pattern-form-clocks" className={`gap-3 ${largeText ? '' : 'flex-row'}`}>
                <View className="min-w-0 flex-1">
                  <Input
                    containerClassName="mb-3 w-full"
                    label={t('patternForm.startLabel')}
                    accessibilityLabel={t('patternForm.startLabel')}
                    placeholder={t('patternForm.timePlaceholder')}
                    placeholderTextColor={theme.textMuted}
                    value={start}
                    onChangeText={setStart}
                    editable={!isSubmitting}
                    testID="pattern-form-start"
                  />
                </View>
                <View className="min-w-0 flex-1">
                  <Input
                    label={t('patternForm.endLabel')}
                    accessibilityLabel={t('patternForm.endLabel')}
                    placeholder={t('patternForm.timePlaceholder')}
                    placeholderTextColor={theme.textMuted}
                    value={end}
                    onChangeText={setEnd}
                    editable={!isSubmitting}
                    testID="pattern-form-end"
                  />
                </View>
              </View>
              <Input
                label={t('patternForm.placesLabel')}
                accessibilityLabel={t('patternForm.placesLabel')}
                placeholderTextColor={theme.textMuted}
                keyboardType="number-pad"
                value={capacity}
                onChangeText={setCapacity}
                editable={!isSubmitting}
                testID="pattern-form-capacity"
              />
            </FormSection>

            <FormSection title={t('patternForm.datesSection')} icon="calendar-outline" testID="pattern-form-dates">
              <View testID="pattern-form-date-fields" className={`gap-3 ${largeText ? '' : 'flex-row'}`}>
                <View className="min-w-0 flex-1">
                  <Input
                    containerClassName="mb-3 w-full"
                    label={t('patternForm.startDateLabel')}
                    accessibilityLabel={t('patternForm.startDateLabel')}
                    placeholder={t('patternForm.datePlaceholder')}
                    placeholderTextColor={theme.textMuted}
                    value={startDate}
                    onChangeText={setStartDate}
                    autoCapitalize="none"
                    editable={!isSubmitting}
                    testID="pattern-form-start-date"
                  />
                </View>
                <View className="min-w-0 flex-1">
                  <Input
                    label={t('patternForm.endDateLabel')}
                    accessibilityLabel={t('patternForm.endDateLabel')}
                    placeholder={t('patternForm.datePlaceholder')}
                    placeholderTextColor={theme.textMuted}
                    value={endDate}
                    onChangeText={setEndDate}
                    autoCapitalize="none"
                    editable={!isSubmitting}
                    testID="pattern-form-end-date"
                  />
                </View>
              </View>
              <Input
                label={t('patternForm.maxLabel')}
                accessibilityLabel={t('patternForm.maxLabel')}
                placeholder={t('patternForm.maxPlaceholder')}
                placeholderTextColor={theme.textMuted}
                keyboardType="number-pad"
                value={maxOccurrences}
                onChangeText={setMaxOccurrences}
                editable={!isSubmitting}
                testID="pattern-form-max"
              />
            </FormSection>
          </ScrollView>
          <FormActionFooter
            title={t('patternForm.reviewTitle')}
            subtitle={!requiredFilled ? t('patternForm.reviewMissing') : (validation ?? t('patternForm.reviewSubtitle'))}
            submitLabel={t('patternForm.save')}
            primary={primary}
            isSubmitting={isSubmitting}
            isDisabled={!requiredFilled}
            onSubmit={() => void submit()}
          />
        </KeyboardAvoidingView>
      )}
      {confirmDialog}
    </SafeAreaView>
  );
}

function PatternFormRoute() {
  return (
    <ModalErrorBoundary>
      <PatternFormScreen />
    </ModalErrorBoundary>
  );
}

export default withRouteGate(PatternFormRoute, 'volunteering-shift-pattern-form');
