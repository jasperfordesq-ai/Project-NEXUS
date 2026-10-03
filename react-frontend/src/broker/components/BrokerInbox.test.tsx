// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';
import { ConfirmDialogProvider } from '@/components/ui';

const api = vi.hoisted(() => ({
  usersList: vi.fn(),
  approve: vi.fn(),
  getMessages: vi.fn(),
  reviewMessage: vi.fn(),
  getExchanges: vi.fn(),
  get: vi.fn(),
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminUsers: { list: api.usersList, approve: api.approve },
  adminBroker: { getMessages: api.getMessages, reviewMessage: api.reviewMessage, getExchanges: api.getExchanges },
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: { get: api.get },
}));
vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  }),
);

import { BrokerInbox } from './BrokerInbox';

const ok = <T,>(data: T, total?: number) => ({ success: true, data, meta: { total: total ?? (Array.isArray(data) ? data.length : 0) } });

describe('BrokerInbox ("Waiting for you")', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.usersList.mockResolvedValue(ok([{ id: 11, name: 'Priya Nolan', email: 'priya@example.org', created_at: '2026-08-24' }], 2));
    api.getMessages.mockResolvedValue(ok([
      { id: 21, sender_name: 'Ann', receiver_name: 'Ben', message_body: 'Saturday works', flagged: false },
      { id: 22, sender_name: 'Cal', receiver_name: 'Dee', message_body: 'Send cash first', flagged: true },
    ]));
    api.getExchanges.mockResolvedValue(ok([]));
    api.get.mockResolvedValue(ok([]));
  });

  const renderInbox = () =>
    render(
      <ConfirmDialogProvider>
        <BrokerInbox showExchanges />
      </ConfirmDialogProvider>,
    );

  it('shows each waiting queue with its total, and leaves out empty ones', async () => {
    renderInbox();
    await waitFor(() => expect(screen.getByText('Priya Nolan')).toBeInTheDocument());
    expect(screen.getByText('Waiting for you')).toBeInTheDocument();
    expect(screen.getByText('Ann → Ben')).toBeInTheDocument();
    expect(screen.queryByText('Pending Exchanges')).not.toBeInTheDocument();
  });

  it('offers Mark reviewed on a routine message but only Open on a flagged one', async () => {
    renderInbox();
    await waitFor(() => expect(screen.getByText('Cal → Dee')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Mark the message from Ann as reviewed' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark the message from Cal as reviewed' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the message from Cal' })).toBeInTheDocument();
  });

  it('approves a new member only after the broker confirms', async () => {
    api.approve.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderInbox();

    await user.click(await screen.findByRole('button', { name: 'Approve Priya Nolan' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(api.approve).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(api.approve).toHaveBeenCalledWith(11));
    await waitFor(() => expect(screen.queryByText('Priya Nolan')).not.toBeInTheDocument());
  });

  it('marks a routine message reviewed from the dashboard', async () => {
    api.reviewMessage.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderInbox();

    await user.click(await screen.findByRole('button', { name: 'Mark the message from Ann as reviewed' }));
    await waitFor(() => expect(api.reviewMessage).toHaveBeenCalledWith(21));
    await waitFor(() => expect(screen.queryByText('Ann → Ben')).not.toBeInTheDocument());
  });

  it('renders nothing when every queue is empty', async () => {
    api.usersList.mockResolvedValue(ok([]));
    api.getMessages.mockResolvedValue(ok([]));
    const { container } = renderInbox();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(container.querySelector('section')).toBeNull();
  });
});
