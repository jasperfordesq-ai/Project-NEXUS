// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The member's accessibility needs — a private note (organisations and coordinators
 * cannot read it, including the emergency contact), edited as a whole set and saved with
 * one PUT that replaces everything, exactly as the website's `AccessibilityTab.tsx` does.
 * Removing a card and saving is how a need is deleted; one card per type, or the server
 * refuses with 422.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Card as HeroCard, Spinner, Surface } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import ChoiceChips from '@/components/ui/ChoiceChips';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import RefreshFailedNotice from '@/components/ui/RefreshFailedNotice';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { Ionicons } from '@/components/ui/Icon';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import { withRouteGate } from '@/components/withRouteGate';
import { describeApiError } from '@/lib/api/describeApiError';
import {
  ACCESSIBILITY_NEED_TYPES,
  getAccessibilityNeeds,
  updateAccessibilityNeeds,
  volunteerSwitchOn,
  type AccessibilityNeed,
  type AccessibilityNeedType,
} from '@/lib/api/volunteeringVolunteer';
import * as Haptics from '@/lib/haptics';
import { useApi } from '@/lib/hooks/useApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import { withAlpha } from '@/lib/utils/color';

const VOLUNTEERING_HUB = '/(modals)/volunteering' as Href;
const TEXT_MAX = 10000;
const CONTACT_NAME_MAX = 255;
const CONTACT_PHONE_MAX = 50;

type DraftNeed = AccessibilityNeed & { key: string };

function toDraft(needs: AccessibilityNeed[]): DraftNeed[] {
  return needs.map((need, index) => ({
    key: `server-${need.id ?? index}`,
    id: need.id,
    need_type: need.need_type,
    description: need.description ?? '',
    accommodations_required: need.accommodations_required ?? '',
    emergency_contact_name: need.emergency_contact_name ?? '',
    emergency_contact_phone: need.emergency_contact_phone ?? '',
  }));
}

function fingerprint(needs: DraftNeed[]) {
  return JSON.stringify(needs.map(({ key: _key, id: _id, ...rest }) => rest));
}

function MyAccessibilityScreen() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  return (
    <ModalErrorBoundary key={`${tenant?.id ?? 'no-tenant'}:${user?.id ?? 'no-user'}`}>
      <MyAccessibilityContent />
    </ModalErrorBoundary>
  );
}

function MyAccessibilityContent() {
  const { t } = useTranslation(['volunteeringVolunteer', 'common']);
  const { tenant } = useTenant();
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;
  const { show: showToast } = useAppToast();
  const { confirm: confirmLeave, confirmDialog } = useConfirm();
  const switchedOn = volunteerSwitchOn(tenant?.volunteering_config, 'tab_accessibility');

  const needsApi = useApi(() => getAccessibilityNeeds(), [], { enabled: switchedOn });
  const loaded = Array.isArray(needsApi.data?.data) ? needsApi.data.data : null;

  const [draft, setDraft] = useState<DraftNeed[] | null>(null);
  const [baseline, setBaseline] = useState('');
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const nextKey = useRef(0);

  // Adopt the server's set on first load and after each save; never while the member is
  // mid-edit, which a pull to refresh would otherwise wipe.
  useEffect(() => {
    if (!loaded) return;
    setDraft((current) => {
      if (current !== null && fingerprint(current) !== baseline) return current;
      const fresh = toDraft(loaded);
      setBaseline(fingerprint(fresh));
      return fresh;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const isDirty = draft !== null && fingerprint(draft) !== baseline;

  useUnsavedChangesGuard({
    isDirty,
    isSaving: saving,
    confirm: confirmLeave,
    title: t('common:unsavedChanges.title'),
    message: t('common:unsavedChanges.message'),
    discardLabel: t('common:unsavedChanges.discard'),
    cancelLabel: t('common:buttons.cancel'),
  });

  const typeLabel = (type: string) => t(`volunteeringVolunteer:accessibility.types.${type}`, { defaultValue: type });

  function update(key: string, patch: Partial<AccessibilityNeed>) {
    setDraft((current) => (current ?? []).map((need) => (need.key === key ? { ...need, ...patch } : need)));
  }

  function add() {
    nextKey.current += 1;
    setDraft((current) => [
      ...(current ?? []),
      { key: `new-${nextKey.current}`, need_type: 'other', description: '', accommodations_required: '', emergency_contact_name: '', emergency_contact_phone: '' },
    ]);
  }

  function remove(key: string) {
    setDraft((current) => (current ?? []).filter((need) => need.key !== key));
  }

  const duplicateType = useMemo(() => {
    const seen = new Set<string>();
    for (const need of draft ?? []) {
      if (seen.has(need.need_type)) return true;
      seen.add(need.need_type);
    }
    return false;
  }, [draft]);

  async function save() {
    if (!draft || pending.current) return;
    if (duplicateType) {
      showToast({ title: t('common:errors.alertTitle'), description: t('volunteeringVolunteer:accessibility.duplicateType'), variant: 'warning' });
      return;
    }
    pending.current = true;
    setSaving(true);
    try {
      await updateAccessibilityNeeds(draft.map(({ key: _key, ...need }) => need));
      setBaseline(fingerprint(draft));
      needsApi.refresh();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ title: t('volunteeringVolunteer:accessibility.savedTitle'), description: t('volunteeringVolunteer:accessibility.savedBody'), variant: 'success' });
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('volunteeringVolunteer:accessibility.saveError')), variant: 'danger' });
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  if (!switchedOn) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('volunteeringVolunteer:accessibility.title')} backLabel={t('common:back')} fallbackHref={VOLUNTEERING_HUB} />
        <EmptyState
          icon="accessibility-outline"
          title={t('volunteeringVolunteer:unavailable.title')}
          subtitle={t('volunteeringVolunteer:unavailable.body')}
          actionLabel={t('volunteeringVolunteer:unavailable.back')}
          onAction={() => router.push(VOLUNTEERING_HUB)}
          testID="accessibility-switched-off"
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      {confirmDialog}
      <AppTopBar title={t('volunteeringVolunteer:accessibility.title')} backLabel={t('common:back')} fallbackHref={VOLUNTEERING_HUB} />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 110, gap: 16 }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={(
          <RefreshControl refreshing={needsApi.isLoading && draft !== null} onRefresh={needsApi.refresh} tintColor={primary} colors={[primary]} />
        )}
      >
        <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('volunteeringVolunteer:accessibility.intro')}</Text>

        <Surface variant="secondary" className="flex-row items-start gap-3 rounded-panel-inner p-3" style={{ borderWidth: 1, borderColor: withAlpha(primary, 0.25) }}>
          <Ionicons name="lock-closed-outline" size={18} color={primary} />
          <Text className="min-w-0 flex-1 text-sm leading-5" style={{ color: theme.text }}>{t('volunteeringVolunteer:accessibility.privacy')}</Text>
        </Surface>

        <RefreshFailedNotice error={needsApi.error} onRetry={needsApi.refresh} isRetrying={needsApi.isLoading} testID="accessibility-error" />

        {draft === null && !needsApi.error ? <ListSkeleton rows={2} testID="accessibility-skeleton" /> : null}

        {draft !== null && draft.length === 0 ? (
          <EmptyState icon="accessibility-outline" title={t('volunteeringVolunteer:accessibility.empty')} testID="accessibility-empty" />
        ) : null}

        {draft?.map((need, index) => (
          <HeroCard key={need.key} className="rounded-panel p-0" testID={`accessibility-need-${index}`}>
            <HeroCard.Body className="gap-4 p-4">
              <View className="flex-row items-center justify-between gap-3">
                <Text className="text-base font-semibold" style={{ color: theme.text }} accessibilityRole="header">
                  {t('volunteeringVolunteer:accessibility.needHeading', { index: index + 1 })}
                </Text>
                <HeroButton
                  size="sm"
                  variant="danger-soft"
                  isDisabled={saving}
                  onPress={() => remove(need.key)}
                  testID={`accessibility-remove-${index}`}
                  accessibilityLabel={t('volunteeringVolunteer:accessibility.removeLabel', { type: typeLabel(need.need_type) })}
                >
                  <Ionicons name="trash-outline" size={16} color={theme.error} />
                  <HeroButton.Label>{t('volunteeringVolunteer:accessibility.remove')}</HeroButton.Label>
                </HeroButton>
              </View>
              <ChoiceChips<AccessibilityNeedType>
                label={t('volunteeringVolunteer:accessibility.typeLabel')}
                options={ACCESSIBILITY_NEED_TYPES.map((value) => ({ value, label: typeLabel(value) }))}
                selected={need.need_type as AccessibilityNeedType}
                onSelect={(value) => { if (value) update(need.key, { need_type: value }); }}
                testID={`accessibility-type-${index}`}
              />
              <Input
                label={t('volunteeringVolunteer:accessibility.descriptionLabel')}
                value={need.description ?? ''}
                onChangeText={(value) => update(need.key, { description: value.slice(0, TEXT_MAX) })}
                multiline
                className="min-h-[80px] text-base"
                style={{ color: theme.text, textAlignVertical: 'top' }}
                accessibilityLabel={t('volunteeringVolunteer:accessibility.descriptionLabel')}
                editable={!saving}
                testID={`accessibility-description-${index}`}
              />
              <Input
                label={t('volunteeringVolunteer:accessibility.accommodationsLabel')}
                value={need.accommodations_required ?? ''}
                onChangeText={(value) => update(need.key, { accommodations_required: value.slice(0, TEXT_MAX) })}
                multiline
                className="min-h-[80px] text-base"
                style={{ color: theme.text, textAlignVertical: 'top' }}
                accessibilityLabel={t('volunteeringVolunteer:accessibility.accommodationsLabel')}
                editable={!saving}
                testID={`accessibility-accommodations-${index}`}
              />
              <Input
                label={t('volunteeringVolunteer:accessibility.contactNameLabel')}
                value={need.emergency_contact_name ?? ''}
                onChangeText={(value) => update(need.key, { emergency_contact_name: value.slice(0, CONTACT_NAME_MAX) })}
                maxLength={CONTACT_NAME_MAX}
                autoCapitalize="words"
                accessibilityLabel={t('volunteeringVolunteer:accessibility.contactNameLabel')}
                editable={!saving}
                testID={`accessibility-contact-name-${index}`}
              />
              <Input
                label={t('volunteeringVolunteer:accessibility.contactPhoneLabel')}
                value={need.emergency_contact_phone ?? ''}
                onChangeText={(value) => update(need.key, { emergency_contact_phone: value.slice(0, CONTACT_PHONE_MAX) })}
                maxLength={CONTACT_PHONE_MAX}
                keyboardType="phone-pad"
                accessibilityLabel={t('volunteeringVolunteer:accessibility.contactPhoneLabel')}
                editable={!saving}
                testID={`accessibility-contact-phone-${index}`}
              />
            </HeroCard.Body>
          </HeroCard>
        ))}

        {draft !== null ? (
          <View className={`${largeText ? '' : 'flex-row'} gap-2`} style={largeText ? { flexDirection: 'column' } : undefined}>
            <HeroButton className={largeText ? 'w-full' : 'flex-1'} variant="secondary" isDisabled={saving} onPress={add} testID="accessibility-add">
              <Ionicons name="add-outline" size={16} color={primary} />
              <HeroButton.Label>{t('volunteeringVolunteer:accessibility.add')}</HeroButton.Label>
            </HeroButton>
            <HeroButton className={largeText ? 'w-full' : 'flex-1'} isDisabled={saving} onPress={() => void save()} testID="accessibility-save" accessibilityState={{ busy: saving }}>
              {saving ? <Spinner size="sm" /> : null}
              <HeroButton.Label>{t('volunteeringVolunteer:accessibility.save')}</HeroButton.Label>
            </HeroButton>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

export default withRouteGate(MyAccessibilityScreen, 'volunteering-my-accessibility');
