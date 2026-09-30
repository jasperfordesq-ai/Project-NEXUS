// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for LegalDocForm admin module (metadata-only settings form).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ── stable mock factories ─────────────────────────────────────────────────────
const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
const mockNavigate = vi.hoisted(() => vi.fn());

const EXISTING_DOC = vi.hoisted(() => ({
  id: 42,
  title: 'Privacy Policy',
  type: 'privacy',
  slug: 'privacy',
  current_version_id: 5,
  requires_acceptance: 1,
  acceptance_required_for: 'registration',
  notify_on_update: 0,
  is_active: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',
}));

// ── module mocks ──────────────────────────────────────────────────────────────
vi.mock('@/contexts', () => createMockContexts({
  useToast: () => mockToast,
  useTenant: () => ({
    tenant: { id: 2, name: 'Test', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    refreshTenant: vi.fn(),
  }),
}));

// useParams drives isEdit — mock for both "create" (no id) and "edit" (id=42) scenarios
let mockParamsId: string | undefined = undefined;

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: mockParamsId }),
  };
});

vi.mock('../../api/adminApi', () => ({
  adminLegalDocs: {
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  },
  adminDeliverability: { list: vi.fn(), delete: vi.fn() },
  adminPages: { list: vi.fn(), delete: vi.fn() },
  adminEnterprise: { getGdprRequests: vi.fn(), updateGdprRequest: vi.fn() },
  adminGamification: { getBadgeConfig: vi.fn(), updateBadgeConfig: vi.fn(), resetBadgeConfig: vi.fn() },
}));

vi.mock('../../AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { LegalDocForm } from './LegalDocForm';
import { adminLegalDocs } from '../../api/adminApi';

// ─────────────────────────────────────────────────────────────────────────────

describe('LegalDocForm — create mode (no id)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParamsId = undefined; // create mode
  });

  it('renders the form immediately (no loading spinner)', () => {
    render(<LegalDocForm />);

    const busy = screen.queryAllByRole('status').find(
      (el) => el.getAttribute('aria-busy') === 'true',
    );
    expect(busy).toBeUndefined();
  });

  it('renders title input', () => {
    render(<LegalDocForm />);
    expect(screen.getByRole('textbox', { name: /title/i })).toBeInTheDocument();
  });

  it('does NOT render a free-text content field (content lives in versions)', () => {
    render(<LegalDocForm />);
    // Only the title textbox should be present — no content/body textarea.
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('shows validation error toast when submitting without a title', async () => {
    const user = userEvent.setup();
    render(<LegalDocForm />);

    const saveBtn = screen.getByRole('button', { name: /create document/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
    expect(adminLegalDocs.create).not.toHaveBeenCalled();
  });

  it('submits a metadata-only payload and routes into the version editor', async () => {
    const user = userEvent.setup();
    vi.mocked(adminLegalDocs.create).mockResolvedValue({ success: true, data: { id: 99 } });

    render(<LegalDocForm />);

    await user.type(screen.getByRole('textbox', { name: /title/i }), 'Terms of Service');

    const saveBtn = screen.getByRole('button', { name: /create document/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(adminLegalDocs.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Terms of Service', type: expect.any(String) }),
      );
    });
    // Payload must NOT carry a content/version/status field.
    const payload = vi.mocked(adminLegalDocs.create).mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('content');
    expect(payload).not.toHaveProperty('version');
    expect(payload).not.toHaveProperty('status');

    expect(mockToast.success).toHaveBeenCalled();
    // Lands in the new-version editor for the freshly created doc.
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('/legal-documents/99/versions/new'));
  });

  it('shows the duplicate-document explanation returned by the API', async () => {
    const user = userEvent.setup();
    const message = 'A document of this type already exists for your community. Edit the existing one instead.';
    vi.mocked(adminLegalDocs.create).mockResolvedValue({ success: false, error: message });

    render(<LegalDocForm />);

    await user.type(screen.getByRole('textbox', { name: /title/i }), 'Terms of Service');
    await user.click(screen.getByRole('button', { name: /create document/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(message);
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows error toast when create API throws', async () => {
    const user = userEvent.setup();
    vi.mocked(adminLegalDocs.create).mockRejectedValue(new Error('Network'));

    render(<LegalDocForm />);

    await user.type(screen.getByRole('textbox', { name: /title/i }), 'Terms of Service');
    await user.click(screen.getByRole('button', { name: /create document/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('navigates back when Cancel is pressed', async () => {
    const user = userEvent.setup();
    render(<LegalDocForm />);

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(mockNavigate).toHaveBeenCalled();
  });
});

describe('LegalDocForm — edit mode (id=42)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParamsId = '42'; // edit mode
  });

  it('shows a loading spinner while fetching the document', () => {
    vi.mocked(adminLegalDocs.get).mockReturnValue(new Promise(() => {}));
    render(<LegalDocForm />);

    const spinners = screen.getAllByRole('status');
    const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeInTheDocument();
  });

  it('pre-fills the title from the fetched document', async () => {
    vi.mocked(adminLegalDocs.get).mockResolvedValue({
      success: true,
      data: EXISTING_DOC,
    });

    render(<LegalDocForm />);

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /title/i })).toHaveValue('Privacy Policy');
    });
  });

  it('shows error toast if document fetch fails', async () => {
    vi.mocked(adminLegalDocs.get).mockRejectedValue(new Error('Not found'));
    render(<LegalDocForm />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('updates with the id and a metadata payload that omits the type', async () => {
    const user = userEvent.setup();
    vi.mocked(adminLegalDocs.get).mockResolvedValue({
      success: true,
      data: EXISTING_DOC,
    });
    vi.mocked(adminLegalDocs.update).mockResolvedValue({ success: true });

    render(<LegalDocForm />);

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /title/i })).toHaveValue('Privacy Policy');
    });

    const saveBtn = screen.getByRole('button', { name: /update document/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(adminLegalDocs.update).toHaveBeenCalledWith(
        42,
        expect.objectContaining({ title: 'Privacy Policy' }),
      );
    });
    const payload = vi.mocked(adminLegalDocs.update).mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('type');
    expect(mockToast.success).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalled();
  });
});
