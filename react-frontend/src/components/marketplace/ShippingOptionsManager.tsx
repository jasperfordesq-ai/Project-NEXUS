// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Select, SelectItem } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Switch } from '@/components/ui/Switch';
/**
 * ShippingOptionsManager — Seller shipping option configuration.
 *
 * CRUD interface for managing shipping options: list, add, edit, delete.
 * Each option has courier name, price, currency, estimated days, and default flag.
 * Uses HeroUI components throughout.
 */

import { useState, useEffect, useCallback } from 'react';

import Plus from 'lucide-react/icons/plus';
import Pencil from 'lucide-react/icons/pencil';
import Trash2 from 'lucide-react/icons/trash-2';
import Truck from 'lucide-react/icons/truck';
import Check from 'lucide-react/icons/check';
import X from 'lucide-react/icons/x';
import Package from 'lucide-react/icons/package';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { useTenant, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { getFormattingLocale } from '@/lib/helpers';
import { logError } from '@/lib/logger';
import { normalizeMarketplaceShippingOption } from '@/lib/marketplaceNumbers';
import type { MarketplaceShippingOption } from '@/types/marketplace';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ShippingOptionsManagerProps {
  sellerId: number;
}

interface ShippingFormData {
  courier_name: string;
  price: string;
  currency: string;
  estimated_days: string;
  is_default: boolean;
}

const CURRENCY_OPTIONS = [
  { value: 'EUR', label: 'EUR' },
  { value: 'GBP', label: 'GBP' },
  { value: 'USD', label: 'USD' },
  { value: 'CAD', label: 'CAD' },
  { value: 'AUD', label: 'AUD' },
  { value: 'NZD', label: 'NZD' },
  { value: 'CHF', label: 'CHF' },
  { value: 'SEK', label: 'SEK' },
  { value: 'NOK', label: 'NOK' },
  { value: 'DKK', label: 'DKK' },
  { value: 'PLN', label: 'PLN' },
  { value: 'JPY', label: 'JPY' },
];

function normalizeSupportedCurrency(value?: string | null): string {
  const candidate = value?.trim().toUpperCase() ?? '';
  return CURRENCY_OPTIONS.some((option) => option.value === candidate) ? candidate : '';
}

function createEmptyForm(currency: string): ShippingFormData {
  return {
    courier_name: '',
    price: '',
    currency,
    estimated_days: '',
    is_default: false,
  };
}

function formatCurrencyAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(getFormattingLocale(), {
      style: 'currency',
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline Form — shared between Add and Edit
// ─────────────────────────────────────────────────────────────────────────────

interface ShippingFormProps {
  form: ShippingFormData;
  onChange: (field: keyof ShippingFormData, value: string | boolean) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
  submitLabel: string;
}

function ShippingForm({ form, onChange, onSubmit, onCancel, isSubmitting, submitLabel }: ShippingFormProps) {
  const { t } = useTranslation('marketplace');
  const currencyOptions = form.currency && !CURRENCY_OPTIONS.some((option) => option.value === form.currency)
    ? [{ value: form.currency, label: form.currency }, ...CURRENCY_OPTIONS]
    : CURRENCY_OPTIONS;

  return (
    <GlassCard className="space-y-4 border border-accent/20 bg-accent/5 p-4 shadow-sm">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input
          label={t('shipping.courier_name')}
          placeholder={t('shipping.courier_name_placeholder')}
          value={form.courier_name}
          onValueChange={(v) => onChange('courier_name', v)}
          size="sm"
          isRequired
          variant="secondary"
        />
        <div className="flex gap-2">
          <Input
            label={t('shipping.price')}
            placeholder={t('shipping.price_placeholder')}
            type="number"
            min={0}
            step={0.01}
            value={form.price}
            onValueChange={(v) => onChange('price', v)}
            size="sm"
            isRequired
            variant="secondary"
            className="flex-1"
          />
          <Select
            label={t('shipping.currency')}
            selectedKeys={form.currency ? [form.currency] : []}
            onSelectionChange={(keys) => {
              const selected = Array.from(keys)[0];
              if (selected) onChange('currency', String(selected));
            }}
            size="sm"
            variant="secondary"
            className="w-28"
          >
            {currencyOptions.map((opt) => (
              <SelectItem key={opt.value} id={opt.value}>{opt.label}</SelectItem>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
        <Input
          label={t('shipping.estimated_days')}
          placeholder={t('shipping.estimated_days_placeholder')}
          type="number"
          min={1}
          value={form.estimated_days}
          onValueChange={(v) => onChange('estimated_days', v)}
          size="sm"
          variant="secondary"
        />
        <div className="flex items-center gap-2 pb-1">
          <Switch
            isSelected={form.is_default}
            onValueChange={(v) => onChange('is_default', v)}
            size="sm"
          />
          <span className="text-sm text-foreground">
            {t('shipping.set_as_default')}
          </span>
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-1">
        <Button
          variant="tertiary"
          size="sm"
          onPress={onCancel}
          startContent={<X className="w-3.5 h-3.5" />}
        >
          {t('shipping.cancel')}
        </Button>
        <Button

          size="sm"
          onPress={onSubmit}
          isLoading={isSubmitting}
          isDisabled={!form.courier_name.trim() || !form.price}
          startContent={<Check className="w-3.5 h-3.5" />}
        >
          {submitLabel}
        </Button>
      </div>
    </GlassCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function ShippingOptionsManager({ sellerId: _sellerId }: ShippingOptionsManagerProps) {
  const { t } = useTranslation(['marketplace', 'common']);
  const { tenant } = useTenant();
  const toast = useToast();
  const confirm = useConfirm();
  const defaultCurrency = normalizeSupportedCurrency(tenant?.currency);

  const [options, setOptions] = useState<MarketplaceShippingOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Add mode
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<ShippingFormData>(() => createEmptyForm(defaultCurrency));

  // Edit mode
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<ShippingFormData>(() => createEmptyForm(defaultCurrency));

  // ─── Load ──────────────────────────────────────────────────────────────────
  const loadOptions = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await api.get<MarketplaceShippingOption[]>(
        '/v2/marketplace/seller/shipping-options'
      );
      if (response.success && response.data) {
        setOptions(response.data.map(normalizeMarketplaceShippingOption));
      } else {
        toast.error(response.error || t('shipping.load_error'));
      }
    } catch (err) {
      logError('Failed to load shipping options', err);
      toast.error(t('shipping.load_error'));
    } finally {
      setIsLoading(false);
    }
  }, [toast, t]);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  // ─── Add ───────────────────────────────────────────────────────────────────
  const handleAdd = useCallback(async () => {
    if (!addForm.courier_name.trim() || !addForm.price) return;
    setIsSubmitting(true);
    try {
      const response = await api.post<MarketplaceShippingOption>(
        '/v2/marketplace/seller/shipping-options',
        {
          courier_name: addForm.courier_name.trim(),
          price: parseFloat(addForm.price),
          ...(addForm.currency ? { currency: addForm.currency } : {}),
          estimated_days: addForm.estimated_days ? parseInt(addForm.estimated_days, 10) : null,
          is_default: addForm.is_default,
        }
      );
      if (response.success && response.data) {
        const savedOption = normalizeMarketplaceShippingOption(response.data);
        setOptions((prev) => {
          // If new option is default, unset others
          if (savedOption.is_default) {
            return [...prev.map((o) => ({ ...o, is_default: false })), savedOption];
          }
          return [...prev, savedOption];
        });
        setAddForm(createEmptyForm(defaultCurrency));
        setShowAddForm(false);
        toast.success(t('shipping.added_success'));
      } else {
        toast.error(response.error || t('shipping.add_error'));
      }
    } catch (err) {
      logError('Failed to add shipping option', err);
      toast.error(t('shipping.add_error'));
    } finally {
      setIsSubmitting(false);
    }
  }, [addForm, defaultCurrency, toast, t]);

  // ─── Edit ──────────────────────────────────────────────────────────────────
  const startEdit = useCallback((option: MarketplaceShippingOption) => {
    setEditingId(option.id);
    setEditForm({
      courier_name: option.courier_name,
      price: String(option.price),
      currency: option.currency,
      estimated_days: option.estimated_days != null ? String(option.estimated_days) : '',
      is_default: option.is_default,
    });
    // Close add form if open
    setShowAddForm(false);
  }, []);

  const handleUpdate = useCallback(async () => {
    if (editingId === null || !editForm.courier_name.trim() || !editForm.price) return;
    setIsSubmitting(true);
    try {
      const response = await api.put<MarketplaceShippingOption>(
        `/v2/marketplace/seller/shipping-options/${editingId}`,
        {
          courier_name: editForm.courier_name.trim(),
          price: parseFloat(editForm.price),
          currency: editForm.currency,
          estimated_days: editForm.estimated_days ? parseInt(editForm.estimated_days, 10) : null,
          is_default: editForm.is_default,
        }
      );
      if (response.success && response.data) {
        const savedOption = normalizeMarketplaceShippingOption(response.data);
        setOptions((prev) =>
          prev.map((o) => {
            if (o.id === editingId) return savedOption;
            // If updated option became default, unset others
            if (savedOption.is_default && o.is_default) {
              return { ...o, is_default: false };
            }
            return o;
          })
        );
        setEditingId(null);
        setEditForm(createEmptyForm(defaultCurrency));
        toast.success(t('shipping.updated_success'));
      } else {
        toast.error(response.error || t('shipping.update_error'));
      }
    } catch (err) {
      logError('Failed to update shipping option', err);
      toast.error(t('shipping.update_error'));
    } finally {
      setIsSubmitting(false);
    }
  }, [editingId, editForm, defaultCurrency, toast, t]);

  // ─── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = useCallback(async (id: number) => {
    const ok = await confirm({
      title: t('marketplace:shipping.delete_confirm'),
      status: 'danger',
      confirmLabel: t('common:delete'),
    });
    if (!ok) return;
    try {
      const response = await api.delete(`/v2/marketplace/seller/shipping-options/${id}`);
      if (!response.success) {
        toast.error(response.error || t('shipping.delete_error'));
        return;
      }
      setOptions((prev) => prev.filter((o) => o.id !== id));
      toast.success(t('shipping.deleted_success'));
    } catch (err) {
      logError('Failed to delete shipping option', err);
      toast.error(t('shipping.delete_error'));
    }
  }, [toast, t, confirm]);

  // ─── Helpers ───────────────────────────────────────────────────────────────
  const updateAddForm = useCallback((field: keyof ShippingFormData, value: string | boolean) => {
    setAddForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const updateEditForm = useCallback((field: keyof ShippingFormData, value: string | boolean) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  // ─── Render ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex justify-center py-8" role="status" aria-busy="true" aria-label={t('common:loading')}>
        <Spinner size="md" color="accent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Truck className="w-5 h-5 text-accent" />
          {t('shipping.title')}
        </h3>
        {!showAddForm && editingId === null && (
          <Button

            variant="primary"
            size="sm"
            className="w-full sm:w-auto"
            startContent={<Plus className="w-4 h-4" />}
            onPress={() => { setShowAddForm(true); setAddForm(createEmptyForm(defaultCurrency)); }}
          >
            {t('shipping.add_option')}
          </Button>
        )}
      </div>

      {/* Add form */}
      {showAddForm && (
        <ShippingForm
          form={addForm}
          onChange={updateAddForm}
          onSubmit={handleAdd}
          onCancel={() => { setShowAddForm(false); setAddForm(createEmptyForm(defaultCurrency)); }}
          isSubmitting={isSubmitting}
          submitLabel={t('shipping.add_option')}
        />
      )}

      {/* Options list */}
      {options.length === 0 && !showAddForm ? (
        <EmptyState
          icon={<Package className="w-6 h-6" />}
          title={t('shipping.empty_title')}
          description={t('shipping.empty_description')}
          action={{
            label: t('shipping.add_option'),
            onClick: () => setShowAddForm(true),
          }}
        />
      ) : (
        <div className="space-y-3">
          {options.map((option) =>
            editingId === option.id ? (
              <ShippingForm
                key={option.id}
                form={editForm}
                onChange={updateEditForm}
                onSubmit={handleUpdate}
                onCancel={() => { setEditingId(null); setEditForm(createEmptyForm(defaultCurrency)); }}
                isSubmitting={isSubmitting}
                submitLabel={t('shipping.save_changes')}
              />
            ) : (
              <GlassCard key={option.id} className="border border-separator p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Truck className="w-5 h-5 text-muted shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-foreground">
                          {option.courier_name}
                        </span>
                        {option.is_default && (
                          <Chip size="sm" color="accent" variant="soft">
                            {t('shipping.default_badge')}
                          </Chip>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-sm text-muted mt-0.5">
                        <span className="font-semibold text-foreground">
                          {formatCurrencyAmount(option.price, option.currency)}
                        </span>
                        {option.estimated_days != null && (
                          <span>
                            {t('shipping.estimated_delivery', {
                              days: option.estimated_days,
                            })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-1 self-end sm:self-auto">
                    <Button
                      isIconOnly
                      variant="tertiary"
                      size="sm"
                      onPress={() => startEdit(option)}
                      aria-label={t('shipping.edit_aria')}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      isIconOnly
                      variant="danger-soft"
                      size="sm"

                      onPress={() => handleDelete(option.id)}
                      aria-label={t('shipping.delete_aria')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </GlassCard>
            )
          )}
        </div>
      )}
    </div>
  );
}

export default ShippingOptionsManager;
