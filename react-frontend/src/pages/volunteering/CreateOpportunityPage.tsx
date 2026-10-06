// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Create / Edit Volunteer Opportunity Page
 *
 * Create: organisation owners/admins post a new volunteer opportunity
 * (needs at least one approved organisation).
 * Edit (/volunteering/opportunities/:id/edit): anyone the server says may
 * manage the opportunity changes its details; the organisation is fixed.
 * Until 6 Oct 2026 nothing on the website could edit an opportunity.
 */

import { useState, useEffect, useRef } from 'react';
import type { DateInputValue } from '@/components/ui/DatePicker';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from '@/lib/motion';
import { Autocomplete } from '@/components/ui/Autocomplete';
import { Button } from '@/components/ui/Button';
import { DatePicker } from '@/components/ui/DatePicker';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { ListBoxItem as AutocompleteItem } from '@/components/ui/ListBox';
import { Switch } from '@/components/ui/Switch';
import { Textarea } from '@/components/ui/Textarea';
import { today, getLocalTimeZone, parseDate } from '@internationalized/date';
import Save from 'lucide-react/icons/save';
import Heart from 'lucide-react/icons/heart';
import Building2 from 'lucide-react/icons/building-2';
import Briefcase from 'lucide-react/icons/briefcase';
import Wrench from 'lucide-react/icons/wrench';
import Globe from 'lucide-react/icons/globe';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import { PlaceAutocompleteInput } from '@/components/location/PlaceAutocompleteInput';
import { Breadcrumbs } from '@/components/navigation';
import { LoadingScreen } from '@/components/feedback';
import { useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { PageMeta } from '@/components/seo';
import { usePageTitle } from '@/hooks';

interface MyOrganisation {
  id: number;
  name: string;
  status: string;
  member_role: string;
}

interface FormData {
  organization_id: string;
  title: string;
  description: string;
  location: string;
  is_remote: boolean;
  latitude: number | null;
  longitude: number | null;
  skills_needed: string;
  start_date: DateInputValue | null;
  end_date: DateInputValue | null;
}

/** The fields of GET /v2/volunteering/opportunities/{id} the edit form reads. */
interface EditableOpportunity {
  id: number;
  title: string;
  description: string;
  location: string | null;
  is_remote: boolean;
  latitude: number | null;
  longitude: number | null;
  skills_needed: string | null;
  start_date: string | null;
  end_date: string | null;
  federated_visibility?: 'none' | 'listed';
  organization: { id: number; name: string };
  is_owner?: boolean;
  can_manage?: boolean;
}

/** "2026-10-06" or "2026-10-06 00:00:00" → a calendar date, or null if unparseable. */
function toDateValue(value: string | null): DateInputValue | null {
  if (!value) return null;
  try {
    return parseDate(value.slice(0, 10));
  } catch {
    return null;
  }
}

const initialFormData: FormData = {
  organization_id: '',
  title: '',
  description: '',
  location: '',
  is_remote: false,
  latitude: null,
  longitude: null,
  skills_needed: '',
  start_date: null,
  end_date: null,
};

export default function CreateOpportunityPage() {
  const { t } = useTranslation('volunteering');
  const { id: routeId } = useParams<{ id?: string }>();
  const editId = routeId && /^\d+$/.test(routeId) ? Number(routeId) : null;
  const isEdit = editId !== null;
  const pageTitle = isEdit ? t('edit_opportunity_title') : t('create_opportunity_title');
  usePageTitle(pageTitle);
  const navigate = useNavigate();
  const { tenantPath, hasFeature } = useTenant();
  const toast = useToast();

  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [shareFederated, setShareFederated] = useState(false);
  const [approvedOrgs, setApprovedOrgs] = useState<MyOrganisation[]>([]);
  const [isLoadingOrgs, setIsLoadingOrgs] = useState(true);
  /** Edit mode: the organisation's name (fixed), and whether the viewer may edit at all. */
  const [editOrgName, setEditOrgName] = useState('');
  const [editAllowed, setEditAllowed] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  // Synchronous re-entry guard: isSubmitting is async state, so a double-Enter (the
  // form submits on Enter, bypassing the disabled button) or a fast double-click can
  // fire handleSubmit twice and create two opportunities. This blocks the 2nd call.
  const submittingRef = useRef(false);

  useEffect(() => {
    if (editId !== null) {
      void loadOpportunity(editId);
    } else {
      void loadMyOrganisations();
    }
  }, [editId]);

  async function loadOpportunity(id: number) {
    try {
      setIsLoadingOrgs(true);
      const response = await api.get<EditableOpportunity>(`/v2/volunteering/opportunities/${id}`);
      if (!response.success || !response.data) {
        setEditAllowed(false);
        return;
      }
      const opp = response.data;
      if (!(opp.can_manage || opp.is_owner)) {
        setEditAllowed(false);
        return;
      }
      setEditOrgName(opp.organization?.name ?? '');
      setShareFederated(opp.federated_visibility === 'listed');
      setFormData({
        organization_id: String(opp.organization?.id ?? ''),
        title: opp.title ?? '',
        description: opp.description ?? '',
        location: opp.location ?? '',
        is_remote: !!opp.is_remote,
        latitude: opp.latitude ?? null,
        longitude: opp.longitude ?? null,
        skills_needed: opp.skills_needed ?? '',
        start_date: toDateValue(opp.start_date),
        end_date: toDateValue(opp.end_date),
      });
    } catch (error) {
      logError('Failed to load opportunity for editing', error);
      setEditAllowed(false);
    } finally {
      setIsLoadingOrgs(false);
    }
  }

  async function loadMyOrganisations() {
    try {
      setIsLoadingOrgs(true);
      const response = await api.get<MyOrganisation[] | { items?: MyOrganisation[] }>('/v2/volunteering/my-organisations');
      if (response.success && response.data) {
        const orgs = Array.isArray(response.data) ? response.data : (response.data.items ?? []);
        const approved = orgs.filter(
          (org) => ['approved', 'active'].includes(org.status) && ['owner', 'admin'].includes(org.member_role),
        );
        setApprovedOrgs(approved);

        // Auto-select if only one approved org
        if (approved.length === 1) {
          setFormData((prev) => ({ ...prev, organization_id: (approved[0]?.id ?? '').toString() }));
        }
      }
    } catch (error) {
      logError('Failed to load organisations', error);
    } finally {
      setIsLoadingOrgs(false);
    }
  }

  function updateField<K extends keyof FormData>(field: K, value: FormData[K]) {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  function validateForm(): boolean {
    const newErrors: Partial<Record<keyof FormData, string>> = {};

    if (!formData.organization_id) {
      newErrors.organization_id = t('form_org_required');
    }

    if (!formData.title.trim()) {
      newErrors.title = t('form_title_required');
    } else if (formData.title.trim().length < 5) {
      newErrors.title = t('form_title_min_length');
    }

    if (!formData.description.trim()) {
      newErrors.description = t('form_desc_required');
    } else if (formData.description.trim().length < 20) {
      newErrors.description = t('form_desc_min_length');
    }

    // The end-date picker's minValue only constrains selection AT pick time; if
    // the user later moves start_date past a chosen end_date the range inverts.
    // ISO date strings (YYYY-MM-DD) sort lexicographically, so a string compare
    // is a safe range check across DateInputValue implementations.
    if (
      formData.start_date &&
      formData.end_date &&
      formData.end_date.toString() < formData.start_date.toString()
    ) {
      newErrors.end_date = t('form_end_before_start');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current) return; // block a second in-flight submit

    if (!validateForm()) return;

    submittingRef.current = true;
    try {
      setIsSubmitting(true);

      const payload: Record<string, unknown> = {
        organization_id: parseInt(formData.organization_id),
        title: formData.title.trim(),
        description: formData.description.trim(),
        location: formData.location.trim(),
        is_remote: formData.is_remote,
        skills_needed: formData.skills_needed.trim(),
      };

      if (!formData.is_remote && formData.latitude !== null && formData.longitude !== null) {
        payload.latitude = formData.latitude;
        payload.longitude = formData.longitude;
      }

      if (formData.start_date) {
        payload.start_date = formData.start_date.toString();
      }
      if (formData.end_date) {
        payload.end_date = formData.end_date.toString();
      }

      if (hasFeature('federation')) {
        payload.federated_visibility = shareFederated ? 'listed' : 'none';
      }

      if (isEdit) {
        // The organisation cannot change, and a cleared place must be sent as
        // empty so the server drops the old pin instead of keeping it.
        delete payload.organization_id;
        if (payload.latitude === undefined) {
          payload.latitude = '';
          payload.longitude = '';
        }
      }

      const response = isEdit
        ? await api.put(`/v2/volunteering/opportunities/${editId}`, payload)
        : await api.post('/v2/volunteering/opportunities', payload);

      if (response.success) {
        toast.success(isEdit ? t('form_update_success') : t('form_success'));
        navigate(tenantPath(isEdit ? `/volunteering/opportunities/${editId}` : '/volunteering'));
      } else {
        toast.error(t('form_save_error'));
      }
    } catch (error) {
      logError(isEdit ? 'Failed to update opportunity' : 'Failed to create opportunity', error);
      toast.error(t('form_save_error'));
    } finally {
      setIsSubmitting(false);
      submittingRef.current = false;
    }
  }

  if (isLoadingOrgs) {
    return <LoadingScreen />;
  }

  // Edit mode: the opportunity could not be loaded, or this person may not change it.
  if (isEdit && !editAllowed) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <GlassCard className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h1 className="text-lg font-semibold text-theme-primary mb-2">{t('edit_not_allowed_title')}</h1>
          <p className="text-theme-muted mb-6">{t('edit_not_allowed_description')}</p>
          <Button as={Link} to={tenantPath('/volunteering')} variant="tertiary">{t('form_cancel')}</Button>
        </GlassCard>
      </div>
    );
  }

  // No approved organisations — show message
  if (!isEdit && approvedOrgs.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-2xl mx-auto space-y-6"
      >
        <Breadcrumbs items={[
          { label: t('heading'), href: tenantPath('/volunteering') },
          { label: t('create_opportunity_title') },
        ]} />

        <GlassCard className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">
            {t('no_approved_orgs_title')}
          </h2>
          <p className="text-theme-muted mb-6">
            {t('no_approved_orgs_description')}
          </p>
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            {hasFeature('organisations') && (
              <Button as={Link} to={tenantPath('/organisations/register')} className="bg-gradient-to-r from-accent to-accent-gradient-end text-white">
                {t('register_org_link')}
              </Button>
            )}
            <Button as={Link} to={tenantPath('/volunteering')} variant="tertiary">
              {t('form_cancel')}
            </Button>
          </div>
        </GlassCard>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-2xl mx-auto space-y-6"
    >
      <PageMeta title={isEdit ? pageTitle : t('page_meta.create_opportunity.title')} noIndex />
      {/* Breadcrumbs */}
      <Breadcrumbs items={[
        { label: t('heading'), href: tenantPath('/volunteering') },
        ...(isEdit ? [{ label: formData.title || pageTitle, href: tenantPath(`/volunteering/opportunities/${editId}`) }] : []),
        { label: pageTitle },
      ]} />

      {/* Form */}
      <GlassCard className="p-6 sm:p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-theme-primary flex items-center gap-3">
            <Heart className="w-7 h-7 text-rose-500" aria-hidden="true" />
            {pageTitle}
          </h1>
          <p className="text-theme-muted mt-1">
            {isEdit ? t('edit_opportunity_subtitle') : t('create_opportunity_subtitle')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Organisation Selector */}
          {!isEdit && approvedOrgs.length > 1 ? (
            <Autocomplete
              label={t('form_org_label')}
              placeholder={t('form_org_placeholder')}
              searchPlaceholder={t('search_organisations')}
              value={formData.organization_id}
              onChange={(key) => updateField('organization_id', key && !Array.isArray(key) ? String(key) : '')}
              isInvalid={!!errors.organization_id}
              errorMessage={errors.organization_id}
              startContent={<Building2 className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
              classNames={{
                trigger: 'bg-theme-elevated border-theme-default',
                value: 'text-theme-primary',
              }}
            >
              {approvedOrgs.map((org) => (
                <AutocompleteItem key={org.id.toString()} id={org.id.toString()} textValue={org.name}>
                  {org.name}
                </AutocompleteItem>
              ))}
            </Autocomplete>
          ) : (
            <Input
              label={t('form_org_label')}
              value={isEdit ? editOrgName : (approvedOrgs[0]?.name ?? '')}
              isReadOnly
              startContent={<Building2 className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
              }}
            />
          )}

          {/* Title */}
          <Input
            label={t('form_title_label')}
            placeholder={t('form_title_placeholder')}
            value={formData.title}
            onChange={(e) => updateField('title', e.target.value)}
            isInvalid={!!errors.title}
            errorMessage={errors.title}
            startContent={<Briefcase className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
            classNames={{
              input: 'bg-transparent text-theme-primary',
              inputWrapper: 'bg-theme-elevated border-theme-default',
            }}
          />

          {/* Description */}
          <Textarea
            label={t('form_desc_label')}
            placeholder={t('form_desc_placeholder')}
            value={formData.description}
            onChange={(e) => updateField('description', e.target.value)}
            isInvalid={!!errors.description}
            errorMessage={errors.description}
            minRows={4}
            classNames={{
              input: 'bg-transparent text-theme-primary',
              inputWrapper: 'bg-theme-elevated border-theme-default',
            }}
          />

          {/* Location */}
          <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-theme-elevated border border-theme-default">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-sky-500/20">
                <Globe className="w-5 h-5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
              </div>
              <div>
                <p className="font-medium text-theme-primary">{t('form_remote_label')}</p>
                <p className="text-sm text-theme-subtle">{t('form_remote_description')}</p>
              </div>
            </div>
            <Switch
              aria-label={t('form_remote_label')}
              isSelected={formData.is_remote}
              onValueChange={(checked) => {
                setFormData((prev) => ({
                  ...prev,
                  is_remote: checked,
                  latitude: checked ? null : prev.latitude,
                  longitude: checked ? null : prev.longitude,
                }));
              }}
              classNames={{
                wrapper: 'group-data-[selected=true]:bg-sky-500',
              }}
            />
          </div>
          <PlaceAutocompleteInput
            label={t('form_location_label')}
            placeholder={t('form_location_placeholder')}
            value={formData.location}
            onChange={(val) => {
              setFormData((prev) => ({
                ...prev,
                location: val,
                latitude: null,
                longitude: null,
              }));
            }}
            onPlaceSelect={(place) => {
              setFormData((prev) => ({
                ...prev,
                location: place.formattedAddress,
                latitude: place.lat,
                longitude: place.lng,
              }));
            }}
            onClear={() => {
              setFormData((prev) => ({
                ...prev,
                location: '',
                latitude: null,
                longitude: null,
              }));
            }}
            classNames={{
              inputWrapper: 'bg-theme-elevated border-theme-default',
              label: 'text-theme-muted',
              input: 'text-theme-primary placeholder:text-theme-subtle',
            }}
          />

          {/* Skills Needed */}
          <Input
            label={t('form_skills_label')}
            placeholder={t('form_skills_placeholder')}
            value={formData.skills_needed}
            onChange={(e) => updateField('skills_needed', e.target.value)}
            startContent={<Wrench className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
            classNames={{
              input: 'bg-transparent text-theme-primary',
              inputWrapper: 'bg-theme-elevated border-theme-default',
            }}
          />

          {/* Date Range */}
          <fieldset className="grid sm:grid-cols-2 gap-4">
            <legend className="sr-only">{t('date_range_sr')}</legend>
            <div>
              <DatePicker
                label={t('form_start_date_label')}
                value={formData.start_date}
                onChange={(val) => updateField('start_date', val)}
                minValue={isEdit ? undefined : today(getLocalTimeZone())}
                classNames={{
                  inputWrapper: 'bg-theme-elevated border-theme-default',
                  label: 'text-theme-muted',
                }}
              />
            </div>
            <div>
              <DatePicker
                label={t('form_end_date_label')}
                value={formData.end_date}
                onChange={(val) => updateField('end_date', val)}
                minValue={formData.start_date || (isEdit ? undefined : today(getLocalTimeZone()))}
                isInvalid={!!errors.end_date}
                errorMessage={errors.end_date}
                classNames={{
                  inputWrapper: 'bg-theme-elevated border-theme-default',
                  label: 'text-theme-muted',
                }}
              />
            </div>
          </fieldset>

          {/* Federation sharing opt-in — only when the tenant has federation */}
          {hasFeature('federation') && (
            <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-theme-elevated border border-theme-default">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-accent/20">
                  <Globe className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
                </div>
                <div>
                  <p className="font-medium text-theme-primary">
                    {t('federation_share_label')}
                  </p>
                  <p className="text-sm text-theme-subtle">
                    {t('federation_share_description')}
                  </p>
                </div>
              </div>
              <Switch
                aria-label={t('federation_share_label')}
                isSelected={shareFederated}
                onValueChange={setShareFederated}
                classNames={{
                  wrapper: 'group-data-[selected=true]:bg-accent',
                }}
              />
            </div>
          )}

          {/* Submit buttons */}
          <div className="flex flex-col gap-3 pt-4 sm:flex-row">
            <Button
              type="submit"
              className="flex-1 bg-gradient-to-r from-rose-500 to-pink-600 text-white"
              startContent={<Save className="w-4 h-4" aria-hidden="true" />}
              isLoading={isSubmitting}
            >
              {isEdit ? t('form_save_changes') : t('form_submit_opportunity')}
            </Button>
            <Button
              as={Link}
              to={tenantPath(isEdit ? `/volunteering/opportunities/${editId}` : '/volunteering')}
              type="button"
              variant="tertiary"
            >
              {t('form_cancel')}
            </Button>
          </div>
        </form>
      </GlassCard>
    </motion.div>
  );
}

export { CreateOpportunityPage };
