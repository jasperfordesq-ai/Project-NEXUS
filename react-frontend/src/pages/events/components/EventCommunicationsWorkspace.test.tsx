// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  eventCommunicationsApi,
  type EventBroadcast,
  type EventBroadcastDetail,
  type EventBroadcastPreview,
} from '@/lib/event-communications-api';
import type { ApiResponse } from '@/lib/api';
import { renderEventComponent } from '@/test/events-test-harness';
import { EventCommunicationsWorkspace } from './EventCommunicationsWorkspace';
import { composerStorageKey } from './communications/composerSession';

// Real English copy is loaded by src/test/setup.ts, so these tests read the
// words an organiser actually sees.

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => mockToast }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('@/components/ui/DatePicker', async () => {
  const { parseDate } = await import('@internationalized/date');
  return {
    DatePicker: ({ label, value, onChange, isInvalid, errorMessage, minValue }: {
      label: string;
      value?: { toString(): string } | null;
      onChange?: (value: ReturnType<typeof parseDate>) => void;
      isInvalid?: boolean;
      errorMessage?: React.ReactNode;
      minValue?: { toString(): string } | null;
    }) => (
      <label>
        {label}
        <input
          aria-label={label}
          data-min={minValue?.toString()}
          aria-invalid={isInvalid || undefined}
          value={value?.toString() ?? ''}
          onChange={(event) => event.target.value && onChange?.(parseDate(event.target.value))}
        />
        {isInvalid && errorMessage ? <span>{errorMessage}</span> : null}
      </label>
    ),
  };
});

vi.mock('@/components/ui/TimeInput', async () => {
  const { parseTime } = await import('@internationalized/date');
  return {
    TimeInput: ({ label, value, onChange, isInvalid, errorMessage }: {
      label: string;
      value?: { toString(): string } | null;
      onChange?: (value: ReturnType<typeof parseTime>) => void;
      isInvalid?: boolean;
      errorMessage?: React.ReactNode;
    }) => (
      <label>
        {label}
        <input
          aria-label={label}
          aria-invalid={isInvalid || undefined}
          value={value?.toString().slice(0, 5) ?? ''}
          onChange={(event) => event.target.value && onChange?.(parseTime(event.target.value))}
        />
        {isInvalid && errorMessage ? <span>{errorMessage}</span> : null}
      </label>
    ),
  };
});

type MutationResponse = Awaited<ReturnType<typeof eventCommunicationsApi.create>>;

function broadcastFixture(overrides: Partial<EventBroadcast> = {}): EventBroadcast {
  return {
    contract_version: 1,
    id: 8,
    event_id: 42,
    variant: 'announcement',
    status: 'draft',
    version: 1,
    audience: { segments: ['registration_confirmed'], recipient_count: 12 },
    channels: ['email', 'in_app'],
    body: null,
    delivery: { total: 0, delivered: 0, suppressed: 0, dead_lettered: 0, failure_code: null },
    capabilities: { edit: true, schedule: true, cancel: true, retry: false },
    scheduled_at: null,
    cancelled_at: null,
    sent_at: null,
    failed_at: null,
    created_at: '2026-07-11T10:00:00+00:00',
    updated_at: '2026-07-11T10:00:00+00:00',
    ...overrides,
  };
}

function detailFixture(overrides: Partial<EventBroadcast> = {}): EventBroadcastDetail {
  return {
    broadcast: broadcastFixture({ body: 'Exact organizer prose.', ...overrides }),
    history: [{
      id: 1,
      version: 1,
      action: 'created',
      from_status: null,
      to_status: 'draft',
      metadata: {},
      created_at: '2026-07-11T10:00:00+00:00',
    }],
    history_meta: { current_page: 1, per_page: 50, total: 1, total_pages: 1, has_more: false },
  };
}

function mutation(overrides: Partial<EventBroadcast> = {}): MutationResponse {
  return {
    success: true,
    data: { ...detailFixture(overrides), changed: true, idempotent_replay: false },
  };
}

function listOf(...broadcasts: EventBroadcast[]) {
  return {
    success: true,
    data: broadcasts,
    meta: { current_page: 1, per_page: 20, total: broadcasts.length, total_pages: 1, has_more: false },
  };
}

function preview(recipients = 12): ApiResponse<EventBroadcastPreview> {
  return {
    success: true,
    data: {
      contract_version: 1,
      event_id: 42,
      variant: 'announcement',
      segments: ['registration_confirmed'],
      channels: ['email', 'in_app'],
      recipient_count: recipients,
      delivery_count: recipients * 2,
      segment_counts: { registration_confirmed: recipients },
      generated_at: '2026-07-11T10:00:00+00:00',
    },
  };
}

function renderWorkspace(props: Partial<Parameters<typeof EventCommunicationsWorkspace>[0]> = {}) {
  return renderEventComponent(
    <EventCommunicationsWorkspace eventId={42} eventTitle="Community summit" eventTimezone="UTC" {...props} />,
  );
}

async function openComposerAndWrite(user: ReturnType<typeof userEvent.setup>, body = 'Exact organizer prose.') {
  await user.click(await screen.findByRole('button', { name: 'New message' }));
  const dialog = await screen.findByRole('dialog');
  await user.type(within(dialog).getByRole('textbox', { name: /Your message/ }), body);
  await within(dialog).findByText('12 people will get this message');
  return dialog;
}

describe('EventCommunicationsWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    window.sessionStorage.clear();
    vi.spyOn(eventCommunicationsApi, 'list').mockResolvedValue(listOf(broadcastFixture()));
    vi.spyOn(eventCommunicationsApi, 'preview').mockResolvedValue(preview());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows only numbers about people, in plain words', async () => {
    renderWorkspace();

    expect(await screen.findByRole('heading', { name: 'Messages to attendees' })).toBeInTheDocument();
    expect(screen.getByText("People's details stay private")).toBeInTheDocument();
    expect(screen.getByText('Draft – not sent yet')).toBeInTheDocument();
    expect(screen.getByText('(No text yet)')).toBeInTheDocument();
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Version/)).not.toBeInTheDocument();
    expect(eventCommunicationsApi.list).toHaveBeenCalledWith(42, 1, 20, { includeSummary: true });
  });

  it('keeps the composer above fixed navigation and inside short viewport insets', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(await screen.findByRole('button', { name: 'New message' }));
    const dialog = await screen.findByRole('dialog', { name: 'New message for Community summit' });
    const backdrop = dialog.closest<HTMLElement>('[data-slot="modal-backdrop"]');
    const container = dialog.closest<HTMLElement>('[data-slot="modal-container"]');

    expect(backdrop).toHaveClass('z-[var(--z-modal-backdrop)]');
    expect(container).toHaveClass(
      'z-[var(--z-modal)]',
      'pt-[calc(var(--safe-area-top)+1rem)]',
      'pb-[calc(var(--safe-area-bottom)+1rem)]',
      'sm:pt-[calc(var(--safe-area-top)+2.5rem)]',
      'sm:pb-[calc(var(--safe-area-bottom)+2.5rem)]',
    );
  });

  it('counts automatically and sends in one action', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(eventCommunicationsApi, 'create').mockResolvedValue(mutation({ id: 9 }));
    const schedule = vi.spyOn(eventCommunicationsApi, 'schedule')
      .mockResolvedValue(mutation({ id: 9, status: 'scheduled', version: 2 }));
    renderWorkspace();

    const dialog = await openComposerAndWrite(user);
    await user.click(within(dialog).getByRole('button', { name: 'Send now' }));
    expect(within(dialog).getByText('Ready to send?')).toBeInTheDocument();
    expect(within(dialog).getByText(/This will go to 12 people by email and a notification in the app/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Yes, send now' }));

    await waitFor(() => expect(schedule).toHaveBeenCalledWith(9, 1, null, expect.any(String)));
    expect(create).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ body: 'Exact organizer prose.', segments: ['registration_confirmed'] }),
      expect.any(String),
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Your message is on its way/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('closes after sending when React mounts it twice, as the app does in development (StrictMode)', async () => {
    // E-106 browser check: under StrictMode the composer's "still on screen"
    // flag was cleared by the first, simulated unmount and never set again, so
    // after a successful send the dialog stayed open with a spinning button.
    const user = userEvent.setup();
    vi.spyOn(eventCommunicationsApi, 'create').mockResolvedValue(mutation({ id: 9 }));
    vi.spyOn(eventCommunicationsApi, 'schedule')
      .mockResolvedValue(mutation({ id: 9, status: 'scheduled', version: 2 }));
    renderEventComponent(
      <StrictMode>
        <EventCommunicationsWorkspace eventId={42} eventTitle="Community summit" eventTimezone="UTC" />
      </StrictMode>,
    );

    const dialog = await openComposerAndWrite(user);
    await user.click(within(dialog).getByRole('button', { name: 'Send now' }));
    await user.click(within(dialog).getByRole('button', { name: 'Yes, send now' }));

    expect(await screen.findByText(/Your message is on its way/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('waits before counting and ignores an older count that arrives late', async () => {
    const user = userEvent.setup();
    let resolveFirst: (value: ApiResponse<EventBroadcastPreview>) => void = () => undefined;
    const previewSpy = vi.spyOn(eventCommunicationsApi, 'preview')
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValue(preview(7));
    renderWorkspace();

    await user.click(await screen.findByRole('button', { name: 'New message' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(previewSpy).toHaveBeenCalledTimes(1));

    // Two quick changes make ONE new request, not two.
    await user.click(within(dialog).getByText('People on the waiting list'));
    await user.click(within(dialog).getByText('Push notification on their phone'));
    expect(await within(dialog).findByText('7 people will get this message')).toBeInTheDocument();
    expect(previewSpy).toHaveBeenCalledTimes(2);

    await act(async () => { resolveFirst(preview(5)); });
    expect(within(dialog).getByText('7 people will get this message')).toBeInTheDocument();
    expect(within(dialog).queryByText('5 people will get this message')).not.toBeInTheDocument();
  });

  it('replays the same key when retrying and uses a new key after an edit', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(eventCommunicationsApi, 'create').mockResolvedValue({
      success: false,
      code: 'SERVER_ERROR',
      errors: [{ code: 'SERVER_ERROR', message: 'Server error' }],
    } as MutationResponse);
    renderWorkspace();

    const dialog = await openComposerAndWrite(user);
    await user.click(within(dialog).getByRole('button', { name: 'Send now' }));
    await user.click(within(dialog).getByRole('button', { name: 'Yes, send now' }));
    expect(await within(dialog).findByText(/Your message couldn't be sent/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Send now' }));
    await user.click(within(dialog).getByRole('button', { name: 'Yes, send now' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1]?.[2]).toBe(create.mock.calls[0]?.[2]);

    await user.type(within(dialog).getByRole('textbox', { name: /Your message/ }), ' More.');
    await user.click(within(dialog).getByRole('button', { name: 'Send now' }));
    await user.click(within(dialog).getByRole('button', { name: 'Yes, send now' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(3));
    expect(create.mock.calls[2]?.[2]).not.toBe(create.mock.calls[0]?.[2]);
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it("explains a refused send inline with the server's words, and retries only the send with the same key", async () => {
    const user = userEvent.setup();
    const explanation = 'Nobody would receive this message. Choose an audience that includes at least one person.';
    const create = vi.spyOn(eventCommunicationsApi, 'create').mockResolvedValue(mutation({ id: 9 }));
    const schedule = vi.spyOn(eventCommunicationsApi, 'schedule')
      .mockResolvedValueOnce({
        success: false,
        code: 'EVENT_BROADCAST_VALIDATION_FAILED',
        errors: [{
          code: 'EVENT_BROADCAST_VALIDATION_FAILED',
          message: explanation,
          field: 'segments',
          reason: 'event_broadcast_audience_empty',
        }],
      } as MutationResponse)
      .mockResolvedValueOnce(mutation({ id: 9, status: 'scheduled', version: 2 }));
    renderWorkspace();

    const dialog = await openComposerAndWrite(user);
    await user.click(within(dialog).getByRole('button', { name: 'Send now' }));
    await user.click(within(dialog).getByRole('button', { name: 'Yes, send now' }));

    expect(await within(dialog).findByText(`Saved as a draft, but not sent: ${explanation}`)).toBeInTheDocument();
    expect(mockToast.error).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Try sending again' }));
    await waitFor(() => expect(schedule).toHaveBeenCalledTimes(2));
    expect(schedule.mock.calls[1]?.[3]).toBe(schedule.mock.calls[0]?.[3]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('keeps its own wording when a refusal carries no explanation', async () => {
    const user = userEvent.setup();
    vi.spyOn(eventCommunicationsApi, 'create').mockResolvedValue(mutation({ id: 9 }));
    vi.spyOn(eventCommunicationsApi, 'schedule').mockResolvedValue({
      success: false,
      code: 'EVENT_BROADCAST_VALIDATION_FAILED',
      errors: [{ code: 'EVENT_BROADCAST_VALIDATION_FAILED', message: 'Validation failed', field: 'variant' }],
    } as MutationResponse);
    renderWorkspace();

    const dialog = await openComposerAndWrite(user);
    await user.click(within(dialog).getByRole('button', { name: 'Send now' }));
    await user.click(within(dialog).getByRole('button', { name: 'Yes, send now' }));

    expect(await within(dialog).findByText(
      "Saved as a draft, but not sent: Your message couldn't be sent. Nothing went out. Please try again.",
    )).toBeInTheDocument();
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('checks a timed-out create once more with the same key and never creates twice', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(eventCommunicationsApi, 'create')
      .mockResolvedValueOnce({ success: false, code: 'TIMEOUT' } as MutationResponse)
      .mockResolvedValueOnce(mutation({ id: 9 }));
    const schedule = vi.spyOn(eventCommunicationsApi, 'schedule')
      .mockResolvedValue(mutation({ id: 9, status: 'scheduled', version: 2 }));
    renderWorkspace();

    const dialog = await openComposerAndWrite(user);
    await user.click(within(dialog).getByRole('button', { name: 'Send now' }));
    await user.click(within(dialog).getByRole('button', { name: 'Yes, send now' }));

    await waitFor(() => expect(schedule).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]?.[2]).toBe(create.mock.calls[0]?.[2]);
  });

  it('changes a scheduled message in the event zone, replacing the original (B7)', async () => {
    const user = userEvent.setup();
    const scheduled = broadcastFixture({ status: 'scheduled', scheduled_at: '2030-06-01T09:30:00+00:00' });
    vi.spyOn(eventCommunicationsApi, 'list').mockResolvedValue(listOf(scheduled));
    vi.spyOn(eventCommunicationsApi, 'get').mockResolvedValue({
      success: true,
      data: detailFixture({ status: 'scheduled', scheduled_at: '2030-06-01T09:30:00+00:00', body: 'Doors open at seven.' }),
    });
    const cancel = vi.spyOn(eventCommunicationsApi, 'cancel')
      .mockResolvedValue(mutation({ status: 'cancelled', version: 2 }));
    vi.spyOn(eventCommunicationsApi, 'create').mockResolvedValue(mutation({ id: 9, body: 'Doors open at seven.' }));
    const schedule = vi.spyOn(eventCommunicationsApi, 'schedule')
      .mockResolvedValue(mutation({ id: 9, status: 'scheduled', version: 2 }));
    renderWorkspace({ eventTimezone: 'Europe/Dublin' });

    await user.click(await screen.findByRole('button', { name: 'Change scheduled message: Update' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change scheduled message' });
    // 09:30 UTC is 10:30 in Dublin in June.
    expect(within(dialog).getByLabelText('Date')).toHaveValue('2030-06-01');
    expect(within(dialog).getByLabelText('Time')).toHaveValue('10:30');
    expect(within(dialog).getByText(/Times are in Dublin time/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    expect(within(dialog).getByText(/The earlier version you scheduled won't be sent/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Yes, schedule it' }));

    await waitFor(() => expect(schedule).toHaveBeenCalledWith(9, 1, '2030-06-01T09:30:00.000Z', expect.any(String)));
    expect(cancel).toHaveBeenCalledWith(8, 1, 'organiser_replaced', expect.any(String));
  });

  it('refetches the list and explains a 409 inside the card, without a toast', async () => {
    const user = userEvent.setup();
    const list = vi.spyOn(eventCommunicationsApi, 'list').mockResolvedValue(listOf(
      broadcastFixture({ status: 'scheduled', scheduled_at: '2030-06-01T09:30:00+00:00' }),
    ));
    vi.spyOn(eventCommunicationsApi, 'cancel').mockResolvedValue({
      success: false,
      code: 'EVENT_BROADCAST_CONFLICT',
      errors: [{ code: 'EVENT_BROADCAST_CONFLICT', message: 'Conflict', reason: 'event_broadcast_cancel_after_send_forbidden' }],
    } as MutationResponse);
    renderWorkspace();

    await user.click(await screen.findByRole('button', { name: "Don't send scheduled message: Update" }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: "Yes, don't send it" }));

    const card = screen.getByRole('article', { name: 'Update' });
    expect(await within(card).findByText('Conflict')).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('uses the local line for a known reason the server did not explain', async () => {
    const user = userEvent.setup();
    vi.spyOn(eventCommunicationsApi, 'list').mockResolvedValue(listOf(
      broadcastFixture({ status: 'scheduled', scheduled_at: '2030-06-01T09:30:00+00:00' }),
    ));
    vi.spyOn(eventCommunicationsApi, 'cancel').mockResolvedValue({
      success: false,
      code: 'EVENT_BROADCAST_CONFLICT',
      errors: [{ code: 'EVENT_BROADCAST_CONFLICT', reason: 'event_broadcast_cancel_after_send_forbidden' }],
    } as MutationResponse);
    renderWorkspace();

    await user.click(await screen.findByRole('button', { name: "Don't send scheduled message: Update" }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: "Yes, don't send it" }));

    expect(await screen.findByText("It has already started sending, so it can't be stopped.")).toBeInTheDocument();
  });

  it('polls while a message is sending and stops once it is sent', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const list = vi.spyOn(eventCommunicationsApi, 'list')
      .mockResolvedValueOnce(listOf(broadcastFixture({
        status: 'sending',
        delivery: { total: 10, delivered: 4, suppressed: 0, dead_lettered: 0, failure_code: null },
      })))
      .mockResolvedValue(listOf(broadcastFixture({
        status: 'sent',
        sent_at: '2026-07-11T10:05:00+00:00',
        delivery: { total: 10, delivered: 10, suppressed: 0, dead_lettered: 0, failure_code: null },
      })));
    renderWorkspace();

    expect(await screen.findByText('Sending… 4 of 10 sent · 6 still sending')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
    expect(await screen.findByText(/Sent to 12 people on/)).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(36_000); });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('accounts for skipped deliveries while sending, so the numbers add up', async () => {
    vi.spyOn(eventCommunicationsApi, 'list').mockResolvedValue(listOf(broadcastFixture({
      status: 'sending',
      version: 3,
      delivery: { total: 4, delivered: 2, suppressed: 1, dead_lettered: 0, failure_code: null },
    })));
    renderWorkspace();

    expect(await screen.findByText('Sending… 2 of 4 sent · 1 skipped · 1 still sending')).toBeInTheDocument();
  });

  it('says a due scheduled message is sending shortly', async () => {
    vi.spyOn(eventCommunicationsApi, 'list').mockResolvedValue(listOf(broadcastFixture({
      status: 'scheduled',
      scheduled_at: new Date(Date.now() - 60_000).toISOString(),
    })));
    renderWorkspace();

    expect(await screen.findByText('Sending shortly…')).toBeInTheDocument();
  });

  it('describes a partly delivered message and offers to try again for the one person', async () => {
    const user = userEvent.setup();
    vi.spyOn(eventCommunicationsApi, 'list').mockResolvedValue(listOf(broadcastFixture({
      status: 'failed',
      version: 4,
      failed_at: '2026-07-11T10:05:00+00:00',
      audience: { segments: ['registration_confirmed'], recipient_count: 40 },
      delivery: { total: 40, delivered: 39, suppressed: 0, dead_lettered: 1, failure_code: 'event_broadcast_provider_failure' },
      capabilities: { edit: false, schedule: false, cancel: false, retry: true },
      summary: { excerpt: 'Doors open at seven.', skipped_reasons: {}, failed_reasons: { event_broadcast_provider_failure: 1 } },
    })));
    const retry = vi.spyOn(eventCommunicationsApi, 'retry').mockResolvedValue(mutation({ status: 'sending', version: 5 }));
    renderWorkspace();

    expect(await screen.findByText(/Sent on .* · 39 of 40 delivered · 1 failed/)).toBeInTheDocument();
    expect(screen.getByText('Partly sent')).toBeInTheDocument();
    expect(screen.getByText('Nobody who already received it will get it twice.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'What do skipped and failed mean?' }));
    expect(await screen.findByText('A sending service had a problem: 1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again for 1 person: Doors open at seven.' }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith(8, 4, expect.any(String)));
    expect(await screen.findByText("We're trying again for the people who didn't get it.")).toBeInTheDocument();
  });

  it('asks before throwing away unsent text and ignores Escape while there is some', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    const dialog = await openComposerAndWrite(user, 'Half-written');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: /Your message/ })).toHaveValue('Half-written');

    // Both the corner X and the footer Close lead to the same question.
    const closeButtons = within(dialog).getAllByRole('button', { name: 'Close' });
    await user.click(closeButtons[0] as HTMLElement);
    expect(within(dialog).getByText('Discard this message?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Keep writing' }));
    const footerClose = within(dialog).getAllByRole('button', { name: 'Close' });
    await user.click(footerClose[footerClose.length - 1] as HTMLElement);
    expect(within(dialog).getByText('Discard this message?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(window.sessionStorage.getItem(composerStorageKey(42))).toBeNull();
  });

  it('offers back a message that was being written before the page changed', async () => {
    const user = userEvent.setup();
    window.sessionStorage.setItem(composerStorageKey(42), JSON.stringify({
      values: {
        variant: 'announcement',
        segments: ['registration_confirmed'],
        channels: ['email'],
        body: 'Kept text',
        when: 'now',
        date: null,
        time: null,
      },
      mode: 'new',
      sourceId: null,
      session: {},
    }));
    renderWorkspace();

    expect(await screen.findByText('We kept the message you were writing')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('textbox', { name: /Your message/ })).toHaveValue('Kept text');
  });

  it('will not send a thank-you before the event has finished', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(eventCommunicationsApi, 'create');
    renderWorkspace({ eventEndsAt: '2099-06-01T18:00:00+00:00' });

    await user.click(await screen.findByRole('button', { name: 'New message' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByText('Thank-you after the event'));
    expect(within(dialog).getByText(/only goes to people who attended/)).toBeInTheDocument();
    await user.type(within(dialog).getByRole('textbox', { name: /Your message/ }), 'Thanks for coming');
    await user.click(within(dialog).getByRole('button', { name: 'Send now' }));

    expect(await within(dialog).findByText(/can be sent once the event has finished on/)).toBeInTheDocument();
    expect(within(dialog).queryByText('Ready to send?')).not.toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('explains an empty message next to the field instead of disabling the button', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(await screen.findByRole('button', { name: 'New message' }));
    const dialog = await screen.findByRole('dialog');
    const send = within(dialog).getByRole('button', { name: 'Send now' });
    expect(send).toBeEnabled();
    await user.click(send);
    expect(await within(dialog).findByText('Write your message first.')).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: /Your message/ })).toHaveFocus());
  });

  it('hides cancelled messages until asked', async () => {
    const user = userEvent.setup();
    vi.spyOn(eventCommunicationsApi, 'list').mockResolvedValue(listOf(
      broadcastFixture(),
      broadcastFixture({ id: 9, status: 'cancelled', cancelled_at: '2026-07-11T11:00:00+00:00' }),
    ));
    renderWorkspace();

    expect(await screen.findByText('Draft – not sent yet')).toBeInTheDocument();
    expect(screen.queryByText(/Cancelled on/)).not.toBeInTheDocument();
    await user.click(screen.getByText('Show cancelled messages (1)'));
    expect(await screen.findByText(/Cancelled on/)).toBeInTheDocument();
  });

  it('asks for a reload when the page is out of date', async () => {
    vi.spyOn(eventCommunicationsApi, 'list').mockResolvedValue({ success: false, code: 'EVENTS_CONTRACT_DRIFT' });
    renderWorkspace();

    expect(await screen.findByText('This page needs a refresh')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
  });

  it('names every card button after the message it acts on', async () => {
    vi.spyOn(eventCommunicationsApi, 'list').mockResolvedValue(listOf(
      broadcastFixture({ summary: { excerpt: 'Doors open at seven.', skipped_reasons: {}, failed_reasons: {} } }),
      broadcastFixture({
        id: 9,
        status: 'scheduled',
        scheduled_at: '2030-06-01T09:30:00+00:00',
        summary: { excerpt: 'Parking is behind the hall.', skipped_reasons: {}, failed_reasons: {} },
      }),
    ));
    renderWorkspace();

    expect(await screen.findByRole('button', { name: 'Open draft: Doors open at seven.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard draft: Doors open at seven.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'See activity for message: Doors open at seven.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change scheduled message: Parking is behind the hall.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Don't send scheduled message: Parking is behind the hall." })).toBeInTheDocument();
    expect(screen.getAllByRole('article', { name: 'Update' })).toHaveLength(2);
  });

  it('shows what happened to a message, page by page, without recipients or text', async () => {
    const user = userEvent.setup();
    const first = detailFixture();
    first.history_meta = { current_page: 1, per_page: 50, total: 51, total_pages: 2, has_more: true };
    const second = detailFixture();
    second.history = [{
      id: 51,
      version: 2,
      action: 'revised',
      from_status: 'draft',
      to_status: 'draft',
      metadata: {},
      created_at: '2026-07-12T10:00:00+00:00',
    }];
    second.history_meta = { current_page: 2, per_page: 50, total: 51, total_pages: 2, has_more: false };
    const get = vi.spyOn(eventCommunicationsApi, 'get')
      .mockResolvedValueOnce({ success: true, data: first })
      .mockResolvedValueOnce({ success: true, data: second });
    renderWorkspace();

    await user.click(await screen.findByRole('button', { name: 'See activity for message: Update' }));
    const dialog = await screen.findByRole('dialog', { name: 'What happened to this message' });
    expect(await within(dialog).findByText('The draft was written')).toBeInTheDocument();
    expect(within(dialog).queryByText('Exact organizer prose.')).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Version/)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Show earlier activity' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith(8, 2, 50));
    expect(await within(dialog).findByText('The draft was changed')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Show earlier activity' })).not.toBeInTheDocument();
  });

  it('pages through every message', async () => {
    const user = userEvent.setup();
    const list = vi.spyOn(eventCommunicationsApi, 'list')
      .mockResolvedValueOnce({
        success: true,
        data: [broadcastFixture()],
        meta: { current_page: 1, per_page: 20, total: 21, total_pages: 2, has_more: true },
      })
      .mockResolvedValueOnce({
        success: true,
        data: [broadcastFixture({ id: 9, audience: { segments: ['registration_confirmed'], recipient_count: 2 } })],
        meta: { current_page: 2, per_page: 20, total: 21, total_pages: 2, has_more: false },
      });
    renderWorkspace();

    await user.click(await screen.findByText('2'));

    await waitFor(() => expect(list).toHaveBeenLastCalledWith(42, 2, 20, { includeSummary: true }));
    expect(await screen.findByText('Draft – not sent yet')).toBeInTheDocument();
  });
});
