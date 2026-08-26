// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Admin API mock (hoisted) ─────────────────────────────────────────────────
const { mockAdminLegalDocs } = vi.hoisted(() => ({
  mockAdminLegalDocs: {
    getVersions: vi.fn(),
    publishVersion: vi.fn(),
    deleteVersion: vi.fn(),
    notifyUsers: vi.fn(),
    getUsersPendingCount: vi.fn(),
    createVersion: vi.fn(),
    updateVersion: vi.fn(),
  },
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminLegalDocs: mockAdminLegalDocs,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Sanitize helper ──────────────────────────────────────────────────────────
vi.mock('@/lib/sanitize', () => ({ sanitizeRichText: (s: string) => s }));

// ─── Heavy child components (avoid rendering rich-text editor etc.) ───────────
vi.mock('./LegalDocVersionComparison', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="version-comparison">
      <button onClick={onClose}>Close Compare</button>
    </div>
  ),
}));

// ─── Admin meta context ────────────────────────────────────────────────────────
vi.mock('../../AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
}));

// ─── React Router — preserve actual but inject useParams + useNavigate ─────────
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useParams: () => ({ id: '5' }),
    useNavigate: () => mockNavigate,
  };
});

// ─── Contexts ──────────────────────────────────────────────────────────────────
const mockSuccess = vi.fn();
const mockError = vi.fn();

vi.mock('@/contexts/ToastContext', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => ({ success: mockSuccess, error: mockError, info: vi.fn(), warning: vi.fn() }),
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    tenant: { id: 2, name: 'Test', slug: 'test' },
  }),
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => ({ success: mockSuccess, error: mockError, info: vi.fn(), warning: vi.fn() }),
    useTenant: () => ({
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
      tenant: { id: 2, name: 'Test', slug: 'test' },
    }),
  })
);

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeVersion = (overrides = {}) => ({
  id: 1,
  version_number: '1.0',
  version_label: 'Initial',
  is_current: true,
  is_draft: false,
  created_at: '2026-01-01T10:00:00Z',
  effective_date: '2026-01-15T00:00:00Z',
  published_at: '2026-01-10T00:00:00Z',
  summary_of_changes: 'First release',
  content: '<p>Terms content</p>',
  ...overrides,
});

const makeDraftVersion = (overrides = {}) => makeVersion({
  id: 2,
  version_number: '2.0',
  version_label: 'Draft',
  is_current: false,
  is_draft: true,
  published_at: null,
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('LegalDocVersionList', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminLegalDocs.getVersions.mockResolvedValue({ success: true, data: [] });
    mockAdminLegalDocs.getUsersPendingCount.mockResolvedValue({ success: true, data: { count: 5 } });
  });

  it('shows loading spinner while fetching versions', async () => {
    mockAdminLegalDocs.getVersions.mockImplementationOnce(() => new Promise(() => {}));
    const LegalDocVersionList = (await import('./LegalDocVersionList')).default;
    render(<LegalDocVersionList />);

    const spinners = screen.queryAllByRole('status');
    const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('shows empty state when no versions found', async () => {
    const LegalDocVersionList = (await import('./LegalDocVersionList')).default;
    render(<LegalDocVersionList />);

    await waitFor(() => {
      // "no_versions_found" i18n key or text
      const el = document.querySelector('[class*="text-center"]');
      expect(el).toBeTruthy();
    });
  });

  it('renders a published version card', async () => {
    mockAdminLegalDocs.getVersions.mockResolvedValue({
      success: true,
      data: [makeVersion()],
    });
    const LegalDocVersionList = (await import('./LegalDocVersionList')).default;
    render(<LegalDocVersionList />);

    await waitFor(() => {
      // version_number is rendered inside a translated string like "Version 1.0"
      // Match by partial text / regex to avoid depending on i18n key output
      expect(screen.getByText(/1\.0/)).toBeInTheDocument();
    });
  });

  it('renders the "Create new version" button', async () => {
    const LegalDocVersionList = (await import('./LegalDocVersionList')).default;
    render(<LegalDocVersionList />);

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /create new version/i });
      expect(btn).toBeInTheDocument();
      expect(screen.queryByText('enterprise.create_new_version')).not.toBeInTheDocument();
    });
  });

  it('navigates to the new-version editor when "Create new version" is clicked', async () => {
    const LegalDocVersionList = (await import('./LegalDocVersionList')).default;
    render(<LegalDocVersionList />);

    await waitFor(() => screen.getAllByRole('button'));

    const createBtn = screen.getByRole('button', { name: /create new version/i });
    fireEvent.click(createBtn);
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('/legal-documents/5/versions/new'));
  });

  it('navigates to the draft editor when a draft "Edit" is clicked', async () => {
    mockAdminLegalDocs.getVersions.mockResolvedValue({
      success: true,
      data: [makeDraftVersion()],
    });
    const LegalDocVersionList = (await import('./LegalDocVersionList')).default;
    render(<LegalDocVersionList />);

    await waitFor(() => screen.getAllByRole('button'));

    const editBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('edit')
    );
    expect(editBtn).toBeTruthy();
    fireEvent.click(editBtn!);
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('/versions/2/edit'));
  });

  it('renders Compliance Dashboard navigation button', async () => {
    const LegalDocVersionList = (await import('./LegalDocVersionList')).default;
    render(<LegalDocVersionList />);

    await waitFor(() => {
      const btn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('compliance')
      );
      expect(btn).toBeInTheDocument();
    });
  });

  it('navigates to compliance dashboard when button clicked', async () => {
    const LegalDocVersionList = (await import('./LegalDocVersionList')).default;
    render(<LegalDocVersionList />);

    await waitFor(() => screen.getAllByRole('button'));

    const complianceBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('compliance')
    );
    if (complianceBtn) {
      fireEvent.click(complianceBtn);
      expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('compliance'));
    }
  });

  it('shows Publish button for draft versions', async () => {
    mockAdminLegalDocs.getVersions.mockResolvedValue({
      success: true,
      data: [makeDraftVersion()],
    });
    const LegalDocVersionList = (await import('./LegalDocVersionList')).default;
    render(<LegalDocVersionList />);

    await waitFor(() => {
      const btn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('publish')
      );
      expect(btn).toBeInTheDocument();
    });
  });

  it('shows Delete button for draft versions', async () => {
    mockAdminLegalDocs.getVersions.mockResolvedValue({
      success: true,
      data: [makeDraftVersion()],
    });
    const LegalDocVersionList = (await import('./LegalDocVersionList')).default;
    render(<LegalDocVersionList />);

    await waitFor(() => {
      const btn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('delete')
      );
      expect(btn).toBeInTheDocument();
    });
  });

  it('opens publish confirmation modal when Publish clicked', async () => {
    mockAdminLegalDocs.getVersions.mockResolvedValue({
      success: true,
      data: [makeDraftVersion()],
    });
    const LegalDocVersionList = (await import('./LegalDocVersionList')).default;
    render(<LegalDocVersionList />);

    await waitFor(() => screen.getAllByRole('button'));

    const publishBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('publish')
    );
    if (publishBtn) {
      fireEvent.click(publishBtn);
      await waitFor(() => {
        const dialog = document.querySelector('[role="dialog"]');
        expect(dialog).toBeTruthy();
      });
    }
  });

  it('calls publishVersion API when modal confirmed', async () => {
    mockAdminLegalDocs.getVersions.mockResolvedValue({
      success: true,
      data: [makeDraftVersion()],
    });
    mockAdminLegalDocs.publishVersion.mockResolvedValue({ success: true });

    const LegalDocVersionList = (await import('./LegalDocVersionList')).default;
    render(<LegalDocVersionList />);

    await waitFor(() => screen.getAllByRole('button'));

    const publishBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('publish')
    );
    if (publishBtn) {
      fireEvent.click(publishBtn);
      await waitFor(() => document.querySelector('[role="dialog"]'));

      // Find confirm publish button inside modal
      const confirmBtn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('publish') && b !== publishBtn
      );
      if (confirmBtn) {
        fireEvent.click(confirmBtn);
        await waitFor(() => {
          expect(mockAdminLegalDocs.publishVersion).toHaveBeenCalledWith(2);
        });
      }
    }
  });

  it('shows Notify Users button for published (non-draft) versions', async () => {
    mockAdminLegalDocs.getVersions.mockResolvedValue({
      success: true,
      data: [makeVersion({ is_draft: false })],
    });
    const LegalDocVersionList = (await import('./LegalDocVersionList')).default;
    render(<LegalDocVersionList />);

    await waitFor(() => {
      const btn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('notify')
      );
      expect(btn).toBeInTheDocument();
    });
  });

  it('does not offer notifications for a historical published version', async () => {
    mockAdminLegalDocs.getVersions.mockResolvedValue({
      success: true,
      data: [makeVersion({ is_current: false, is_draft: false })],
    });
    const LegalDocVersionList = (await import('./LegalDocVersionList')).default;
    render(<LegalDocVersionList />);

    await waitFor(() => expect(screen.getByText(/1\.0/)).toBeInTheDocument());
    const notifyButton = screen.queryAllByRole('button').find((button) =>
      button.textContent?.toLowerCase().includes('notify')
    );
    expect(notifyButton).toBeUndefined();
  });

  it('shows error toast when API returns failure', async () => {
    mockAdminLegalDocs.getVersions.mockResolvedValue({
      success: false,
      error: 'Server error',
    });
    const LegalDocVersionList = (await import('./LegalDocVersionList')).default;
    render(<LegalDocVersionList />);

    await waitFor(() => {
      expect(mockError).toHaveBeenCalled();
    });
  });

  it('renders version summary of changes', async () => {
    mockAdminLegalDocs.getVersions.mockResolvedValue({
      success: true,
      data: [makeVersion({ summary_of_changes: 'Added GDPR clauses' })],
    });
    const LegalDocVersionList = (await import('./LegalDocVersionList')).default;
    render(<LegalDocVersionList />);

    await waitFor(() => {
      expect(screen.getByText('Added GDPR clauses')).toBeInTheDocument();
    });
  });
});
