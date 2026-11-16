// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — Notices.
 *
 * The platform team writes a short notice once; every community's admins see
 * it as a band at the top of the admin panel (`PlatformNoticeBand`). Members
 * and brokers never see one.
 *
 * The form shows the real band as it is typed. A notice is shown as written:
 * it is not translated (owner, 16 Nov 2026).
 *
 * 🔴 A notice that has been ended stays ended. There is no "start again":
 * write a new one, so the record of what admins were shown, and when, stays
 * true.
 *
 * A list that cannot be loaded shows the error card, never "no notices yet".
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Megaphone from 'lucide-react/icons/megaphone';
import Plus from 'lucide-react/icons/plus';
import Edit from 'lucide-react/icons/square-pen';
import Square from 'lucide-react/icons/square';
import {
  Button, Card, CardBody, Chip, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader,
  Select, SelectItem, Spinner, Switch, Textarea,
} from '@/components/ui';
import { ConfirmModal } from '@/admin/components/ConfirmModal';
import { PlatformNoticeView } from '@/admin/components/PlatformNoticeBand';
import { LoadError } from '@/components/feedback/LoadError';
import { useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import {
  PLATFORM_NOTICE_KINDS, PLATFORM_NOTICE_MAX_LINK_LABEL, PLATFORM_NOTICE_MAX_MESSAGE,
  httpsLink, noticeKind, type PlatformNotice, type PlatformNoticeKind,
} from '@/lib/platformNotice';

export type TeamNoticeState = 'live' | 'scheduled' | 'expired' | 'ended';

export interface TeamNotice {
  id: number;
  message: string;
  kind: string;
  link_url: string | null;
  link_label: string | null;
  starts_at: string | null;
  ends_at: string | null;
  is_dismissible: boolean;
  state: TeamNoticeState;
  written_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  ended_at: string | null;
  closed_count: number;
}

interface FormState {
  message: string;
  kind: PlatformNoticeKind;
  link_url: string;
  link_label: string;
  starts_at: string; // <input type="datetime-local"> value, the writer's own clock
  ends_at: string;
  is_dismissible: boolean;
}

const EMPTY_FORM: FormState = {
  message: '', kind: 'info', link_url: '', link_label: '', starts_at: '', ends_at: '', is_dismissible: true,
};

const STATES: readonly TeamNoticeState[] = ['live', 'scheduled', 'expired', 'ended'];
const STATE_COLOR: Record<TeamNoticeState, 'success' | 'accent' | 'default' | 'warning'> = {
  live: 'success', scheduled: 'accent', expired: 'default', ended: 'warning',
};

/** Server time (ISO) → the value a datetime-local field wants, in the writer's own time. */
function toLocalField(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A datetime-local value (the writer's own time) → ISO with the zone stated, or null when empty. */
function fromLocalField(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function PlatformNoticesPage() {
  const { t, i18n } = useTranslation('platform_team');
  const toast = useToast();
  usePageTitle(t('notices.title'));

  const [notices, setNotices] = useState<TeamNotice[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<TeamNotice | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toEnd, setToEnd] = useState<TeamNotice | null>(null);
  const [ending, setEnding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await api.get<{ notices: TeamNotice[] }>('/v2/platform-team/notices');
      if (res.success && res.data && Array.isArray(res.data.notices)) {
        setNotices(res.data.notices);
      } else {
        setNotices(null);
        setFailed(true);
      }
    } catch (err) {
      logError('Failed to load the platform notices', err);
      setNotices(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEdit = (notice: TeamNotice) => {
    setEditing(notice);
    setForm({
      message: notice.message,
      kind: noticeKind(notice.kind),
      link_url: notice.link_url ?? '',
      link_label: notice.link_label ?? '',
      starts_at: toLocalField(notice.starts_at),
      ends_at: toLocalField(notice.ends_at),
      is_dismissible: notice.is_dismissible,
    });
    setFormError(null);
    setIsFormOpen(true);
  };

  const message = form.message.trim();
  const link = form.link_url.trim();
  const linkOk = link === '' || httpsLink(link) !== null;
  // The band shows a link only with its words, so a link needs them.
  const labelOk = link === '' || form.link_label.trim() !== '';
  const startsAt = fromLocalField(form.starts_at);
  const endsAt = fromLocalField(form.ends_at);
  const datesOk = !startsAt || !endsAt || Date.parse(endsAt) > Date.parse(startsAt);
  const canSave = message !== '' && message.length <= PLATFORM_NOTICE_MAX_MESSAGE && linkOk && labelOk && datesOk && !saving;

  // The real band, from what is in the form right now.
  const preview = useMemo<PlatformNotice>(() => {
    const safe = httpsLink(form.link_url);
    const label = form.link_label.trim();
    return {
      id: editing?.id ?? 0,
      message: message || t('notices.form.preview_placeholder'),
      kind: form.kind,
      link_url: safe && label ? safe : null,
      link_label: safe && label ? label : null,
      is_dismissible: form.is_dismissible,
    };
  }, [editing?.id, form.is_dismissible, form.kind, form.link_label, form.link_url, message, t]);

  /** The server's refusal, in this page's own words, by the field it names. */
  const refusal = (field: string | undefined): string => {
    switch (field) {
      case 'message':
        return t('notices.form.message_required');
      case 'link_url':
        return t('notices.form.link_hint');
      case 'link_label':
        return t('notices.form.link_label_required');
      case 'starts_at':
      case 'ends_at':
        return t('notices.form.until_before_from');
      default:
        return t('notices.save_failed');
    }
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setFormError(null);
    const payload = {
      message,
      kind: form.kind,
      link_url: link || null,
      link_label: form.link_label.trim() || null,
      starts_at: startsAt,
      ends_at: endsAt,
      is_dismissible: form.is_dismissible,
    };
    try {
      const res = editing
        ? await api.put<{ notice: TeamNotice }>(`/v2/platform-team/notices/${editing.id}`, payload)
        : await api.post<{ notice: TeamNotice }>('/v2/platform-team/notices', payload);
      if (res.success) {
        toast.success(t('notices.saved'));
        setIsFormOpen(false);
        await load();
      } else {
        setFormError(refusal(res.errors?.[0]?.field));
      }
    } catch (err) {
      logError('Saving a platform notice did not complete', err);
      setFormError(t('notices.save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const end = async () => {
    if (!toEnd) return;
    setEnding(true);
    try {
      const res = await api.post<{ notice: TeamNotice }>(`/v2/platform-team/notices/${toEnd.id}/end`);
      if (res.success) {
        toast.success(t('notices.ended_toast'));
        setToEnd(null);
        await load();
      } else {
        toast.error(t('notices.save_failed'));
      }
    } catch (err) {
      logError('Ending a platform notice did not complete', err);
      toast.error(t('notices.save_failed'));
    } finally {
      setEnding(false);
    }
  };

  const when = (iso: string | null): string | null => {
    if (!iso) return null;
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? null
      : date.toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  };

  const fact = (label: string, value: string) => (
    <div className="flex gap-1">
      <dt>{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );

  return (
    <section className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">{t('notices.title')}</h1>
          <p className="mt-2 max-w-2xl text-base text-muted">{t('notices.intro')}</p>
        </div>
        <Button onPress={openCreate}>
          <Plus size={16} aria-hidden="true" />
          {t('notices.new')}
        </Button>
      </div>

      {loading && !notices ? (
        <div role="status" aria-busy="true" aria-label={t('notices.loading')} className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : failed || !notices ? (
        <LoadError title={t('notices.load_error_title')} onRetry={() => void load()} />
      ) : notices.length === 0 ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-2 p-10 text-center">
            <Megaphone size={32} className="text-muted" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-foreground">{t('notices.empty_title')}</h2>
            <p className="text-sm text-muted">{t('notices.empty_text')}</p>
          </CardBody>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {notices.map((notice) => {
            const state: TeamNoticeState = STATES.includes(notice.state) ? notice.state : 'ended';
            const from = when(notice.starts_at);
            const until = when(notice.ends_at);
            const canEnd = state === 'live' || state === 'scheduled';
            return (
              <li key={notice.id} data-testid={`team-notice-${notice.id}`}>
                <Card>
                  <CardBody className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="break-words text-base font-medium text-foreground">{notice.message}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Chip size="sm" variant="soft" color={STATE_COLOR[state]}>
                          {t(`notices.state.${state}`)}
                        </Chip>
                        <Chip size="sm" variant="soft" color="default">
                          {t(`notices.kind.${noticeKind(notice.kind)}`)}
                        </Chip>
                        {!notice.is_dismissible ? (
                          <Chip size="sm" variant="soft" color="default">
                            {t('notices.cannot_close')}
                          </Chip>
                        ) : null}
                      </div>
                      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                        {from ? fact(t('notices.from'), from) : null}
                        {until ? fact(t('notices.until'), until) : null}
                        {notice.written_by ? fact(t('notices.written_by'), notice.written_by) : null}
                        {notice.is_dismissible ? fact(t('notices.closed_count'), String(notice.closed_count)) : null}
                      </dl>
                    </div>
                    {state !== 'ended' ? (
                      <div className="flex shrink-0 gap-2">
                        <Button size="sm" variant="tertiary" onPress={() => openEdit(notice)}>
                          <Edit size={14} aria-hidden="true" />
                          {t('notices.change')}
                        </Button>
                        {canEnd ? (
                          <Button size="sm" variant="danger" onPress={() => setToEnd(notice)}>
                            <Square size={14} aria-hidden="true" />
                            {t('notices.end')}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </CardBody>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Modal isOpen={isFormOpen} onClose={() => !saving && setIsFormOpen(false)} size="lg">
        <ModalContent>
          <ModalHeader>{editing ? t('notices.form.title_edit') : t('notices.form.title_new')}</ModalHeader>
          <ModalBody className="space-y-4">
            {/* What admins will see, as it is typed. */}
            <div>
              <p className="mb-1.5 text-sm font-medium text-foreground">{t('notices.form.preview')}</p>
              <div data-testid="notice-preview">
                <PlatformNoticeView notice={preview} onClose={() => undefined} />
              </div>
              <p className="mt-1.5 text-xs text-muted">{t('notices.form.language_note')}</p>
            </div>

            <Textarea
              label={t('notices.form.message')}
              description={`${t('notices.form.message_hint')} ${message.length}/${PLATFORM_NOTICE_MAX_MESSAGE}`}
              value={form.message}
              onValueChange={(v) => setForm((prev) => ({ ...prev, message: v }))}
              maxLength={PLATFORM_NOTICE_MAX_MESSAGE}
              minRows={2}
              isRequired
              variant="secondary"
            />

            <Select
              label={t('notices.form.kind')}
              selectedKeys={new Set([form.kind])}
              onSelectionChange={(keys) => {
                const selected = Array.from(keys)[0] as PlatformNoticeKind | undefined;
                if (selected) setForm((prev) => ({ ...prev, kind: selected }));
              }}
              variant="secondary"
            >
              {PLATFORM_NOTICE_KINDS.map((kind) => (
                <SelectItem key={kind} id={kind}>{t(`notices.kind.${kind}`)}</SelectItem>
              ))}
            </Select>

            <Input
              label={t('notices.form.link')}
              description={t('notices.form.link_hint')}
              value={form.link_url}
              onValueChange={(v) => setForm((prev) => ({ ...prev, link_url: v }))}
              isInvalid={!linkOk}
              errorMessage={!linkOk ? t('notices.form.link_hint') : undefined}
              variant="secondary"
            />
            <Input
              label={t('notices.form.link_label')}
              value={form.link_label}
              onValueChange={(v) => setForm((prev) => ({ ...prev, link_label: v }))}
              isInvalid={!labelOk}
              errorMessage={!labelOk ? t('notices.form.link_label_required') : undefined}
              maxLength={PLATFORM_NOTICE_MAX_LINK_LABEL}
              variant="secondary"
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                type="datetime-local"
                label={t('notices.form.from')}
                value={form.starts_at}
                onValueChange={(v) => setForm((prev) => ({ ...prev, starts_at: v }))}
                variant="secondary"
              />
              <Input
                type="datetime-local"
                label={t('notices.form.until')}
                value={form.ends_at}
                onValueChange={(v) => setForm((prev) => ({ ...prev, ends_at: v }))}
                isInvalid={!datesOk}
                errorMessage={!datesOk ? t('notices.form.until_before_from') : undefined}
                variant="secondary"
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium text-foreground">{t('notices.form.can_close')}</p>
                <p className="text-sm text-muted">{t('notices.form.can_close_hint')}</p>
              </div>
              <Switch
                isSelected={form.is_dismissible}
                onValueChange={(v) => setForm((prev) => ({ ...prev, is_dismissible: v }))}
                aria-label={t('notices.form.can_close')}
              />
            </div>

            {formError ? (
              <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground">
                {formError}
              </p>
            ) : null}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setIsFormOpen(false)} isDisabled={saving}>
              {t('notices.form.cancel')}
            </Button>
            <Button onPress={() => void save()} isLoading={saving} isDisabled={!canSave}>
              {t('notices.form.save')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <ConfirmModal
        isOpen={toEnd !== null}
        onClose={() => setToEnd(null)}
        onConfirm={() => void end()}
        title={t('notices.end_title')}
        message={t('notices.end_message')}
        confirmLabel={t('notices.end_confirm')}
        cancelLabel={t('notices.keep')}
        confirmColor="danger"
        isLoading={ending}
      />
    </section>
  );
}

export default PlatformNoticesPage;
