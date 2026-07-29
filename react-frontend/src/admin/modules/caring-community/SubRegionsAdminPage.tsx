import { CardBody, Card, Select, SelectItem, Button, Chip, Spinner, Input, Textarea, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow, useConfirm } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * SubRegionsAdminPage — AG77 Sub-Regional Geographic Units Admin
 *
 * Manages tenant-scoped Quartier/Ortsteil/municipality/canton subdivisions
 * used by the care-provider directory and member-facing locality filters.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Info from 'lucide-react/icons/info';
import Plus from 'lucide-react/icons/plus';
import Pencil from 'lucide-react/icons/pencil';
import Trash2 from 'lucide-react/icons/trash-2';
import MapPin from 'lucide-react/icons/map-pin';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type SubRegionType = 'quartier' | 'ortsteil' | 'municipality' | 'canton' | 'other';

interface SubRegion {
  id: number;
  name: string;
  slug: string;
  type: SubRegionType;
  description: string | null;
  postal_codes: string[] | null;
  center_latitude: number | null;
  center_longitude: number | null;
  status: 'active' | 'inactive';
  created_at: string | null;
}

interface ListResponse {
  data: SubRegion[];
  total: number;
  per_page: number;
  current_page: number;
}

interface FormData {
  name: string;
  slug: string;
  type: SubRegionType | '';
  description: string;
  postal_codes: string;
  center_latitude: string;
  center_longitude: string;
  status: 'active' | 'inactive';
}

const EMPTY_FORM: FormData = {
  name: '',
  slug: '',
  type: '',
  description: '',
  postal_codes: '',
  center_latitude: '',
  center_longitude: '',
  status: 'active',
};

const REGION_TYPES: SubRegionType[] = ['quartier', 'ortsteil', 'municipality', 'canton', 'other'];

const TYPE_FILTER_OPTIONS: Array<SubRegionType | 'all'> = ['all', ...REGION_TYPES];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

type ChipColor = 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger';

function typeColor(type: SubRegionType): ChipColor {
  switch (type) {
    case 'quartier':     return 'primary';
    case 'ortsteil':     return 'secondary';
    case 'municipality': return 'success';
    case 'canton':       return 'warning';
    default:             return 'default';
  }
}

function parsePostalCodes(value: string): string[] {
  return value
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function postalCodesPreview(codes: string[] | null): string {
  if (!codes || codes.length === 0) return '—';
  if (codes.length <= 3) return codes.join(', ');
  return `${codes.slice(0, 3).join(', ')} +${codes.length - 3}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function SubRegionsAdminPage() {
  const { t } = useTranslation(['admin_caring_community', 'common']);
  const confirm = useConfirm();
  usePageTitle(t('sub_regions.meta.page_title'));
  const { showToast } = useToast();

  const [regions, setRegions] = useState<SubRegion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<SubRegionType | 'all'>('all');

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SubRegion | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof FormData, string>>>({});

  // ── Fetch ────────────────────────────────────────────────────────────────

  const fetchRegions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (search.trim()) params.search = search.trim();
      if (typeFilter !== 'all') params.type = typeFilter;

      const query = new URLSearchParams(params).toString();
      const url = '/v2/admin/caring-community/sub-regions' + (query ? `?${query}` : '');
      const res = await api.get<ListResponse>(url);
      setRegions(res.data?.data ?? []);
    } catch (err) {
      logError('SubRegionsAdminPage.fetch', err);
      setError(t('sub_regions.errors.load_failed'));
    } finally {
      setLoading(false);
    }
  }, [search, t, typeFilter]);

  useEffect(() => {
    void fetchRegions();
  }, [fetchRegions]);

  // ── Modal helpers ────────────────────────────────────────────────────────

  function openCreate() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setModalOpen(true);
  }

  function openEdit(region: SubRegion) {
    setEditTarget(region);
    setForm({
      name: region.name,
      slug: region.slug,
      type: region.type,
      description: region.description ?? '',
      postal_codes: (region.postal_codes ?? []).join(', '),
      center_latitude: region.center_latitude !== null ? String(region.center_latitude) : '',
      center_longitude: region.center_longitude !== null ? String(region.center_longitude) : '',
      status: region.status,
    });
    setFormErrors({});
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
  }

  // ── Save ─────────────────────────────────────────────────────────────────

  async function handleSave() {
    const errors: Partial<Record<keyof FormData, string>> = {};
    if (!form.name.trim()) errors.name = t('sub_regions.validation.name_required');
    if (!form.type) errors.type = t('sub_regions.validation.type_required');

    if (form.center_latitude !== '' && Number.isNaN(Number(form.center_latitude))) {
      errors.center_latitude = t('sub_regions.validation.latitude_number');
    }
    if (form.center_longitude !== '' && Number.isNaN(Number(form.center_longitude))) {
      errors.center_longitude = t('sub_regions.validation.longitude_number');
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        type: form.type,
        description: form.description.trim() || null,
        status: form.status,
        postal_codes: parsePostalCodes(form.postal_codes),
        center_latitude: form.center_latitude !== '' ? Number(form.center_latitude) : null,
        center_longitude: form.center_longitude !== '' ? Number(form.center_longitude) : null,
      };
      if (form.slug.trim()) payload.slug = form.slug.trim();

      const res = editTarget
        ? await api.put(`/v2/admin/caring-community/sub-regions/${editTarget.id}`, payload)
        : await api.post('/v2/admin/caring-community/sub-regions', payload);

      if (!res.success) {
        // Field-level validation arrives in the ApiResponse's own `errors`
        // array. The previous code looked for an axios-shaped
        // err.response.data.errors inside the catch block below, which can
        // never run: the API client returns a failed response instead of
        // throwing. Both the per-field messages and the overall refusal were
        // therefore unreachable, and every failure showed the same generic
        // toast.
        const fieldErrors: Partial<Record<keyof FormData, string>> = {};
        for (const detail of res.errors ?? []) {
          // Validation text comes from the controller as a __() key.
          if (detail.field && detail.message) {
            fieldErrors[detail.field as keyof FormData] = detail.message;
          }
        }
        if (Object.keys(fieldErrors).length > 0) {
          setFormErrors(fieldErrors);
        } else {
          // admin-i18n-ignore: localized server message — CaringSubRegionService
          // refusals are __() keys, guarded by ApiErrorLocalisationTest.
          showToast(res.error || t('sub_regions.errors.save_failed'), 'error');
        }
        return;
      }

      showToast(t(editTarget ? 'sub_regions.toasts.updated' : 'sub_regions.toasts.created'), 'success');
      closeModal();
      void fetchRegions();
    } catch (err) {
      logError('SubRegionsAdminPage.save', err);
      showToast(t('sub_regions.errors.save_failed'), 'error');
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────

  async function handleDelete(region: SubRegion) {
    const ok = await confirm({
      title: t('sub_regions.confirm_mark_inactive', { name: region.name }),
      status: 'warning',
      confirmLabel: t('common:confirm'),
    });
    if (!ok) {
      return;
    }
    try {
      const res = await api.delete(`/v2/admin/caring-community/sub-regions/${region.id}`);
      if (res.success) {
        showToast(t('sub_regions.toasts.marked_inactive'), 'success');
        void fetchRegions();
      } else {
        showToast(t('sub_regions.errors.delete_failed'), 'error');
      }
    } catch (err) {
      logError('SubRegionsAdminPage.delete', err);
      showToast(t('sub_regions.errors.delete_failed'), 'error');
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const visibleRegions = useMemo(() => regions, [regions]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <MapPin className="h-5 w-5 text-accent" aria-hidden="true" />
            {t('sub_regions.meta.title')}
          </h1>
          <p className="text-sm text-muted mt-0.5">
            {t('sub_regions.meta.subtitle')}
          </p>
        </div>
        <Button
          startContent={<Plus className="h-4 w-4" aria-hidden="true" />}
          onPress={openCreate}
        >
          {t('sub_regions.actions.add')}
        </Button>
      </div>

      {/* Intro card */}
      <Card className="border-l-4 border-l-accent bg-accent-soft dark:bg-accent-soft" >
        <CardBody className="px-4 py-3">
          <div className="flex gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-accent dark:text-accent">{t('sub_regions.about.title')}</p>
              <p className="text-muted">
                {t('sub_regions.about.body')}
              </p>
              <p className="text-muted">
                {t('sub_regions.about.postal_codes_note')}
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Input type="search" name="admin-search" autoComplete="off"
          aria-label={t('sub_regions.filters.search_aria')}
          placeholder={t('sub_regions.filters.search_placeholder')}
          value={search}
          onValueChange={setSearch}
          className="max-w-xs"
          size="sm"
        />
        <Select
          aria-label={t('sub_regions.filters.type_aria')}
          selectedKeys={new Set([typeFilter])}
          onSelectionChange={(keys) => {
            const v = Array.from(keys)[0] as SubRegionType | 'all' | undefined;
            if (v) setTypeFilter(v);
          }}
          className="max-w-[220px]"
          size="sm"
        >
          {TYPE_FILTER_OPTIONS.map((value) => (
            <SelectItem key={value} id={value}>{t(`sub_regions.type_options.${value}`)}</SelectItem>
          ))}
        </Select>
      </div>

      {/* Table */}
      {loading ? (
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-6 text-center text-danger">
          {error}
        </div>
      ) : (
        <Table aria-label={t('sub_regions.table.aria')} removeWrapper>
          <TableHeader>
            <TableColumn>{t('sub_regions.table.name')}</TableColumn>
            <TableColumn>{t('sub_regions.table.type')}</TableColumn>
            <TableColumn>{t('sub_regions.table.postal_codes')}</TableColumn>
            <TableColumn>{t('sub_regions.table.coordinates')}</TableColumn>
            <TableColumn>{t('sub_regions.table.status')}</TableColumn>
            <TableColumn>{t('sub_regions.table.actions')}</TableColumn>
          </TableHeader>
          <TableBody emptyContent={t('sub_regions.table.empty')}>
            {visibleRegions.map((region) => (
              <TableRow key={region.id}>
                <TableCell>
                  <div>
                    <p className="font-medium">{region.name}</p>
                    <p className="text-xs text-muted font-mono">{region.slug}</p>
                  </div>
                </TableCell>
                <TableCell>
                  <Chip size="sm" color={typeColor(region.type)} variant="soft">
                    {t(`sub_regions.type_options.${region.type}`)}
                  </Chip>
                </TableCell>
                <TableCell>
                  <span className="text-xs text-muted font-mono">
                    {postalCodesPreview(region.postal_codes)}
                  </span>
                </TableCell>
                <TableCell>
                  {region.center_latitude !== null && region.center_longitude !== null ? (
                    <span className="text-xs text-muted font-mono">
                      {region.center_latitude.toFixed(4)}, {region.center_longitude.toFixed(4)}
                    </span>
                  ) : (
                    <span className="text-xs text-muted">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <Chip
                    size="sm"
                    color={region.status === 'active' ? 'success' : 'default'}
                    variant="soft"
                  >
                    {t(`sub_regions.status.${region.status}`)}
                  </Chip>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="tertiary"
                      isIconOnly
                      onPress={() => openEdit(region)}
                      aria-label={t('sub_regions.actions.edit_aria')}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    {region.status === 'active' && (
                      <Button
                        size="sm"
                        variant="danger"
                        isIconOnly
                        onPress={() => handleDelete(region)}
                        aria-label={t('sub_regions.actions.mark_inactive')}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Create / Edit Modal */}
      <Modal isOpen={modalOpen} onOpenChange={(open) => { if (!open) closeModal(); }} size="2xl">
        <ModalContent>
          {() => (
            <>
              <ModalHeader>
                {editTarget ? t('sub_regions.modal.edit_title', { name: editTarget.name }) : t('sub_regions.modal.add_title')}
              </ModalHeader>
              <ModalBody className="gap-4">
                <Input
                  label={t('sub_regions.form.name')}
                  isRequired
                  value={form.name}
                  onValueChange={(v) => setForm((f) => ({ ...f, name: v }))}
                  isInvalid={!!formErrors.name}
                  errorMessage={formErrors.name}
                  placeholder={t('sub_regions.form.name_placeholder')}
                />
                <Input
                  label={t('sub_regions.form.slug')}
                  value={form.slug}
                  onValueChange={(v) => setForm((f) => ({ ...f, slug: v }))}
                  isInvalid={!!formErrors.slug}
                  errorMessage={formErrors.slug}
                  placeholder={t('sub_regions.form.slug_placeholder')}
                  description={t('sub_regions.form.slug_description')}
                />
                <Select
                  label={t('sub_regions.form.type')}
                  isRequired
                  selectedKeys={form.type ? new Set([form.type]) : new Set()}
                  onSelectionChange={(keys) => {
                    const val = Array.from(keys)[0] as SubRegionType;
                    setForm((f) => ({ ...f, type: val }));
                  }}
                  isInvalid={!!formErrors.type}
                  errorMessage={formErrors.type}
                >
                  {REGION_TYPES.map((value) => (
                    <SelectItem key={value} id={value}>{t(`sub_regions.type_options.${value}`)}</SelectItem>
                  ))}
                </Select>
                <Textarea
                  label={t('sub_regions.form.description')}
                  value={form.description}
                  onValueChange={(v) => setForm((f) => ({ ...f, description: v }))}
                  placeholder={t('sub_regions.form.description_placeholder')}
                  minRows={2}
                />
                <Input
                  label={t('sub_regions.form.postal_codes')}
                  value={form.postal_codes}
                  onValueChange={(v) => setForm((f) => ({ ...f, postal_codes: v }))}
                  placeholder={t('sub_regions.form.postal_codes_placeholder')}
                  description={t('sub_regions.form.postal_codes_description')}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label={t('sub_regions.form.centre_latitude')}
                    value={form.center_latitude}
                    onValueChange={(v) => setForm((f) => ({ ...f, center_latitude: v }))}
                    placeholder={t('sub_regions.form.latitude_placeholder')}
                    isInvalid={!!formErrors.center_latitude}
                    errorMessage={formErrors.center_latitude}
                  />
                  <Input
                    label={t('sub_regions.form.centre_longitude')}
                    value={form.center_longitude}
                    onValueChange={(v) => setForm((f) => ({ ...f, center_longitude: v }))}
                    placeholder={t('sub_regions.form.longitude_placeholder')}
                    isInvalid={!!formErrors.center_longitude}
                    errorMessage={formErrors.center_longitude}
                  />
                </div>
                <Select
                  label={t('sub_regions.form.status')}
                  selectedKeys={new Set([form.status])}
                  onSelectionChange={(keys) => {
                    const val = Array.from(keys)[0] as 'active' | 'inactive' | undefined;
                    if (val) setForm((f) => ({ ...f, status: val }));
                  }}
                >
                  <SelectItem key="active" id="active">{t('sub_regions.status.active')}</SelectItem>
                  <SelectItem key="inactive" id="inactive">{t('sub_regions.status.inactive')}</SelectItem>
                </Select>
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={closeModal} isDisabled={saving}>
                  {t('sub_regions.actions.cancel')}
                </Button>
                <Button onPress={handleSave} isLoading={saving}>
                  {editTarget ? t('sub_regions.actions.save_changes') : t('sub_regions.actions.create')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
