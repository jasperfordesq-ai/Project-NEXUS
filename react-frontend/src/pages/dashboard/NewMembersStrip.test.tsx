// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import type { User } from '@/types/api';

const { mockApi, tenantState } = vi.hoisted(() => ({
  mockApi: { get: vi.fn() },
  tenantState: { connections: true, messages: true },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/contexts', () => createMockContexts({
  useAuth: () => ({
    user: { id: 1, first_name: 'Viewer', name: 'Viewer One' } as User,
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    updateUser: vi.fn(),
    refreshUser: vi.fn(),
    status: 'idle' as const,
    error: null,
  }),
  useTenant: () => ({
    tenant: { id: 2, name: 'Hour Timebank', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn((key: string) => (key === 'connections' ? tenantState.connections : true)),
    hasModule: vi.fn((key: string) => (key === 'messages' ? tenantState.messages : true)),
  }),
}));

import { NewMembersStrip } from './NewMembersStrip';

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

function member(id: number, name: string, joinedDaysAgo: number) {
  return { id, name, first_name: name.split(' ')[0], avatar: null, created_at: daysAgo(joinedDaysAgo) };
}

describe('NewMembersStrip', () => {
  beforeEach(() => {
    mockApi.get.mockReset();
    tenantState.connections = true;
    tenantState.messages = true;
  });

  it('asks the member directory for its newest members, so it shows only people the Members page would', async () => {
    mockApi.get.mockResolvedValueOnce({ success: true, data: [member(9, 'Maeve Byrne', 2)] });
    render(<NewMembersStrip />);
    await screen.findByText('Maeve Byrne');
    expect(mockApi.get).toHaveBeenCalledWith('/v2/users?sort=joined&order=desc&limit=7');
  });

  it('shows people who joined in the last 30 days, never the viewer, at most six', async () => {
    mockApi.get.mockResolvedValueOnce({
      success: true,
      data: [
        member(1, 'Viewer One', 1),
        member(2, 'Ann Two', 1),
        member(3, 'Bea Three', 3),
        member(4, 'Cal Four', 5),
        member(5, 'Dee Five', 8),
        member(6, 'Eve Six', 12),
        member(7, 'Fin Seven', 20),
        member(8, 'Old Timer', 45),
      ],
    });
    render(<NewMembersStrip />);
    await screen.findByText('Ann Two');
    expect(screen.queryByText('Viewer One')).not.toBeInTheDocument();
    expect(screen.queryByText('Old Timer')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('new-member')).toHaveLength(6);
  });

  it('offers a hello by message to each new member', async () => {
    mockApi.get.mockResolvedValueOnce({ success: true, data: [member(9, 'Maeve Byrne', 2)] });
    render(<NewMembersStrip />);
    const hello = await screen.findByRole('link', { name: 'Say hello to Maeve Byrne' });
    expect(hello).toHaveAttribute('href', '/test/messages/new/9');
    expect(screen.getByRole('link', { name: 'Maeve Byrne' })).toHaveAttribute('href', '/test/profile/9');
  });

  it('leaves out the hello button when messages are switched off', async () => {
    tenantState.messages = false;
    mockApi.get.mockResolvedValueOnce({ success: true, data: [member(9, 'Maeve Byrne', 2)] });
    render(<NewMembersStrip />);
    await screen.findByText('Maeve Byrne');
    expect(screen.queryByRole('link', { name: /Say hello/ })).not.toBeInTheDocument();
  });

  it('shows nothing when nobody joined in the last 30 days', async () => {
    mockApi.get.mockResolvedValueOnce({ success: true, data: [member(8, 'Old Timer', 45)] });
    const { container } = render(<NewMembersStrip />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('does not ask for anyone when the member directory is switched off', () => {
    tenantState.connections = false;
    const { container } = render(<NewMembersStrip />);
    expect(mockApi.get).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing if the directory cannot be read', async () => {
    mockApi.get.mockRejectedValueOnce(new Error('offline'));
    const { container } = render(<NewMembersStrip />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
