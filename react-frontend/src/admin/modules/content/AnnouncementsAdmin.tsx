// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Announcements Admin (warmth phase 5).
 *
 * A community's admins write one-line notices that show across the top of
 * their community's member website. The form shows the real banner as they
 * type (SiteAnnouncementView, the same component members see).
 *
 * Server: SiteAnnouncementAdminController — GET/POST /v2/admin/announcements,
 * PUT/DELETE /v2/admin/announcements/{id}; current community only.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Megaphone from 'lucide-react/icons/megaphone';
import Plus from 'lucide-react/icons/plus';
import Edit from 'lucide-react/icons/square-pen';
import Trash2 from 'lucide-react/icons/trash-2';
import {
  Alert, Button, Card, CardBody, Chip, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader,
  Select, SelectItem, Switch, Textarea,
} from '@/components/ui';
import { usePageTitle } from '@/hooks';
import { getFormattingLocale } from '@/lib/helpers';
import { useTenant, useToast } from '@/contexts';
import { SiteAnnouncementView } from '@/components/layout/SiteAnnouncementBanner';
import { ANNOUNCEMENT_STYLES, safeAnnouncementLink, type AnnouncementStyle, type SiteAnnouncement } from '@/lib/siteAnnouncement';
import { adminAnnouncements, type AdminAnnouncement } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';
import { EmptyState } from '../../components/EmptyState';

const MAX_MESSAGE = 280;

interface FormState {
  message: string;
  style: AnnouncementStyle;
  link_url: string;
  link_label: string;
  starts_at: string; // <input type="datetime-local"> value, the admin's own clock
  ends_at: string;
  is_dismissible: boolean;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  message: '', style: 'info', link_url: '', link_label: '', starts_at: '', ends_at: '',
  is_dismissible: true, is_active: true,
};

/** Server time (ISO, UTC) → the value a datetime-local field wants, in the admin's own time. */
export function toLocalField(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A datetime-local value (the admin's own time) → ISO with the zone stated, or null when empty. */
export function fromLocalField(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export type AnnouncementStatus = 'off' | 'scheduled' | 'ended' | 'showing';

export function announcementStatus(item: Pick<AdminAnnouncement, 'is_active' | 'starts_at' | 'ends_at'>, now = Date.now()): AnnouncementStatus {
  if (!item.is_active) return 'off';
  const start = item.starts_at ? Date.parse(item.starts_at) : null;
  const end = item.ends_at ? Date.parse(item.ends_at) : null;
  if (end !== null && !Number.isNaN(end) && end <= now) return 'ended';
  if (start !== null && !Number.isNaN(start) && start > now) return 'scheduled';
  return 'showing';
}

const STATUS_COLOR: Record<AnnouncementStatus, 'success' | 'accent' | 'default' | 'warning'> = {
  showing: 'success', scheduled: 'accent', ended: 'default', off: 'warning',
};
const STATUS_KEY: Record<AnnouncementStatus, string> = {
  showing: 'content.announcements_status_showing',
  scheduled: 'content.announcements_status_scheduled',
  ended: 'content.announcements_status_ended',
  off: 'content.announcements_status_off',
};
const STYLE_KEY: Record<AnnouncementStyle, string> = {
  info: 'content.announcements_style_info',
  celebration: 'content.announcements_style_celebration',
  important: 'content.announcements_style_important',
};

export function AnnouncementsAdmin() {
  const { t } = useTranslation('admin_content');
  usePageTitle(t('content.announcements_title'));
  const toast = useToast();
  const { tenantPath } = useTenant();

  const [items, setItems] = useState<AdminAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState<AdminAnnouncement | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminAnnouncement | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminAnnouncements.list();
      if (res.success && res.data && Array.isArray(res.data.items)) {
        setItems(res.data.items);
        setLoadFailed(false);
      } else {
        setLoadFailed(true);
      }
    } catch {
      setLoadFailed(true);
    }
    setLoading(false);
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

  const openEdit = (item: AdminAnnouncement) => {
    setEditing(item);
    setForm({
      message: item.message,
      style: (ANNOUNCEMENT_STYLES as readonly string[]).includes(item.style) ? (item.style as AnnouncementStyle) : 'info',
      link_url: item.link_url ?? '',
      link_label: item.link_label ?? '',
      starts_at: toLocalField(item.starts_at),
      ends_at: toLocalField(item.ends_at),
      is_dismissible: item.is_dismissible,
      is_active: item.is_active,
    });
    setFormError(null);
    setIsFormOpen(true);
  };

  const message = form.message.trim();
  const linkOk = form.link_url.trim() === '' || safeAnnouncementLink(form.link_url) !== null;
  const canSave = message !== '' && message.length <= MAX_MESSAGE && linkOk && !saving;

  // The real banner, from what is in the form right now.
  const preview = useMemo<SiteAnnouncement>(() => {
    const link = safeAnnouncementLink(form.link_url);
    const label = form.link_label.trim();
    return {
      id: editing?.id ?? 0,
      message: message || t('content.announcements_preview_placeholder'),
      style: form.style,
      linkUrl: link?.url ?? null,
      linkLabel: link && label ? label : null,
      linkIsInternal: link?.internal ?? false,
      isDismissible: form.is_dismissible,
      version: '',
    };
  }, [editing?.id, form.is_dismissible, form.link_label, form.link_url, form.style, message, t]);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setFormError(null);
    const payload = {
      message,
      style: form.style,
      link_url: form.link_url.trim() || null,
      link_label: form.link_label.trim() || null,
      starts_at: fromLocalField(form.starts_at),
      ends_at: fromLocalField(form.ends_at),
      is_dismissible: form.is_dismissible,
      is_active: form.is_active,
    };
    try {
      const res = editing
        ? await adminAnnouncements.update(editing.id, payload)
        : await adminAnnouncements.create(payload);
      if (res.success) {
        toast.success(t('content.announcements_saved'));
        setIsFormOpen(false);
        await load();
      } else {
        // admin-i18n-ignore: localized server message (SiteAnnouncementService refusals are __() keys).
        setFormError(res.error || t('content.announcements_save_failed'));
      }
    } catch {
      setFormError(t('content.announcements_save_failed'));
    }
    setSaving(false);
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await adminAnnouncements.delete(deleteTarget.id);
      if (res.success) {
        toast.success(t('content.announcements_deleted'));
        setDeleteTarget(null);
        await load();
      } else {
        toast.error(t('content.announcements_save_failed'));
      }
    } catch {
      toast.error(t('content.announcements_save_failed'));
    }
    setDeleting(false);
  };

  const formatWhen = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(getFormattingLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : null;

  return (
    <div>
      <PageHeader
        title={t('content.announcements_title')}
        description={t('content.announcements_desc')}
        actions={
          <Button startContent={<Plus size={16} />} onPress={openCreate}>
            {t('content.announcements_new')}
          </Button>
        }
      />

      <Alert color="default" className="mb-4" title={t('content.announcements_delay_note')} />

      {loadFailed && <Alert color="danger" className="mb-4" title={t('content.announcements_load_failed')} />}

      {!loading && !loadFailed && items.length === 0 && (
        <EmptyState
          icon={Megaphone}
          title={t('content.announcements_empty_title')}
          description={t('content.announcements_empty_desc')}
          actionLabel={t('content.announcements_new')}
          onAction={openCreate}
        />
      )}

      <ul className="space-y-3" aria-busy={loading}>
        {items.map((item) => {
          const status = announcementStatus(item);
          const from = formatWhen(item.starts_at);
          const until = formatWhen(item.ends_at);
          return (
            <li key={item.id} data-testid={`announcement-row-${item.id}`}>
              <Card>
                <CardBody className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">{item.message}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <Chip size="sm" variant="soft" color={STATUS_COLOR[status]}>{t(STATUS_KEY[status])}</Chip>
                      <Chip size="sm" variant="soft" color="default">
                        {t(STYLE_KEY[(ANNOUNCEMENT_STYLES as readonly string[]).includes(item.style) ? (item.style as AnnouncementStyle) : 'info'])}
                      </Chip>
                      {from && <span>{t('content.announcements_starts')}: {from}</span>}
                      {until && <span>{t('content.announcements_ends')}: {until}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="tertiary" startContent={<Edit size={14} />} onPress={() => openEdit(item)}>
                      {t('content.announcements_edit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="tertiary"
                      className="text-danger"
                      startContent={<Trash2 size={14} />}
                      onPress={() => setDeleteTarget(item)}
                    >
                      {t('content.label_delete_item')}
                    </Button>
                  </div>
                </CardBody>
              </Card>
            </li>
          );
        })}
      </ul>

      <Modal isOpen={isFormOpen} onClose={() => !saving && setIsFormOpen(false)} size="lg">
        <ModalContent>
          <ModalHeader>{editing ? t('content.announcements_edit') : t('content.announcements_new')}</ModalHeader>
          <ModalBody className="space-y-4">
            {/* What members will see, as it is typed. */}
            <div>
              <p className="mb-1.5 text-sm font-medium text-foreground">{t('content.announcements_preview')}</p>
              <div data-testid="announcement-preview" className="overflow-hidden rounded-xl border border-divider">
                <SiteAnnouncementView announcement={preview} linkPath={tenantPath} />
              </div>
            </div>

            <Textarea
              label={t('content.announcements_message')}
              description={`${t('content.announcements_message_hint')} ${message.length}/${MAX_MESSAGE}`}
              value={form.message}
              onValueChange={(v) => setForm((prev) => ({ ...prev, message: v }))}
              maxLength={MAX_MESSAGE}
              minRows={2}
              isRequired
              variant="secondary"
            />

            <Select
              label={t('content.announcements_style')}
              selectedKeys={new Set([form.style])}
              onSelectionChange={(keys) => {
                const selected = Array.from(keys)[0] as AnnouncementStyle | undefined;
                if (selected) setForm((prev) => ({ ...prev, style: selected }));
              }}
              variant="secondary"
            >
              {ANNOUNCEMENT_STYLES.map((style) => (
                <SelectItem key={style} id={style}>{t(STYLE_KEY[style])}</SelectItem>
              ))}
            </Select>

            <Input
              label={t('content.announcements_link_url')}
              description={t('content.announcements_link_url_hint')}
              value={form.link_url}
              onValueChange={(v) => setForm((prev) => ({ ...prev, link_url: v }))}
              isInvalid={!linkOk}
              errorMessage={!linkOk ? t('content.announcements_link_url_hint') : undefined}
              variant="secondary"
            />
            <Input
              label={t('content.announcements_link_label')}
              value={form.link_label}
              onValueChange={(v) => setForm((prev) => ({ ...prev, link_label: v }))}
              maxLength={60}
              variant="secondary"
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                type="datetime-local"
                label={t('content.announcements_starts')}
                value={form.starts_at}
                onValueChange={(v) => setForm((prev) => ({ ...prev, starts_at: v }))}
                variant="secondary"
              />
              <Input
                type="datetime-local"
                label={t('content.announcements_ends')}
                value={form.ends_at}
                onValueChange={(v) => setForm((prev) => ({ ...prev, ends_at: v }))}
                variant="secondary"
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <p className="font-medium text-foreground">{t('content.announcements_dismissible')}</p>
              <Switch
                isSelected={form.is_dismissible}
                onValueChange={(v) => setForm((prev) => ({ ...prev, is_dismissible: v }))}
                aria-label={t('content.announcements_dismissible')}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <p className="font-medium text-foreground">{t('content.announcements_active')}</p>
              <Switch
                isSelected={form.is_active}
                onValueChange={(v) => setForm((prev) => ({ ...prev, is_active: v }))}
                aria-label={t('content.announcements_active')}
              />
            </div>

            {formError && <Alert color="danger" title={formError} />}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setIsFormOpen(false)} isDisabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button onPress={save} isLoading={saving} isDisabled={!canSave}>
              {t('content.save_changes')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {deleteTarget && (
        <ConfirmModal
          isOpen
          onClose={() => setDeleteTarget(null)}
          onConfirm={remove}
          title={t('content.announcements_delete_title')}
          message={t('content.announcements_delete_confirm')}
          confirmLabel={t('content.label_delete_item')}
          confirmColor="danger"
          isLoading={deleting}
        />
      )}
    </div>
  );
}

export default AnnouncementsAdmin;
