// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
const mockRefreshTenant = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockSettings = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));

vi.mock('@/contexts', () => createMockContexts({
  useToast: () => mockToast,
  useTenant: () => ({ tenant: { id: 2, name: 'Test Tenant', slug: 'test' }, refreshTenant: mockRefreshTenant, tenantPath: (p: string) => p, hasFeature: vi.fn((_key: string) => true), hasModule: vi.fn((_key: string) => true) }),
}));
vi.mock('../../api/adminApi', () => ({ adminSettings: mockSettings }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { HeaderColumnTitleCard } from './HeaderColumnTitleCard';

describe('HeaderColumnTitleCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettings.get.mockResolvedValue({ success: true, data: { settings: { header_column_title: 'Impact' } } });
  });

  it('prefills from settings and saves the trimmed title', async () => {
    mockSettings.update.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<HeaderColumnTitleCard />);

    const input = await screen.findByRole('textbox');
    await waitFor(() => expect(input).toHaveValue('Impact'));
    expect(input).toHaveAttribute('maxlength', '30');

    await user.clear(input);
    await user.type(input, ' Our Work ');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockSettings.update).toHaveBeenCalledWith({ header_column_title: 'Our Work' }));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
    expect(mockRefreshTenant).toHaveBeenCalledTimes(1);
    expect(mockRefreshTenant).toHaveBeenCalledWith({ silent: true });
  });

  it('shows the failure toast when saving fails', async () => {
    mockSettings.update.mockResolvedValue({ success: false });
    const user = userEvent.setup();
    render(<HeaderColumnTitleCard />);

    const input = await screen.findByRole('textbox');
    await waitFor(() => expect(input).toHaveValue('Impact'));
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockRefreshTenant).not.toHaveBeenCalled();
  });

  it('keeps Save disabled and shows the failure toast when loading fails', async () => {
    mockSettings.get.mockRejectedValue(new Error('network'));
    render(<HeaderColumnTitleCard />);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
    expect(mockSettings.update).not.toHaveBeenCalled();
  });
});
