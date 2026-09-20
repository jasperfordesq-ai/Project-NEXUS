// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { z } from 'zod';
import { loadCreationDraft, saveCreationDraft, type CreationDraftScope } from './creationDraftStore';
import { mutationIdempotencyKey } from './utils/idempotencyKey';
import { ApiResponseError } from './api/client';
import { getOrganizerRegistrationGuests, registrationGuestAttendanceIntentSchema,
  transitionOrganizerRegistrationGuest, type RegistrationGuestAttendanceIntent } from './api/eventRegistration';

const id = z.number().int().positive().safe();
const version = z.number().int().nonnegative().safe();
const scopeSchema = z.object({ tenantId: id, userId: id, eventId: id, guestId: id }).strict();
const base = scopeSchema.extend({ schemaVersion: z.literal(1), key: z.string().min(1).max(191), intent: registrationGuestAttendanceIntentSchema });
const savedSchema = z.discriminatedUnion('status', [
  base.extend({ status: z.literal('pending') }).strict(),
  base.extend({ status: z.literal('acknowledged'), attendanceVersion: id, historyId: id }).strict(),
  base.extend({ status: z.literal('rejected') }).strict(),
  base.extend({ status: z.literal('review'), attendanceVersion: version }).strict(),
]);
export type GuestAttendanceScope = z.infer<typeof scopeSchema>;
export type SavedGuestAttendanceOperation = z.infer<typeof savedSchema>;
const queues = new Map<string, Promise<void>>();
const active = new Set<string>();
const ownerKey = (scope: GuestAttendanceScope) => JSON.stringify([scope.tenantId, scope.userId, scope.eventId, scope.guestId]);
function draftScope(scope: GuestAttendanceScope): CreationDraftScope {
  scopeSchema.parse(scope);
  return { kind: 'event-guest-attendance', tenantId: scope.tenantId, userId: scope.userId, contextId: `${scope.eventId}:${scope.guestId}` };
}
async function ordered<T>(scope: GuestAttendanceScope, task: () => Promise<T>): Promise<T> {
  draftScope(scope);
  const owner = ownerKey(scope);
  const next = (queues.get(owner) ?? Promise.resolve()).then(task);
  const settled = next.then(() => undefined, () => undefined);
  queues.set(owner, settled);
  try { return await next; } finally { if (queues.get(owner) === settled) queues.delete(owner); }
}
async function read(scope: GuestAttendanceScope): Promise<SavedGuestAttendanceOperation | null> {
  const raw = await loadCreationDraft<unknown>(draftScope(scope), { required: true });
  if (raw === null) return null;
  const saved = savedSchema.parse(raw);
  if (ownerKey(saved) !== ownerKey(scope) || saved.intent.guestId !== scope.guestId) throw new Error('Guest operation owner mismatch');
  return saved;
}
async function save(scope: GuestAttendanceScope, value: unknown) {
  const saved = savedSchema.parse(value);
  if (!await saveCreationDraft(draftScope(scope), saved)) throw new Error('Guest operation not saved');
  return saved;
}
/** Reading saved work never sends an attendance mutation. */
export const loadGuestAttendanceOperation = (scope: GuestAttendanceScope) => ordered(scope, () => read(scope));
async function prepare(scope: GuestAttendanceScope, intent: RegistrationGuestAttendanceIntent) {
  return ordered(scope, async () => {
    const parsed = registrationGuestAttendanceIntentSchema.parse(intent);
    if (parsed.guestId !== scope.guestId) throw new Error('Guest intent mismatch');
    const previous = await read(scope);
    if (previous?.status === 'rejected') throw new Error('Guest conflict needs review');
    if (previous?.status === 'pending') {
      if (JSON.stringify(previous.intent) !== JSON.stringify(parsed)) throw new Error('Pending guest request differs');
      return previous;
    }
    if (previous?.status === 'review' && previous.attendanceVersion !== parsed.expectedVersion) throw new Error('Guest review version mismatch');
    return save(scope, { ...scope, schemaVersion: 1, status: 'pending', intent: parsed, key: mutationIdempotencyKey('mobile-guest-attendance') });
  });
}
async function run(scope: GuestAttendanceScope, isCurrent: () => boolean, reserve: () => Promise<SavedGuestAttendanceOperation | null>) {
  scopeSchema.parse(scope);
  const owner = ownerKey(scope);
  if (!isCurrent() || active.has(owner)) throw new Error('Guest operation inactive or busy');
  active.add(owner);
  try {
    const pending = await reserve();
    if (!isCurrent()) throw new Error('Guest operation departed');
    if (!pending || pending.status !== 'pending') throw new Error('No pending guest operation');
    let response: Awaited<ReturnType<typeof transitionOrganizerRegistrationGuest>>;
    try {
      response = await transitionOrganizerRegistrationGuest(scope.eventId, pending.intent, pending.key);
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 409 && error.code === 'EVENT_REGISTRATION_CONFLICT' && error.field === 'expected_version') {
        await ordered(scope, async () => {
          const saved = await read(scope);
          if (saved?.status !== 'pending' || saved.key !== pending.key) throw new Error('Guest rejection mismatch');
          await save(scope, { ...saved, status: 'rejected' });
        });
      }
      throw error;
    }
    // Persist a confirmed receipt even when the originating screen departed.
    await ordered(scope, async () => {
      const saved = await read(scope);
      const fact = response.data.attendance;
      if (saved?.status !== 'pending' || saved.key !== pending.key || fact.event_id !== scope.eventId || fact.guest_id !== scope.guestId
        || fact.attendance_version !== pending.intent.expectedVersion + 1) throw new Error('Guest receipt mismatch');
      await save(scope, { ...saved, status: 'acknowledged', attendanceVersion: fact.attendance_version, historyId: response.data.history_id });
    });
    return response;
  } finally { active.delete(owner); }
}
export const executeGuestAttendanceOperation = (scope: GuestAttendanceScope, intent: RegistrationGuestAttendanceIntent, current: () => boolean) =>
  run(scope, current, () => prepare(scope, intent));
export const recoverGuestAttendanceOperation = (scope: GuestAttendanceScope, current: () => boolean) =>
  run(scope, current, () => loadGuestAttendanceOperation(scope));

/** Explicit read-only review of a definitively rejected version; no guest contact data is saved. */
export async function reviewGuestAttendanceOperation(scope: GuestAttendanceScope, key: string, current: () => boolean) {
  scopeSchema.parse(scope);
  const seen = new Set<number>();
  let page: number | null = 1;
  while (page !== null) {
    if (!current() || seen.has(page)) throw new Error('Guest review departed or invalid pagination');
    seen.add(page);
    const { data } = await getOrganizerRegistrationGuests(scope.eventId, page, 100);
    if (!current() || !data.permissions.manage_attendance) throw new Error('Guest review unavailable');
    const guest = data.guests.find(item => item.id === scope.guestId);
    if (guest) return ordered(scope, async () => {
      const saved = await read(scope);
      if (!current() || saved?.status !== 'rejected' || saved.key !== key || guest.status !== 'captured') throw new Error('Guest review mismatch');
      return save(scope, { ...saved, status: 'review', attendanceVersion: guest.attendance?.version ?? 0 });
    });
    page = data.pagination.guests.next_page;
  }
  throw new Error('Guest no longer available');
}
