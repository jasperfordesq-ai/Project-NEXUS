// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * WaitlistTab - View and manage shift waitlist positions (V1)
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from '@/lib/motion';

import Clock from 'lucide-react/icons/clock';
import Users from 'lucide-react/icons/users';
import X from 'lucide-react/icons/x';
import MapPin from 'lucide-react/icons/map-pin';
import Calendar from 'lucide-react/icons/calendar';
import Building2 from 'lucide-react/icons/building-2';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Hash from 'lucide-react/icons/hash';
import Check from 'lucide-react/icons/check';
import PartyPopper from 'lucide-react/icons/party-popper';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { EmptyState } from '@/components/feedback';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

/* ───────────────────────── Types ───────────────────────── */

interface WaitlistEntry {
  id: number;
  position: number;
  status: 'waiting' | 'notified';
  notified_at: string | null;
  shift: {
    id: number;
    start_time: string;
    end_time: string;
    capacity: number | null;
  };
  opportunity: {
    id: number;
    title: string;
    location: string;
  };
  organization: {
    id: number;
    name: string;
    logo_url: string | null;
  };
  joined_at: string;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

/* ───────────────────────── Component ───────────────────────── */

export function WaitlistTab() {
  const { t } = useTranslation('volunteering');
  const toast = useToast();
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [leaveTarget, setLeaveTarget] = useState<number | null>(null);
  const [claimingId, setClaimingId] = useState<number | null>(null);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setError(null);

      const response = await api.get<WaitlistEntry[]>(
        '/v2/volunteering/my-waitlists'
      );

      if (controller.signal.aborted) return;

      if (response.success && response.data) {
        const items = Array.isArray(response.data) ? response.data : [];
        setEntries(items);
      } else {
        setError(tRef.current('waitlist.load_error'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load waitlists', err);
      setError(tRef.current('waitlist.load_error'));
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    load();
    // Abort any in-flight request on unmount so a late response can't set state
    // on an unmounted component.
    return () => abortRef.current?.abort();
  }, [load]);

  const handleLeaveWaitlist = async () => {
    if (!leaveTarget) return;

    try {
      setRemovingId(leaveTarget);
      const response = await api.delete(`/v2/volunteering/shifts/${leaveTarget}/waitlist`);
      if (response.success) {
        setEntries((prev) => prev.filter((e) => e.shift.id !== leaveTarget));
        toastRef.current.success(tRef.current('waitlist.leave_success'));
      } else {
        toastRef.current.error(tRef.current('waitlist.leave_failed'));
      }
    } catch (err) {
      logError('Failed to leave waitlist', err);
      toastRef.current.error(tRef.current('waitlist.leave_failed'));
    } finally {
      setRemovingId(null);
      setLeaveTarget(null);
    }
  };

  const handleClaimSpot = async (entry: WaitlistEntry) => {
    try {
      setClaimingId(entry.id);
      const response = await api.post(`/v2/volunteering/shifts/${entry.shift.id}/waitlist/promote`);
      if (response.success) {
        toastRef.current.success(tRef.current('waitlist.claim_success'));
        load();
      } else {
        toastRef.current.error(response.error || tRef.current('waitlist.claim_failed'));
        // The spot may have gone to someone else — refresh to show live state
        load();
      }
    } catch (err) {
      logError('Failed to claim waitlist spot', err);
      toastRef.current.error(tRef.current('waitlist.claim_failed'));
    } finally {
      setClaimingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-amber-400" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary">{t('waitlist.heading')}</h2>
        </div>
        <Button
          size="sm"
          variant="tertiary"
          startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
          onPress={load}
          isDisabled={isLoading}
        >
          {t('waitlist.refresh')}
        </Button>
      </div>

      {/* Error */}
      {error && !isLoading && (
        <GlassCard className="p-8 text-center" role="alert">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <p className="text-theme-muted mb-4">{error}</p>
          <Button className="bg-gradient-to-r from-rose-500 to-pink-600 text-white" onPress={load}>
            {t('waitlist.try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Loading */}
      {!error && isLoading && (
        <div className="space-y-4" role="status" aria-busy="true" aria-label={t('common:loading')}>
          {[1, 2, 3].map((i) => (
            <CardRowsSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Empty */}
      {!error && !isLoading && entries.length === 0 && (
        <EmptyState
          icon={<Clock className="w-12 h-12" aria-hidden="true" />}
          title={t('waitlist.no_entries_title')}
          description={t('waitlist.no_entries_desc')}
        />
      )}

      {/* Waitlist Entries */}
      {!error && !isLoading && entries.length > 0 && (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-4"
        >
          {entries.map((entry) => (
            <motion.div key={entry.id} variants={itemVariants}>
              <GlassCard className={`p-5 ${entry.status === 'notified' ? 'ring-2 ring-emerald-500/40 bg-emerald-500/5' : ''}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <h3 className="font-semibold text-theme-primary text-lg">
                        {entry.opportunity.title}
                      </h3>
                      {entry.status === 'notified' ? (
                        <Chip
                          size="sm"
                          color="success"
                          variant="soft"
                          startContent={<PartyPopper className="w-3 h-3" />}
                        >
                          {t('waitlist.spot_available')}
                        </Chip>
                      ) : (
                        <Chip
                          size="sm"
                          color="warning"
                          variant="soft"
                          startContent={<Hash className="w-3 h-3" />}
                        >
                          {t('waitlist.position', { position: entry.position })}
                        </Chip>
                      )}
                    </div>

                    {entry.status === 'notified' && (
                      <p className="text-sm text-theme-success font-medium mb-2">
                        {t('waitlist.claim_hint')}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-3 text-xs text-theme-subtle mb-2">
                      <span className="flex items-center gap-1">
                        <Building2 className="w-3 h-3" aria-hidden="true" />
                        {entry.organization.name}
                      </span>
                      {entry.opportunity.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" aria-hidden="true" />
                          {entry.opportunity.location}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" aria-hidden="true" />
                        {new Date(entry.shift.start_time).toLocaleDateString(getFormattingLocale())}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" aria-hidden="true" />
                        {new Date(entry.shift.start_time).toLocaleTimeString(getFormattingLocale(), { hour: '2-digit', minute: '2-digit' })}
                        {' - '}
                        {new Date(entry.shift.end_time).toLocaleTimeString(getFormattingLocale(), { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {entry.shift.capacity != null && (
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3" aria-hidden="true" />
                          {t('waitlist.spots', { count: entry.shift.capacity })}
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-theme-subtle">
                      {t('waitlist.joined')} {new Date(entry.joined_at).toLocaleDateString(getFormattingLocale())}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 shrink-0">
                    {entry.status === 'notified' && (
                      <Button
                        size="sm"
                        className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white"
                        startContent={!claimingId ? <Check className="w-4 h-4" aria-hidden="true" /> : undefined}
                        onPress={() => handleClaimSpot(entry)}
                        isLoading={claimingId === entry.id}
                      >
                        {t('waitlist.claim')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="danger-soft"
                      startContent={<X className="w-4 h-4" aria-hidden="true" />}
                      onPress={() => setLeaveTarget(entry.shift.id)}
                      isLoading={removingId === entry.shift.id}
                      isDisabled={claimingId === entry.id}
                    >
                      {t('waitlist.leave')}
                    </Button>
                  </div>
                </div>
              </GlassCard>
            </motion.div>
          ))}
        </motion.div>
      )}
      {/* Leave Waitlist Confirmation Modal */}
      <Modal
        isOpen={leaveTarget !== null}
        onOpenChange={(open) => !open && setLeaveTarget(null)}
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="text-theme-primary">{t('waitlist.leave')}</ModalHeader>
              <ModalBody>
                <p className="text-theme-secondary">
                  {t('waitlist.leave_confirm')}
                </p>
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>{t('cancel')}</Button>
                <Button variant="danger" onPress={handleLeaveWaitlist}>{t('waitlist.leave')}</Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

export default WaitlistTab;
