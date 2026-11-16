// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — Agreements and renewals.
 *
 * The agreements the platform has with communities and others, ordered by
 * the next renewal (the server's order). One that renews within
 * `renewal_warning_days` days, or whose renewal date has passed, is marked;
 * the home page card is the reminder (no email is sent).
 *
 * 🔴 Nothing is filled in that the platform team did not type. An empty field
 * is sent as null and shown as "Not entered". No date is suggested.
 *
 * 🔴 The contact's name and email are a person outside the platform. They are
 * shown on this page only.
 *
 * There is no delete. An agreement entered by mistake is ended; an ended
 * agreement stays on record and cannot be brought back (it can still be
 * changed, to correct it).
 *
 * A list that cannot be loaded shows the error card, never "none entered".
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FileSignature from 'lucide-react/icons/file-signature';
import Plus from 'lucide-react/icons/plus';
import Edit from 'lucide-react/icons/square-pen';
import Square from 'lucide-react/icons/square';
import {
  Button, Card, CardBody, Chip, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader,
  Select, SelectItem, Spinner, Textarea,
} from '@/components/ui';
import { ConfirmModal } from '@/admin/components/ConfirmModal';
import { LoadError } from '@/components/feedback/LoadError';
import { useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

export interface Agreement {
  id: number;
  community: { id: number; name: string | null } | null;
  title: string;
  with_whom: string;
  starts_on: string | null;
  renews_on: string | null;
  ends_on: string | null;
  contact_name: string | null;
  contact_email: string | null;
  notes: string | null;
  is_ended: boolean;
  days_to_renewal: number | null;
  renews_soon: boolean;
  updated_at: string | null;
}

interface Overview {
  agreements: Agreement[];
  ended: Agreement[];
  communities: { id: number; name: string }[];
  renewal_warning_days: number;
}

interface FormState {
  title: string;
  with_whom: string;
  community_id: string; // '' = not linked to a community
  starts_on: string; // <input type="date"> value, YYYY-MM-DD or ''
  renews_on: string;
  ends_on: string;
  contact_name: string;
  contact_email: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  title: '', with_whom: '', community_id: '', starts_on: '', renews_on: '', ends_on: '',
  contact_name: '', contact_email: '', notes: '',
};

const MAX_NAME = 160;
const MAX_EMAIL = 255;
const MAX_NOTES = 5000;
const NO_COMMUNITY = 'none';

/** Plain check only; the server decides. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const orNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

export function AgreementsPage() {
  const { t, i18n } = useTranslation('platform_team');
  const toast = useToast();
  usePageTitle(t('agreements.title'));

  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<Agreement | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toEnd, setToEnd] = useState<Agreement | null>(null);
  const [ending, setEnding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await api.get<Overview>('/v2/platform-team/agreements');
      if (res.success && res.data && Array.isArray(res.data.agreements) && Array.isArray(res.data.ended)) {
        setOverview(res.data);
      } else {
        setOverview(null);
        setFailed(true);
      }
    } catch (err) {
      logError('Failed to load the platform agreements', err);
      setOverview(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (field: keyof FormState) => (value: string) => setForm((prev) => ({ ...prev, [field]: value }));

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEdit = (agreement: Agreement) => {
    setEditing(agreement);
    setForm({
      title: agreement.title,
      with_whom: agreement.with_whom,
      community_id: agreement.community ? String(agreement.community.id) : '',
      starts_on: agreement.starts_on ?? '',
      renews_on: agreement.renews_on ?? '',
      ends_on: agreement.ends_on ?? '',
      contact_name: agreement.contact_name ?? '',
      contact_email: agreement.contact_email ?? '',
      notes: agreement.notes ?? '',
    });
    setFormError(null);
    setIsFormOpen(true);
  };

  const communities = overview?.communities ?? [];
  /** The agreement being changed is linked to a community that is no longer in the list. */
  const goneCommunityId =
    editing?.community && !communities.some((c) => c.id === editing.community?.id)
      ? String(editing.community.id)
      : null;

  const title = form.title.trim();
  const withWhom = form.with_whom.trim();
  const email = form.contact_email.trim();
  // YYYY-MM-DD strings compare correctly as text.
  const endsOk = !form.starts_on || !form.ends_on || form.ends_on >= form.starts_on;
  const renewsOk = !form.starts_on || !form.renews_on || form.renews_on >= form.starts_on;
  const emailOk = email === '' || (email.length <= MAX_EMAIL && EMAIL_SHAPE.test(email));
  const canSave = title !== '' && title.length <= MAX_NAME && withWhom !== '' && withWhom.length <= MAX_NAME
    && form.contact_name.trim().length <= MAX_NAME && form.notes.trim().length <= MAX_NOTES
    && endsOk && renewsOk && emailOk && !saving;

  /**
   * The server's refusal, in this page's own words: by the server's error code
   * first (a date that is not a date is not "before the start"), by the field
   * second. Codes: PlatformAgreementService::validate().
   */
  const refusal = (error: { code?: string; field?: string } | undefined): string => {
    const field = error?.field;
    switch (error?.code) {
      case 'VALIDATION_REQUIRED_FIELD':
        return t('agreements.form.required');
      case 'VALIDATION_TOO_LONG':
        return t('agreements.form.too_long');
      case 'VALIDATION_INVALID_FORMAT':
        return field === 'contact_email' ? t('agreements.form.email_invalid') : t('agreements.form.date_invalid');
      case 'VALIDATION_INVALID_VALUE':
        if (field === 'renews_on') return t('agreements.form.renews_before_start');
        if (field === 'ends_on') return t('agreements.form.ends_before_start');
        if (field === 'community_id') return t('agreements.form.community_unknown');
        break;
      default:
        break;
    }
    switch (field) {
      case 'title':
      case 'with_whom':
        return t('agreements.form.required');
      case 'starts_on':
        return t('agreements.form.date_invalid');
      case 'renews_on':
        return t('agreements.form.renews_before_start');
      case 'ends_on':
        return t('agreements.form.ends_before_start');
      case 'contact_email':
        return t('agreements.form.email_invalid');
      case 'contact_name':
      case 'notes':
        return t('agreements.form.too_long');
      case 'community_id':
        return t('agreements.form.community_unknown');
      default:
        return t('agreements.save_failed');
    }
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setFormError(null);
    const payload: Record<string, string | number | null> = {
      title,
      with_whom: withWhom,
      community_id: form.community_id ? Number(form.community_id) : null,
      starts_on: form.starts_on || null,
      renews_on: form.renews_on || null,
      ends_on: form.ends_on || null,
      contact_name: orNull(form.contact_name),
      contact_email: orNull(form.contact_email),
      notes: orNull(form.notes),
    };
    // A community that no longer exists: leave the stored link alone unless another was picked.
    if (goneCommunityId !== null && form.community_id === goneCommunityId) delete payload.community_id;
    try {
      const res = editing
        ? await api.put<{ agreement: Agreement }>(`/v2/platform-team/agreements/${editing.id}`, payload)
        : await api.post<{ agreement: Agreement }>('/v2/platform-team/agreements', payload);
      if (res.success) {
        toast.success(t('agreements.saved'));
        setIsFormOpen(false);
        await load();
      } else {
        setFormError(refusal(res.errors?.[0]));
      }
    } catch (err) {
      logError('Saving a platform agreement did not complete', err);
      setFormError(t('agreements.save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const end = async () => {
    if (!toEnd || ending) return;
    setEnding(true);
    try {
      const res = await api.post<{ agreement: Agreement }>(`/v2/platform-team/agreements/${toEnd.id}/end`);
      if (res.success) {
        toast.success(t('agreements.ended_toast'));
        setToEnd(null);
        await load();
      } else {
        toast.error(t('agreements.save_failed'));
      }
    } catch (err) {
      logError('Ending a platform agreement did not complete', err);
      toast.error(t('agreements.save_failed'));
    } finally {
      setEnding(false);
    }
  };

  /** A YYYY-MM-DD date in the reader's language, on that calendar day (no time zone shift). */
  const day = (value: string | null): string => {
    if (!value) return t('agreements.not_entered');
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(y ?? NaN, (m ?? NaN) - 1, d ?? NaN);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(i18n.language, { dateStyle: 'medium' });
  };

  const text = (value: string | null): string => value ?? t('agreements.not_entered');

  const count = (value: number): string => new Intl.NumberFormat(i18n.language).format(value);

  const communityName = (agreement: Agreement): string => {
    if (!agreement.community) return t('agreements.community_none');
    return agreement.community.name ?? t('agreements.community_gone', { id: agreement.community.id });
  };

  const fact = (label: string, value: string, wide = false) => (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-muted">{label}</dt>
      <dd className="whitespace-pre-line break-words font-medium text-foreground">{value}</dd>
    </div>
  );

  const renderAgreement = (agreement: Agreement) => {
    const days = agreement.days_to_renewal;
    const passed = !agreement.is_ended && days !== null && days < 0;
    return (
      <li key={agreement.id} data-testid={`agreement-${agreement.id}`}>
        <Card>
          <CardBody className="flex flex-col gap-3 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 className="break-words text-base font-semibold text-foreground">{agreement.title}</h3>
                <p className="break-words text-sm text-muted">{agreement.with_whom}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {agreement.is_ended ? (
                    <Chip size="sm" variant="soft" color="default">{t('agreements.chip_ended')}</Chip>
                  ) : passed ? (
                    <Chip size="sm" variant="soft" color="danger">{t('agreements.chip_passed')}</Chip>
                  ) : agreement.renews_soon ? (
                    <Chip size="sm" variant="soft" color="warning">{t('agreements.chip_soon')}</Chip>
                  ) : null}
                  {!agreement.is_ended && days === 0 ? (
                    <span className="text-sm font-medium text-warning">{t('agreements.renews_today')}</span>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="tertiary" onPress={() => openEdit(agreement)}>
                  <Edit size={14} aria-hidden="true" />
                  {t('agreements.change')}
                </Button>
                {!agreement.is_ended ? (
                  <Button size="sm" variant="danger" onPress={() => setToEnd(agreement)}>
                    <Square size={14} aria-hidden="true" />
                    {t('agreements.end')}
                  </Button>
                ) : null}
              </div>
            </div>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {fact(t('agreements.field.community'), communityName(agreement))}
              {fact(t('agreements.field.renews_on'), day(agreement.renews_on))}
              {!agreement.is_ended && days !== null && days > 0
                ? fact(t('agreements.field.days_left'), count(days))
                : null}
              {!agreement.is_ended && days !== null && days < 0
                ? fact(t('agreements.field.days_since'), count(-days))
                : null}
              {fact(t('agreements.field.starts_on'), day(agreement.starts_on))}
              {fact(t('agreements.field.ends_on'), day(agreement.ends_on))}
              {fact(t('agreements.field.contact_name'), text(agreement.contact_name))}
              {fact(t('agreements.field.contact_email'), text(agreement.contact_email))}
              {fact(t('agreements.field.notes'), text(agreement.notes), true)}
            </dl>
          </CardBody>
        </Card>
      </li>
    );
  };


  return (
    <section className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">{t('agreements.title')}</h1>
          <p className="mt-2 max-w-2xl text-base text-muted">
            {t('agreements.intro', { days: overview?.renewal_warning_days ?? 60 })}
          </p>
          <p className="mt-2 max-w-2xl text-sm text-muted">{t('agreements.private_note')}</p>
        </div>
        <Button onPress={openCreate}>
          <Plus size={16} aria-hidden="true" />
          {t('agreements.new')}
        </Button>
      </div>

      {loading && !overview ? (
        <div role="status" aria-busy="true" aria-label={t('agreements.loading')} className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : failed || !overview ? (
        <LoadError title={t('agreements.load_error_title')} onRetry={() => void load()} />
      ) : (
        <>
          {overview.agreements.length === 0 ? (
            <Card>
              <CardBody className="flex flex-col items-center gap-2 p-10 text-center">
                <FileSignature size={32} className="text-muted" aria-hidden="true" />
                <h2 className="text-lg font-semibold text-foreground">{t('agreements.empty_title')}</h2>
                <p className="text-sm text-muted">{t('agreements.empty_text')}</p>
              </CardBody>
            </Card>
          ) : (
            <ul className="flex flex-col gap-3">{overview.agreements.map(renderAgreement)}</ul>
          )}

          <div className="mt-10">
            <h2 className="text-lg font-semibold text-foreground">{t('agreements.ended_title')}</h2>
            <p className="mt-1 text-sm text-muted">{t('agreements.ended_text')}</p>
            {overview.ended.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-3">{overview.ended.map(renderAgreement)}</ul>
            ) : null}
          </div>
        </>
      )}

      <Modal isOpen={isFormOpen} onClose={() => !saving && setIsFormOpen(false)} size="lg">
        <ModalContent>
          <ModalHeader>{editing ? t('agreements.form.title_edit') : t('agreements.form.title_new')}</ModalHeader>
          <ModalBody className="space-y-4">
            <p className="text-sm text-muted">{t('agreements.form.hint')}</p>

            <Input
              label={t('agreements.form.title')}
              value={form.title}
              onValueChange={set('title')}
              maxLength={MAX_NAME}
              isRequired
              variant="secondary"
            />
            <Input
              label={t('agreements.form.with_whom')}
              value={form.with_whom}
              onValueChange={set('with_whom')}
              maxLength={MAX_NAME}
              isRequired
              variant="secondary"
            />

            <Select
              label={t('agreements.form.community')}
              selectedKeys={new Set([form.community_id || NO_COMMUNITY])}
              onSelectionChange={(keys) => {
                const selected = Array.from(keys)[0];
                if (selected !== undefined) {
                  setForm((prev) => ({ ...prev, community_id: String(selected) === NO_COMMUNITY ? '' : String(selected) }));
                }
              }}
              variant="secondary"
            >
              {[
                <SelectItem key={NO_COMMUNITY} id={NO_COMMUNITY}>{t('agreements.community_none')}</SelectItem>,
                ...(goneCommunityId !== null
                  ? [
                      <SelectItem key={goneCommunityId} id={goneCommunityId}>
                        {t('agreements.community_missing')}
                      </SelectItem>,
                    ]
                  : []),
                ...communities.map((community) => (
                  <SelectItem key={String(community.id)} id={String(community.id)}>{community.name}</SelectItem>
                )),
              ]}
            </Select>

            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                type="date"
                label={t('agreements.form.starts_on')}
                value={form.starts_on}
                onValueChange={set('starts_on')}
                variant="secondary"
              />
              <Input
                type="date"
                label={t('agreements.form.renews_on')}
                value={form.renews_on}
                onValueChange={set('renews_on')}
                isInvalid={!renewsOk}
                errorMessage={!renewsOk ? t('agreements.form.renews_before_start') : undefined}
                variant="secondary"
              />
              <Input
                type="date"
                label={t('agreements.form.ends_on')}
                value={form.ends_on}
                onValueChange={set('ends_on')}
                isInvalid={!endsOk}
                errorMessage={!endsOk ? t('agreements.form.ends_before_start') : undefined}
                variant="secondary"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label={t('agreements.form.contact_name')}
                value={form.contact_name}
                onValueChange={set('contact_name')}
                maxLength={MAX_NAME}
                autoComplete="off"
                variant="secondary"
              />
              <Input
                type="email"
                label={t('agreements.form.contact_email')}
                value={form.contact_email}
                onValueChange={set('contact_email')}
                maxLength={MAX_EMAIL}
                autoComplete="off"
                isInvalid={!emailOk}
                errorMessage={!emailOk ? t('agreements.form.email_invalid') : undefined}
                variant="secondary"
              />
            </div>

            <Textarea
              label={t('agreements.form.notes')}
              value={form.notes}
              onValueChange={set('notes')}
              maxLength={MAX_NOTES}
              minRows={3}
              variant="secondary"
            />

            {formError ? (
              <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground">
                {formError}
              </p>
            ) : null}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setIsFormOpen(false)} isDisabled={saving}>
              {t('agreements.form.cancel')}
            </Button>
            <Button onPress={() => void save()} isLoading={saving} isDisabled={!canSave}>
              {t('agreements.form.save')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <ConfirmModal
        isOpen={toEnd !== null}
        onClose={() => setToEnd(null)}
        onConfirm={() => void end()}
        title={t('agreements.end_title')}
        message={t('agreements.end_message')}
        confirmLabel={t('agreements.end_confirm')}
        cancelLabel={t('agreements.keep')}
        confirmColor="danger"
        isLoading={ending}
      />
    </section>
  );
}

export default AgreementsPage;
