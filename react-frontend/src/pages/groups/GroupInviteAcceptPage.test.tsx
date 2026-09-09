// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const mocks = vi.hoisted(() => ({
  token: 'a'.repeat(40),
  navigate: vi.fn(),
  preview: vi.fn(),
  accept: vi.fn(),
}));

vi.mock('@/contexts', () => createMockContexts({
  useTenant: () => ({
    hasFeature: vi.fn((_key: string) => true),
    hasModule: vi.fn((_key: string) => true),
    tenantPath: (path: string) => `/test${path}`,
  }),
}));

vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useParams: () => ({ token: mocks.token }),
    useNavigate: () => mocks.navigate,
  };
});

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return {
    ...actual,
    getGroupInvitePreview: mocks.preview,
    acceptGroupInvite: mocks.accept,
  };
});

import GroupInviteAcceptPage from './GroupInviteAcceptPage';

const preview = {
  invite: {
    id: 4,
    type: 'email' as const,
    status: 'pending' as const,
    email_bound: true,
    expires_at: '2026-07-20T00:00:00Z',
  },
  group: {
    id: 8,
    name: 'Garden Crew',
    image_url: null,
    visibility: 'private' as const,
    member_count: 2,
  },
  membership: { status: 'none' as const },
};

describe('GroupInviteAcceptPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.token = 'a'.repeat(40);
    mocks.preview.mockResolvedValue(preview);
    mocks.accept.mockResolvedValue({
      action: 'joined',
      group: { id: 8, name: 'Garden Crew' },
      membership: { status: 'active', role: 'member' },
      invite: { id: 4, type: 'email', status: 'accepted' },
    });
  });

  it('previews the group and accepts the invitation explicitly', async () => {
    render(<GroupInviteAcceptPage />);

    expect(await screen.findByRole('heading', { name: 'Garden Crew' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Accept Invitation' }));

    expect(mocks.accept).toHaveBeenCalledWith('a'.repeat(40));
    expect(await screen.findByRole('heading', { name: 'Invitation Accepted' })).toBeInTheDocument();
  });

  it('takes an existing member straight to the group without accepting again', async () => {
    mocks.preview.mockResolvedValue({
      ...preview,
      membership: { status: 'active' },
    });
    render(<GroupInviteAcceptPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Go to Group' }));
    expect(mocks.accept).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith('/test/groups/8');
  });

  it('rejects malformed tokens without sending them to the API', async () => {
    mocks.token = 'not-a-token';
    render(<GroupInviteAcceptPage />);

    expect(await screen.findByText('This invitation link is invalid or no longer available.')).toBeInTheDocument();
    expect(mocks.preview).not.toHaveBeenCalled();
  });
});
