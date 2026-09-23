// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import i18n from 'i18next';
import communications from '@/locales/en/event_communications.json';
import eventSafety from '@/locales/en/eventSafety.json';
let mockParams: { id?: string | string[] } = { id: '7' };
let mockUserId = 3;
let mockFocused = true;
const mockConfirm = jest.fn();
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/useConfirm', () => ({ useConfirm: () => ({ confirm: mockConfirm, confirmDialog: null }) }));
jest.mock('@/lib/hooks/useUnsavedChangesGuard', () => ({ useUnsavedChangesGuard: jest.fn() }));
jest.mock('@/lib/hooks/useTenant', () => ({ usePrimaryColor: () => '#06f', useTenant: () => ({ tenant: { id: 2 } }) }));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mockUserId } }) }));
jest.mock('@/lib/api/events', () => ({ getEvent: jest.fn() }));
jest.mock('@/lib/api/eventSafety', () => ({ ...jest.requireActual('@/lib/api/eventSafety'), getEventSafety: jest.fn() }));
jest.mock('@/lib/api/eventSafetyManagement', () => ({ ...jest.requireActual('@/lib/api/eventSafetyManagement'), getEventSafetyReviews: jest.fn() }));
jest.mock('@/lib/api/eventPeople', () => ({ searchEventInviteMembers: jest.fn() }));
jest.mock('@/lib/eventSafetyOperation', () => ({ loadSafetyOperation: jest.fn(), executeSafetyOperation: jest.fn(), recoverSafetyOperation: jest.fn(), discardRejectedSafetyOperation: jest.fn() }));
import Screen, { draftFromForm, parseAge } from './event-safety';
import { getEvent } from '@/lib/api/events';
import { getEventSafety } from '@/lib/api/eventSafety';
import { getEventSafetyReviews } from '@/lib/api/eventSafetyManagement';
import { searchEventInviteMembers as search } from '@/lib/api/eventPeople';
import { loadSafetyOperation as load, executeSafetyOperation as execute, recoverSafetyOperation as recover, discardRejectedSafetyOperation as discard } from '@/lib/eventSafetyOperation';
import { ApiResponseError } from '@/lib/api/client';

const event = { id: 7, organizer: { id: 3 }, permissions: { edit: true } };
const permissions = { manage_requirements: true, review_participation: true, acknowledge_code_of_conduct: false, withdraw_code_of_conduct: false, request_guardian_consent: false, withdraw_guardian_consent: false };
function safety(overrides: Record<string, unknown> = {}) {
  return {
    contract_version: 1, event_id: 7,
    rollout: { mode: 'shadow', source: 'global', configuration_valid: true, enforcement_active: false },
    requirements: { status: 'draft', revision: 2, current_version: 1, published_version: null,
      version: { number: 1, minimum_age: 16, guardian_consent_required: false, minor_age_threshold: null,
        code_of_conduct: { required: false, text: null, text_version: null, text_hash: null }, published_at: null } },
    eligibility: { status: 'not_evaluated', reason_codes: [], required_actions: [], requirements_version: null, age_at_event: null, minor_at_event: null },
    evidence: { code_of_conduct: { status: 'not_required', acknowledgement_id: null, text_version: null, acknowledged_at: null },
      guardian_consent: { status: 'not_required', consent_id: null, consent_version: null, expires_at: null, granted_at: null }, active_denial: null },
    permissions,
    privacy: { guardian_identity_redacted: true, guardian_token_redacted: true, safeguarding_policy_evidence_redacted: true, free_text_review_notes_supported: false },
    ...overrides,
  };
}
const review = {
  denial: { id: 40, decision: 'deny', reason_code: 'safety_review', status: 'active', decision_version: 2, effective_from: '2026-09-23T10:00:00+00:00', effective_until: null, reviewed_at: '2026-09-23T10:00:00+00:00' },
  member: { id: 9, display_name: 'Reviewed member', avatar_url: null }, reviewer: { id: 3, display_name: 'Organiser' },
  history: [{ decision_version: 2, decision: 'deny', reason_code: 'safety_review', status: 'active', action: 'recorded', effective_from: '2026-09-23T10:00:00+00:00', effective_until: null, reviewed_at: '2026-09-23T10:00:00+00:00', reviewer: { id: 3, display_name: 'Organiser' } }],
};
const reviews = (items: unknown[] = [review], total = items.length, page = 1) => ({ data: { items, total, page, per_page: 25 } });
const pendingReview = { tenantId: 2, userId: 3, eventId: 7, schemaVersion: 1, status: 'pending', key: 'saved', attempts: 1,
  intent: { action: 'withdraw', denialId: 40, expectedVersion: 2 } };

beforeEach(() => {
  i18n.addResourceBundle('en', 'event_communications', communications, true, true);
  i18n.addResourceBundle('en', 'eventSafety', eventSafety, true, true);
  jest.clearAllMocks(); mockParams = { id: '7' }; mockUserId = 3; mockFocused = true;
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  jest.mocked(getEvent).mockReset().mockResolvedValue({ data: event } as never);
  jest.mocked(getEventSafety).mockReset().mockResolvedValue({ data: safety() } as never);
  jest.mocked(getEventSafetyReviews).mockReset().mockResolvedValue(reviews() as never);
  jest.mocked(search).mockReset().mockResolvedValue([{ id: 10, name: 'New member' }] as never);
  jest.mocked(load).mockReset().mockResolvedValue(null);
  jest.mocked(execute).mockReset().mockResolvedValue({ data: {} } as never);
  jest.mocked(recover).mockReset().mockResolvedValue({ data: {} } as never);
  jest.mocked(discard).mockReset().mockResolvedValue(undefined);
});
async function ready() {
  const view = render(<Screen />);
  await view.findByText('Reviewed member · Member #9');
  await waitFor(() => expect(load).toHaveBeenCalled());
  return view;
}

describe('requirement form helpers', () => {
  it('accepts blank or whole ages in range only', () => {
    expect(parseAge('', 0)).toBeNull(); expect(parseAge(' 18 ', 0)).toBe(18); expect(parseAge('0', 1)).toBeUndefined();
    expect(parseAge('1.5', 0)).toBeUndefined(); expect(parseAge('126', 0)).toBeUndefined(); expect(parseAge('-1', 0)).toBeUndefined();
  });
  it('requires a threshold for guardian consent and complete code-of-conduct fields', () => {
    const base = { minimumAge: '', guardian: false, threshold: '', codeRequired: false, codeText: '', codeVersion: '' };
    expect(draftFromForm({ ...base, guardian: true })).toBeNull();
    expect(draftFromForm({ ...base, codeRequired: true, codeText: 'Be kind' })).toBeNull();
    expect(draftFromForm({ ...base, guardian: true, threshold: '18', codeRequired: true, codeText: ' Be kind ', codeVersion: ' v1 ' })).toEqual({
      minimum_age: null, guardian_consent_required: true, minor_age_threshold: 18, code_of_conduct_required: true, code_of_conduct_text: 'Be kind', code_of_conduct_text_version: 'v1' });
  });
});

it.each([undefined, '0', '1e2', ['7']])('rejects invalid link %j without requests', id => {
  mockParams = { id }; const view = render(<Screen />);
  expect(view.getByText('Invalid event ID.')).toBeTruthy(); expect(getEvent).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled();
});

it('shows a loading state, then the policy, observation notice and review ledger', async () => {
  const view = render(<Screen />);
  expect(view.queryByText('Participation policy')).toBeNull();
  await view.findByText('Participation policy');
  expect(view.getByText('Observation mode · Draft')).toBeTruthy();
  expect(view.getByText('Revision 2, policy version 1')).toBeTruthy();
  expect(view.getByDisplayValue('16')).toBeTruthy();
  expect(await view.findByText('Reviewed member · Member #9')).toBeTruthy();
  expect(view.getByText('Recorded decisions: 1')).toBeTruthy();
  expect(view.getByText('Audit history: 1')).toBeTruthy();
});

it('shows an empty ledger and "no policy" state', async () => {
  jest.mocked(getEventSafety).mockResolvedValue({ data: safety({ requirements: null }) } as never);
  jest.mocked(getEventSafetyReviews).mockResolvedValue(reviews([]) as never);
  const view = render(<Screen />);
  expect(await view.findByText('No participation policy has been saved yet.')).toBeTruthy();
  expect(view.getByText('No participation reviews have been recorded for this event.')).toBeTruthy();
  expect(view.queryByText('Publish requirements')).toBeNull();
  expect(view.queryByText('Archive requirements')).toBeNull();
});

it.each([401, 403, 404])('clears the workspace on refusal %s', async status => {
  jest.mocked(getEventSafety).mockRejectedValue(new ApiResponseError(status, 'No'));
  const view = render(<Screen />);
  expect(await view.findByText('You may not have permission to manage safety for this event.')).toBeTruthy();
  expect(view.queryByText('Participation policy')).toBeNull();
});

it('offers retry after a general load failure', async () => {
  // useApi retries a 5xx once on its own, so fail both attempts.
  jest.mocked(getEventSafety).mockRejectedValueOnce(new ApiResponseError(500, 'Down')).mockRejectedValueOnce(new ApiResponseError(500, 'Down'));
  const view = render(<Screen />);
  fireEvent.press(await view.findByText('Try again', {}, { timeout: 5000 }));
  expect(await view.findByText('Participation policy')).toBeTruthy();
});

it('does not send an invalid draft and sends the exact validated draft with the current revision', async () => {
  const view = await ready();
  fireEvent.changeText(view.getByDisplayValue('16'), '1.5');
  fireEvent.press(view.getByText('Save draft'));
  expect(execute).not.toHaveBeenCalled();
  expect(view.getByText('Enter a whole number from 0 to 125.')).toBeTruthy();
  fireEvent.changeText(view.getByDisplayValue('1.5'), '18');
  await act(async () => { fireEvent.press(view.getByText('Save draft')); });
  expect(execute).toHaveBeenCalledWith({ eventId: 7, tenantId: 2, userId: 3 }, { action: 'draft', expectedRevision: 2, payload: {
    minimum_age: 18, guardian_consent_required: false, minor_age_threshold: null, code_of_conduct_required: false, code_of_conduct_text: null, code_of_conduct_text_version: null } }, expect.any(Function));
});

it('publishes and archives only after confirmation, with current revision and version', async () => {
  const view = await ready();
  fireEvent.press(view.getByText('Publish requirements')); expect(execute).not.toHaveBeenCalled();
  await act(async () => mockConfirm.mock.calls[0][0].onConfirm());
  expect(execute).toHaveBeenLastCalledWith(expect.anything(), { action: 'publish', expectedRevision: 2, expectedVersion: 1 }, expect.any(Function));
  await waitFor(() => expect(view.getByText('Archive requirements')).toBeTruthy());
  fireEvent.press(view.getByText('Archive requirements'));
  expect(mockConfirm.mock.calls[1][0].title).toBe('Archive these safety requirements?');
  await act(async () => mockConfirm.mock.calls[1][0].onConfirm());
  expect(execute).toHaveBeenLastCalledWith(expect.anything(), { action: 'archive', expectedRevision: 2, expectedVersion: 1 }, expect.any(Function));
});

it('records a confirmed review for the selected member and withdraws with the decision version', async () => {
  const view = await ready();
  fireEvent.changeText(view.getByLabelText('Find a member'), 'New');
  fireEvent.press(await view.findByLabelText('Select New member · Member #10'));
  fireEvent.press(view.getByLabelText('Remove from event'));
  fireEvent.press(view.getByLabelText('Conduct violation'));
  fireEvent.press(view.getByText('Save review decision'));
  expect(execute).not.toHaveBeenCalled();
  await act(async () => mockConfirm.mock.calls[0][0].onConfirm());
  expect(execute).toHaveBeenCalledWith(expect.anything(), { action: 'review', payload: expect.objectContaining({
    user_id: 10, decision: 'remove', reason_code: 'conduct_violation', effective_until: null, expected_version: null }) }, expect.any(Function));
  const sent = jest.mocked(execute).mock.calls[0][1] as { payload: { effective_from: string } };
  expect(sent.payload.effective_from).toMatch(/\.000Z$/);
  fireEvent.press(await view.findByText('Withdraw decision'));
  await act(async () => mockConfirm.mock.calls[1][0].onConfirm());
  expect(execute).toHaveBeenLastCalledWith(expect.anything(), { action: 'withdraw', denialId: 40, expectedVersion: 2 }, expect.any(Function));
});

it('edits an existing review with its expected decision version', async () => {
  const view = await ready();
  fireEvent.press(view.getByText('Update decision'));
  expect(view.getByText('Update this decision')).toBeTruthy();
  fireEvent.press(view.getByText('Save review decision'));
  await act(async () => mockConfirm.mock.calls[0][0].onConfirm());
  expect(execute).toHaveBeenCalledWith(expect.anything(), { action: 'review', payload: expect.objectContaining({ user_id: 9, expected_version: 2, decision: 'deny' }) }, expect.any(Function));
});

it('shows a saved uncertain change, blocks new work and recovers only on explicit request', async () => {
  jest.mocked(load).mockResolvedValue(pendingReview as never);
  const view = await ready();
  expect(view.getByText('Withdraw decision #40')).toBeTruthy();
  expect(recover).not.toHaveBeenCalled();
  expect(view.getByText('Save draft').parent?.props.accessibilityState?.disabled ?? true).toBeTruthy();
  fireEvent.press(view.getByText('Save draft')); expect(execute).not.toHaveBeenCalled();
  jest.mocked(load).mockResolvedValue({ tenantId: 2, userId: 3, eventId: 7, schemaVersion: 1, status: 'acknowledged', key: 'saved' } as never);
  await act(async () => { fireEvent.press(view.getByText(communications.recovery_button)); });
  expect(recover).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(view.queryByText('Withdraw decision #40')).toBeNull());
});

it('shows a first conflict as rejected and discards it only after confirmation', async () => {
  jest.mocked(load).mockResolvedValue({ ...pendingReview, status: 'rejected', code: 'EVENT_SAFETY_CONFLICT' } as never);
  const view = await ready();
  expect(view.getByText('Saved change was not applied')).toBeTruthy();
  fireEvent.press(view.getByText('Discard saved change'));
  expect(discard).not.toHaveBeenCalled();
  jest.mocked(load).mockResolvedValue(null);
  await act(async () => mockConfirm.mock.calls[0][0].onConfirm());
  expect(discard).toHaveBeenCalledWith({ tenantId: 2, userId: 3, eventId: 7 }, 'saved', expect.any(Function));
});

it('keeps the edited draft and shows the failure when a save fails', async () => {
  jest.mocked(execute).mockRejectedValue(new ApiResponseError(503, 'Unavailable'));
  const view = await ready();
  fireEvent.changeText(view.getByDisplayValue('16'), '21');
  await act(async () => { fireEvent.press(view.getByText('Save draft')); });
  expect(await view.findByText('The safety change could not be completed. Check the saved change before trying again.')).toBeTruthy();
  expect(view.getByDisplayValue('21')).toBeTruthy();
});

it('is read-only without management or review permission', async () => {
  jest.mocked(getEventSafety).mockResolvedValue({ data: safety({ permissions: { ...permissions, manage_requirements: false, review_participation: false } }) } as never);
  const view = render(<Screen />);
  expect(await view.findByText('You can view this policy but cannot change its requirements.')).toBeTruthy();
  expect(view.queryByText('Save draft')).toBeNull();
  expect(getEventSafetyReviews).not.toHaveBeenCalled();
});

it('pages the review ledger', async () => {
  jest.mocked(getEventSafetyReviews).mockImplementation(async (_id, page = 1) => reviews([{ ...review, denial: { ...review.denial, id: 40 + page } }], 30, page) as never);
  const view = await ready();
  expect(view.getByText('Page 1 of 2')).toBeTruthy();
  fireEvent.press(view.getByText('Next page'));
  expect(await view.findByText('Page 2 of 2')).toBeTruthy();
  expect(getEventSafetyReviews).toHaveBeenLastCalledWith(7, 2, 25);
});

it('locks an archived policy, because the server refuses further drafts', async () => {
  jest.mocked(getEventSafety).mockResolvedValue({ data: safety({ requirements: { ...safety().requirements, status: 'archived' } }) } as never);
  const view = await ready();
  expect(view.getByText('This policy is archived and can no longer be changed. Its evidence and audit history are kept.')).toBeTruthy();
  expect(view.queryByText('Save draft')).toBeNull();
  expect(view.queryByText('Archive requirements')).toBeNull();
  expect(view.getByDisplayValue('16').props.editable).toBe(false);
});

it('reloads current server values once after a change is rejected, without looping', async () => {
  jest.mocked(load).mockResolvedValue({ ...pendingReview, status: 'rejected', code: 'EVENT_SAFETY_CONFLICT' } as never);
  const view = await ready();
  expect(view.getByText('Saved change was not applied')).toBeTruthy();
  await waitFor(() => expect(getEventSafety).toHaveBeenCalledTimes(2));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
  expect(getEventSafety).toHaveBeenCalledTimes(2);
});

it('keeps the end date shown on the iOS wheel when the organiser taps Done without scrolling', async () => {
  // iOS fires no change event until the wheel moves; Done must keep what is shown.
  const view = await ready();
  fireEvent.changeText(view.getByLabelText('Find a member'), 'New');
  fireEvent.press(await view.findByLabelText('Select New member · Member #10'));
  fireEvent.press(view.getByText('Set an end date'));
  const shown = view.UNSAFE_getByType(DateTimePicker).props.value as Date;
  fireEvent.press(view.getByText('Done'));
  fireEvent.press(view.getByText('Save review decision'));
  await act(async () => mockConfirm.mock.calls[0][0].onConfirm());
  const sent = jest.mocked(execute).mock.calls[0][1] as { payload: { effective_until: string | null } };
  expect(sent.payload.effective_until).not.toBeNull();
  expect(Math.abs(Date.parse(sent.payload.effective_until as string) - shown.getTime())).toBeLessThan(5000);
});
