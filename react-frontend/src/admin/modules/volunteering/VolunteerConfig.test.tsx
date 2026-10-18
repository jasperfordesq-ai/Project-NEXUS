// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Mock adminVolunteering API ───────────────────────────────────────────────
const { mockAdminVolunteering } = vi.hoisted(() => ({
  mockAdminVolunteering: {
    getReminderLogs: vi.fn(),
    sendShiftReminders: vi.fn(),
  },
}));

vi.mock('../../api/adminApi', () => ({
  adminVolunteering: mockAdminVolunteering,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('../../components/PageHeader', () => ({
  PageHeader: ({ title }: { title?: string }) => <h1>{title}</h1>,
}));

// Stub HeroUI Select to avoid jsdom loops
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...orig,
    Select: ({ label, children, onSelectionChange }: { label?: string; children?: React.ReactNode; onSelectionChange?: (keys: Set<string>) => void }) => (
      <select aria-label={label ?? 'select'} onChange={(e) => onSelectionChange?.(new Set([e.target.value]))}>
        {children}
      </select>
    ),
    SelectItem: ({ children, id }: { children?: React.ReactNode; id?: string }) => (
      <option value={id ?? ''}>{children}</option>
    ),
  };
});

// ─── Mock contexts ────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Admin', is_super_admin: true, role: 'super_admin' },
      isAuthenticated: true,
      login: vi.fn(), logout: vi.fn(), register: vi.fn(),
      updateUser: vi.fn(), refreshUser: vi.fn(),
      status: 'idle' as const, error: null,
    }),
    useToast: () => mockToast,
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

/**
 * After 18 Oct 2026 this page is only the reminder delivery log: the reminder
 * settings live in the Module Configuration window and the webhooks on the
 * platform Integrations page. No tabs, nothing to save.
 */
describe('VolunteerConfig', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminVolunteering.getReminderLogs.mockResolvedValue({ success: true, data: [] });
  });

  it('shows the reminder delivery log and nothing else', async () => {
    const { default: VolunteerConfig } = await import('./VolunteerConfig');
    render(<VolunteerConfig />);

    await waitFor(() => expect(mockAdminVolunteering.getReminderLogs).toHaveBeenCalled());
    expect(screen.getByText(/recent deliveries/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/webhook/i)).not.toBeInTheDocument();
  });
});
