// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import { useConfirm } from '@/components/ui/useConfirm';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import EmptyState from '@/components/ui/EmptyState';
import { isRefusal } from '@/lib/api/refusal';
import { describeApiError } from '@/lib/api/describeApiError';
import AccentIcon from '@/components/ui/AccentIcon';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Text } from 'heroui-native';
import * as Haptics from '@/lib/haptics';
import { useTranslation } from 'react-i18next';

import { createJob, generateJobDescription, getJobDetail, updateJob, type CreateJobPayload, type JobVacancy } from '@/lib/api/jobs';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import FormActionFooter from '@/components/ui/FormActionFooter';
import ChoiceChips, { toOptions } from '@/components/ui/ChoiceChips';
import Input from '@/components/ui/Input';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { parseDecimalInput } from '@/lib/utils/decimal';
import { withRouteGate } from '@/components/withRouteGate';

type JobType = CreateJobPayload['type'];
type Commitment = CreateJobPayload['commitment'];
type SalaryType = 'hourly' | 'monthly' | 'annual';
type CompanySize = '1-10' | '11-50' | '51-200' | '201-500' | '500+';

const jobTypes: JobType[] = ['volunteer', 'timebank', 'paid'];
const commitments: Commitment[] = ['flexible', 'part_time', 'full_time', 'one_off'];
const salaryTypes: SalaryType[] = ['hourly', 'monthly', 'annual'];
const companySizes: CompanySize[] = ['1-10', '11-50', '51-200', '201-500', '500+'];

/**
 * A number the employer typed, or null when they left the field empty.
 *
 * 🔴 This used to STRIP the comma before parsing, so an employer offering "1,5" time
 * credits published a vacancy offering **15**, and a salary of "50,5" was posted as 505.
 * Nothing warned them; the number was simply wrong. Half the app's locales write decimals
 * with a comma and Android's decimal keypad emits the device locale's mark. Found by the
 * 2026-09-07 audit (E/F-3). `parseDecimalInput` is the shared parser that gets this right,
 * including the "1.000,50" thousands-separator case.
 */
function optionalNumber(value: string): number | null {
  return parseDecimalInput(value);
}

function NewJobRoute() {
  return (
    <ModalErrorBoundary>
      <NewJobScreen />
    </ModalErrorBoundary>
  );
}

function NewJobScreen() {
  const { t } = useTranslation(['jobs', 'common']);
  const params = useLocalSearchParams<{ id?: string }>();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const jobId = Number(params.id);
  const isEditing = Number.isFinite(jobId) && jobId > 0;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<JobType>('volunteer');
  const [commitment, setCommitment] = useState<Commitment>('flexible');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState('');
  const [skills, setSkills] = useState('');
  const [hours, setHours] = useState('');
  const [credits, setCredits] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [salaryMin, setSalaryMin] = useState('');
  const [salaryMax, setSalaryMax] = useState('');
  const [salaryCurrency, setSalaryCurrency] = useState('');
  const [salaryType, setSalaryType] = useState<SalaryType>('annual');
  const [salaryNegotiable, setSalaryNegotiable] = useState(false);
  const [blindHiring, setBlindHiring] = useState(false);
  const [tagline, setTagline] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [companySize, setCompanySize] = useState<CompanySize | ''>('');
  const [benefits, setBenefits] = useState('');
  const [deadline, setDeadline] = useState('');
  const [isRemote, setIsRemote] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  /*
    🔴 S5: a long description, a price and chosen photos were lost to a stray Back with
    no prompt — the same fault the two listing forms had before the 5 September audit.
  */
  useUnsavedChangesGuard({
    isDirty: Boolean(title.trim() || description.trim()),
    isSaving: isSubmitting,
    hasSaved: hasSubmitted,
    confirm,
    title: t('create.unsavedTitle'),
    message: t('create.unsavedMessage'),
    discardLabel: t('create.discard'),
    cancelLabel: t('common:buttons.cancel'),
  });
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);
  const [hasHydratedEdit, setHasHydratedEdit] = useState(false);
  /*
    🔴 Not a dead form — and worse than dead. A failed load in EDIT mode left every field
    empty under a live "Update job" button, so one tap would have wiped the vacancy's
    title, description, location and pay. The toast was the only sign anything had gone
    wrong, and it fades. This is the same fault as S4-03 on the volunteering form, which
    was fixed there and never here.
  */
  const [editLoadFailed, setEditLoadFailed] = useState(false);
  const [editRefused, setEditRefused] = useState(false);
  const [editRetryToken, setEditRetryToken] = useState(0);

  /*
    🔴 One attempt per retry token. Without this the effect re-runs on the re-render its own
    failure causes — `t` and the toast opener are new objects on every render — and the
    screen sits in a fetch loop against an endpoint that has already said no.
  */
  const attemptedEditRetryRef = useRef(-1);

  useEffect(() => {
    if (!isEditing || hasHydratedEdit || attemptedEditRetryRef.current === editRetryToken) return;
    attemptedEditRetryRef.current = editRetryToken;

    let isMounted = true;
    setEditLoadFailed(false);
    getJobDetail(jobId)
      .then((response) => {
        if (!isMounted) return;
        hydrateFromJob(response.data);
        setHasHydratedEdit(true);
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        // A vacancy that is not this member's answers 403/404; retrying cannot clear that.
        setEditRefused(isRefusal(err));
        setEditLoadFailed(true);
        showToast({ title: t('create.failedTitle'), description: t('create.loadFailed'), variant: 'danger' });
      });

    return () => {
      isMounted = false;
    };
  }, [editRetryToken, hasHydratedEdit, isEditing, jobId, showToast, t]);

  function hydrateFromJob(job: JobVacancy) {
    setTitle(job.title ?? '');
    setDescription(job.description ?? '');
    setType(job.type ?? 'volunteer');
    setCommitment(job.commitment ?? 'flexible');
    setLocation(job.location ?? '');
    setCategory(job.category ?? '');
    setSkills((job.skills ?? []).join(', '));
    setHours(job.hours_per_week !== null && job.hours_per_week !== undefined ? String(job.hours_per_week) : '');
    setCredits(job.time_credits !== null && job.time_credits !== undefined ? String(job.time_credits) : '');
    setContactEmail(job.contact_email ?? '');
    setContactPhone(job.contact_phone ?? '');
    setSalaryMin(job.salary_min !== null && job.salary_min !== undefined ? String(job.salary_min) : '');
    setSalaryMax(job.salary_max !== null && job.salary_max !== undefined ? String(job.salary_max) : '');
    setSalaryCurrency(job.salary_currency ?? '');
    setSalaryType(job.salary_type ?? 'annual');
    setSalaryNegotiable(Boolean(job.salary_negotiable));
    setBlindHiring(Boolean(job.blind_hiring));
    setTagline(job.tagline ?? '');
    setVideoUrl(job.video_url ?? '');
    setCompanySize(companySizes.includes(job.company_size as CompanySize) ? job.company_size as CompanySize : '');
    setBenefits((job.benefits ?? []).join(', '));
    setDeadline(job.deadline ? job.deadline.slice(0, 10) : '');
    setIsRemote(Boolean(job.is_remote));
  }

  async function submit() {
    if (!title.trim() || !description.trim()) {
      showToast({ title: t('create.validationTitle'), description: t('create.validationRequired'), variant: 'warning' });
      return;
    }

    const normalizedDeadline = deadline.trim();
    if (normalizedDeadline) {
      const deadlineDate = new Date(`${normalizedDeadline}T00:00:00`);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (!Number.isNaN(deadlineDate.getTime()) && deadlineDate < today) {
        showToast({ title: t('create.validationTitle'), description: t('create.deadlinePast'), variant: 'warning' });
        return;
      }
    }

    const parsedSalaryMin = optionalNumber(salaryMin);
    const parsedSalaryMax = optionalNumber(salaryMax);
    if (parsedSalaryMin !== null && parsedSalaryMax !== null && parsedSalaryMin > parsedSalaryMax) {
      showToast({ title: t('create.validationTitle'), description: t('create.salaryRangeInvalid'), variant: 'warning' });
      return;
    }
    if (type === 'paid' && !salaryNegotiable && parsedSalaryMin === null && parsedSalaryMax === null) {
      showToast({ title: t('create.validationTitle'), description: t('create.salaryRequired'), variant: 'warning' });
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: Omit<CreateJobPayload, 'status'> = {
        title: title.trim(),
        description: description.trim(),
        type,
        commitment,
        location: location.trim() || null,
        is_remote: isRemote,
        category: category.trim() || null,
        skills_required: skills.split(',').map((skill) => skill.trim()).filter(Boolean).join(', ') || null,
        hours_per_week: optionalNumber(hours),
        time_credits: optionalNumber(credits),
        contact_email: contactEmail.trim() || null,
        contact_phone: contactPhone.trim() || null,
        salary_min: parsedSalaryMin,
        salary_max: parsedSalaryMax,
        salary_currency: salaryCurrency.trim() || null,
        salary_type: type === 'paid' ? salaryType : null,
        deadline: normalizedDeadline || null,
        salary_negotiable: salaryNegotiable,
        blind_hiring: blindHiring,
        tagline: tagline.trim() || null,
        video_url: videoUrl.trim() || null,
        company_size: companySize || null,
        benefits: benefits.split(',').map((benefit) => benefit.trim()).filter(Boolean),
      };
      const result = isEditing ? await updateJob(jobId, payload) : await createJob({ ...payload, status: 'open' });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const id = result.data?.id ?? jobId;
      if (id) {
        setHasSubmitted(true);
        router.replace({ pathname: '/(modals)/job-detail', params: { id: String(id) } });
      } else {
        router.back();
      }
    } catch (error) {
      showToast({
        title: isEditing ? t('create.editFailedTitle') : t('create.failedTitle'),
        description: describeApiError(error, isEditing ? t('create.editFailedDescription') : t('create.failedDescription')),
        variant: 'danger',
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function generateDescription() {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      showToast({ title: t('create.validationTitle'), description: t('create.generateTitleRequired'), variant: 'warning' });
      return;
    }

    setIsGeneratingDescription(true);
    try {
      const response = await generateJobDescription({
        title: cleanTitle,
        skills: skills.split(',').map((skill) => skill.trim()).filter(Boolean),
        type,
        commitment,
      });
      setDescription(response.data.description);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      showToast({
        title: t('common:errors.alertTitle'),
        description: describeApiError(error, t('create.generateDescriptionFailed')),
        variant: 'danger',
      });
    } finally {
      setIsGeneratingDescription(false);
    }
  }

  if (isEditing && editLoadFailed) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }} testID="new-job-load-failed">
        <AppTopBar title={t('create.editTitle')} backLabel={t('common:back')} fallbackHref="/(modals)/jobs" />
        <View className="flex-1 justify-center" style={{ flex: 1, backgroundColor: theme.bg }}>
          <EmptyState
            icon={editRefused ? 'lock-closed-outline' : 'briefcase-outline'}
            title={editRefused ? t('common:errors.notAvailableTitle') : t('create.loadFailedTitle')}
            subtitle={editRefused ? t('common:errors.notAvailableHint') : t('create.loadFailed')}
            actionLabel={editRefused ? undefined : t('common:buttons.retry')}
            onAction={editRefused ? undefined : () => setEditRetryToken((value) => value + 1)}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (isEditing && !hasHydratedEdit) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }} testID="new-job-loading">
        <AppTopBar title={t('create.editTitle')} backLabel={t('common:back')} fallbackHref="/(modals)/jobs" />
        <View className="flex-1 items-center justify-center" style={{ flex: 1, backgroundColor: theme.bg }}>
          <LoadingSpinner />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={isEditing ? t('create.editTitle') : t('create.title')} backLabel={t('common:back')} fallbackHref="/(modals)/jobs" />
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
          <View className="h-1.5" style={{ backgroundColor: '#06b6d4' }} />
          <HeroCard.Body className="gap-4 p-4">
            <View className="flex-row items-start gap-3">
              <View className="size-13 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha('#06b6d4', 0.14) }}>
                <Ionicons name="briefcase-outline" size={25} color="#06b6d4" />
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
            <FormField label={t('create.titleLabel')} value={title} onChangeText={setTitle} placeholder={t('create.titlePlaceholder')} theme={theme} />
            <FormField label={t('create.descriptionLabel')} value={description} onChangeText={setDescription} placeholder={t('create.descriptionPlaceholder')} theme={theme} multiline />
            <HeroButton variant="secondary" onPress={() => void generateDescription()} isDisabled={isGeneratingDescription || !title.trim()}>
              <Ionicons name="sparkles-outline" size={16} color={primary} />
              <HeroButton.Label>{isGeneratingDescription ? t('create.generatingDescription') : t('create.generateDescription')}</HeroButton.Label>
            </HeroButton>
            <ButtonGroup label={t('create.typeLabel')} values={jobTypes} selected={type} onSelect={setType} labelFor={(value) => t(`filters.type.${value}`)} />
            <ButtonGroup label={t('create.commitmentLabel')} values={commitments} selected={commitment} onSelect={setCommitment} labelFor={(value) => t(`filters.commitment.${value}`)} />
            <FormField label={t('create.locationLabel')} value={location} onChangeText={setLocation} placeholder={t('create.locationPlaceholder')} theme={theme} />
            <FormField label={t('create.categoryLabel')} value={category} onChangeText={setCategory} placeholder={t('create.categoryPlaceholder')} theme={theme} />
            <FormField label={t('create.skillsLabel')} value={skills} onChangeText={setSkills} placeholder={t('create.skillsPlaceholder')} theme={theme} />
            <FormField label={t('create.hoursLabel')} value={hours} onChangeText={setHours} placeholder={t('create.hoursPlaceholder')} theme={theme} keyboardType="decimal-pad" />
            <FormField label={t('create.creditsLabel')} value={credits} onChangeText={setCredits} placeholder={t('create.creditsPlaceholder')} theme={theme} keyboardType="decimal-pad" />
            <FormField label={t('create.contactEmailLabel')} value={contactEmail} onChangeText={setContactEmail} placeholder={t('create.contactEmailPlaceholder')} theme={theme} keyboardType="email-address" />
            <FormField label={t('create.contactPhoneLabel')} value={contactPhone} onChangeText={setContactPhone} placeholder={t('create.contactPhonePlaceholder')} theme={theme} keyboardType="phone-pad" />
            {type === 'paid' ? (
              <View className="gap-4">
                <View className="flex-row gap-3">
                  <View className="min-w-0 flex-1">
                    <FormField label={t('create.salaryMinLabel')} value={salaryMin} onChangeText={setSalaryMin} placeholder={t('create.salaryPlaceholder')} theme={theme} keyboardType="decimal-pad" />
                  </View>
                  <View className="min-w-0 flex-1">
                    <FormField label={t('create.salaryMaxLabel')} value={salaryMax} onChangeText={setSalaryMax} placeholder={t('create.salaryPlaceholder')} theme={theme} keyboardType="decimal-pad" />
                  </View>
                </View>
                <FormField label={t('create.salaryCurrencyLabel')} value={salaryCurrency} onChangeText={setSalaryCurrency} placeholder={t('create.salaryCurrencyPlaceholder')} theme={theme} />
                <ButtonGroup label={t('create.salaryTypeLabel')} values={salaryTypes} selected={salaryType} onSelect={setSalaryType} labelFor={(value) => t(`create.salaryType.${value}`)} />
                <HeroButton
                  variant={salaryNegotiable ? 'primary' : 'secondary'}
                  onPress={() => setSalaryNegotiable((value) => !value)}
                >
                  {salaryNegotiable ? <AccentIcon name="cash-outline" size={15} /> : <Ionicons name="cash-outline" size={15} color={primary} />}
                  <HeroButton.Label>{t('create.salaryNegotiable')}</HeroButton.Label>
                </HeroButton>
              </View>
            ) : null}
            <FormField label={t('create.deadlineLabel')} value={deadline} onChangeText={setDeadline} placeholder={t('create.deadlinePlaceholder')} theme={theme} />

            <HeroButton variant={isRemote ? 'primary' : 'secondary'} onPress={() => setIsRemote((value) => !value)}>
              {isRemote ? <AccentIcon name="globe-outline" size={15} /> : <Ionicons name="globe-outline" size={15} color={primary} />}
              <HeroButton.Label>{t('create.remote')}</HeroButton.Label>
            </HeroButton>

            <HeroButton variant={blindHiring ? 'primary' : 'secondary'} onPress={() => setBlindHiring((value) => !value)}>
              {blindHiring ? <AccentIcon name="eye-off-outline" size={15} /> : <Ionicons name="eye-off-outline" size={15} color={primary} />}
              <HeroButton.Label>{t('create.blindHiring')}</HeroButton.Label>
            </HeroButton>

            <FormField label={t('create.taglineLabel')} value={tagline} onChangeText={setTagline} placeholder={t('create.taglinePlaceholder')} theme={theme} />
            <FormField label={t('create.videoUrlLabel')} value={videoUrl} onChangeText={setVideoUrl} placeholder={t('create.videoUrlPlaceholder')} theme={theme} keyboardType="url" />
            <ButtonGroup label={t('create.companySizeLabel')} values={companySizes} selected={companySize} onSelect={setCompanySize} labelFor={(value) => t(`create.companySize.${value}`)} />
            <FormField label={t('create.benefitsLabel')} value={benefits} onChangeText={setBenefits} placeholder={t('create.benefitsPlaceholder')} theme={theme} />
          </HeroCard.Body>
        </HeroCard>
      </ScrollView>
      <FormActionFooter
        title={isEditing ? t('create.editReviewTitle') : t('create.reviewTitle')}
        subtitle={
          !title.trim() || !description.trim()
            ? t('create.footerMissing')
            : isEditing ? t('create.editReviewSubtitle') : t('create.reviewSubtitle')
        }
        submitLabel={isEditing ? t('create.updateSubmit') : t('create.submit')}
        isDisabled={isEditing && !hasHydratedEdit}
        isSubmitting={isSubmitting}
        onSubmit={submit}
      />
      </KeyboardAvoidingView>
      {confirmDialog}
    </SafeAreaView>
  );
}

function ButtonGroup<T extends string>({
  label,
  values,
  selected,
  onSelect,
  labelFor,
}: {
  label: string;
  values: T[];
  selected: T | '';
  onSelect: (value: T) => void;
  labelFor: (value: T) => string;
}) {
  return (
    <ChoiceChips
      label={label}
      options={toOptions(values, labelFor)}
      selected={selected}
      onSelect={(value) => { if (value) onSelect(value); }}
    />
  );
}

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  theme,
  multiline = false,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  theme: ReturnType<typeof useTheme>;
  multiline?: boolean;
  keyboardType?: 'default' | 'decimal-pad' | 'email-address' | 'phone-pad' | 'url';
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
        keyboardType={keyboardType}
      />
    </View>
  );
}

export default withRouteGate(NewJobRoute, 'new-job');
