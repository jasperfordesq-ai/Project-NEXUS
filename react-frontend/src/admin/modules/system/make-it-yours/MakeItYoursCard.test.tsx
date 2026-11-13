// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import type { CommunitySetupStatus } from '../../../api/adminApi';

const api = vi.hoisted(() => ({ setup: vi.fn() }));
const tenant = vi.hoisted(() => ({ id: 106, name: 'Riverside Timebank', slug: 'riverside' }));

vi.mock('../../../api/adminApi', () => ({ adminCommunitySetup: { get: api.setup } }));
vi.mock('@/contexts', () => createMockContexts({
  useTenant: () => ({
    tenant,
    tenantPath: (p: string) => `/riverside${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  }),
}));

import { MakeItYoursCard, makeItYoursDismissKey } from './MakeItYoursCard';

function status(done: number): Pick<CommunitySetupStatus, 'steps' | 'done' | 'total'> & Partial<CommunitySetupStatus> {
  const keys = ['logo', 'colour', 'photo', 'tagline', 'themes', 'notice'] as const;
  return {
    steps: keys.map((key, i) => ({ key, done: i < done })),
    done,
    total: 6,
    suggested_colours: [],
  };
}

describe('MakeItYoursCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    tenant.id = 106;
    api.setup.mockResolvedValue({ success: true, data: status(2) });
  });

  it('shows how far the community has got and where to carry on', async () => {
    render(<MakeItYoursCard />);

    expect(await screen.findByRole('heading', { name: 'Make this site yours' })).toBeInTheDocument();
    expect(screen.getByText('2 of 6 done')).toBeInTheDocument();
    // On the card's tinted background the count must not be muted grey (4.08:1 there).
    expect(screen.getByText('2 of 6 done').className).not.toMatch(/text-muted/);
    expect(screen.getByText(/make it look like Riverside Timebank/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /carry on/i })).toHaveAttribute('href', '/riverside/admin/make-it-yours');
  });

  it('asks the server for the steps only, without the colours from the logo', async () => {
    render(<MakeItYoursCard />);
    await screen.findByTestId('make-it-yours-card');

    expect(api.setup).toHaveBeenCalledWith(false);
  });

  it('says "Get started" to a community that has done nothing yet', async () => {
    api.setup.mockResolvedValue({ success: true, data: status(0) });
    render(<MakeItYoursCard />);

    expect(await screen.findByRole('link', { name: /get started/i })).toBeInTheDocument();
  });

  it('is not there once everything is done', async () => {
    api.setup.mockResolvedValue({ success: true, data: status(6) });
    render(<MakeItYoursCard />);

    await waitFor(() => expect(api.setup).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.queryByTestId('make-it-yours-card')).toBeNull();
  });

  it('adds nothing to the dashboard when the read fails', async () => {
    api.setup.mockRejectedValue(new Error('offline'));
    render(<MakeItYoursCard />);

    await waitFor(() => expect(api.setup).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.queryByTestId('make-it-yours-card')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('can be hidden, and stays hidden for this community on the next visit', async () => {
    const first = render(<MakeItYoursCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Hide this reminder' }));

    expect(screen.queryByTestId('make-it-yours-card')).toBeNull();
    expect(window.localStorage.getItem(makeItYoursDismissKey(106))).toBe('1');

    first.unmount();
    render(<MakeItYoursCard />);
    await waitFor(() => expect(api.setup).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(screen.queryByTestId('make-it-yours-card')).toBeNull();
  });

  it('hiding it for one community does not hide it for another', async () => {
    window.localStorage.setItem(makeItYoursDismissKey(106), '1');
    tenant.id = 2;
    render(<MakeItYoursCard />);

    expect(await screen.findByTestId('make-it-yours-card')).toBeInTheDocument();
  });
});
