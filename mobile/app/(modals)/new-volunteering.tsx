// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Spinner, Surface, Text } from 'heroui-native';
import * as Haptics from '@/lib/haptics';
import { useTranslation } from 'react-i18next';

import { createOpportunity, getMyOrganisations, getOpportunity, updateOpportunity, type VolunteerOpportunity, type VolunteeringOrganisation } from '@/lib/api/volunteering';
import { canPostForOrganisation } from '@/lib/volunteering/postingPermission';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import AccentIcon from '@/components/ui/AccentIcon';
import EmptyState from '@/components/ui/EmptyState';
import FormActionFooter from '@/components/ui/FormActionFooter';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';

function unwrapOrgs(response: { data?: VolunteeringOrganisation[]; items?: VolunteeringOrganisation[] } | null | undefined): VolunteeringOrganisation[] {
  if (Array.isArray(response?.data)) {
    return response.data;
  }

  return Array.isArray(response?.items) ? response.items : [];
}

function parseDateOnly(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);

  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }

  return timestamp;
}

export default function NewVolunteeringRoute() {
  return (
    <ModalErrorBoundary>
      <NewVolunteeringScreen />
    </ModalErrorBoundary>
  );
}

function NewVolunteeringScreen() {
  const { t } = useTranslation(['volunteering', 'common']);
  const params = useLocalSearchParams<{ id?: string }>();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const opportunityId = Number(params.id);
  const isEditing = Number.isFinite(opportunityId) && opportunityId > 0;
  const orgQuery = useApi(() => getMyOrganisations(), []);
  const organisations = useMemo(() => unwrapOrgs(orgQuery.data).filter(canPostForOrganisation), [orgQuery.data]);
  const [organisationId, setOrganisationId] = useState<number | null>(null);
  const selectedOrg = organisations.find((org) => org.id === organisationId) ?? null;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [skills, setSkills] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isRemote, setIsRemote] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);
  const [hasHydratedEdit, setHasHydratedEdit] = useState(false);
  const [editLoadFailed, setEditLoadFailed] = useState(false);
  const [editRetryToken, setEditRetryToken] = useState(0);
  const attemptedEditRetryRef = useRef<number | null>(null);
  // Mount tracking in its own effect: a re-render mid-fetch must not cancel the hydration.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    if (!isEditing || hasHydratedEdit || attemptedEditRetryRef.current === editRetryToken) return;
    attemptedEditRetryRef.current = editRetryToken;
    setEditLoadFailed(false);
    getOpportunity(opportunityId)
      .then((response) => {
        if (!isMountedRef.current) return;
        hydrateFromOpportunity(response.data);
        setHasHydratedEdit(true);
      })
      .catch(() => {
        if (!isMountedRef.current) return;
        // 🔴 Not a dead form. A failed hydration used to leave empty fields under a live
        // "Update opportunity" button — one tap would have wiped the record (S4-03).
        setEditLoadFailed(true);
        showToastRef.current({
          title: tRef.current('create.failedTitle'),
          description: tRef.current('create.loadFailed'),
          variant: 'danger',
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRetryToken, hasHydratedEdit, isEditing, opportunityId]);

  // Everything the member can type, compared with the form as first shown. The organisation
  // choice is left out: a lone organisation is auto-selected below, which is not their input.
  const formFingerprint = JSON.stringify([title, description, location, skills, startDate, endDate, isRemote]);
  const baselineRef = useRef<string | null>(null);
  if (!isEditing && baselineRef.current === null) baselineRef.current = formFingerprint;
  useEffect(() => {
    if (isEditing && hasHydratedEdit && baselineRef.current === null) baselineRef.current = formFingerprint;
  }, [formFingerprint, hasHydratedEdit, isEditing]);
  const isDirty = baselineRef.current !== null && formFingerprint !== baselineRef.current;
  useUnsavedChangesGuard({
    isDirty,
    isBusy: isSubmitting || hasSaved,
    confirm,
    title: t('create.unsavedTitle'),
    message: t('create.unsavedMessage'),
    discardLabel: t('create.discard'),
    cancelLabel: t('common:buttons.cancel'),
  });

  useEffect(() => {
    if (isEditing || organisationId || organisations.length !== 1) {
      return;
    }

    setOrganisationId(organisations[0]?.id ?? null);
  }, [isEditing, organisationId, organisations]);

  function hydrateFromOpportunity(opportunity: VolunteerOpportunity) {
    setOrganisationId(opportunity.organisation?.id ?? opportunity.organization?.id ?? null);
    setTitle(opportunity.title ?? '');
    setDescription(opportunity.description ?? '');
    setLocation(opportunity.location ?? '');
    setSkills(Array.isArray(opportunity.skills_needed) ? opportunity.skills_needed.join(', ') : opportunity.skills_needed ?? '');
    setStartDate(opportunity.start_date?.slice(0, 10) ?? '');
    setEndDate(opportunity.end_date?.slice(0, 10) ?? '');
    setIsRemote(Boolean(opportunity.is_remote));
  }

  async function submit() {
    if (isEditing && !hasHydratedEdit) {
      showToast({ title: t('create.failedTitle'), description: t('create.loadFailed'), variant: 'danger' });
      return;
    }

    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const trimmedStartDate = startDate.trim();
    const trimmedEndDate = endDate.trim();

    if ((!isEditing && !organisationId) || !trimmedTitle || !trimmedDescription) {
      showToast({ title: t('create.validationTitle'), description: t('create.validationRequired'), variant: 'warning' });
      return;
    }

    if (trimmedTitle.length < 5) {
      showToast({ title: t('create.validationTitle'), description: t('create.validationTitleMinLength'), variant: 'warning' });
      return;
    }

    if (trimmedDescription.length < 20) {
      showToast({ title: t('create.validationTitle'), description: t('create.validationDescriptionMinLength'), variant: 'warning' });
      return;
    }

    const parsedStartDate = trimmedStartDate ? parseDateOnly(trimmedStartDate) : null;
    const parsedEndDate = trimmedEndDate ? parseDateOnly(trimmedEndDate) : null;

    // A typed date that does not parse is a FORMAT problem, not a missing field (S4-25).
    if ((trimmedStartDate && parsedStartDate === null) || (trimmedEndDate && parsedEndDate === null)) {
      showToast({ title: t('create.validationTitle'), description: t('create.validationDateFormat'), variant: 'warning' });
      return;
    }

    if (parsedStartDate !== null && parsedEndDate !== null && parsedEndDate <= parsedStartDate) {
      showToast({ title: t('create.validationTitle'), description: t('create.validationEndAfterStart'), variant: 'warning' });
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        title: trimmedTitle,
        description: trimmedDescription,
        location: location.trim() || null,
        is_remote: isRemote,
        skills_needed: skills.trim(),
        start_date: trimmedStartDate || null,
        end_date: trimmedEndDate || null,
      };
      const result = isEditing
        ? await updateOpportunity(opportunityId, payload)
        : await createOpportunity({
          organization_id: organisationId as number,
          ...payload,
        });
      setHasSaved(true);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const id = result.data?.id ?? opportunityId;
      if (id) {
        router.replace({ pathname: '/(modals)/volunteering-detail', params: { id: String(id) } });
      } else {
        router.back();
      }
    } catch (error) {
      showToast({
        title: isEditing ? t('create.editFailedTitle') : t('create.failedTitle'),
        description: error instanceof Error ? error.message : (isEditing ? t('create.editFailedDescription') : t('create.failedDescription')),
        variant: 'danger',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  const organisationsFailed = !isEditing && Boolean(orgQuery.error);
  const organisationMissing = !isEditing && !organisationId;
  const requiredFieldsFilled = title.trim().length > 0
    && description.trim().length > 0
    && !organisationMissing
    && (!isEditing || hasHydratedEdit);
  const footerSubtitle = organisationMissing
    ? t('create.validationRequired')
    : !requiredFieldsFilled
      ? t('create.reviewMissing')
      : isEditing ? t('create.editReviewSubtitle') : t('create.reviewSubtitle');

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={isEditing ? t('create.editTitle') : t('create.title')} backLabel={t('common:back')} fallbackHref="/(modals)/volunteering" />
      {isEditing && editLoadFailed ? (
        <View className="flex-1 justify-center" style={{ flex: 1, backgroundColor: theme.bg }} testID="new-volunteering-load-failed">
          <EmptyState
            icon="heart-outline"
            title={t('create.loadFailedTitle')}
            subtitle={t('create.loadFailed')}
            actionLabel={t('common:buttons.retry')}
            onAction={() => setEditRetryToken((value) => value + 1)}
          />
        </View>
      ) : isEditing && !hasHydratedEdit ? (
        <View className="flex-1 items-center justify-center" style={{ flex: 1, backgroundColor: theme.bg }} testID="new-volunteering-loading">
          <LoadingSpinner />
        </View>
      ) : (
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: theme.bg }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <ScrollView
        className="flex-1"
        style={{ flex: 1, backgroundColor: theme.bg }}
        contentContainerStyle={{ flexGrow: 1, padding: 16, paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
      >
        <HeroCard className="mb-4 overflow-hidden rounded-panel p-0">
          <View className="h-1.5" style={{ backgroundColor: '#e11d48' }} />
          <HeroCard.Body className="gap-4 p-4">
            <View className="flex-row items-start gap-3">
              <View className="size-13 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha('#e11d48', 0.14) }}>
                <Ionicons name="heart-outline" size={25} color="#e11d48" />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('create.eyebrow')}</Text>
                <Text className="text-2xl font-bold" style={{ color: theme.text }}>{isEditing ? t('create.editTitle') : t('create.title')}</Text>
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{isEditing ? t('create.editSubtitle') : t('create.subtitle')}</Text>
              </View>
            </View>
          </HeroCard.Body>
        </HeroCard>

        <HeroCard className="rounded-panel p-0">
          <HeroCard.Body className="gap-4 p-4">
            <View className="gap-2">
              <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('create.organisationLabel')}</Text>
              {orgQuery.isLoading ? <Spinner size="sm" /> : organisationsFailed ? (
                // 🔴 A failed organisation load used to read as "you have no organisations"
                // and disabled the form for ever (S4-08). Say so, and offer the retry.
                <EmptyState
                  icon="business-outline"
                  title={t('create.organisationsLoadFailed')}
                  actionLabel={t('common:buttons.retry')}
                  onAction={orgQuery.refresh}
                  testID="new-volunteering-organisations-failed"
                />
              ) : organisations.length === 0 ? (
                <Surface variant="secondary" className="rounded-panel-inner p-3">
                  <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('create.noOrganisations')}</Text>
                </Surface>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {organisations.map((org) => (
                    <HeroButton
                      key={org.id}
                      size="sm"
                      variant={organisationId === org.id ? 'primary' : 'secondary'}
                      onPress={() => setOrganisationId(org.id)}
                      accessibilityLabel={org.name}
                      accessibilityState={{ selected: organisationId === org.id }}
                    >
                      <HeroButton.Label>{org.name}</HeroButton.Label>
                    </HeroButton>
                  ))}
                </ScrollView>
              )}
              {selectedOrg ? <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('create.selectedOrganisation', { name: selectedOrg.name })}</Text> : null}
              {isEditing ? <Text className="text-xs" style={{ color: theme.textMuted }}>{t('create.editOrganisationHint')}</Text> : null}
            </View>

            <FormField label={t('create.titleLabel')} value={title} onChangeText={setTitle} placeholder={t('create.titlePlaceholder')} theme={theme} />
            <FormField label={t('create.descriptionLabel')} value={description} onChangeText={setDescription} placeholder={t('create.descriptionPlaceholder')} theme={theme} multiline />
            <FormField label={t('create.locationLabel')} value={location} onChangeText={setLocation} placeholder={t('create.locationPlaceholder')} theme={theme} />
            <FormField label={t('create.skillsLabel')} value={skills} onChangeText={setSkills} placeholder={t('create.skillsPlaceholder')} theme={theme} />
            <FormField label={t('create.startLabel')} value={startDate} onChangeText={setStartDate} placeholder={t('create.datePlaceholder')} theme={theme} />
            <FormField label={t('create.endLabel')} value={endDate} onChangeText={setEndDate} placeholder={t('create.datePlaceholder')} theme={theme} />

            <HeroButton
              variant={isRemote ? 'primary' : 'secondary'}
              onPress={() => setIsRemote((value) => !value)}
              accessibilityLabel={t('create.remote')}
              accessibilityState={{ selected: isRemote }}
            >
              {isRemote
                ? <AccentIcon name="globe-outline" size={15} />
                : <Ionicons name="globe-outline" size={15} color={primary} />}
              <HeroButton.Label>{t('create.remote')}</HeroButton.Label>
            </HeroButton>

          </HeroCard.Body>
        </HeroCard>
      </ScrollView>
      <FormActionFooter
        title={isEditing ? t('create.editReviewTitle') : t('create.reviewTitle')}
        subtitle={footerSubtitle}
        submitLabel={isEditing ? t('create.updateSubmit') : t('create.submit')}
        primary={primary}
        isSubmitting={isSubmitting}
        isDisabled={!requiredFieldsFilled || organisationsFailed}
        onSubmit={submit}
      />
      </KeyboardAvoidingView>
      )}
      {confirmDialog}
    </SafeAreaView>
  );
}

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  theme,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  theme: ReturnType<typeof useTheme>;
  multiline?: boolean;
}) {
  return (
    <View>
      <Input
        label={label}
        style={{ color: theme.text, minHeight: multiline ? 112 : undefined, textAlignVertical: multiline ? 'top' : 'center' }}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
      />
    </View>
  );
}
