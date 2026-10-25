// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  }),
);

vi.mock('@/contexts/ToastContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/ToastContext')>();
  return { ...actual, useToast: () => mockToast };
});

const digestApi = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  preview: vi.fn(),
  sendNow: vi.fn(),
}));
vi.mock('@/admin/api/adminApi', () => ({
  adminListingsDigest: digestApi,
  adminNewsletters: {},
  adminLegalDocs: {},
  adminHelpFaqs: {},
}));

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));

import { ListingsDigestAdmin } from './ListingsDigestAdmin';

describe('ListingsDigestAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    digestApi.get.mockResolvedValue({ success: true, data: { default_frequency: 'monthly', recipient_count: 12 } });
    digestApi.preview.mockResolvedValue({ success: true, data: { html: '<!DOCTYPE html><p>Preview</p>' } });
  });

  it('loads the settings and shows a preview of the email', async () => {
    render(<ListingsDigestAdmin />);

    await waitFor(() => expect(digestApi.get).toHaveBeenCalled());
    await waitFor(() => expect(digestApi.preview).toHaveBeenCalledWith('all'));
    expect(await screen.findByTitle('Preview')).toBeInTheDocument();
  });

  it('asks before sending to everyone, then queues the send', async () => {
    digestApi.sendNow.mockResolvedValue({ success: true, data: { queued: true, recipient_count: 12 } });
    const user = userEvent.setup();
    render(<ListingsDigestAdmin />);

    await waitFor(() => expect(digestApi.get).toHaveBeenCalled());
    const sendButton = await screen.findByRole('button', { name: /^Send now$/ });
    await waitFor(() => expect(sendButton).not.toBeDisabled());
    await user.click(sendButton);

    expect(digestApi.sendNow).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: /Send to everyone/ }));

    await waitFor(() => expect(digestApi.sendNow).toHaveBeenCalledTimes(1));
    expect(mockToast.success).toHaveBeenCalled();
  });
});
