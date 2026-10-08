// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Create or edit one of the organisation's fundraising campaigns.
 *
 * Same fields and rules as the website's campaign dialog in OrgFundraisingTab: title,
 * both dates and a goal above zero are required. A new campaign goes live as soon as it
 * is saved — there is no approval step (owner decision, 5 Oct 2026) — and the server
 * refuses with 422 when the organisation is not approved, in its own words.
 *
 * There is no "GET one campaign" endpoint, so editing loads the organisation's campaign
 * list and picks the one named in the URL.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, useWindowDimensions, View } from 'react-native';
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
  createOrganisationCampaign,
  getOrganisationCampaigns,
  isValidDateOnly,
  unwrapList,
  updateOrganisationCampaign,
  type OrgCampaign,
} from '@/lib/api/volunteeringOrganiser';
import { describeApiError } from '@/lib/api/describeApiError';
import { isRefusal } from '@/lib/api/refusal';
import * as Haptics from '@/lib/haptics';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import { parseDecimalInput } from '@/lib/utils/decimal';

const FUNDRAISING_TONE = '#e11d48';

function parseId(value?: string | string[]): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function CampaignFormScreen() {
  const { t } = useTranslation(['volunteeringOrganiser', 'common']);
  const params = useLocalSearchParams<{ id?: string; campaignId?: string }>();
  const orgId = parseId(params.id);
  const campaignId = parseId(params.campaignId);
  const isEditing = campaignId !== null;
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { tenant } = useTenant();
  const currency = (tenant?.currency || 'EUR').toUpperCase();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [goal, setGoal] = useState('');
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
    if (!isEditing || !orgId || !campaignId) return;
    let cancelled = false;
    setLoadFailed(null);
    getOrganisationCampaigns(orgId)
      .then((response) => {
        if (cancelled || !mountedRef.current) return;
        const campaign = unwrapList<OrgCampaign>(response?.data, 'items').find((c) => c.id === campaignId);
        if (!campaign) {
          setLoadFailed('missing');
          return;
        }
        setTitle(campaign.title ?? campaign.name ?? '');
        setDescription(campaign.description ?? '');
        setStartDate(campaign.start_date.slice(0, 10));
        setEndDate(campaign.end_date.slice(0, 10));
        setGoal(String(Number(campaign.goal_amount ?? campaign.target_amount ?? 0)));
        setHydrated(true);
      })
      .catch((err: unknown) => {
        if (cancelled || !mountedRef.current) return;
        setLoadFailed(isRefusal(err) ? 'refused' : 'failed');
      });
    return () => { cancelled = true; };
  }, [campaignId, isEditing, orgId, retryToken]);

  const fingerprint = JSON.stringify([title, description, startDate, endDate, goal]);
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
    title: t('campaignForm.unsavedTitle'),
    message: t('campaignForm.unsavedMessage'),
    discardLabel: t('campaignForm.discard'),
    cancelLabel: t('common:buttons.cancel'),
  });

  const goalValue = parseDecimalInput(goal);
  const validation = useMemo((): string | null => {
    if (!title.trim() || !startDate.trim() || !endDate.trim() || !goal.trim()) return t('campaignForm.required');
    if (!isValidDateOnly(startDate) || !isValidDateOnly(endDate)) return t('campaignForm.invalidDate');
    if (endDate.trim() < startDate.trim()) return t('campaignForm.endBeforeStart');
    if (goalValue === null || !(goalValue > 0)) return t('campaignForm.invalidGoal');
    return null;
  }, [endDate, goal, goalValue, startDate, t, title]);

  const requiredFilled = title.trim().length > 0 && startDate.trim().length > 0 && endDate.trim().length > 0 && goal.trim().length > 0 && hydrated;

  async function submit() {
    if (submitPending.current || !orgId) return;
    if (validation || goalValue === null) {
      showToast({ title: t('common:errors.alertTitle'), description: validation ?? t('campaignForm.invalidGoal'), variant: 'warning' });
      return;
    }
    const payload = {
      title: title.trim(),
      description: description.trim(),
      start_date: startDate.trim(),
      end_date: endDate.trim(),
      goal_amount: goalValue,
    };
    submitPending.current = true;
    setIsSubmitting(true);
    try {
      if (isEditing && campaignId) await updateOrganisationCampaign(orgId, campaignId, payload);
      else await createOrganisationCampaign(orgId, payload);
      setHasSaved(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ title: t('campaignForm.saved'), variant: 'success' });
      router.back();
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('campaignForm.saveFailed')), variant: 'danger' });
    } finally {
      submitPending.current = false;
      if (mountedRef.current) setIsSubmitting(false);
    }
  }

  const screenTitle = isEditing ? t('campaignForm.editTitle') : t('campaignForm.newTitle');

  if (!orgId) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={screenTitle} backLabel={t('common:back')} fallbackHref="/(modals)/volunteering" />
        <EmptyState icon="gift-outline" title={t('common:errors.notFound')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={screenTitle} backLabel={t('common:back')} fallbackHref="/(modals)/volunteering" />
      {loadFailed ? (
        <View className="flex-1 justify-center" style={{ flex: 1 }} testID="campaign-form-load-failed">
          <EmptyState
            icon={loadFailed === 'refused' ? 'lock-closed-outline' : 'gift-outline'}
            title={loadFailed === 'refused' ? t('common:errors.notAvailableTitle') : loadFailed === 'missing' ? t('campaignForm.notFound') : t('campaignForm.loadFailed')}
            subtitle={loadFailed === 'refused' ? t('common:errors.notAvailableHint') : undefined}
            actionLabel={loadFailed === 'failed' ? t('common:buttons.retry') : undefined}
            onAction={loadFailed === 'failed' ? () => setRetryToken((v) => v + 1) : undefined}
          />
        </View>
      ) : !hydrated ? (
        <View className="flex-1 items-center justify-center" style={{ flex: 1 }} testID="campaign-form-loading">
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
              icon="gift-outline"
              eyebrow={t('campaignForm.eyebrow')}
              title={screenTitle}
              subtitle={isEditing ? t('campaignForm.editSubtitle') : t('campaignForm.subtitle')}
              tone={FUNDRAISING_TONE}
            />
            <FormSection title={t('campaignForm.section')} icon="document-text-outline" testID="campaign-form-section">
              <Input
                label={t('campaignForm.titleLabel')}
                accessibilityLabel={t('campaignForm.titleLabel')}
                placeholder={t('campaignForm.titlePlaceholder')}
                placeholderTextColor={theme.textMuted}
                value={title}
                onChangeText={setTitle}
                maxLength={255}
                editable={!isSubmitting}
                testID="campaign-form-title"
              />
              <Input
                label={t('campaignForm.descriptionLabel')}
                accessibilityLabel={t('campaignForm.descriptionLabel')}
                placeholder={t('campaignForm.descriptionPlaceholder')}
                placeholderTextColor={theme.textMuted}
                style={{ color: theme.text, minHeight: 112, textAlignVertical: 'top' }}
                value={description}
                onChangeText={setDescription}
                multiline
                editable={!isSubmitting}
                testID="campaign-form-description"
              />
              <View testID="campaign-form-dates" className={`gap-3 ${largeText ? '' : 'flex-row'}`}>
                <View className="min-w-0 flex-1">
                  <Input
                    containerClassName="mb-3 w-full"
                    label={t('campaignForm.startDateLabel')}
                    accessibilityLabel={t('campaignForm.startDateLabel')}
                    placeholder={t('campaignForm.datePlaceholder')}
                    placeholderTextColor={theme.textMuted}
                    value={startDate}
                    onChangeText={setStartDate}
                    autoCapitalize="none"
                    editable={!isSubmitting}
                    testID="campaign-form-start-date"
                  />
                </View>
                <View className="min-w-0 flex-1">
                  <Input
                    label={t('campaignForm.endDateLabel')}
                    accessibilityLabel={t('campaignForm.endDateLabel')}
                    placeholder={t('campaignForm.datePlaceholder')}
                    placeholderTextColor={theme.textMuted}
                    value={endDate}
                    onChangeText={setEndDate}
                    autoCapitalize="none"
                    editable={!isSubmitting}
                    testID="campaign-form-end-date"
                  />
                </View>
              </View>
              <Input
                label={t('campaignForm.goalLabel', { currency })}
                accessibilityLabel={t('campaignForm.goalLabel', { currency })}
                placeholder={t('campaignForm.goalPlaceholder')}
                placeholderTextColor={theme.textMuted}
                keyboardType="decimal-pad"
                value={goal}
                onChangeText={setGoal}
                editable={!isSubmitting}
                testID="campaign-form-goal"
              />
            </FormSection>
          </ScrollView>
          <FormActionFooter
            title={t('campaignForm.reviewTitle')}
            subtitle={!requiredFilled ? t('campaignForm.reviewMissing') : (validation ?? t('campaignForm.reviewSubtitle'))}
            submitLabel={t('campaignForm.save')}
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

function CampaignFormRoute() {
  return (
    <ModalErrorBoundary>
      <CampaignFormScreen />
    </ModalErrorBoundary>
  );
}

export default withRouteGate(CampaignFormRoute, 'volunteering-org-campaign-form');
