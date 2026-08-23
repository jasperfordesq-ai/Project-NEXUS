// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Every events response the app parses, driven from a REAL captured response.
 *
 * 🔴 Why this file exists. Three separate defects on 2026-08-23 came from one cause: a test
 * fixture written from the app's own type instead of from the server. Event check-in
 * reported failure while succeeding (`credit_status` undeclared on a `.strict()` object),
 * offline check-in could never be activated, and the Matches screen crashed outright. Each
 * had a passing test alongside it.
 *
 * The events family is the most exposed surface in the app: **141 `.strict()` zod objects**
 * across nine client modules. A `.strict()` object turns any field the server adds into a
 * thrown error, which the calling screen shows as a failed action — AFTER the write has
 * committed. Nothing compared those schemas with the API.
 *
 * So the fixtures in `__contract__/` are the API's own words, captured from a live local
 * Laravel with the exact headers the client sends (`X-Events-Contract: 2`, and
 * `X-Event-Checkin-Contract` for the offline module). Refresh them with
 * `scripts/capture-events-contract.sh` and read what changes — a diff there is the server
 * moving, which is the thing worth knowing.
 *
 * 🔴 What this does NOT cover: only the contract-2 variant, because that is the only one
 * the client ever asks for. It also cannot see a field the server sends that the client
 * silently ignores — `.passthrough()` objects accept those by design.
 */

import fs from 'node:fs';
import path from 'node:path';

import { api } from '@/lib/api/client';

jest.mock('@/lib/api/client', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  ApiResponseError: class extends Error {},
}));

jest.mock('@/lib/observability/report', () => ({
  reportSentryMessage: jest.fn(),
  reportError: jest.fn(),
}));

import {
  getEvent,
  getEventAgenda,
  getEventAttendees,
  getEventAttendanceRoster,
  getEventCategories,
  getEvents,
  transitionEventAttendance,
} from './events';
import { getEventAnalytics } from './eventAnalytics';
import { getEventLifecycleHistory } from './eventLifecycleHistory';
import { getEventSafety } from './eventSafety';
import { getEventTickets } from './eventTickets';
import { createEventCommunication, getEventCommunications } from './eventCommunications';
import {
  getOfflineCheckinConflicts,
  getOfflineCheckinWorkspace,
  issueMyEventCheckinCredential,
  registerOfflineCheckinDevice,
} from './eventOfflineCheckin';
import { getEventTemplates } from './eventTemplates';
import { getAttendeeRegistrationProduct } from './eventRegistration';

const FIXTURES = path.join(__dirname, '__contract__');

function captured(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'));
}

/** Every capture, paired with the client call that has to accept it. */
const CONTRACTS: { fixture: string; label: string; call: () => Promise<unknown> }[] = [
  { fixture: 'events-list', label: 'GET /events', call: () => getEvents() },
  { fixture: 'event-detail', label: 'GET /events/{id}', call: () => getEvent(164) },
  { fixture: 'agenda', label: 'GET /events/{id}/agenda', call: () => getEventAgenda(164) },
  { fixture: 'analytics', label: 'GET /events/{id}/analytics', call: () => getEventAnalytics(164) },
  { fixture: 'attendees', label: 'GET /events/{id}/attendees', call: () => getEventAttendees(164) },
  { fixture: 'people', label: 'GET /events/{id}/people', call: () => getEventAttendanceRoster(164) },
  { fixture: 'broadcasts', label: 'GET /events/{id}/broadcasts', call: () => getEventCommunications(164) },
  { fixture: 'lifecycle-history', label: 'GET /events/{id}/lifecycle-history', call: () => getEventLifecycleHistory(164) },
  { fixture: 'offline-workspace', label: 'GET /events/{id}/offline-checkin', call: () => getOfflineCheckinWorkspace(164) },
  { fixture: 'offline-conflicts', label: 'GET /events/{id}/offline-checkin/conflicts', call: () => getOfflineCheckinConflicts(164) },
  { fixture: 'registration-product', label: 'GET /events/{id}/registration-product', call: () => getAttendeeRegistrationProduct(164) },
  { fixture: 'safety', label: 'GET /events/{id}/safety', call: () => getEventSafety(164) },
  { fixture: 'tickets', label: 'GET /events/{id}/tickets', call: () => getEventTickets(164) },
  { fixture: 'templates', label: 'GET /event-templates', call: () => getEventTemplates() },
  { fixture: 'categories', label: 'GET /categories', call: () => getEventCategories() },
];

describe('events contract, against real captured responses', () => {
  beforeEach(() => jest.clearAllMocks());

  it('has a capture for every contract under test', () => {
    for (const contract of CONTRACTS) {
      expect(fs.existsSync(path.join(FIXTURES, `${contract.fixture}.json`))).toBe(true);
    }
    expect(CONTRACTS.length).toBeGreaterThanOrEqual(15);
  });

  it.each(CONTRACTS.map((c) => [c.label, c] as const))(
    'accepts the real response for %s',
    async (_label, contract) => {
      (api.get as jest.Mock).mockResolvedValue(captured(contract.fixture));
      await expect(contract.call()).resolves.toBeDefined();
    },
  );

  /**
   * 🔴 WRITES, not just reads — this is the half that matters most.
   *
   * The first version of this file captured GET responses only, and a mutation check proved
   * it would NOT have caught the defect that prompted it: `credit_status` lives in the
   * attendance MUTATION response, so deleting it from the schema left every GET fixture
   * happy. A drift on a write is worse than on a read, because the throw lands AFTER the
   * server has committed — the member is told their action failed when it succeeded.
   *
   * These payloads are real 2xx bodies from the live local API, captured with the client's
   * own headers.
   */
  const MUTATIONS: { fixture: string; label: string; call: () => Promise<unknown> }[] = [
    {
      fixture: 'mutation-attendance',
      label: 'POST /events/{id}/people/{userId}/attendance',
      /*
        🔴 The captured body is a real `undo` response, deliberately, because it is the only
        way to exercise the `undo` branch of the response enum — the client's
        `EventAttendanceAction` type cannot express it. The server accepts `undo`, the
        response schema declares it, and `management_actions.undo_attendance` came back TRUE
        on the roster capture, yet the online attendance screen offers no undo at all while
        the offline queue does. Recorded against journey 5.4; building it needs a reason
        field the client does not currently send.
      */
      call: () => transitionEventAttendance(163, 675, {
        action: 'no_show',
        expectedVersion: 2,
        idempotencyKey: 'contract-drift',
      }),
    },
    {
      fixture: 'mutation-broadcast',
      label: 'POST /events/{id}/broadcasts',
      call: () => createEventCommunication(
        164,
        { variant: 'announcement', segments: ['registration_confirmed'], channels: ['in_app'], body: 'x' },
        'contract-drift',
      ),
    },
    {
      fixture: 'mutation-device',
      label: 'POST /events/{id}/offline-checkin/devices',
      call: () => registerOfflineCheckinDevice(164, 'Contract capture device', 'contract-drift'),
    },
    {
      fixture: 'mutation-checkin-credential',
      label: 'POST /events/{id}/offline-checkin/credentials',
      call: () => issueMyEventCheckinCredential(164, 'contract-drift'),
    },
  ];

  it('has a capture for every mutation under test', () => {
    for (const mutation of MUTATIONS) {
      expect(fs.existsSync(path.join(FIXTURES, `${mutation.fixture}.json`))).toBe(true);
    }
  });

  it.each(MUTATIONS.map((m) => [m.label, m] as const))(
    'accepts the real response for %s',
    async (_label, mutation) => {
      (api.post as jest.Mock).mockResolvedValue(captured(mutation.fixture));
      await expect(mutation.call()).resolves.toBeDefined();
    },
  );

  /**
   * 🔴 A gate that overstates its own coverage is worse than no gate.
   *
   * An empty array satisfies any array schema, so a capture whose collections are empty
   * proves the ENVELOPE and nothing about the items inside it — and item-level omissions
   * are exactly what caused the check-in defect (`credit_status`). These collections were
   * still empty when the fixtures were captured, so their item schemas are UNVERIFIED.
   *
   * Shrink-only: populate one in the fixture data, refresh with
   * `scripts/capture-events-contract.sh`, and remove it here in the same commit.
   */
  const UNVERIFIED_ITEM_SCHEMAS = [
    'event-detail: series_occurrences (needs a recurring series)',
    'offline-conflicts: items (needs a genuine sync conflict)',
    'registration-product: registrations, submissions, guests, invitations',
    'templates: the list itself (no template exists in the fixture)',
    'tickets: ticket_types, own_entitlements (no mobile creator; admin-side)',
  ];

  it('states which item schemas its own fixtures do NOT exercise', () => {
    const stillEmpty: string[] = [];
    for (const contract of CONTRACTS) {
      const body = captured(contract.fixture) as Record<string, unknown>;
      const payload = (body?.data ?? body) as unknown;
      const collections = Array.isArray(payload)
        ? { [contract.fixture]: payload }
        : Object.fromEntries(
            Object.entries((payload ?? {}) as Record<string, unknown>)
              .filter(([, value]) => Array.isArray(value)),
          );
      const counts = Object.values(collections).map((value) => (value as unknown[]).length);
      if (counts.length > 0 && counts.every((n) => n === 0)) {
        stillEmpty.push(contract.fixture);
      }
    }

    // Every capture with nothing in it must be named above, and nothing may be named there
    // that is now populated — so the list cannot rot in either direction.
    const named = UNVERIFIED_ITEM_SCHEMAS.map((line) => line.split(':')[0]);
    expect(stillEmpty.sort()).toEqual(named.sort());
  });
});
