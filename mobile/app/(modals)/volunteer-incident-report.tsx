// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Report a safeguarding concern — the same form, fields, options and refusals as the
 * website's `ReportIncidentModal.tsx`, plus the member's own earlier reports with the
 * plain-English status the website shows a reporter ("Received", "Being looked into"…).
 *
 * 🔴 Adults only. There is no guardian, parent or under-18 path here and none may be
 * added (owner, 2026-09-25). The "person involved" search never offers the reporter
 * themselves, as the website's does not.
 *
 * The emergency line is always on screen: this form is not watched around the clock.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Card as HeroCard, Spinner, Surface } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import Avatar from '@/components/ui/Avatar';
import ChoiceChips from '@/components/ui/ChoiceChips';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import RefreshFailedNotice from '@/components/ui/RefreshFailedNotice';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { Chip } from '@/components/ui/StatusChip';
import { Ionicons } from '@/components/ui/Icon';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import { withRouteGate } from '@/components/withRouteGate';
import { describeApiError } from '@/lib/api/describeApiError';
import { getMembers, type Member } from '@/lib/api/members';
import {
  getIncidentReportOptions,
  getMyIncidents,
  INCIDENT_DESCRIPTION_MAX,
  INCIDENT_DESCRIPTION_MIN,
  INCIDENT_SEVERITIES,
  INCIDENT_TYPES,
  myIncidentItems,
  reportIncident,
  volunteerSwitchOn,
  type IncidentSeverity,
  type IncidentType,
} from '@/lib/api/volunteeringVolunteer';
import * as Haptics from '@/lib/haptics';
import { useApi } from '@/lib/hooks/useApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import { withAlpha } from '@/lib/utils/color';
import { dateLocale } from '@/lib/utils/dateLocale';
import { eventIsoToLocalInput, localEventTimeZone } from '@/lib/utils/eventDateTime';

const VOLUNTEERING_HUB = '/(modals)/volunteering' as Href;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TITLE_MAX = 255;
const CATEGORY_MAX = 100;
const SEARCH_MIN = 2;
const SEARCH_DEBOUNCE_MS = 300;
const NONE = 'none';

function today() {
  return eventIsoToLocalInput(new Date().toISOString(), localEventTimeZone()).slice(0, 10);
}

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value.includes('T') ? value : `${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function statusKey(status: string): 'open' | 'investigating' | 'escalated' | 'resolved' | 'closed' {
  return status === 'investigating' || status === 'escalated' || status === 'resolved' || status === 'closed' ? status : 'open';
}

function IncidentReportScreen() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  return (
    <ModalErrorBoundary key={`${tenant?.id ?? 'no-tenant'}:${user?.id ?? 'no-user'}`}>
      <IncidentReportContent />
    </ModalErrorBoundary>
  );
}

function IncidentReportContent() {
  const { t } = useTranslation(['volunteeringVolunteer', 'common']);
  const { tenant } = useTenant();
  const { user } = useAuth();
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;
  const { show: showToast } = useAppToast();
  const { confirm: confirmLeave, confirmDialog } = useConfirm();
  const switchedOn = volunteerSwitchOn(tenant?.volunteering_config, 'tab_safeguarding');

  const optionsApi = useApi(() => getIncidentReportOptions(), [], { enabled: switchedOn });
  const reportsApi = useApi(() => getMyIncidents(), [], { enabled: switchedOn });
  const organisations = optionsApi.data?.data?.organisations ?? [];
  const opportunities = optionsApi.data?.data?.opportunities ?? [];
  const reports = myIncidentItems(reportsApi.data);

  const [title, setTitle] = useState('');
  const [incidentType, setIncidentType] = useState<IncidentType>('concern');
  const [severity, setSeverity] = useState<IncidentSeverity>('low');
  const [incidentDate, setIncidentDate] = useState(today);
  const [organisationId, setOrganisationId] = useState<string>(NONE);
  const [opportunityId, setOpportunityId] = useState<string>(NONE);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [person, setPerson] = useState<{ id: number; name: string } | null>(null);
  const [personQuery, setPersonQuery] = useState('');
  const [personResults, setPersonResults] = useState<Member[] | null>(null);
  const [personSearchError, setPersonSearchError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequest = useRef(0);
  const initialDate = useRef(incidentDate);

  const isDirty = title.trim() !== '' || description.trim() !== '' || category.trim() !== '' || person !== null
    || organisationId !== NONE || opportunityId !== NONE || incidentType !== 'concern' || severity !== 'low' || incidentDate !== initialDate.current;

  useUnsavedChangesGuard({
    isDirty,
    isSaving: submitting,
    confirm: confirmLeave,
    title: t('common:unsavedChanges.title'),
    message: t('common:unsavedChanges.message'),
    discardLabel: t('common:unsavedChanges.discard'),
    cancelLabel: t('common:buttons.cancel'),
  });

  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);

  const runSearch = useCallback(async (query: string) => {
    const request = ++searchRequest.current;
    try {
      const response = await getMembers(0, query);
      if (request !== searchRequest.current) return;
      const self = user?.id ?? null;
      setPersonResults((response.data ?? []).filter((member) => member.id !== self));
      setPersonSearchError(null);
    } catch (err) {
      if (request !== searchRequest.current) return;
      setPersonResults([]);
      setPersonSearchError(describeApiError(err, t('volunteeringVolunteer:incident.searchError')));
    }
  }, [t, user?.id]);

  function handlePersonQuery(value: string) {
    setPersonQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const query = value.trim();
    if (query.length < SEARCH_MIN) {
      searchRequest.current += 1;
      setPersonResults(null);
      setPersonSearchError(null);
      return;
    }
    searchTimer.current = setTimeout(() => { void runSearch(query); }, SEARCH_DEBOUNCE_MS);
  }

  function choosePerson(member: Member) {
    setPerson({ id: member.id, name: member.name || member.first_name });
    setPersonQuery('');
    setPersonResults(null);
  }

  function chooseOrganisation(value: string) {
    setOrganisationId(value);
    // An opportunity belongs to one organisation; changing the organisation clears a
    // choice that no longer fits, as the website's filtered autocomplete does.
    if (value === NONE) return;
    const chosen = opportunities.find((item) => String(item.id) === opportunityId);
    if (chosen && String(chosen.organization_id) !== value) setOpportunityId(NONE);
  }

  function chooseOpportunity(value: string) {
    setOpportunityId(value);
    const chosen = opportunities.find((item) => String(item.id) === value);
    if (chosen) setOrganisationId(String(chosen.organization_id));
  }

  function warn(description: string) {
    showToast({ title: t('common:errors.alertTitle'), description, variant: 'warning' });
  }

  async function handleSubmit() {
    if (pending.current) return;
    // The website's refusals, in its order: required fields, description length, date.
    if (title.trim() === '' || description.trim() === '') return warn(t('volunteeringVolunteer:incident.required'));
    if (description.trim().length < INCIDENT_DESCRIPTION_MIN) return warn(t('volunteeringVolunteer:incident.descriptionMin', { count: INCIDENT_DESCRIPTION_MIN }));
    const date = incidentDate.trim();
    if (date !== '' && (!DATE_PATTERN.test(date) || Number.isNaN(new Date(`${date}T00:00:00`).getTime()))) return warn(t('volunteeringVolunteer:incident.dateInvalid'));
    if (date !== '' && date > today()) return warn(t('volunteeringVolunteer:incident.dateFuture'));

    pending.current = true;
    setSubmitting(true);
    try {
      const result = await reportIncident({
        title: title.trim(),
        description: description.trim(),
        severity,
        incident_type: incidentType,
        ...(category.trim() ? { category: category.trim() } : {}),
        ...(date ? { incident_date: date } : {}),
        ...(organisationId !== NONE ? { organization_id: Number(organisationId) } : {}),
        ...(opportunityId !== NONE ? { opportunity_id: Number(opportunityId) } : {}),
        ...(person ? { subject_user_id: person.id } : {}),
      });
      setTitle('');
      setDescription('');
      setCategory('');
      setPerson(null);
      setOrganisationId(NONE);
      setOpportunityId(NONE);
      setIncidentType('concern');
      setSeverity('low');
      setIncidentDate(initialDate.current);
      reportsApi.refresh();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const id = result?.data?.id;
      showToast({
        title: t('volunteeringVolunteer:incident.sentTitle'),
        description: id ? t('volunteeringVolunteer:incident.sentBody', { id }) : t('volunteeringVolunteer:incident.sentBodyNoId'),
        variant: 'success',
      });
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('volunteeringVolunteer:incident.submitError')), variant: 'danger' });
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  }

  if (!switchedOn) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('volunteeringVolunteer:incident.title')} backLabel={t('common:back')} fallbackHref={VOLUNTEERING_HUB} />
        <EmptyState
          icon="shield-outline"
          title={t('volunteeringVolunteer:unavailable.title')}
          subtitle={t('volunteeringVolunteer:unavailable.body')}
          actionLabel={t('volunteeringVolunteer:unavailable.back')}
          onAction={() => router.push(VOLUNTEERING_HUB)}
          testID="incident-switched-off"
        />
      </SafeAreaView>
    );
  }

  const visibleOpportunities = organisationId === NONE ? opportunities : opportunities.filter((item) => String(item.organization_id) === organisationId);

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      {confirmDialog}
      <AppTopBar title={t('volunteeringVolunteer:incident.title')} backLabel={t('common:back')} fallbackHref={VOLUNTEERING_HUB} />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 110, gap: 16 }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={(
          <RefreshControl refreshing={reportsApi.isLoading && reports.length > 0} onRefresh={() => { optionsApi.refresh(); reportsApi.refresh(); }} tintColor={primary} colors={[primary]} />
        )}
      >
        <Surface variant="secondary" className="flex-row items-start gap-3 rounded-panel-inner p-3" style={{ borderWidth: 1, borderColor: withAlpha(theme.error, 0.35) }} accessibilityRole="alert">
          <Ionicons name="warning-outline" size={20} color={theme.error} />
          <Text className="min-w-0 flex-1 text-sm font-semibold leading-5" style={{ color: theme.text }}>{t('volunteeringVolunteer:incident.emergency')}</Text>
        </Surface>

        <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('volunteeringVolunteer:incident.intro')}</Text>

        {optionsApi.error ? (
          <Text className="text-xs leading-4" style={{ color: theme.warning }} testID="incident-options-unavailable">{t('volunteeringVolunteer:incident.optionsUnavailable')}</Text>
        ) : null}

        <HeroCard className="rounded-panel p-0">
          <HeroCard.Body className="gap-4 p-4">
            <Input
              label={t('volunteeringVolunteer:incident.titleLabel')}
              value={title}
              onChangeText={(value) => setTitle(value.slice(0, TITLE_MAX))}
              maxLength={TITLE_MAX}
              placeholder={t('volunteeringVolunteer:incident.titlePlaceholder')}
              placeholderTextColor={theme.textMuted}
              accessibilityLabel={t('volunteeringVolunteer:incident.titleLabel')}
              editable={!submitting}
              testID="incident-title"
            />
            <ChoiceChips
              label={t('volunteeringVolunteer:incident.typeLabel')}
              options={INCIDENT_TYPES.map((value) => ({ value, label: t(`volunteeringVolunteer:incident.types.${value}`) }))}
              selected={incidentType}
              onSelect={(value) => { if (value) setIncidentType(value); }}
              testID="incident-type"
            />
            <Input
              label={t('volunteeringVolunteer:incident.dateLabel')}
              value={incidentDate}
              onChangeText={setIncidentDate}
              keyboardType="numbers-and-punctuation"
              placeholder={today()}
              placeholderTextColor={theme.textMuted}
              accessibilityLabel={t('volunteeringVolunteer:incident.dateLabel')}
              editable={!submitting}
              testID="incident-date"
            />
            {organisations.length > 0 ? (
              <ChoiceChips
                label={t('volunteeringVolunteer:incident.organisationLabel')}
                options={[
                  { value: NONE, label: t('volunteeringVolunteer:incident.organisationNone') },
                  ...organisations.map((item) => ({ value: String(item.id), label: item.name })),
                ]}
                selected={organisationId}
                onSelect={(value) => { if (value) chooseOrganisation(value); }}
                testID="incident-organisation"
              />
            ) : null}
            {visibleOpportunities.length > 0 ? (
              <ChoiceChips
                label={t('volunteeringVolunteer:incident.opportunityLabel')}
                options={[
                  { value: NONE, label: t('volunteeringVolunteer:incident.opportunityNone') },
                  ...visibleOpportunities.map((item) => ({ value: String(item.id), label: item.title })),
                ]}
                selected={opportunityId}
                onSelect={(value) => { if (value) chooseOpportunity(value); }}
                testID="incident-opportunity"
              />
            ) : null}

            <View className="gap-2">
              <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('volunteeringVolunteer:incident.personLabel')}</Text>
              {person ? (
                <View className="flex-row flex-wrap items-center gap-2" testID="incident-person-chosen">
                  <Chip size="md" variant="secondary" color="default">
                    <Chip.Label>{t('volunteeringVolunteer:incident.personChosen', { name: person.name })}</Chip.Label>
                  </Chip>
                  <HeroButton size="sm" variant="tertiary" isDisabled={submitting} onPress={() => setPerson(null)} accessibilityLabel={t('volunteeringVolunteer:incident.personClear')} testID="incident-person-clear">
                    <Ionicons name="close-outline" size={16} color={theme.textSecondary} />
                    <HeroButton.Label>{t('volunteeringVolunteer:incident.personClear')}</HeroButton.Label>
                  </HeroButton>
                </View>
              ) : (
                <>
                  <Input
                    value={personQuery}
                    onChangeText={handlePersonQuery}
                    placeholder={t('volunteeringVolunteer:incident.personPlaceholder')}
                    placeholderTextColor={theme.textMuted}
                    autoCorrect={false}
                    autoCapitalize="words"
                    accessibilityLabel={t('volunteeringVolunteer:incident.personLabel')}
                    editable={!submitting}
                    testID="incident-person-search"
                  />
                  {personSearchError ? <Text className="text-xs" style={{ color: theme.error }}>{personSearchError}</Text> : null}
                  {personResults && personResults.length === 0 && !personSearchError ? (
                    <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('volunteeringVolunteer:incident.searchEmpty')}</Text>
                  ) : null}
                  {personResults?.map((member) => (
                    <HeroButton
                      key={member.id}
                      variant="secondary"
                      className="justify-start"
                      onPress={() => choosePerson(member)}
                      testID={`incident-person-${member.id}`}
                      accessibilityLabel={t('volunteeringVolunteer:incident.personPick', { name: member.name || member.first_name })}
                    >
                      <Avatar uri={member.avatar ?? member.avatar_url ?? undefined} name={member.name || member.first_name} size={24} decorative />
                      <HeroButton.Label>{member.name || member.first_name}</HeroButton.Label>
                    </HeroButton>
                  ))}
                </>
              )}
            </View>

            <Input
              label={t('volunteeringVolunteer:incident.descriptionLabel')}
              helper={t('volunteeringVolunteer:incident.descriptionMin', { count: INCIDENT_DESCRIPTION_MIN })}
              value={description}
              onChangeText={(value) => setDescription(value.slice(0, INCIDENT_DESCRIPTION_MAX))}
              maxLength={INCIDENT_DESCRIPTION_MAX}
              placeholder={t('volunteeringVolunteer:incident.descriptionPlaceholder')}
              placeholderTextColor={theme.textMuted}
              multiline
              className="min-h-[120px] text-base"
              style={{ color: theme.text, textAlignVertical: 'top' }}
              accessibilityLabel={t('volunteeringVolunteer:incident.descriptionLabel')}
              editable={!submitting}
              testID="incident-description"
            />
            <ChoiceChips
              label={t('volunteeringVolunteer:incident.severityLabel')}
              options={INCIDENT_SEVERITIES.map((value) => ({ value, label: t(`volunteeringVolunteer:incident.severities.${value}`) }))}
              selected={severity}
              onSelect={(value) => { if (value) setSeverity(value); }}
              testID="incident-severity"
            />
            <Input
              label={t('volunteeringVolunteer:incident.categoryLabel')}
              value={category}
              onChangeText={(value) => setCategory(value.slice(0, CATEGORY_MAX))}
              maxLength={CATEGORY_MAX}
              accessibilityLabel={t('volunteeringVolunteer:incident.categoryLabel')}
              editable={!submitting}
              testID="incident-category"
            />
            <HeroButton isDisabled={submitting} onPress={() => void handleSubmit()} testID="incident-submit" accessibilityState={{ busy: submitting }}>
              {submitting ? <Spinner size="sm" /> : null}
              <HeroButton.Label>{t('volunteeringVolunteer:incident.submit')}</HeroButton.Label>
            </HeroButton>
          </HeroCard.Body>
        </HeroCard>

        <View className="gap-2">
          <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }} accessibilityRole="header">{t('volunteeringVolunteer:incident.myReports')}</Text>
          <RefreshFailedNotice error={reportsApi.error} onRetry={reportsApi.refresh} isRetrying={reportsApi.isLoading} testID="incident-reports-error" />
          {!reportsApi.isLoading && !reportsApi.error && reports.length === 0 ? (
            <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('volunteeringVolunteer:incident.reportsEmpty')}</Text>
          ) : null}
          {reports.map((report) => {
            const key = statusKey(report.status);
            const tone = key === 'resolved' || key === 'closed' ? theme.success : key === 'escalated' ? theme.error : key === 'investigating' ? theme.warning : primary;
            return (
              <HeroCard key={report.id} className="rounded-panel p-0" testID={`incident-report-${report.id}`}>
                <HeroCard.Body className="gap-2 p-4">
                  <View className={`${largeText ? '' : 'flex-row items-start justify-between'} gap-3`} style={largeText ? { flexDirection: 'column' } : undefined}>
                    <View className="min-w-0 flex-1">
                      <Text className="text-xs" style={{ color: theme.textMuted }}>{t('volunteeringVolunteer:incident.reference', { id: report.id })}</Text>
                      <Text className="mt-0.5 text-base font-semibold" style={{ color: theme.text }} numberOfLines={largeText ? 0 : 2}>
                        {report.title || t(`volunteeringVolunteer:incident.types.${report.incident_type}`, { defaultValue: report.incident_type })}
                      </Text>
                    </View>
                    <Chip size={largeText ? 'md' : 'sm'} variant="secondary" color="default">
                      <Ionicons name="ellipse" size={9} color={tone} />
                      <Chip.Label>{t(`volunteeringVolunteer:incident.status.${key}`)}</Chip.Label>
                    </Chip>
                  </View>
                  <Text className="text-xs" style={{ color: theme.textMuted }}>
                    {[report.organization_name, formatDate(report.incident_date ?? report.created_at) ?? t('volunteeringVolunteer:common.dateUnknown')].filter(Boolean).join(' · ')}
                  </Text>
                </HeroCard.Body>
              </HeroCard>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default withRouteGate(IncidentReportScreen, 'volunteer-incident-report');
