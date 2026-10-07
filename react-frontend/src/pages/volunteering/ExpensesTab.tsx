// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ExpensesTab - View and submit volunteer expense claims
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion } from '@/lib/motion';

import Receipt from 'lucide-react/icons/receipt';
import Plus from 'lucide-react/icons/plus';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Calendar from 'lucide-react/icons/calendar';
import Car from 'lucide-react/icons/car';
import UtensilsCrossed from 'lucide-react/icons/utensils-crossed';
import Package from 'lucide-react/icons/package';
import Wrench from 'lucide-react/icons/wrench';
import ParkingCircle from 'lucide-react/icons/circle-parking';
import MoreHorizontal from 'lucide-react/icons/ellipsis';
import Upload from 'lucide-react/icons/upload';
import X from 'lucide-react/icons/x';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import Briefcase from 'lucide-react/icons/briefcase';
import Send from 'lucide-react/icons/send';
import { EmptyState } from '@/components/feedback';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Select, SelectItem } from '@/components/ui/Select';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { Textarea } from '@/components/ui/Textarea';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { useTenant, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { extractCollectionItems } from './extractCollectionItems';

interface Organisation {
  id: number;
  name: string;
  status?: string;
}

interface ApprovedApplication {
  status: string;
  opportunity?: { id: number; title: string } | null;
  organization?: { id: number; name: string } | null;
}

interface ClaimableOpportunity {
  id: number;
  title: string;
  organisationId: number;
}

/* ───────────────────────── Types ───────────────────────── */

type ExpenseType = 'travel' | 'meals' | 'supplies' | 'equipment' | 'parking' | 'other';
type ExpenseStatus = 'pending' | 'approved' | 'rejected' | 'paid';

interface Expense {
  id: number;
  expense_type: ExpenseType;
  amount: string;
  currency: string;
  description: string;
  status: ExpenseStatus;
  submitted_at: string;
  reviewed_at: string | null;
  review_notes: string | null;
  paid_at: string | null;
  payment_reference: string | null;
}

const EXPENSE_TYPE_OPTIONS: { key: ExpenseType; icon: React.ReactNode }[] = [
  { key: 'travel', icon: <Car className="w-4 h-4" /> },
  { key: 'meals', icon: <UtensilsCrossed className="w-4 h-4" /> },
  { key: 'supplies', icon: <Package className="w-4 h-4" /> },
  { key: 'equipment', icon: <Wrench className="w-4 h-4" /> },
  { key: 'parking', icon: <ParkingCircle className="w-4 h-4" /> },
  { key: 'other', icon: <MoreHorizontal className="w-4 h-4" /> },
];

const STATUS_COLOR: Record<ExpenseStatus, 'warning' | 'success' | 'danger' | 'primary'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  paid: 'primary',
};

/* ───────────────────────── Component ───────────────────────── */

const fmt = (val: number) =>
  val.toLocaleString(getFormattingLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ExpensesTab() {
  const { t } = useTranslation('volunteering');
  const { tenantPath } = useTenant();
  const toast = useToast();
  const { isOpen, onOpen, onOpenChange } = useDisclosure();
  const [items, setItems] = useState<Expense[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Organisation state
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [opportunities, setOpportunities] = useState<ClaimableOpportunity[]>([]);
  const [formOrgId, setFormOrgId] = useState('');
  const [formOpportunityId, setFormOpportunityId] = useState('');

  // Form state
  const [formType, setFormType] = useState<ExpenseType>('travel');
  const [formAmount, setFormAmount] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formReceipt, setFormReceipt] = useState<File | null>(null);
  const tRef = useRef(t);
  tRef.current = t;
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setError(null);
      const response = await api.get<{ items: Expense[]; cursor?: string; has_more: boolean }>(
        '/v2/volunteering/expenses'
      );
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        const data = response.data;
        setItems(Array.isArray(data.items) ? data.items : []);
      } else {
        setError(tRef.current('expenses.load_error'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load expenses', err);
      setError(tRef.current('expenses.load_error'));
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    loadRef.current();
    // Who a volunteer may claim from mirrors the server's rule
    // (VolunteerExpenseService::userCanClaimAgainstOrganization): an organisation
    // that accepted them onto an opportunity, or one they belong to. Being accepted
    // does not make someone a member, so "my organisations" alone hid the
    // organisation most volunteers claim from. Same merge as the Hours tab.
    Promise.all([
      api.get<unknown>('/v2/volunteering/applications?status=approved&per_page=50'),
      api.get<unknown>('/v2/volunteering/my-organisations?per_page=50'),
    ]).then(([applicationsRes, myOrgsRes]) => {
      const eligible = new Map<number, Organisation>();
      const claimable: ClaimableOpportunity[] = [];

      if (applicationsRes.success && applicationsRes.data) {
        extractCollectionItems<ApprovedApplication>(applicationsRes.data).forEach((application) => {
          const org = application.organization;
          if (application.status !== 'approved' || !org?.id) return;
          eligible.set(org.id, { id: org.id, name: org.name });
          const opp = application.opportunity;
          if (opp?.id && !claimable.some((c) => c.id === opp.id)) {
            claimable.push({ id: opp.id, title: opp.title, organisationId: org.id });
          }
        });
      }
      if (myOrgsRes.success && myOrgsRes.data) {
        extractCollectionItems<Organisation>(myOrgsRes.data)
          .filter((org) => ['approved', 'active'].includes(org.status ?? ''))
          .forEach((org) => eligible.set(org.id, org));
      }

      const orgs = Array.from(eligible.values()).sort((a, b) => a.name.localeCompare(b.name));
      setOrganisations(orgs);
      setOpportunities(claimable.sort((a, b) => a.title.localeCompare(b.title)));
      if (orgs.length === 1) {
        setFormOrgId((orgs[0]?.id ?? '').toString());
      }
    }).catch((err) => logError('Failed to load organisations', err));
    return () => { abortRef.current?.abort(); };
  }, []);

  const stats = useMemo(() => {
    const sum = (filter?: (e: Expense) => boolean) =>
      items
        .filter(filter ?? (() => true))
        .reduce((acc, e) => acc + parseFloat(e.amount || '0'), 0);
    return {
      claimed: sum(),
      approved: sum((e) => e.status === 'approved' || e.status === 'paid'),
      paid: sum((e) => e.status === 'paid'),
    };
  }, [items]);

  const orgOpportunities = useMemo(
    () => opportunities.filter((o) => o.organisationId.toString() === formOrgId),
    [opportunities, formOrgId],
  );

  const resetForm = () => {
    setFormType('travel');
    setFormAmount('');
    setFormDescription('');
    setFormReceipt(null);
    setFormOpportunityId('');
    if (organisations.length !== 1) setFormOrgId('');
  };

  // No currency field: the server always records the community's own currency
  // (VolunteerExpenseService::submitExpense), so a box here could only mislead.
  const handleOpenForm = () => {
    onOpen();
  };

  const handleSubmit = async (onClose: () => void) => {
    if (isSubmitting) return;
    if (!formOrgId || !formAmount || !formDescription) {
      toast.error(t('expenses.fill_required'));
      return;
    }

    // Client-side guard (server stays authoritative): amount must be a positive
    // number with at most 2 decimal places — never send NaN.
    const amountNum = parseFloat(formAmount);
    if (!/^\d+(\.\d{1,2})?$/.test(formAmount.trim()) || !Number.isFinite(amountNum) || amountNum <= 0) {
      toast.error(t('expenses.invalid_amount'));
      return;
    }

    try {
      setIsSubmitting(true);
      const payload = new FormData();
      payload.append('organization_id', formOrgId);
      if (formOpportunityId && orgOpportunities.some((o) => o.id.toString() === formOpportunityId)) {
        payload.append('opportunity_id', formOpportunityId);
      }
      payload.append('expense_type', formType);
      payload.append('amount', String(amountNum));
      payload.append('description', formDescription);
      if (formReceipt) payload.append('receipt', formReceipt);

      const response = await api.upload('/v2/volunteering/expenses', payload);
      if (response.success) {
        toast.success(t('expenses.submit_success'));
        resetForm();
        onClose();
        load();
      } else {
        toast.error(response.error || t('expenses.submit_error'));
      }
    } catch (err) {
      logError('Failed to submit expense', err);
      toast.error(t('expenses.submit_error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Receipt className="w-5 h-5 text-rose-400" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary">{t('expenses.heading')}</h2>
        </div>
        <Button
          size="sm"
          className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
          startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
          onPress={handleOpenForm}
        >
          {t('expenses.submit')}
        </Button>
      </div>

      {/* Stats */}
      {!error && !isLoading && items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: t('expenses.stats.total_claimed'), value: stats.claimed, color: 'text-theme-primary' },
            { label: t('expenses.stats.approved'), value: stats.approved, color: 'text-rose-500' },
            { label: t('expenses.stats.paid'), value: stats.paid, color: 'text-[var(--color-info)]' },
          ].map((s) => (
            <GlassCard key={s.label} className="p-3 text-center">
              <p className="text-xs text-theme-muted">{s.label}</p>
              <p className={`text-lg font-bold ${s.color}`}>{fmt(s.value)}</p>
            </GlassCard>
          ))}
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <GlassCard className="p-8 text-center" role="alert">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <p className="text-theme-muted mb-4">{error}</p>
          <Button className="bg-gradient-to-r from-rose-500 to-pink-600 text-white" onPress={load}>
            {t('expenses.try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Loading */}
      {!error && isLoading && (
        <div role="status" aria-busy="true" aria-label={t('common:loading')} className="space-y-4">
          {[1, 2, 3].map((i) => (
            <CardRowsSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Empty */}
      {!error && !isLoading && items.length === 0 && (
        <EmptyState
          icon={<Receipt className="w-12 h-12" aria-hidden="true" />}
          title={t('expenses.empty_title')}
          description={t('expenses.empty_description')}
          action={
            // The description says "Click Submit Expense"; offer it right here (gap C6).
            <Button
              className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
              startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
              onPress={handleOpenForm}
            >
              {t('expenses.submit')}
            </Button>
          }
        />
      )}

      {/* Expense List */}
      {!error && !isLoading && items.length > 0 && (
        <div className="space-y-3">
          {items.map((expense) => (
            <motion.div key={expense.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <GlassCard className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Chip size="sm" variant="soft" color="default">
                        {t(`expenses.types.${expense.expense_type}`)}
                      </Chip>
                      <span className="font-bold text-theme-primary text-lg">
                        {expense.currency} {fmt(parseFloat(expense.amount || '0'))}
                      </span>
                    </div>
                    <p className="text-sm text-theme-secondary mb-1">{expense.description}</p>
                    <div className="flex items-center gap-1 text-xs text-theme-subtle">
                      <Calendar className="w-3 h-3" aria-hidden="true" />
                      {new Date(expense.submitted_at).toLocaleDateString(getFormattingLocale())}
                    </div>
                    {expense.review_notes && (
                      <p className="text-xs text-theme-subtle mt-1 italic">
                        {t('expenses.note_prefix')} {expense.review_notes}
                      </p>
                    )}
                  </div>
                  <Chip size="sm" variant="soft" color={STATUS_COLOR[expense.status]}>
                    {t(`expenses.status.${expense.status}`)}
                  </Chip>
                </div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      )}

      {/* Submit Modal */}
      <Modal
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (!open) resetForm();
          onOpenChange();
        }}
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="text-theme-primary">{t('expenses.modal_title')}</ModalHeader>
              <ModalBody className="gap-4">
                {organisations.length === 0 && (
                  <div className="space-y-3">
                    <p className="text-sm text-danger">
                      {t('expenses.no_organisation')}
                    </p>
                    {/* Gap C8: say where a claim becomes possible, as the Hours tab does (C3). */}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        as={Link}
                        to={tenantPath('/volunteering')}
                        size="sm"
                        variant="secondary"
                        startContent={<Briefcase className="w-4 h-4" aria-hidden="true" />}
                      >
                        {t('no_loggable_organisations_find')}
                      </Button>
                      <Button
                        as={Link}
                        to={tenantPath('/volunteering?tab=applications')}
                        size="sm"
                        variant="secondary"
                        startContent={<Send className="w-4 h-4" aria-hidden="true" />}
                      >
                        {t('no_loggable_organisations_applications')}
                      </Button>
                    </div>
                  </div>
                )}
                {organisations.length > 1 && (
                  <Select
                    label={t('expenses.form.organisation')}
                    selectedKeys={formOrgId ? [formOrgId] : []}
                    onSelectionChange={(keys) => {
                      const val = Array.from(keys)[0] as string;
                      if (val) {
                        setFormOrgId(val);
                        setFormOpportunityId('');
                      }
                    }}
                    variant="secondary"
                    isRequired
                  >
                    {organisations.map((org) => (
                      <SelectItem key={org.id.toString()} id={org.id.toString()}>{org.name}</SelectItem>
                    ))}
                  </Select>
                )}
                {orgOpportunities.length > 0 && (
                  <Select
                    label={t('expenses.form.opportunity')}
                    description={t('expenses.form.opportunity_hint')}
                    selectedKeys={[formOpportunityId || 'none']}
                    onSelectionChange={(keys) => {
                      const val = Array.from(keys)[0] as string | undefined;
                      setFormOpportunityId(!val || val === 'none' ? '' : val);
                    }}
                    variant="secondary"
                  >
                    {[
                      <SelectItem key="none" id="none">{t('expenses.form.opportunity_none')}</SelectItem>,
                      ...orgOpportunities.map((opp) => (
                        <SelectItem key={opp.id.toString()} id={opp.id.toString()}>{opp.title}</SelectItem>
                      )),
                    ]}
                  </Select>
                )}
                <Select
                  label={t('expenses.form.type')}
                  selectedKeys={[formType]}
                  onSelectionChange={(keys) => {
                    const val = Array.from(keys)[0] as ExpenseType;
                    if (val) setFormType(val);
                  }}
                  variant="secondary"
                >
                  {EXPENSE_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.key} id={opt.key} startContent={opt.icon}>
                      {t(`expenses.types.${opt.key}`)}
                    </SelectItem>
                  ))}
                </Select>
                <Input
                  label={t('expenses.form.amount')}
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={formAmount}
                  onValueChange={setFormAmount}
                  variant="secondary"
                  isRequired
                />
                <Textarea
                  label={t('expenses.form.description')}
                  value={formDescription}
                  onValueChange={setFormDescription}
                  variant="secondary"
                  minRows={2}
                  maxRows={4}
                  isRequired
                />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-theme-muted">{t('expenses.form.receipt')}</p>
                  <div className="flex flex-col gap-2 rounded-xl border border-dashed border-theme-default bg-theme-elevated p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-theme-primary">
                        {formReceipt ? formReceipt.name : t('expenses.form.receipt_none')}
                      </p>
                      <p className="text-xs text-theme-subtle">{t('expenses.form.receipt_hint')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        id="volunteer-expense-receipt"
                        type="file"
                        accept=".pdf,image/png,image/jpeg,image/webp"
                        className="sr-only"
                        onChange={(event) => setFormReceipt(event.target.files?.[0] ?? null)}
                      />
                      <label
                        htmlFor="volunteer-expense-receipt"
                        className="inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-lg bg-theme-surface px-3 text-sm font-medium text-theme-primary transition-colors hover:bg-theme-hover"
                      >
                        <Upload className="w-4 h-4" aria-hidden="true" />
                        {formReceipt ? t('expenses.form.receipt_replace') : t('expenses.form.receipt_attach')}
                      </label>
                      {formReceipt && (
                        <Button
                          isIconOnly
                          size="sm"
                          variant="tertiary"
                          aria-label={t('expenses.form.receipt_remove')}
                          onPress={() => setFormReceipt(null)}
                        >
                          <X className="w-4 h-4" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>{t('expenses.cancel')}</Button>
                <Button
                  className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
                  onPress={() => handleSubmit(onClose)}
                  isLoading={isSubmitting}
                  isDisabled={organisations.length === 0}
                >
                  {t('expenses.submit_button')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

export default ExpensesTab;
