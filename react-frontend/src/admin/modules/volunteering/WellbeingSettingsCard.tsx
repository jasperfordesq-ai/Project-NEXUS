// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A community's wellbeing settings, for community administrators only:
 * who is told first when a volunteer says they are low or struggling and asks
 * for someone to get in touch (named members plus an optional extra address),
 * and the "If you need support now" box every volunteer sees.
 *
 * Brokers never see this card; they read the alerts on the broker page.
 */

import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import HeartHandshake from 'lucide-react/icons/heart-handshake';
import Plus from 'lucide-react/icons/plus';
import X from 'lucide-react/icons/x';
import { Button, Card, CardBody, CardHeader, Chip, Input, Skeleton, Textarea } from '@/components/ui';
import { useToast } from '@/contexts';
import { adminVolunteering } from '../../api/adminApi';
import { MemberSearchPicker, type MemberSearchMember } from '../../components/MemberSearchPicker';

const MAX_CONTACTS = 10;
const MAX_LINKS = 5;
const MAX_SUPPORT_TEXT = 2000;
/** The same limits as WellbeingSettingsService (MAX_LABEL, MAX_URL). */
const MAX_LINK_LABEL = 80;
const MAX_LINK_URL = 500;

type LinkError = { label?: string; url?: string };

/**
 * The server's own rule (WellbeingSettingsService::isSafeLink), checked before
 * anything is sent: https://, mailto:, tel:, or a page on this site (/path,
 * never //host). No spaces or control characters, never plain http or
 * javascript:.
 */
function isSafeSupportLink(url: string): boolean {
  const hasControlOrSpace = [...url].some((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f || /\s/.test(ch);
  });
  if (url === '' || [...url].length > MAX_LINK_URL || hasControlOrSpace) {
    return false;
  }
  if (url.startsWith('/') && !url.startsWith('//')) {
    return true;
  }
  return /^(https:\/\/\S+|mailto:[^\s@]+@[^\s@]+|tel:\+?[0-9][0-9 ().-]{2,})$/i.test(url);
}

/** A server field naming one link: support_links.{i}, or support_links.{i}.label|url. */
function linkFieldIndex(field: string): { index: number; part?: 'label' | 'url' } | null {
  const match = /^support_links\.(\d+)(?:\.(label|url))?$/.exec(field);
  if (!match) return null;
  return { index: Number(match[1]), part: match[2] as 'label' | 'url' | undefined };
}

export interface WellbeingSettingsLink {
  label: string;
  url: string;
}

export interface WellbeingSettingsContact {
  id: number;
  name: string;
  status?: string;
}

export interface WellbeingSettings {
  contact_user_ids: number[];
  contacts: WellbeingSettingsContact[];
  contact_email: string | null;
  support_text: string;
  support_links: WellbeingSettingsLink[];
  defaults: { support_text: string; support_links: WellbeingSettingsLink[] };
}

interface ApiError {
  code?: string;
  message?: string;
  field?: string;
}

export function WellbeingSettingsCard() {
  const { t } = useTranslation('admin_volunteering');
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [defaults, setDefaults] = useState<WellbeingSettings['defaults']>({ support_text: '', support_links: [] });
  const [contacts, setContacts] = useState<WellbeingSettingsContact[]>([]);
  const [contactEmail, setContactEmail] = useState('');
  const [supportText, setSupportText] = useState('');
  const [links, setLinks] = useState<WellbeingSettingsLink[]>([]);
  const [pickerValue, setPickerValue] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Per-row problems with a support link, from the check below or the server.
  const [linkErrors, setLinkErrors] = useState<Record<number, LinkError>>({});
  const idBase = useId();
  const contactsErrorId = `${idBase}-contacts-error`;
  const linksErrorId = `${idBase}-links-error`;
  const linksSummaryId = `${idBase}-links-summary`;
  const linksHeadingId = `${idBase}-links-heading`;

  const apply = useCallback((data: WellbeingSettings) => {
    setDefaults(data.defaults ?? { support_text: '', support_links: [] });
    setContacts(Array.isArray(data.contacts) ? data.contacts : []);
    setContactEmail(data.contact_email ?? '');
    setSupportText(data.support_text ?? '');
    setLinks(Array.isArray(data.support_links) ? data.support_links : []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await adminVolunteering.getWellbeingSettings();
        if (cancelled) return;
        if (res.success && res.data && typeof res.data === 'object') {
          apply(res.data as WellbeingSettings);
          setLoadError(null);
        } else {
          setLoadError(t('volunteering.wellbeing_settings_load_failed'));
        }
      } catch {
        if (!cancelled) setLoadError(t('volunteering.wellbeing_settings_load_failed'));
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [apply, t]);

  const addContact = useCallback((member: MemberSearchMember | null) => {
    if (!member) return;
    setPickerValue('');
    setContacts((prev) => {
      if (prev.some((c) => c.id === member.id) || prev.length >= MAX_CONTACTS) return prev;
      return [...prev, { id: member.id, name: member.name, status: 'active' }];
    });
  }, []);

  const removeContact = useCallback((id: number) => {
    setContacts((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const updateLink = useCallback((index: number, patch: Partial<WellbeingSettingsLink>) => {
    setLinks((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }, []);

  const removeLink = useCallback((index: number) => {
    setLinks((prev) => prev.filter((_, j) => j !== index));
    // Row errors are keyed by position; after a removal they no longer line up.
    setLinkErrors({});
  }, []);

  /** Every row's problems, worked out with the server's own rule. */
  const checkLinks = useCallback((rows: WellbeingSettingsLink[]): Record<number, LinkError> => {
    const found: Record<number, LinkError> = {};
    rows.forEach((row, i) => {
      const label = row.label.trim();
      const url = row.url.trim();
      const problem: LinkError = {};
      if (label === '') {
        problem.label = t('volunteering.wellbeing_link_label_required');
      } else if ([...label].length > MAX_LINK_LABEL) {
        problem.label = t('volunteering.wellbeing_link_label_too_long', { max: MAX_LINK_LABEL });
      }
      if ([...url].length > MAX_LINK_URL) {
        problem.url = t('volunteering.wellbeing_link_url_too_long', { max: MAX_LINK_URL });
      } else if (!isSafeSupportLink(url)) {
        problem.url = t('volunteering.wellbeing_link_url_invalid');
      }
      if (problem.label || problem.url) found[i] = problem;
    });
    return found;
  }, [t]);

  const save = useCallback(async () => {
    setFieldErrors({});
    const rowProblems = checkLinks(links);
    setLinkErrors(rowProblems);
    if (Object.keys(rowProblems).length > 0) {
      return;
    }
    setSaving(true);
    try {
      const res = await adminVolunteering.updateWellbeingSettings({
        contact_user_ids: contacts.map((c) => c.id),
        contact_email: contactEmail.trim() === '' ? null : contactEmail.trim(),
        support_text: supportText,
        support_links: links.map((l) => ({ label: l.label.trim(), url: l.url.trim() })),
      });
      if (res.success && res.data && typeof res.data === 'object') {
        apply(res.data as WellbeingSettings);
        toast.success(t('volunteering.wellbeing_settings_saved'));
      } else {
        const errors = (res as { errors?: ApiError[] }).errors ?? [];
        const first = errors[0];
        const row = first?.field ? linkFieldIndex(first.field) : null;
        if (row && first?.message) {
          // The server names the row (21 Oct 2026): mark that link, not the whole list.
          setLinkErrors({ [row.index]: row.part === 'label' ? { label: first.message } : { url: first.message } });
        } else if (first?.field && first.message) {
          setFieldErrors({ [first.field]: first.message });
        } else {
          toast.error(first?.message || t('volunteering.wellbeing_settings_failed'));
        }
      }
    } catch {
      toast.error(t('volunteering.wellbeing_settings_failed'));
    }
    setSaving(false);
  }, [contacts, contactEmail, supportText, links, apply, toast, t, checkLinks]);

  const hasLinkErrors = Object.keys(linkErrors).length > 0;

  const usingDefault = supportText.trim() === '' && links.length === 0;

  return (
    <Card className="border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
      <CardHeader className="flex flex-col items-start gap-1">
        <div className="flex items-center gap-2">
          <HeartHandshake size={18} className="text-accent" aria-hidden="true" />
          <h3 className="text-lg font-semibold">{t('volunteering.wellbeing_settings_title')}</h3>
        </div>
        <p className="text-sm text-muted">{t('volunteering.wellbeing_settings_desc')}</p>
      </CardHeader>
      <CardBody className="space-y-6">
        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}
          </div>
        ) : loadError ? (
          <p className="text-sm text-danger">{loadError}</p>
        ) : (
          <>
            {/* Who is told first */}
            <section
              className="space-y-3"
              role="group"
              aria-label={t('volunteering.wellbeing_contacts_label')}
              aria-describedby={fieldErrors.contact_user_ids ? contactsErrorId : undefined}
            >
              <div>
                <h4 className="text-sm font-semibold">{t('volunteering.wellbeing_contacts_label')}</h4>
                <p className="text-xs text-muted">{t('volunteering.wellbeing_contacts_help', { max: MAX_CONTACTS })}</p>
              </div>
              {contacts.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {contacts.map((c) => (
                    <li key={c.id}>
                      <Chip
                        size="sm"
                        variant="soft"
                        color={c.status && c.status !== 'active' ? 'warning' : 'default'}
                        endContent={
                          <button
                            type="button"
                            className="ml-1 rounded-full p-0.5 hover:bg-black/10"
                            aria-label={t('volunteering.wellbeing_remove_contact', { name: c.name })}
                            onClick={() => removeContact(c.id)}
                          >
                            <X size={12} aria-hidden="true" />
                          </button>
                        }
                      >
                        {c.name}{c.status && c.status !== 'active' ? ` (${t('volunteering.wellbeing_contact_inactive')})` : ''}
                      </Chip>
                    </li>
                  ))}
                </ul>
              )}
              {contacts.length < MAX_CONTACTS && (
                <MemberSearchPicker
                  value={pickerValue}
                  onValueChange={setPickerValue}
                  selectedMember={null}
                  onSelectedMemberChange={addContact}
                  label={t('volunteering.wellbeing_add_contact')}
                  placeholder={t('volunteering.wellbeing_contact_placeholder')}
                  noResultsText={t('volunteering.wellbeing_contact_no_results')}
                  clearText={t('volunteering.wellbeing_contact_clear')}
                  size="sm"
                />
              )}
              {fieldErrors.contact_user_ids && <p id={contactsErrorId} role="alert" className="text-sm text-danger">{fieldErrors.contact_user_ids}</p>}
              <Input
                label={t('volunteering.wellbeing_contact_email_label')}
                description={t('volunteering.wellbeing_contact_email_help')}
                type="email"
                value={contactEmail}
                onValueChange={setContactEmail}
                isInvalid={Boolean(fieldErrors.contact_email)}
                errorMessage={fieldErrors.contact_email}
                size="sm"
              />
            </section>

            {/* The support box */}
            <section className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold">{t('volunteering.wellbeing_support_text_label')}</h4>
                {usingDefault && <Chip size="sm" variant="soft">{t('volunteering.wellbeing_support_default_badge')}</Chip>}
              </div>
              {usingDefault && (
                <div className="rounded-lg bg-surface-secondary/60 px-3 py-2 text-sm">
                  <p className="text-xs text-muted">{t('volunteering.wellbeing_support_default_note')}</p>
                  <p className="mt-1 whitespace-pre-wrap">{defaults.support_text}</p>
                </div>
              )}
              <Textarea
                label={t('volunteering.wellbeing_support_text_label')}
                description={t('volunteering.wellbeing_support_text_help', { max: MAX_SUPPORT_TEXT })}
                value={supportText}
                onValueChange={setSupportText}
                maxLength={MAX_SUPPORT_TEXT}
                minRows={3}
                isInvalid={Boolean(fieldErrors.support_text)}
                errorMessage={fieldErrors.support_text}
              />
              <div
                role="group"
                aria-labelledby={linksHeadingId}
                aria-describedby={[fieldErrors.support_links ? linksErrorId : '', hasLinkErrors ? linksSummaryId : ''].filter(Boolean).join(' ') || undefined}
                className="space-y-3"
              >
                <div>
                  <h4 id={linksHeadingId} className="text-sm font-semibold">{t('volunteering.wellbeing_support_links_label')}</h4>
                  <p className="text-xs text-muted">{t('volunteering.wellbeing_link_url_help')}</p>
                </div>
                {hasLinkErrors && (
                  <p id={linksSummaryId} role="alert" className="text-sm text-danger">{t('volunteering.wellbeing_links_need_fixing')}</p>
                )}
                {links.map((link, i) => (
                  <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-start">
                    <Input
                      label={t('volunteering.wellbeing_link_label', { n: i + 1 })}
                      value={link.label}
                      onValueChange={(v) => updateLink(i, { label: v })}
                      maxLength={MAX_LINK_LABEL}
                      isInvalid={Boolean(linkErrors[i]?.label)}
                      errorMessage={linkErrors[i]?.label}
                      size="sm"
                      className="sm:w-1/3"
                    />
                    <Input
                      label={t('volunteering.wellbeing_link_url', { n: i + 1 })}
                      value={link.url}
                      onValueChange={(v) => updateLink(i, { url: v })}
                      maxLength={MAX_LINK_URL}
                      isInvalid={Boolean(linkErrors[i]?.url)}
                      errorMessage={linkErrors[i]?.url}
                      size="sm"
                      className="flex-1"
                    />
                    <Button
                      size="sm"
                      variant="tertiary"
                      isIconOnly
                      aria-label={t('volunteering.wellbeing_remove_link', { n: i + 1 })}
                      onPress={() => removeLink(i)}
                      className="sm:mt-6"
                    >
                      <X size={14} aria-hidden="true" />
                    </Button>
                  </div>
                ))}
                {fieldErrors.support_links && <p id={linksErrorId} role="alert" className="text-sm text-danger">{fieldErrors.support_links}</p>}
              </div>
              {links.length < MAX_LINKS && (
                <Button size="sm" variant="tertiary" startContent={<Plus size={14} aria-hidden="true" />} onPress={() => setLinks((prev) => [...prev, { label: '', url: '' }])}>
                  {t('volunteering.wellbeing_add_link')}
                </Button>
              )}
            </section>

            <div className="flex justify-end">
              <Button variant="primary" isLoading={saving} onPress={() => void save()}>
                {t('volunteering.wellbeing_save_settings')}
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

export default WellbeingSettingsCard;
