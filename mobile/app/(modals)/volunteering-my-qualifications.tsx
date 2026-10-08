// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The member's qualifications register — a RECORD of what they hold (first aid, food
 * hygiene, a driving licence…), never a document store. The owner decided on 2026-10-07
 * that nothing is uploaded anywhere on the platform, so there is no file field here and
 * none must be added. Organisations confirm a record when they see the original.
 *
 * Same fields, rules and withdrawal reasons as the website's `QualificationsTab.tsx`;
 * the type list comes from the server because it depends on the community's country.
 */

import { useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Card as HeroCard, Spinner, Surface } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import BottomSheet from '@/components/ui/BottomSheet';
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
  createQualification,
  getQualifications,
  QUALIFICATION_WITHDRAWAL_REASONS,
  updateQualification,
  volunteerSwitchOn,
  withdrawQualification,
  type Qualification,
  type QualificationPayload,
  type QualificationType,
  type QualificationWithdrawalReason,
} from '@/lib/api/volunteeringVolunteer';
import * as Haptics from '@/lib/haptics';
import { useApi } from '@/lib/hooks/useApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { dateLocale } from '@/lib/utils/dateLocale';

const VOLUNTEERING_HUB = '/(modals)/volunteering' as Href;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TITLE = 160;
const MAX_ISSUER = 160;
const MAX_REFERENCE = 100;
const MAX_NOTES = 500;

type Draft = QualificationPayload & { id: number | null; wasConfirmed: boolean };

const EMPTY_DRAFT: Draft = {
  id: null, wasConfirmed: false, qualification_type: '', title: '', issuer: '', reference_number: '', obtained_at: '', expires_at: '', notes: '',
};

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value.includes('T') ? value : `${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function validDate(value: string) {
  return value === '' || (DATE_PATTERN.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime()));
}

function statusKey(item: Qualification): 'recorded' | 'confirmed' | 'expired' | 'withdrawn' | 'expiring' {
  if (item.status === 'withdrawn' || item.status === 'expired') return item.status;
  if (item.is_expiring) return 'expiring';
  return item.status === 'confirmed' ? 'confirmed' : 'recorded';
}

function MyQualificationsScreen() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  return (
    <ModalErrorBoundary key={`${tenant?.id ?? 'no-tenant'}:${user?.id ?? 'no-user'}`}>
      <MyQualificationsContent />
    </ModalErrorBoundary>
  );
}

function MyQualificationsContent() {
  const { t } = useTranslation(['volunteeringVolunteer', 'common']);
  const { tenant } = useTenant();
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;
  const { show: showToast } = useAppToast();
  const switchedOn = volunteerSwitchOn(tenant?.volunteering_config, 'tab_credentials');

  const listApi = useApi(() => getQualifications(), [], { enabled: switchedOn });
  const payload = listApi.data?.data;
  const items: Qualification[] = Array.isArray(payload?.items) ? payload.items : [];
  const types: QualificationType[] = Array.isArray(payload?.types) ? payload.types : [];
  const counts = payload?.counts ?? null;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [withdrawing, setWithdrawing] = useState<Qualification | null>(null);
  const [reason, setReason] = useState<QualificationWithdrawalReason>('volunteer_request');
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const pending = useRef(false);

  const typeLabel = (code: string) => t(`volunteeringVolunteer:qualifications.types.${code}`, { defaultValue: code });

  function openAdd() {
    setDraft({ ...EMPTY_DRAFT, qualification_type: types[0]?.code ?? '' });
  }

  function openEdit(item: Qualification) {
    setDraft({
      id: item.id,
      wasConfirmed: item.status === 'confirmed',
      qualification_type: item.qualification_type,
      title: item.title ?? '',
      issuer: item.issuer ?? '',
      reference_number: item.reference_number ?? '',
      obtained_at: item.obtained_at ?? '',
      expires_at: item.expires_at ?? '',
      notes: item.notes ?? '',
    });
  }

  function warn(description: string) {
    showToast({ title: t('common:errors.alertTitle'), description, variant: 'warning' });
  }

  async function save() {
    if (!draft || pending.current) return;
    // The website's three client-side refusals, in its order, before anything is sent.
    if (draft.qualification_type === 'other' && (draft.title ?? '').trim() === '') return warn(t('volunteeringVolunteer:qualifications.titleRequired'));
    const obtained = (draft.obtained_at ?? '').trim();
    const expires = (draft.expires_at ?? '').trim();
    if (!validDate(obtained) || !validDate(expires)) return warn(t('volunteeringVolunteer:qualifications.dateInvalid'));
    if (obtained && expires && expires < obtained) return warn(t('volunteeringVolunteer:qualifications.expiryBeforeObtained'));

    pending.current = true;
    setSaving(true);
    try {
      const body: QualificationPayload = {
        qualification_type: draft.qualification_type,
        title: draft.title,
        issuer: draft.issuer,
        reference_number: draft.reference_number,
        obtained_at: draft.obtained_at,
        expires_at: draft.expires_at,
        notes: draft.notes,
      };
      if (draft.id === null) await createQualification(body);
      else await updateQualification(draft.id, body);
      setDraft(null);
      listApi.refresh();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ title: t('volunteeringVolunteer:qualifications.savedTitle'), description: t('volunteeringVolunteer:qualifications.savedBody'), variant: 'success' });
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('volunteeringVolunteer:qualifications.saveError')), variant: 'danger' });
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  async function confirmWithdraw() {
    if (!withdrawing || pending.current) return;
    pending.current = true;
    setWithdrawBusy(true);
    try {
      await withdrawQualification(withdrawing.id, reason);
      setWithdrawing(null);
      setReason('volunteer_request');
      listApi.refresh();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ title: t('volunteeringVolunteer:qualifications.withdrawnTitle'), variant: 'success' });
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('volunteeringVolunteer:qualifications.withdrawError')), variant: 'danger' });
    } finally {
      pending.current = false;
      setWithdrawBusy(false);
    }
  }

  if (!switchedOn) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('volunteeringVolunteer:qualifications.title')} backLabel={t('common:back')} fallbackHref={VOLUNTEERING_HUB} />
        <EmptyState
          icon="ribbon-outline"
          title={t('volunteeringVolunteer:unavailable.title')}
          subtitle={t('volunteeringVolunteer:unavailable.body')}
          actionLabel={t('volunteeringVolunteer:unavailable.back')}
          onAction={() => router.push(VOLUNTEERING_HUB)}
          testID="qualifications-switched-off"
        />
      </SafeAreaView>
    );
  }

  const selectedType = types.find((type) => type.code === draft?.qualification_type) ?? null;
  const titleRequired = draft?.qualification_type === 'other';

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('volunteeringVolunteer:qualifications.title')} backLabel={t('common:back')} fallbackHref={VOLUNTEERING_HUB} />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 110, gap: 12 }}
        refreshControl={(
          <RefreshControl refreshing={listApi.isLoading && Boolean(payload)} onRefresh={listApi.refresh} tintColor={primary} colors={[primary]} />
        )}
      >
        <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('volunteeringVolunteer:qualifications.intro')}</Text>

        <RefreshFailedNotice error={listApi.error} onRetry={listApi.refresh} isRetrying={listApi.isLoading} testID="qualifications-error" />

        {payload ? (
          <HeroButton onPress={openAdd} testID="qualifications-add" accessibilityLabel={t('volunteeringVolunteer:qualifications.add')}>
            <Ionicons name="add-outline" size={16} color="#ffffff" />
            <HeroButton.Label>{t('volunteeringVolunteer:qualifications.add')}</HeroButton.Label>
          </HeroButton>
        ) : null}

        {counts ? (
          <View className="flex-row flex-wrap gap-3" testID="qualifications-counts">
            {(['confirmed', 'recorded', 'expiring', 'expired'] as const).map((key) => (
              <Surface key={key} variant="secondary" className="min-w-[45%] flex-1 rounded-panel-inner p-3" style={largeText ? { width: '100%' } : undefined}>
                <Text className="text-xl font-bold" style={{ color: theme.text }}>{String(counts[key] ?? 0)}</Text>
                <Text className="mt-1 text-xs font-semibold uppercase leading-4" style={{ color: theme.textSecondary }} numberOfLines={largeText ? 0 : 2}>
                  {t(`volunteeringVolunteer:qualifications.counts.${key}`)}
                </Text>
              </Surface>
            ))}
          </View>
        ) : null}

        {listApi.isLoading && !payload && !listApi.error ? <ListSkeleton rows={3} testID="qualifications-skeleton" /> : null}

        {payload && items.length === 0 ? (
          <EmptyState icon="ribbon-outline" title={t('volunteeringVolunteer:qualifications.empty')} testID="qualifications-empty" />
        ) : null}

        {items.map((item) => {
          const key = statusKey(item);
          const tone = key === 'confirmed' ? theme.success : key === 'expiring' ? theme.warning : key === 'expired' ? theme.error : key === 'withdrawn' ? theme.textMuted : primary;
          const name = item.title || typeLabel(item.qualification_type);
          const actionable = item.status !== 'withdrawn';
          return (
            <HeroCard key={item.id} className="overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: withAlpha(tone, 0.25), opacity: key === 'withdrawn' ? 0.7 : 1 }} testID={`qualification-${item.id}`}>
              <View className="h-1" style={{ backgroundColor: tone }} />
              <HeroCard.Body className="gap-3 p-4">
                <View className={`${largeText ? '' : 'flex-row items-start justify-between'} gap-3`} style={largeText ? { flexDirection: 'column' } : undefined}>
                  <View className="min-w-0 flex-1">
                    <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>{typeLabel(item.qualification_type)}</Text>
                    <Text className="mt-1 text-base font-semibold" style={{ color: theme.text }} numberOfLines={largeText ? 0 : 2}>{name}</Text>
                    {item.issuer ? <Text className="mt-1 text-sm" style={{ color: theme.textSecondary }}>{item.issuer}</Text> : null}
                  </View>
                  <Chip size={largeText ? 'md' : 'sm'} variant="secondary" color="default">
                    <Ionicons name="ellipse" size={9} color={tone} />
                    <Chip.Label>{t(`volunteeringVolunteer:qualifications.status.${key}`)}</Chip.Label>
                  </Chip>
                </View>

                <Text className="text-xs leading-4" style={{ color: theme.textMuted }}>
                  {[
                    item.reference_number ? t('volunteeringVolunteer:qualifications.reference', { reference: item.reference_number }) : null,
                    item.obtained_at ? t('volunteeringVolunteer:qualifications.obtained', { date: formatDate(item.obtained_at) ?? item.obtained_at }) : null,
                    item.expires_at
                      ? t(item.status === 'expired' ? 'volunteeringVolunteer:qualifications.expiredOn' : 'volunteeringVolunteer:qualifications.expiresOn', { date: formatDate(item.expires_at) ?? item.expires_at })
                      : t('volunteeringVolunteer:qualifications.noExpiry'),
                    item.withdrawn_at ? t('volunteeringVolunteer:qualifications.withdrawnOn', { date: formatDate(item.withdrawn_at) ?? '' }) : null,
                  ].filter(Boolean).join(' · ')}
                </Text>

                {item.confirmed_by ? (
                  <View className="gap-0.5">
                    <Text className="text-xs" style={{ color: theme.success }}>
                      {t('volunteeringVolunteer:qualifications.confirmedBy', { name: item.confirmed_by.name })}
                    </Text>
                    {item.confirmed_for_organization ? (
                      <Text className="text-xs" style={{ color: theme.textMuted }}>{item.confirmed_for_organization.name}</Text>
                    ) : null}
                  </View>
                ) : null}

                {item.notes ? <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{item.notes}</Text> : null}

                {actionable ? (
                  <View className={`${largeText ? '' : 'flex-row'} gap-2`} style={largeText ? { flexDirection: 'column' } : undefined}>
                    <HeroButton className={largeText ? 'w-full' : 'flex-1'} size={largeText ? 'md' : 'sm'} variant="secondary" onPress={() => openEdit(item)} testID={`qualification-edit-${item.id}`} accessibilityLabel={t('volunteeringVolunteer:qualifications.editLabel', { title: name })}>
                      <Ionicons name="create-outline" size={16} color={primary} />
                      <HeroButton.Label>{t('volunteeringVolunteer:qualifications.edit')}</HeroButton.Label>
                    </HeroButton>
                    <HeroButton className={largeText ? 'w-full' : 'flex-1'} size={largeText ? 'md' : 'sm'} variant="danger-soft" onPress={() => { setReason('volunteer_request'); setWithdrawing(item); }} testID={`qualification-withdraw-${item.id}`} accessibilityLabel={t('volunteeringVolunteer:qualifications.withdrawLabel', { title: name })}>
                      <HeroButton.Label>{t('volunteeringVolunteer:qualifications.withdraw')}</HeroButton.Label>
                    </HeroButton>
                  </View>
                ) : null}
              </HeroCard.Body>
            </HeroCard>
          );
        })}
      </ScrollView>

      <BottomSheet visible={draft !== null} onClose={() => { if (!saving) setDraft(null); }} dismissible={!saving} scrollable title={t(draft?.id === null ? 'volunteeringVolunteer:qualifications.formTitleAdd' : 'volunteeringVolunteer:qualifications.formTitleEdit')}>
        {draft ? (
          <View className="gap-4 p-4">
            {draft.wasConfirmed ? (
              <Surface variant="secondary" className="rounded-panel-inner p-3" style={{ borderWidth: 1, borderColor: withAlpha(theme.warning, 0.3) }}>
                <Text className="text-sm leading-5" style={{ color: theme.text }}>{t('volunteeringVolunteer:qualifications.editConfirmedWarning')}</Text>
              </Surface>
            ) : null}
            <ChoiceChips
              label={t('volunteeringVolunteer:qualifications.typeLabel')}
              options={types.map((type) => ({ value: type.code, label: typeLabel(type.code) }))}
              selected={draft.qualification_type}
              onSelect={(value) => { if (value) setDraft({ ...draft, qualification_type: value }); }}
              testID="qualification-type"
            />
            {selectedType?.expiry_hint_years ? (
              <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('volunteeringVolunteer:qualifications.expiryHint', { count: selectedType.expiry_hint_years })}</Text>
            ) : null}
            <Input
              label={t(titleRequired ? 'volunteeringVolunteer:qualifications.nameLabel' : 'volunteeringVolunteer:qualifications.nameOptionalLabel')}
              value={draft.title ?? ''}
              onChangeText={(value) => setDraft({ ...draft, title: value.slice(0, MAX_TITLE) })}
              maxLength={MAX_TITLE}
              accessibilityLabel={t(titleRequired ? 'volunteeringVolunteer:qualifications.nameLabel' : 'volunteeringVolunteer:qualifications.nameOptionalLabel')}
              editable={!saving}
              testID="qualification-title"
            />
            <Input label={t('volunteeringVolunteer:qualifications.issuerLabel')} value={draft.issuer ?? ''} onChangeText={(value) => setDraft({ ...draft, issuer: value.slice(0, MAX_ISSUER) })} maxLength={MAX_ISSUER} accessibilityLabel={t('volunteeringVolunteer:qualifications.issuerLabel')} editable={!saving} testID="qualification-issuer" />
            <Input label={t('volunteeringVolunteer:qualifications.referenceLabel')} value={draft.reference_number ?? ''} onChangeText={(value) => setDraft({ ...draft, reference_number: value.slice(0, MAX_REFERENCE) })} maxLength={MAX_REFERENCE} accessibilityLabel={t('volunteeringVolunteer:qualifications.referenceLabel')} editable={!saving} testID="qualification-reference" />
            <Input label={t('volunteeringVolunteer:qualifications.obtainedLabel')} value={draft.obtained_at ?? ''} onChangeText={(value) => setDraft({ ...draft, obtained_at: value })} keyboardType="numbers-and-punctuation" placeholder="2026-01-31" placeholderTextColor={theme.textMuted} accessibilityLabel={t('volunteeringVolunteer:qualifications.obtainedLabel')} editable={!saving} testID="qualification-obtained" />
            <Input label={t('volunteeringVolunteer:qualifications.expiresLabel')} helper={t('volunteeringVolunteer:qualifications.expiresHint')} value={draft.expires_at ?? ''} onChangeText={(value) => setDraft({ ...draft, expires_at: value })} keyboardType="numbers-and-punctuation" placeholder="2028-01-31" placeholderTextColor={theme.textMuted} accessibilityLabel={t('volunteeringVolunteer:qualifications.expiresLabel')} editable={!saving} testID="qualification-expires" />
            <Input label={t('volunteeringVolunteer:qualifications.notesLabel')} value={draft.notes ?? ''} onChangeText={(value) => setDraft({ ...draft, notes: value.slice(0, MAX_NOTES) })} maxLength={MAX_NOTES} multiline className="min-h-[80px] text-base" style={{ color: theme.text, textAlignVertical: 'top' }} accessibilityLabel={t('volunteeringVolunteer:qualifications.notesLabel')} editable={!saving} testID="qualification-notes" />
            <View className={`${largeText ? '' : 'flex-row'} gap-2`} style={largeText ? { flexDirection: 'column' } : undefined}>
              <HeroButton className={largeText ? 'w-full' : 'flex-1'} variant="secondary" isDisabled={saving} onPress={() => setDraft(null)} testID="qualification-cancel">
                <HeroButton.Label>{t('common:buttons.cancel')}</HeroButton.Label>
              </HeroButton>
              <HeroButton className={largeText ? 'w-full' : 'flex-1'} isDisabled={saving || draft.qualification_type === ''} onPress={() => void save()} testID="qualification-save" accessibilityState={{ busy: saving }}>
                {saving ? <Spinner size="sm" /> : null}
                <HeroButton.Label>{t('volunteeringVolunteer:qualifications.save')}</HeroButton.Label>
              </HeroButton>
            </View>
          </View>
        ) : null}
      </BottomSheet>

      <BottomSheet visible={withdrawing !== null} onClose={() => { if (!withdrawBusy) setWithdrawing(null); }} dismissible={!withdrawBusy} title={t('volunteeringVolunteer:qualifications.withdrawTitle')}>
        <View className="gap-4 p-4">
          <ChoiceChips
            label={t('volunteeringVolunteer:qualifications.withdrawReason')}
            options={QUALIFICATION_WITHDRAWAL_REASONS.map((value) => ({ value, label: t(`volunteeringVolunteer:qualifications.reasons.${value}`) }))}
            selected={reason}
            onSelect={(value) => { if (value) setReason(value); }}
            testID="qualification-reason"
          />
          <View className={`${largeText ? '' : 'flex-row'} gap-2`} style={largeText ? { flexDirection: 'column' } : undefined}>
            <HeroButton className={largeText ? 'w-full' : 'flex-1'} variant="secondary" isDisabled={withdrawBusy} onPress={() => setWithdrawing(null)}>
              <HeroButton.Label>{t('common:buttons.cancel')}</HeroButton.Label>
            </HeroButton>
            <HeroButton className={largeText ? 'w-full' : 'flex-1'} variant="danger" isDisabled={withdrawBusy} onPress={() => void confirmWithdraw()} testID="qualification-withdraw-confirm" accessibilityState={{ busy: withdrawBusy }}>
              {withdrawBusy ? <Spinner size="sm" /> : null}
              <HeroButton.Label>{t('volunteeringVolunteer:qualifications.withdrawConfirm')}</HeroButton.Label>
            </HeroButton>
          </View>
        </View>
      </BottomSheet>
    </SafeAreaView>
  );
}

export default withRouteGate(MyQualificationsScreen, 'volunteering-my-qualifications');
