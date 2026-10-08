// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Add or change ONE shift on an opportunity the member manages.
 *
 * Same rules as the website's ShiftFormModal: date, start and end are required, the end
 * must be after the start, places is a whole number of 1 or more or blank for no limit.
 * The server adds its own: a shift that has started cannot be changed, and places cannot
 * drop below the number already taken — those refusals are shown in the server's words.
 *
 * There is no "GET one shift" endpoint, so editing loads the opportunity's shift list and
 * picks the one named in the URL.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import EmptyState from '@/components/ui/EmptyState';
import FormActionFooter from '@/components/ui/FormActionFooter';
import { FormHero, FormSection } from '@/components/ui/FormSection';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { useConfirm } from '@/components/ui/useConfirm';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { withRouteGate } from '@/components/withRouteGate';
import {
  createShift,
  getManagedShifts,
  isValidDateOnly,
  normaliseClock,
  splitShiftTime,
  unwrapList,
  updateShift,
  type ManagedShift,
} from '@/lib/api/volunteeringOrganiser';
import { describeApiError } from '@/lib/api/describeApiError';
import { isRefusal } from '@/lib/api/refusal';
import * as Haptics from '@/lib/haptics';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';

const VOLUNTEERING_TONE = '#e11d48';

function parseId(value?: string | string[]): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function ShiftFormScreen() {
  const { t } = useTranslation(['volunteeringOrganiser', 'common']);
  const params = useLocalSearchParams<{ opportunityId?: string; shiftId?: string }>();
  const opportunityId = parseId(params.opportunityId);
  const shiftId = parseId(params.shiftId);
  const isEditing = shiftId !== null;
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();

  const [date, setDate] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [capacity, setCapacity] = useState('');
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
    if (!isEditing || !opportunityId || !shiftId) return;
    let cancelled = false;
    setLoadFailed(null);
    getManagedShifts(opportunityId)
      .then((response) => {
        if (cancelled || !mountedRef.current) return;
        const shift = unwrapList<ManagedShift>(response?.data, 'shifts').find((s) => s.id === shiftId);
        if (!shift) {
          setLoadFailed('missing');
          return;
        }
        const from = splitShiftTime(shift.start_time);
        const to = splitShiftTime(shift.end_time);
        setDate(from.date);
        setStart(from.clock);
        setEnd(to.clock);
        setCapacity(shift.capacity ? String(shift.capacity) : '');
        setHydrated(true);
      })
      .catch((err: unknown) => {
        if (cancelled || !mountedRef.current) return;
        // A failed load must not leave empty fields under a live Save button.
        setLoadFailed(isRefusal(err) ? 'refused' : 'failed');
      });
    return () => { cancelled = true; };
  }, [isEditing, opportunityId, retryToken, shiftId]);

  const fingerprint = JSON.stringify([date, start, end, capacity]);
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
    title: t('shiftForm.unsavedTitle'),
    message: t('shiftForm.unsavedMessage'),
    discardLabel: t('shiftForm.discard'),
    cancelLabel: t('common:buttons.cancel'),
  });

  const validation = useMemo((): string | null => {
    if (!date.trim() || !start.trim() || !end.trim()) return t('shiftForm.required');
    if (!isValidDateOnly(date)) return t('shiftForm.invalidDate');
    const startClock = normaliseClock(start);
    const endClock = normaliseClock(end);
    if (!startClock || !endClock) return t('shiftForm.invalidTime');
    if (endClock <= startClock) return t('shiftForm.endBeforeStart');
    if (capacity.trim() !== '' && (!/^\d+$/.test(capacity.trim()) || Number(capacity) < 1)) return t('shiftForm.invalidPlaces');
    return null;
  }, [capacity, date, end, start, t]);

  const requiredFilled = date.trim().length > 0 && start.trim().length > 0 && end.trim().length > 0 && hydrated;

  async function submit() {
    if (submitPending.current || !opportunityId) return;
    if (validation) {
      showToast({ title: t('common:errors.alertTitle'), description: validation, variant: 'warning' });
      return;
    }
    const startClock = normaliseClock(start) as string;
    const endClock = normaliseClock(end) as string;
    const payload = {
      start_time: `${date.trim()} ${startClock}:00`,
      end_time: `${date.trim()} ${endClock}:00`,
      capacity: capacity.trim() === '' ? null : Number(capacity.trim()),
    };
    submitPending.current = true;
    setIsSubmitting(true);
    try {
      if (isEditing && shiftId) await updateShift(shiftId, payload);
      else await createShift(opportunityId, payload);
      setHasSaved(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ title: isEditing ? t('shiftForm.updated') : t('shiftForm.created'), variant: 'success' });
      router.back();
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('shiftForm.saveFailed')), variant: 'danger' });
    } finally {
      submitPending.current = false;
      if (mountedRef.current) setIsSubmitting(false);
    }
  }

  const title = isEditing ? t('shiftForm.editTitle') : t('shiftForm.newTitle');

  if (!opportunityId) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={title} backLabel={t('common:back')} fallbackHref="/(modals)/volunteering" />
        <EmptyState icon="calendar-outline" title={t('common:errors.notFound')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={title} backLabel={t('common:back')} fallbackHref="/(modals)/volunteering" />
      {loadFailed ? (
        <View className="flex-1 justify-center" style={{ flex: 1 }} testID="shift-form-load-failed">
          <EmptyState
            icon={loadFailed === 'refused' ? 'lock-closed-outline' : 'calendar-outline'}
            title={loadFailed === 'refused' ? t('common:errors.notAvailableTitle') : loadFailed === 'missing' ? t('shiftForm.notFound') : t('shiftForm.loadFailed')}
            subtitle={loadFailed === 'refused' ? t('common:errors.notAvailableHint') : undefined}
            actionLabel={loadFailed === 'failed' ? t('common:buttons.retry') : undefined}
            onAction={loadFailed === 'failed' ? () => setRetryToken((v) => v + 1) : undefined}
          />
        </View>
      ) : !hydrated ? (
        <View className="flex-1 items-center justify-center" style={{ flex: 1 }} testID="shift-form-loading">
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
              icon="calendar-outline"
              eyebrow={t('shiftForm.eyebrow')}
              title={title}
              subtitle={isEditing ? t('shiftForm.editSubtitle') : t('shiftForm.subtitle')}
              tone={VOLUNTEERING_TONE}
            />
            <FormSection title={t('shiftForm.eyebrow')} icon="time-outline" testID="shift-form-section">
              <Input
                label={t('shiftForm.dateLabel')}
                accessibilityLabel={t('shiftForm.dateLabel')}
                placeholder={t('shiftForm.datePlaceholder')}
                placeholderTextColor={theme.textMuted}
                value={date}
                onChangeText={setDate}
                autoCapitalize="none"
                editable={!isSubmitting}
                testID="shift-form-date"
              />
              <View testID="shift-form-times" className={`gap-3 ${largeText ? '' : 'flex-row'}`}>
                <View className="min-w-0 flex-1">
                  <Input
                    containerClassName="mb-3 w-full"
                    label={t('shiftForm.startLabel')}
                    accessibilityLabel={t('shiftForm.startLabel')}
                    placeholder={t('shiftForm.timePlaceholder')}
                    placeholderTextColor={theme.textMuted}
                    value={start}
                    onChangeText={setStart}
                    editable={!isSubmitting}
                    testID="shift-form-start"
                  />
                </View>
                <View className="min-w-0 flex-1">
                  <Input
                    label={t('shiftForm.endLabel')}
                    accessibilityLabel={t('shiftForm.endLabel')}
                    placeholder={t('shiftForm.timePlaceholder')}
                    placeholderTextColor={theme.textMuted}
                    value={end}
                    onChangeText={setEnd}
                    editable={!isSubmitting}
                    testID="shift-form-end"
                  />
                </View>
              </View>
              <Input
                label={t('shiftForm.placesLabel')}
                accessibilityLabel={t('shiftForm.placesLabel')}
                placeholder={t('shiftForm.placesPlaceholder')}
                placeholderTextColor={theme.textMuted}
                keyboardType="number-pad"
                value={capacity}
                onChangeText={setCapacity}
                editable={!isSubmitting}
                testID="shift-form-capacity"
              />
              <Text className="-mt-2 text-xs leading-5" style={{ color: theme.textMuted }}>{t('shiftForm.placesHint')}</Text>
            </FormSection>
          </ScrollView>
          <FormActionFooter
            title={t('shiftForm.reviewTitle')}
            subtitle={!requiredFilled ? t('shiftForm.reviewMissing') : (validation ?? t('shiftForm.reviewSubtitle'))}
            submitLabel={t('shiftForm.save')}
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

function ShiftFormRoute() {
  return (
    <ModalErrorBoundary>
      <ShiftFormScreen />
    </ModalErrorBoundary>
  );
}

export default withRouteGate(ShiftFormRoute, 'volunteering-shift-form');
