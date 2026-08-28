// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { Description } from '@heroui/react/description';
import { Label } from '@heroui/react/label';
import { SearchField } from '@heroui/react/search-field';
import History from 'lucide-react/icons/history';
import Search from 'lucide-react/icons/search';
import ShieldCheck from 'lucide-react/icons/shield-check';
import Trash2 from 'lucide-react/icons/trash-2';
import UserPlus from 'lucide-react/icons/user-plus';
import Users from 'lucide-react/icons/users';
import { useTranslation } from 'react-i18next';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { Select, SelectItem } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/contexts/ToastContext';
import {
  eventsApi,
  type EventMemberSearchResult,
  type EventStaffAssignment,
  type EventStaffCapability,
  type EventStaffRole,
} from '@/lib/events-api';
import { getFormattingLocale, resolveAvatarUrl, resolveUserDisplayName } from '@/lib/helpers';
import { logError } from '@/lib/logger';

const ALL_STAFF_ROLES = [
  'co_organizer',
  'registration_manager',
  'communications_manager',
  'check_in_staff',
  'finance_manager',
] as const satisfies readonly EventStaffRole[];

const STAFF_MANAGER_ROLES = [
  'registration_manager',
  'communications_manager',
  'check_in_staff',
] as const satisfies readonly EventStaffRole[];

interface EventStaffWorkspaceProps {
  eventId: number;
  organizerId: number;
  canGrantPrivilegedRoles: boolean;
  assignments: EventStaffAssignment[];
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onChanged: () => Promise<void>;
}

type SearchState = 'idle' | 'loading' | 'success' | 'error';

function idempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `event-staff-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isExpired(assignment: EventStaffAssignment): boolean {
  if (assignment.status !== 'active' || assignment.expires_at === null) return false;
  const expiresAt = Date.parse(assignment.expires_at);

  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

function localDateTimeMinimum(): string {
  const date = new Date(Date.now() + 60_000);
  const offset = date.getTimezoneOffset() * 60_000;

  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function EventStaffWorkspace({
  eventId,
  organizerId,
  canGrantPrivilegedRoles,
  assignments,
  isLoading,
  error,
  onRetry,
  onChanged,
}: EventStaffWorkspaceProps) {
  const { t } = useTranslation('events');
  const toast = useToast();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const allowedRoles = useMemo<readonly EventStaffRole[]>(
    () => (canGrantPrivilegedRoles ? ALL_STAFF_ROLES : STAFF_MANAGER_ROLES),
    [canGrantPrivilegedRoles],
  );
  const defaultRole = allowedRoles[0] ?? 'registration_manager';

  const [query, setQuery] = useState('');
  const [searchState, setSearchState] = useState<SearchState>('idle');
  const [searchResults, setSearchResults] = useState<EventMemberSearchResult[]>([]);
  const [selectedMember, setSelectedMember] = useState<EventMemberSearchResult | null>(null);
  const [role, setRole] = useState<EventStaffRole>(defaultRole);
  const [expiry, setExpiry] = useState('');
  const [expiryError, setExpiryError] = useState<string | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<EventStaffAssignment | null>(null);
  const [revokingAssignmentId, setRevokingAssignmentId] = useState<number | null>(null);
  const isFormUnavailable = isAssigning || isLoading || error !== null;

  useEffect(() => {
    if (!allowedRoles.includes(role)) setRole(defaultRole);
  }, [allowedRoles, defaultRole, role]);

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2 || selectedMember !== null) {
      setSearchResults([]);
      setSearchState('idle');
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearchState('loading');
      void eventsApi.searchMembers(normalizedQuery, { signal: controller.signal })
        .then((response) => {
          if (controller.signal.aborted) return;
          if (!response.success || !response.data) {
            setSearchResults([]);
            setSearchState('error');
            return;
          }

          setSearchResults(response.data.filter((member) => member.id !== organizerId));
          setSearchState('success');
        })
        .catch((caught: unknown) => {
          if (controller.signal.aborted) return;
          logError('Failed to search event staff candidates', caught);
          setSearchResults([]);
          setSearchState('error');
        });
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [organizerId, query, selectedMember]);

  const memberName = (member: EventMemberSearchResult): string => {
    const name = member.name?.trim()
      || resolveUserDisplayName(member);

    return name || t('manage.team.member_fallback', { id: member.id });
  };

  const assignmentName = (assignment: EventStaffAssignment): string => (
    assignment.member.name?.trim()
    || resolveUserDisplayName(assignment.member)
    || t('manage.team.member_fallback', { id: assignment.member.id })
  );

  const formatTimestamp = (value: string | null): string => {
    if (!value) return t('manage.team.not_recorded');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    return new Intl.DateTimeFormat(getFormattingLocale(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  };

  const resetAssignmentForm = () => {
    setQuery('');
    setSearchResults([]);
    setSearchState('idle');
    setSelectedMember(null);
    setRole(defaultRole);
    setExpiry('');
    setExpiryError(null);
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  };

  const handleAssign = async () => {
    if (!selectedMember || isAssigning) return;

    let expiresAt: string | null = null;
    if (expiry) {
      const parsedExpiry = new Date(expiry);
      if (Number.isNaN(parsedExpiry.getTime()) || parsedExpiry.getTime() <= Date.now()) {
        setExpiryError(t('manage.team.expiry_invalid'));
        return;
      }
      expiresAt = parsedExpiry.toISOString();
    }

    setExpiryError(null);
    setIsAssigning(true);
    try {
      const response = await eventsApi.assignStaff(
        eventId,
        { user_id: selectedMember.id, role, expires_at: expiresAt },
        idempotencyKey(),
      );
      if (!response.success || !response.data) {
        toast.error(t('manage.team.assign_error'));
        return;
      }

      await onChanged();
      toast.success(t('manage.team.assign_success', { name: memberName(selectedMember) }));
      resetAssignmentForm();
    } catch (caught) {
      logError('Failed to assign event staff member', caught);
      toast.error(t('manage.team.assign_error'));
    } finally {
      setIsAssigning(false);
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget || revokingAssignmentId !== null) return;

    setRevokingAssignmentId(revokeTarget.id);
    try {
      const response = await eventsApi.revokeStaff(
        eventId,
        revokeTarget.id,
        idempotencyKey(),
      );
      if (!response.success || !response.data) {
        toast.error(t('manage.team.revoke_error'));
        return;
      }

      await onChanged();
      toast.success(t('manage.team.revoke_success', { name: assignmentName(revokeTarget) }));
      setRevokeTarget(null);
    } catch (caught) {
      logError('Failed to revoke event staff assignment', caught);
      toast.error(t('manage.team.revoke_error'));
    } finally {
      setRevokingAssignmentId(null);
    }
  };

  const sortedAssignments = useMemo(
    () => [...assignments].sort((left, right) => {
      const rank = (assignment: EventStaffAssignment) => {
        if (assignment.effective) return 0;
        if (assignment.status === 'active') return 1;
        return 2;
      };

      return rank(left) - rank(right) || right.version - left.version;
    }),
    [assignments],
  );

  return (
    <div className="space-y-6">
      <Card className="border border-theme-default bg-theme-surface">
        <CardBody className="space-y-5 p-4 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-accent/10 p-2 text-accent" aria-hidden="true">
              <UserPlus className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-theme-primary">{t('manage.team.add_title')}</h2>
              <p className="mt-1 text-sm text-theme-muted">{t('manage.team.add_description')}</p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="relative space-y-2">
              <SearchField
                className="w-full"
                value={query}
                onChange={(value) => {
                  setQuery(value);
                  if (selectedMember !== null) setSelectedMember(null);
                }}
                isDisabled={isFormUnavailable}
              >
                <Label>{t('manage.team.search_label')}</Label>
                <SearchField.Group>
                  <SearchField.SearchIcon><Search className="h-4 w-4" aria-hidden="true" /></SearchField.SearchIcon>
                  <SearchField.Input
                    ref={searchInputRef as RefObject<HTMLInputElement>}
                    autoComplete="off"
                    placeholder={t('manage.team.search_placeholder')}
                  />
                  <SearchField.ClearButton aria-label={t('manage.team.clear_search')} />
                </SearchField.Group>
                <Description>{t('manage.team.search_hint')}</Description>
              </SearchField>

              {searchState !== 'idle' && (
                <div className="rounded-xl border border-theme-default bg-theme-surface shadow-lg">
                  {searchState === 'loading' ? (
                    <div className="flex items-center gap-2 p-4 text-sm text-theme-muted">
                      <Spinner size="sm" aria-label={t('manage.team.searching')} />
                      <span>{t('manage.team.searching')}</span>
                    </div>
                  ) : searchState === 'error' ? (
                    <p className="p-4 text-sm text-danger" role="alert">{t('manage.team.search_error')}</p>
                  ) : searchResults.length === 0 ? (
                    <p className="p-4 text-sm text-theme-muted" role="status" aria-live="polite">{t('manage.team.no_results')}</p>
                  ) : (
                    <ul className="max-h-72 overflow-y-auto p-1" aria-label={t('manage.team.search_results')}>
                      {searchResults.map((member) => {
                        const name = memberName(member);
                        return (
                          <li key={member.id}>
                            <Button
                              className="h-auto min-h-11 w-full justify-start px-3 py-2 text-left"
                              variant="ghost"
                              onPress={() => {
                                setSelectedMember(member);
                                setQuery(name);
                                setSearchResults([]);
                                setSearchState('idle');
                              }}
                              aria-label={t('manage.team.select_member', { name })}
                            >
                              <Avatar
                                size="sm"
                                name={name}
                                src={resolveAvatarUrl(member.avatar_url ?? member.avatar ?? null)}
                              />
                              <span className="min-w-0 truncate font-medium text-theme-primary">{name}</span>
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-4">
              {selectedMember && (
                <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/5 p-3">
                  <Avatar
                    size="sm"
                    name={memberName(selectedMember)}
                    src={resolveAvatarUrl(selectedMember.avatar_url ?? selectedMember.avatar ?? null)}
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-theme-subtle">{t('manage.team.selected_member')}</p>
                    <p className="truncate font-semibold text-theme-primary">{memberName(selectedMember)}</p>
                  </div>
                </div>
              )}

              <Select
                label={t('manage.team.role_label')}
                description={t('manage.team.role_hint')}
                selectedKeys={new Set([role])}
                isDisabled={isFormUnavailable}
                onSelectionChange={(keys) => {
                  const nextRole = Array.from(keys as Iterable<string | number>)[0];
                  if (allowedRoles.includes(String(nextRole) as EventStaffRole)) {
                    setRole(String(nextRole) as EventStaffRole);
                  }
                }}
              >
                {allowedRoles.map((staffRole) => (
                  <SelectItem key={staffRole} id={staffRole} textValue={t(`manage.roles.${staffRole}`)}>
                    {t(`manage.roles.${staffRole}`)}
                  </SelectItem>
                ))}
              </Select>

              <Input
                type="datetime-local"
                min={localDateTimeMinimum()}
                label={t('manage.team.expiry_label')}
                description={t('manage.team.expiry_hint')}
                value={expiry}
                onChange={(event) => {
                  setExpiry(event.target.value);
                  setExpiryError(null);
                }}
                isDisabled={isFormUnavailable}
                isInvalid={expiryError !== null}
                errorMessage={expiryError ?? undefined}
              />

              <Button
                className="w-full sm:w-auto"
                variant="primary"
                isDisabled={selectedMember === null || isFormUnavailable}
                isLoading={isAssigning}
                onPress={() => void handleAssign()}
                startContent={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
              >
                {isAssigning ? t('manage.team.assigning') : t('manage.team.assign')}
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      <section aria-labelledby="event-team-heading" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="event-team-heading" className="text-xl font-semibold text-theme-primary">{t('manage.team.title')}</h2>
            <p className="mt-1 text-sm text-theme-muted">{t('manage.team.description')}</p>
          </div>
          <Chip variant="flat">{t('manage.team.assignment_count', { count: assignments.length })}</Chip>
        </div>

        {isLoading ? (
          <div className="flex min-h-40 items-center justify-center rounded-xl border border-theme-default bg-theme-surface" aria-busy="true">
            <Spinner size="lg" aria-label={t('manage.team.loading')} />
          </div>
        ) : error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-5" role="alert">
            <h3 className="font-semibold text-danger">{t('manage.team.load_error_title')}</h3>
            <p className="mt-1 text-sm text-theme-muted">{error}</p>
            <Button className="mt-4" variant="outline" onPress={onRetry}>{t('manage.try_again')}</Button>
          </div>
        ) : sortedAssignments.length === 0 ? (
          <div className="rounded-xl border border-dashed border-theme-default bg-theme-surface px-5 py-12 text-center">
            <Users className="mx-auto h-10 w-10 text-theme-subtle" aria-hidden="true" />
            <h3 className="mt-4 font-semibold text-theme-primary">{t('manage.team.empty_title')}</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-theme-muted">{t('manage.team.empty_desc')}</p>
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {sortedAssignments.map((assignment) => (
              <StaffAssignmentCard
                key={assignment.id}
                assignment={assignment}
                name={assignmentName(assignment)}
                formatTimestamp={formatTimestamp}
                canRevoke={allowedRoles.includes(assignment.role)}
                onRevoke={() => setRevokeTarget(assignment)}
              />
            ))}
          </div>
        )}
      </section>

      <AlertDialog.Backdrop
        isOpen={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open && revokingAssignmentId === null) setRevokeTarget(null);
        }}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[480px]">
            <AlertDialog.CloseTrigger
              isDisabled={revokingAssignmentId !== null}
              aria-label={t('manage.team.revoke_cancel')}
            />
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>{t('manage.team.revoke_title')}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>{t('manage.team.revoke_desc', {
                name: revokeTarget ? assignmentName(revokeTarget) : '',
                role: revokeTarget ? t(`manage.roles.${revokeTarget.role}`) : '',
              })}</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button
                variant="tertiary"
                isDisabled={revokingAssignmentId !== null}
                onPress={() => setRevokeTarget(null)}
              >
                {t('manage.team.revoke_cancel')}
              </Button>
              <Button
                variant="danger"
                isDisabled={revokeTarget === null || revokingAssignmentId !== null}
                isLoading={revokingAssignmentId !== null}
                startContent={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                onPress={() => void handleRevoke()}
              >
                {t('manage.team.revoke_confirm')}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </div>
  );
}

function StaffAssignmentCard({
  assignment,
  name,
  formatTimestamp,
  canRevoke,
  onRevoke,
}: {
  assignment: EventStaffAssignment;
  name: string;
  formatTimestamp: (value: string | null) => string;
  canRevoke: boolean;
  onRevoke: () => void;
}) {
  const { t } = useTranslation('events');
  const expired = isExpired(assignment);
  const status = assignment.status === 'revoked' ? 'revoked' : expired ? 'expired' : 'active';
  const statusColor = status === 'active' ? 'success' : status === 'expired' ? 'warning' : 'default';

  return (
    <Card className="border border-theme-default bg-theme-surface">
      <CardBody className="space-y-5 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar size="md" name={name} src={resolveAvatarUrl(assignment.member.avatar_url)} />
            <div className="min-w-0">
              <h3 className="truncate font-semibold text-theme-primary">{name}</h3>
              <p className="text-sm text-theme-muted">{t(`manage.roles.${assignment.role}`)}</p>
            </div>
          </div>
          <Chip color={statusColor} variant="flat">{t(`manage.team.status_${status}`)}</Chip>
        </div>

        <dl className="grid grid-cols-2 gap-3 rounded-xl bg-theme-elevated p-3 text-sm">
          <div>
            <dt className="text-theme-subtle">{t('manage.team.version')}</dt>
            <dd className="font-semibold text-theme-primary">{assignment.version}</dd>
          </div>
          <div>
            <dt className="text-theme-subtle">{t('manage.team.audit_entries')}</dt>
            <dd className="font-semibold text-theme-primary">{assignment.history_metadata.entry_count}</dd>
          </div>
          <div>
            <dt className="text-theme-subtle">{t('manage.team.granted_at')}</dt>
            <dd className="text-theme-primary">{formatTimestamp(assignment.granted_at)}</dd>
          </div>
          <div>
            <dt className="text-theme-subtle">{t('manage.team.expires_at')}</dt>
            <dd className="text-theme-primary">
              {assignment.expires_at ? formatTimestamp(assignment.expires_at) : t('manage.team.no_expiry')}
            </dd>
          </div>
        </dl>

        <div>
          <h4 className="text-sm font-semibold text-theme-primary">{t('manage.team.capabilities')}</h4>
          <div className="mt-2 flex flex-wrap gap-2">
            {assignment.capabilities.length > 0 ? assignment.capabilities.map((capability) => (
              <Chip key={capability} size="sm" variant="flat">
                {t(`manage.capabilities.${capability as EventStaffCapability}`)}
              </Chip>
            )) : (
              <span className="text-sm text-theme-muted">{t('manage.team.no_capabilities')}</span>
            )}
          </div>
        </div>

        <details className="rounded-xl border border-theme-default bg-theme-elevated p-3">
          <summary className="cursor-pointer list-none font-medium text-theme-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <span className="inline-flex items-center gap-2">
              <History className="h-4 w-4" aria-hidden="true" />
              {t('manage.team.audit_title', { count: assignment.history_metadata.entry_count })}
            </span>
          </summary>
          <p className="mt-3 text-xs text-theme-subtle">
            {assignment.history_metadata.immutable
              ? t('manage.team.history_immutable')
              : t('manage.team.history_unverified')}
          </p>
          {assignment.history.length > 0 ? (
            <ol className="mt-3 space-y-3">
              {assignment.history.map((entry) => (
                <li key={entry.id} className="border-l-2 border-theme-default pl-3 text-sm">
                  <p className="font-medium text-theme-primary">
                    {t(`manage.team.audit_actions.${entry.action}`)} · {t('manage.team.version_value', { version: entry.version })}
                  </p>
                  <p className="mt-1 text-theme-muted">
                    {t('manage.team.audit_actor_time', {
                      actor: entry.actor_user_id,
                      time: formatTimestamp(entry.created_at),
                    })}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-sm text-theme-muted">{t('manage.team.no_audit_entries')}</p>
          )}
        </details>

        {assignment.status === 'active' && canRevoke && (
          <Button
            variant="danger-soft"
            onPress={onRevoke}
            startContent={<Trash2 className="h-4 w-4" aria-hidden="true" />}
          >
            {t('manage.team.revoke')}
          </Button>
        )}
      </CardBody>
    </Card>
  );
}

export default EventStaffWorkspace;
