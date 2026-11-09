// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * SellerPickupSlotsPage — AG45 click-and-collect: seller manages pickup time slots.
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useEffect, useState, useCallback } from 'react';

import Calendar from 'lucide-react/icons/calendar';
import Plus from 'lucide-react/icons/plus';
import Trash2 from 'lucide-react/icons/trash-2';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Switch } from '@/components/ui/Switch';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { PageMeta } from '@/components/seo/PageMeta';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { useAuth, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { usePageTitle } from '@/hooks';

interface PickupSlot {
  id: number;
  slot_start: string;
  slot_end: string;
  capacity: number;
  booked_count: number;
  remaining?: number;
  is_recurring: boolean;
  is_active: boolean;
}

const formatRange = (s: string, e: string) => {
  try {
    const a = new Date(s);
    const b = new Date(e);
    return `${a.toLocaleString(getFormattingLocale())} → ${b.toLocaleTimeString(getFormattingLocale())}`;
  } catch {
    return `${s} → ${e}`;
  }
};

export function SellerPickupSlotsPage() {
  const { t } = useTranslation('common');
  const confirm = useConfirm();
  usePageTitle(t('marketplace.pickup.slots_title'));
  const { isAuthenticated } = useAuth();
  const toast = useToast();
  const { isOpen, onOpen, onClose } = useDisclosure();

  const [slots, setSlots] = useState<PickupSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [slotStart, setSlotStart] = useState('');
  const [slotEnd, setSlotEnd] = useState('');
  const [capacity, setCapacity] = useState(5);
  const [isRecurring, setIsRecurring] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<PickupSlot[]>('/v2/marketplace/seller/pickup-slots');
      if (res.success && res.data) setSlots(res.data);
    } catch (err) {
      logError('SellerPickupSlotsPage: load failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      load();
    }
  }, [isAuthenticated, load]);

  const handleCreate = async () => {
    if (!slotStart || !slotEnd) {
      toast.error(t('marketplace.pickup.slot_times_required'));
      return;
    }
    setSaving(true);
    try {
      const res = await api.post<PickupSlot>('/v2/marketplace/seller/pickup-slots', {
        slot_start: new Date(slotStart).toISOString(),
        slot_end: new Date(slotEnd).toISOString(),
        capacity,
        is_recurring: isRecurring,
        is_active: true,
      });
      if (res.success) {
        toast.success(t('marketplace.pickup.slot_created'));
        onClose();
        setSlotStart('');
        setSlotEnd('');
        setCapacity(5);
        setIsRecurring(false);
        load();
      } else {
        toast.error(res.error || t('marketplace.pickup.slot_create_failed'));
      }
    } catch (err) {
      logError('SellerPickupSlotsPage: create failed', err);
      toast.error(t('marketplace.pickup.slot_create_failed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    const ok = await confirm({
      title: t('marketplace.pickup.slot_delete_confirm'),
      status: 'danger',
      confirmLabel: t('delete'),
    });
    if (!ok) return;
    try {
      const res = await api.delete(`/v2/marketplace/seller/pickup-slots/${id}`);
      if (res.success) {
        toast.success(t('marketplace.pickup.slot_deleted'));
        setSlots((prev) => prev.filter((s) => s.id !== id));
      }
    } catch (err) {
      logError('SellerPickupSlotsPage: delete failed', err);
    }
  };

  return (
    <>
      <PageMeta title={t('marketplace.pickup.slots_title')} noIndex />
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* The same soft panel in the community colour that opens the offers,
          events and groups pages (AWID: warmer, more inviting). */}
      <PublicPageHero
        size="compact"
        title={t('marketplace.pickup.slots_title')}
        description={t('marketplace.pickup.slots_subtitle')}
        icon={<Calendar className="h-6 w-6" aria-hidden="true" />}
        accent="indigo"
        action={
          <Button startContent={<Plus className="w-4 h-4" />} onPress={onOpen}>
            {t('marketplace.pickup.new_slot')}
          </Button>
        }
      />

      {loading ? (
        <div role="status" aria-busy="true" aria-label={t('loading')} className="flex justify-center py-16">
          <Spinner size="lg" color="accent" />
        </div>
      ) : slots.length === 0 ? (
        <GlassCard className="p-8 text-center">
          <p className="text-muted">
            {t('marketplace.pickup.no_slots')}
          </p>
        </GlassCard>
      ) : (
        <div className="grid gap-3">
          {slots.map((s) => (
            <GlassCard key={s.id} className="p-4 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="font-semibold text-foreground">{formatRange(s.slot_start, s.slot_end)}</p>
                <div className="flex gap-2 mt-1 flex-wrap">
                  <Chip size="sm" variant="soft" color="accent">
                    {t('marketplace.pickup.capacity')}: {s.booked_count}/{s.capacity}
                  </Chip>
                  {s.is_recurring && (
                    <Chip size="sm" variant="soft" color="default">
                      {t('marketplace.pickup.recurring')}
                    </Chip>
                  )}
                  {!s.is_active && (
                    <Chip size="sm" variant="soft" color="warning">
                      {t('marketplace.pickup.inactive')}
                    </Chip>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                variant="danger-soft"

                isIconOnly
                onPress={() => handleDelete(s.id)}
                aria-label={t('common.delete')}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </GlassCard>
          ))}
        </div>
      )}

      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalContent>
          <ModalHeader>{t('marketplace.pickup.new_slot')}</ModalHeader>
          <ModalBody className="space-y-3">
            <Input
              type="datetime-local"
              label={t('marketplace.pickup.slot_start')}
              value={slotStart}
              onValueChange={setSlotStart}
            />
            <Input
              type="datetime-local"
              label={t('marketplace.pickup.slot_end')}
              value={slotEnd}
              onValueChange={setSlotEnd}
            />
            <Input
              type="number"
              label={t('marketplace.pickup.capacity')}
              value={String(capacity)}
              onValueChange={(v) => setCapacity(Math.max(1, parseInt(v) || 1))}
              min={1}
            />
            <Switch isSelected={isRecurring} onValueChange={setIsRecurring}>
              {t('marketplace.pickup.recurring_weekly')}
            </Switch>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={onClose}>
              {t('common.cancel')}
            </Button>
            <Button onPress={handleCreate} isLoading={saving}>
              {t('common.create')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      </div>
    </>
  );
}

export default SellerPickupSlotsPage;
