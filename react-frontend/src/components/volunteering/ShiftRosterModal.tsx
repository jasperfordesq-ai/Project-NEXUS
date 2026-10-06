// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ShiftRosterModal — who is on a shift and who turned up.
 *
 * Until 2026-10-06 an organiser saw only "1 of 2 places taken" with no names,
 * and attendance appeared nowhere. Opened from a shift row in ShiftManager, so
 * it serves the opportunity page and the admin Opportunities & shifts page.
 *
 * Server contract: GET /v2/volunteering/shifts/{id}/roster (managers only)
 *   → { summary, volunteers[{user, check_in_status, checked_in_at, checked_out_at}],
 *       groups[{group_name, reserved_slots, leader, members[]}], waitlist[{user, position}] }
 */

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import Users from 'lucide-react/icons/users';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { api } from '@/lib/api';
import { getFormattingLocale, resolveAvatarUrl } from '@/lib/helpers';
import { logError } from '@/lib/logger';

interface RosterPerson { id: number; name: string; avatar_url?: string | null }

type CheckInStatus = 'pending' | 'checked_in' | 'checked_out' | 'no_show' | null;

export interface ShiftRoster {
  summary: { signed_up: number; checked_in: number; no_show: number; group_places: number; waiting: number };
  volunteers: Array<{ user: RosterPerson; check_in_status: CheckInStatus; checked_in_at: string | null; checked_out_at: string | null }>;
  groups: Array<{ id: number; group_name: string; reserved_slots: number; leader: RosterPerson | null; members: RosterPerson[] }>;
  waitlist: Array<{ user: RosterPerson; position: number }>;
}

export interface ShiftRosterModalProps {
  /** The shift to show, or null when closed. */
  shiftId: number | null;
  /** e.g. "Sat 15 Mar 2099, 10:00 – 13:00" — shown under the title. */
  shiftLabel: string;
  /** Whether the shift has started: before it starts, nobody is "missing" yet. */
  hasStarted: boolean;
  onClose: () => void;
}

const EMPTY_SUMMARY: ShiftRoster['summary'] = { signed_up: 0, checked_in: 0, no_show: 0, group_places: 0, waiting: 0 };

const toDate = (value: string) => new Date(value.includes('T') ? value : value.replace(' ', 'T'));
const formatTime = (value: string) =>
  toDate(value).toLocaleTimeString(getFormattingLocale(), { hour: '2-digit', minute: '2-digit' });

function PersonLine({ person, children }: { person: RosterPerson; children?: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span className="flex items-center gap-3 min-w-0">
        <Avatar src={resolveAvatarUrl(person.avatar_url ?? undefined)} name={person.name} size="sm" />
        <span className="text-sm font-medium text-theme-primary truncate">{person.name}</span>
      </span>
      {children}
    </li>
  );
}

export function ShiftRosterModal({ shiftId, shiftLabel, hasStarted, onClose }: ShiftRosterModalProps) {
  const { t } = useTranslation('volunteering');
  const [roster, setRoster] = useState<ShiftRoster | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (shiftId === null) return;
    let cancelled = false;
    setRoster(null);
    setFailed(false);
    (async () => {
      try {
        const res = await api.get<Partial<ShiftRoster>>(`/v2/volunteering/shifts/${shiftId}/roster`);
        if (cancelled) return;
        if (res.success && res.data) {
          // Missing lists read as empty rather than crashing the view.
          setRoster({
            summary: { ...EMPTY_SUMMARY, ...res.data.summary },
            volunteers: Array.isArray(res.data.volunteers) ? res.data.volunteers : [],
            groups: Array.isArray(res.data.groups) ? res.data.groups : [],
            waitlist: Array.isArray(res.data.waitlist) ? res.data.waitlist : [],
          });
        } else {
          setFailed(true);
        }
      } catch (err) {
        if (cancelled) return;
        logError('Failed to load shift roster', err);
        setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [shiftId]);

  const statusChip = (status: CheckInStatus, checkedInAt: string | null) => {
    if (status === 'checked_in' && checkedInAt) {
      return <Chip size="sm" variant="soft" color="success">{t('shift_manager.roster_checked_in_at', { time: formatTime(checkedInAt) })}</Chip>;
    }
    if (status === 'checked_in') return <Chip size="sm" variant="soft" color="success">{t('shift_manager.roster_checked_in')}</Chip>;
    if (status === 'checked_out') return <Chip size="sm" variant="soft" color="success">{t('shift_manager.roster_checked_out')}</Chip>;
    if (status === 'no_show') return <Chip size="sm" variant="soft" color="danger">{t('shift_manager.roster_no_show')}</Chip>;
    return (
      <Chip size="sm" variant="soft" color={hasStarted ? 'warning' : 'default'}>
        {hasStarted ? t('shift_manager.roster_not_checked_in') : t('shift_manager.roster_not_yet')}
      </Chip>
    );
  };

  const isEmpty = roster !== null
    && roster.volunteers.length === 0 && roster.groups.length === 0 && roster.waitlist.length === 0;

  return (
    <Modal isOpen={shiftId !== null} onClose={onClose} size="lg" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          <span className="flex items-center gap-2 text-theme-primary">
            <Users className="w-5 h-5 text-accent" aria-hidden="true" />
            {t('shift_manager.roster_title')}
          </span>
          <span className="text-sm font-normal text-theme-muted">{shiftLabel}</span>
        </ModalHeader>
        <ModalBody className="space-y-5" data-testid="shift-roster">
          {roster === null && !failed && (
            <div className="flex justify-center py-6" role="status" aria-label={t('shift_manager.roster_loading')}><Spinner /></div>
          )}
          {failed && <p className="text-sm text-danger" role="alert">{t('shift_manager.roster_load_error')}</p>}
          {isEmpty && <p className="text-sm text-theme-muted">{t('shift_manager.roster_empty')}</p>}

          {roster !== null && !isEmpty && (
            <>
              <div className="flex flex-wrap gap-2" data-testid="shift-roster-summary">
                <Chip size="sm" variant="soft">{t('shift_manager.roster_summary_signed_up', { count: roster.summary.signed_up })}</Chip>
                {hasStarted && (
                  <Chip size="sm" variant="soft" color="success">{t('shift_manager.roster_summary_checked_in', { count: roster.summary.checked_in })}</Chip>
                )}
                {roster.summary.no_show > 0 && (
                  <Chip size="sm" variant="soft" color="danger">{t('shift_manager.roster_summary_no_show', { count: roster.summary.no_show })}</Chip>
                )}
                {roster.summary.group_places > 0 && (
                  <Chip size="sm" variant="soft">{t('shift_manager.roster_summary_group_places', { count: roster.summary.group_places })}</Chip>
                )}
                {roster.summary.waiting > 0 && (
                  <Chip size="sm" variant="soft" color="warning">{t('shift_manager.roster_summary_waiting', { count: roster.summary.waiting })}</Chip>
                )}
              </div>

              <section>
                <h3 className="text-sm font-semibold text-theme-primary">{t('shift_manager.roster_volunteers_heading')}</h3>
                {roster.volunteers.length === 0 ? (
                  <p className="text-sm text-theme-muted mt-1">{t('shift_manager.roster_no_volunteers')}</p>
                ) : (
                  <ul className="divide-y divide-[var(--border-default)]">
                    {roster.volunteers.map((v) => (
                      <PersonLine key={v.user.id} person={v.user}>{statusChip(v.check_in_status, v.checked_in_at)}</PersonLine>
                    ))}
                  </ul>
                )}
              </section>

              {roster.groups.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold text-theme-primary">{t('shift_manager.roster_groups_heading')}</h3>
                  {roster.groups.map((g) => (
                    <div key={g.id} className="mt-2 rounded-xl border border-theme-default p-3">
                      <p className="text-sm font-medium text-theme-primary">
                        {t('shift_manager.roster_group_line', { name: g.group_name, count: g.reserved_slots })}
                      </p>
                      {g.leader && (
                        <p className="text-xs text-theme-muted">{t('shift_manager.roster_group_leader', { name: g.leader.name })}</p>
                      )}
                      {g.members.length > 0 && (
                        <ul className="divide-y divide-[var(--border-default)]">
                          {g.members.map((m) => <PersonLine key={m.id} person={m} />)}
                        </ul>
                      )}
                    </div>
                  ))}
                </section>
              )}

              {roster.waitlist.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold text-theme-primary">{t('shift_manager.roster_waitlist_heading')}</h3>
                  <ol className="divide-y divide-[var(--border-default)]">
                    {roster.waitlist.map((w) => (
                      <PersonLine key={w.user.id} person={w.user}>
                        <span className="text-xs text-theme-muted">{t('shift_manager.roster_waitlist_position', { position: w.position })}</span>
                      </PersonLine>
                    ))}
                  </ol>
                </section>
              )}
            </>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="tertiary" onPress={onClose}>{t('shift_manager.roster_close')}</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default ShiftRosterModal;
