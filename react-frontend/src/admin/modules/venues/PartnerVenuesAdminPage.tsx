// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * PartnerVenuesAdminPage — tenant-admin management of partner venues, their
 * staff rosters, and the engagement recorded at each one.
 *
 * The "offer" field is descriptive text only. The platform records visits; it
 * does not issue coupons or apply discounts (that stays in the marketplace /
 * merchant-coupon modules, which are separate and off by default).
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  CardBody,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  useConfirm,
} from '@/components/ui';
import { Select, SelectItem } from '@/components/ui/Select';
import Plus from 'lucide-react/icons/plus';
import Download from 'lucide-react/icons/download';
import UsersIcon from 'lucide-react/icons/users';
import Archive from 'lucide-react/icons/archive';
import Pencil from 'lucide-react/icons/pencil';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { PageHeader } from '../../components/PageHeader';
import {
  partnerVenuesApi,
  type PartnerVenueAdminRow,
  type VenueStaffRow,
  type VenueSummary,
} from '@/lib/partner-venues-api';

const CATEGORIES = ['cafe', 'shop', 'leisure', 'community', 'other'] as const;
const STATUSES = ['active', 'paused', 'archived'] as const;

interface VenueForm {
  name: string;
  category: string;
  offer_summary: string;
  description: string;
  address_line: string;
  city: string;
  postcode: string;
  website: string;
  contact_email: string;
  status: string;
}

const EMPTY_FORM: VenueForm = {
  name: '',
  category: 'cafe',
  offer_summary: '',
  description: '',
  address_line: '',
  city: '',
  postcode: '',
  website: '',
  contact_email: '',
  status: 'active',
};

export default function PartnerVenuesAdminPage() {
  const { t } = useTranslation(['venues', 'common']);
  usePageTitle(t('venues:admin.title'));
  const toast = useToast();
  const confirm = useConfirm();

  const [venues, setVenues] = useState<PartnerVenueAdminRow[]>([]);
  const [summary, setSummary] = useState<VenueSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<VenueForm>(EMPTY_FORM);

  const [staffVenue, setStaffVenue] = useState<PartnerVenueAdminRow | null>(null);
  const [staff, setStaff] = useState<VenueStaffRow[]>([]);
  const [newStaffId, setNewStaffId] = useState('');
  const [newStaffRole, setNewStaffRole] = useState('member');

  const load = useCallback(async () => {
    setLoading(true);
    const [listRes, summaryRes] = await Promise.all([
      partnerVenuesApi.adminList(),
      partnerVenuesApi.adminSummary(),
    ]);

    if (listRes.success && listRes.data) {
      setVenues(listRes.data.venues ?? []);
    }
    if (summaryRes.success && summaryRes.data) {
      setSummary(summaryRes.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setEditorOpen(true);
  }

  function openEdit(venue: PartnerVenueAdminRow) {
    setEditingId(venue.id);
    setForm({
      name: venue.name ?? '',
      category: venue.category ?? 'cafe',
      offer_summary: venue.offer_summary ?? '',
      description: venue.description ?? '',
      address_line: venue.address_line ?? '',
      city: venue.city ?? '',
      postcode: venue.postcode ?? '',
      website: venue.website ?? '',
      contact_email: venue.contact_email ?? '',
      status: venue.status ?? 'active',
    });
    setEditorOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);

    // Send only populated optional fields — the API validates url/email shapes
    // and would reject empty strings.
    const payload: Record<string, string> = { name: form.name.trim(), status: form.status };
    (['category', 'offer_summary', 'description', 'address_line', 'city', 'postcode', 'website', 'contact_email'] as const)
      .forEach((key) => {
        const value = form[key].trim();
        if (value !== '') payload[key] = value;
      });

    const res = editingId
      ? await partnerVenuesApi.adminUpdate(editingId, payload)
      : await partnerVenuesApi.adminCreate(payload);

    if (res.success) {
      toast.success(t('venues:admin.saved'));
      setEditorOpen(false);
      await load();
    } else {
      // Admin UI shows its own translated message rather than passing the
      // server string through — see scripts/check-admin-ui-literals.mjs.
      toast.error(t('venues:admin.save_failed'));
    }
    setSaving(false);
  }

  async function handleArchive(venue: PartnerVenueAdminRow) {
    const ok = await confirm({
      title: t('venues:admin.archive_confirm'),
      status: 'warning',
      confirmLabel: t('common:confirm'),
    });
    if (!ok) return;

    const res = await partnerVenuesApi.adminArchive(venue.id);
    if (res.success) {
      toast.success(t('venues:admin.archived'));
      await load();
    } else {
      toast.error(t('venues:admin.save_failed'));
    }
  }

  async function openStaff(venue: PartnerVenueAdminRow) {
    setStaffVenue(venue);
    setNewStaffId('');
    setNewStaffRole('member');
    const res = await partnerVenuesApi.adminStaff(venue.id);
    setStaff(res.success && res.data ? res.data.staff ?? [] : []);
  }

  async function handleAddStaff() {
    if (!staffVenue || !newStaffId.trim()) return;
    const res = await partnerVenuesApi.adminAddStaff(staffVenue.id, Number(newStaffId), newStaffRole);
    if (res.success && res.data) {
      setStaff(res.data.staff ?? []);
      setNewStaffId('');
      toast.success(t('venues:admin.staff_added'));
      await load();
    } else {
      toast.error(t('venues:admin.staff_add_failed'));
    }
  }

  async function handleRemoveStaff(userId: number) {
    if (!staffVenue) return;
    const res = await partnerVenuesApi.adminRemoveStaff(staffVenue.id, userId);
    if (res.success && res.data) {
      setStaff(res.data.staff ?? []);
      toast.success(t('venues:admin.staff_removed'));
      await load();
    }
  }

  async function handleExport() {
    try {
      const blob = await partnerVenuesApi.adminExportCsv();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `partner-venue-visits-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t('venues:admin.export_failed'));
    }
  }

  const statusColor = (status: string) =>
    status === 'active' ? 'success' : status === 'paused' ? 'warning' : 'default';

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('venues:admin.title')}
        description={t('venues:admin.intro')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onPress={handleExport}>
              <Download className="w-4 h-4 mr-2" aria-hidden="true" />
              {t('venues:admin.export_csv')}
            </Button>
            <Button color="primary" onPress={openCreate}>
              <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
              {t('venues:admin.add_venue')}
            </Button>
          </div>
        }
      />

      {summary && (
        <Card>
          <CardBody>
            <p className="text-sm text-theme-muted">{t('venues:admin.total_visits')}</p>
            <p className="text-3xl font-semibold">{summary.total_visits}</p>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody>
          {loading ? (
            <div className="py-12 text-center">
              <Spinner className="mx-auto" aria-label={t('venues:loading')} />
            </div>
          ) : venues.length === 0 ? (
            <p className="py-12 text-center text-theme-muted">{t('venues:admin.empty')}</p>
          ) : (
            <Table aria-label={t('venues:admin.title')}>
              <TableHeader>
                <TableColumn>{t('venues:admin.name')}</TableColumn>
                <TableColumn>{t('venues:admin.status')}</TableColumn>
                <TableColumn>{t('venues:admin.visits')}</TableColumn>
                <TableColumn>{t('venues:admin.members')}</TableColumn>
                <TableColumn>{t('venues:admin.staff')}</TableColumn>
                <TableColumn>{t('venues:admin.manage_column')}</TableColumn>
              </TableHeader>
              <TableBody>
                {venues.map((venue) => (
                  <TableRow key={venue.id}>
                    <TableCell>
                      <div className="font-medium">{venue.name}</div>
                      {venue.offer_summary && (
                        <div className="text-xs text-theme-muted">{venue.offer_summary}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip color={statusColor(venue.status)} variant="secondary">
                        {/* Every status the API can return has a key, so no raw fallback. */}
                        {t(`venues:admin.status_${venue.status}`)}
                      </Chip>
                    </TableCell>
                    <TableCell>{venue.visit_count}</TableCell>
                    <TableCell>{venue.member_count}</TableCell>
                    <TableCell>{venue.staff_count}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          isIconOnly
                          variant="tertiary"
                          aria-label={t('venues:admin.edit_venue')}
                          onPress={() => openEdit(venue)}
                        >
                          <Pencil className="w-4 h-4" aria-hidden="true" />
                        </Button>
                        <Button
                          isIconOnly
                          variant="tertiary"
                          aria-label={t('venues:admin.manage_staff')}
                          onPress={() => void openStaff(venue)}
                        >
                          <UsersIcon className="w-4 h-4" aria-hidden="true" />
                        </Button>
                        <Button
                          isIconOnly
                          variant="tertiary"
                          aria-label={t('venues:admin.archive')}
                          onPress={() => void handleArchive(venue)}
                        >
                          <Archive className="w-4 h-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Venue editor */}
      <Modal isOpen={editorOpen} onClose={() => setEditorOpen(false)} size="lg">
        <ModalContent>
        <ModalHeader>{editingId ? t('venues:admin.edit_venue') : t('venues:admin.add_venue')}</ModalHeader>
        <ModalBody className="space-y-4">
          <Input
            label={t('venues:admin.name')}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            isRequired
          />
          <Select
            label={t('venues:admin.category')}
            selectedKeys={[form.category]}
            onSelectionChange={(keys) => {
              if (keys === 'all') return;
              const first = Array.from(keys)[0];
              if (first !== undefined) setForm({ ...form, category: String(first) });
            }}
          >
            {CATEGORIES.map((category) => (
              <SelectItem key={category} id={category}>
                {t(`venues:categories.${category}`)}
              </SelectItem>
            ))}
          </Select>
          <Input
            label={t('venues:admin.offer_summary')}
            description={t('venues:admin.offer_summary_hint')}
            value={form.offer_summary}
            onChange={(e) => setForm({ ...form, offer_summary: e.target.value })}
          />
          <Input
            label={t('venues:admin.address_line')}
            value={form.address_line}
            onChange={(e) => setForm({ ...form, address_line: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('venues:admin.city')}
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
            <Input
              label={t('venues:admin.postcode')}
              value={form.postcode}
              onChange={(e) => setForm({ ...form, postcode: e.target.value })}
            />
          </div>
          <Input
            label={t('venues:admin.website')}
            value={form.website}
            onChange={(e) => setForm({ ...form, website: e.target.value })}
          />
          <Input
            label={t('venues:admin.contact_email')}
            type="email"
            value={form.contact_email}
            onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
          />
          <Select
            label={t('venues:admin.status')}
            selectedKeys={[form.status]}
            onSelectionChange={(keys) => {
              if (keys === 'all') return;
              const first = Array.from(keys)[0];
              if (first !== undefined) setForm({ ...form, status: String(first) });
            }}
          >
            {STATUSES.map((status) => (
              <SelectItem key={status} id={status}>
                {t(`venues:admin.status_${status}`)}
              </SelectItem>
            ))}
          </Select>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onPress={() => setEditorOpen(false)}>
              {t('venues:admin.cancel')}
            </Button>
            <Button
              color="primary"
              isDisabled={saving || !form.name.trim()}
              data-testid="venue-save"
              onPress={handleSave}
            >
              {t('venues:admin.save')}
            </Button>
          </div>
        </ModalBody>
        </ModalContent>
      </Modal>

      {/* Staff roster */}
      <Modal isOpen={staffVenue !== null} onClose={() => setStaffVenue(null)} size="lg">
        <ModalContent>
        <ModalHeader>
          {staffVenue ? `${staffVenue.name} — ${t('venues:admin.staff')}` : ''}
        </ModalHeader>
        <ModalBody className="space-y-4">
          {staff.length === 0 ? (
            <p className="text-theme-muted text-sm">{t('venues:admin.add_staff')}</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {staff.map((row) => (
                <li key={row.id} className="py-2 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{row.name || `#${row.user_id}`}</div>
                    <div className="text-xs text-theme-muted">
                      {t(`venues:admin.role_${row.role}`)}
                    </div>
                  </div>
                  <Button variant="tertiary" onPress={() => void handleRemoveStaff(row.user_id)}>
                    {t('venues:admin.remove')}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-2 gap-3 items-end">
            <Input
              label={t('venues:admin.staff_member_id')}
              type="number"
              value={newStaffId}
              onChange={(e) => setNewStaffId(e.target.value)}
            />
            <Select
              label={t('venues:admin.staff_role')}
              selectedKeys={[newStaffRole]}
              onSelectionChange={(keys) => {
                if (keys === 'all') return;
                const first = Array.from(keys)[0];
                if (first !== undefined) setNewStaffRole(String(first));
              }}
            >
              {(['owner', 'admin', 'member'] as const).map((role) => (
                <SelectItem key={role} id={role}>
                  {t(`venues:admin.role_${role}`)}
                </SelectItem>
              ))}
            </Select>
          </div>
          <Button
            color="primary"
            isDisabled={!newStaffId.trim()}
            onPress={handleAddStaff}
          >
            {t('venues:admin.add_staff')}
          </Button>
        </ModalBody>
        </ModalContent>
      </Modal>
    </div>
  );
}
