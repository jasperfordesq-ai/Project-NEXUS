// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  }),
);

const previewApi = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/admin/api/adminApi', () => ({
  adminEmailPreview: previewApi,
}));

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));

import { EmailPreviewPage } from './EmailPreviewPage';

describe('EmailPreviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    previewApi.get.mockResolvedValue({
      success: true,
      data: { subject: 'A note from Riverside', html: '<!DOCTYPE html><p>Sample</p><script>alert(1)</script>' },
    });
  });

  it('shows the sample email in a sandboxed frame that cannot run scripts', async () => {
    render(<EmailPreviewPage />);

    const frame = await screen.findByTitle('Sample email');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('sandbox');
    const sandbox = frame.getAttribute('sandbox') ?? '';
    expect(sandbox).not.toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
    expect(frame.getAttribute('srcdoc')).toContain('<p>Sample</p>');
  });

  it('shows the subject line as text', async () => {
    render(<EmailPreviewPage />);

    expect(await screen.findByText('A note from Riverside')).toBeInTheDocument();
  });

  it('explains where the logo and colour come from and links to Make it yours', async () => {
    render(<EmailPreviewPage />);

    const link = await screen.findByRole('link', { name: /Make it yours/ });
    expect(link).toHaveAttribute('href', '/test/admin/make-it-yours');
    expect(screen.getByText(/PNG, JPEG or GIF/)).toBeInTheDocument();
  });

  it('says so kindly when the sample cannot load, and can try again', async () => {
    previewApi.get.mockResolvedValueOnce({ success: false });
    const user = userEvent.setup();
    render(<EmailPreviewPage />);

    expect(await screen.findByText(/We couldn't load the sample email/)).toBeInTheDocument();
    expect(screen.queryByTitle('Sample email')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(previewApi.get).toHaveBeenCalledTimes(2));
    expect(await screen.findByTitle('Sample email')).toBeInTheDocument();
  });
});
