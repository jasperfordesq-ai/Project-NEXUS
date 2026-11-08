// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for ListingTab — thin composer wrapper around the shared ListingForm.
 * Covers the composer contracts (draft persistence, submit registration,
 * close/success flow) plus the shared form rendering inside the sheet.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── API mock ────────────────────────────────────────────────────────────────
const { mockApi, mockTenantState } = vi.hoisted(() => ({
  // Which AI description buttons the server allows (tenant bootstrap ai_descriptions).
  mockTenantState: { aiDescriptions: undefined as { listings?: boolean } | undefined },
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
  },
}));
vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveThumbnailUrl: vi.fn((url: string | undefined) => url || ''),
}));

// ─── Context mocks ────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Test User', location: 'Dublin', latitude: 53.33, longitude: -6.26 },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test', ai_descriptions: mockTenantState.aiDescriptions },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
      listingConfig: {
        'listing.min_title_length': 5,
        'listing.min_description_length': 20,
        'listing.require_category': false,
        'listing.require_hours_estimate': false,
      },
    }),
  })
);

// ─── Hooks ───────────────────────────────────────────────────────────────────
const { mockSetDraft, mockClearDraft } = vi.hoisted(() => ({
  mockSetDraft: vi.fn(),
  mockClearDraft: vi.fn(),
}));

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
  useDraftPersistence: vi.fn(() => [
    { title: '', description: '', type: 'offer' as const },
    mockSetDraft,
    mockClearDraft,
  ]),
  useMediaQuery: vi.fn(() => false),
}));

vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: vi.fn(() => false),
}));

// ─── Compose submit context ──────────────────────────────────────────────────
const { mockRegister, mockUnregister } = vi.hoisted(() => ({
  mockRegister: vi.fn(),
  mockUnregister: vi.fn(),
}));

vi.mock('../ComposeSubmitContext', () => ({
  useComposeSubmit: vi.fn(() => ({
    registration: null,
    register: mockRegister,
    unregister: mockUnregister,
  })),
}));

// ─── Shared form dependencies ────────────────────────────────────────────────
vi.mock('@/components/listings/SkillTagsInput', () => ({
  SkillTagsInput: () => <div data-testid="skill-tags-input" />,
}));

vi.mock('@/components/feedback', () => ({
  LoadingScreen: ({ message }: { message: string }) => <div data-testid="loading-screen">{message}</div>,
}));

import { ListingTab } from './ListingTab';

const defaultProps = {
  onSuccess: vi.fn(),
  onClose: vi.fn(),
  groupId: null as number | null,
  templateData: undefined,
};

function fillValidForm(container: HTMLElement) {
  const textboxes = screen.getAllByRole('textbox');
  // First textbox is the title input, the textarea is the description
  fireEvent.change(textboxes[0], { target: { value: 'Garden help offered locally' } });
  fireEvent.change(
    container.querySelector('textarea') as HTMLTextAreaElement,
    { target: { value: 'I can help with weeding, planting and general garden maintenance.' } },
  );
}

describe('ListingTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTenantState.aiDescriptions = undefined;
    mockApi.get.mockResolvedValue({ success: true, data: [] });
    mockApi.post.mockResolvedValue({ success: true, data: { id: 99 } });
    mockApi.put.mockResolvedValue({ success: true });
  });

  it('renders the offer/request intent radio group', async () => {
    render(<ListingTab {...defaultProps} />);
    await waitFor(() => {
      const radios = screen.getAllByRole('radio');
      expect(radios.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('loads listing categories from the API on mount', async () => {
    render(<ListingTab {...defaultProps} />);
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/v2/categories?type=listing');
    });
  });

  it('renders title input and description textarea', async () => {
    const { container } = render(<ListingTab {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getAllByRole('textbox').length).toBeGreaterThanOrEqual(1);
      expect(container.querySelector('textarea')).toBeInTheDocument();
    });
  });

  it('renders the AI help-me-write button when the community can use it', async () => {
    mockTenantState.aiDescriptions = { listings: true };
    render(<ListingTab {...defaultProps} />);
    await waitFor(() => {
      const aiBtn = screen.getAllByRole('button').find(
        (b) => b.textContent?.toLowerCase().includes('help me write')
      );
      expect(aiBtn).toBeDefined();
    });
  });

  it('hides the AI help-me-write button unless the community can use it (8 Nov 2026)', async () => {
    render(<ListingTab {...defaultProps} />);
    await waitFor(() => expect(screen.getByTestId('skill-tags-input')).toBeInTheDocument());
    expect(
      screen.queryAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('help me write'))
    ).toBeUndefined();
  });

  it('renders the skill tags input from the shared form', async () => {
    render(<ListingTab {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByTestId('skill-tags-input')).toBeInTheDocument();
    });
  });

  it('renders a disabled location input sourced from the profile', async () => {
    render(<ListingTab {...defaultProps} />);
    await waitFor(() => {
      const disabledEls = Array.from(
        document.querySelectorAll('[disabled], [aria-disabled="true"]')
      );
      expect(disabledEls.length).toBeGreaterThan(0);
    });
  });

  it('does not render any SDG goals section', async () => {
    render(<ListingTab {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getAllByRole('radio').length).toBeGreaterThanOrEqual(2);
    });
    expect(document.body.textContent?.toLowerCase()).not.toContain('sustainable');
  });

  it('calls onClose when Cancel is clicked', async () => {
    const onClose = vi.fn();
    render(<ListingTab {...defaultProps} onClose={onClose} />);

    const cancelBtn = await waitFor(() => {
      const btn = screen.getAllByRole('button').find(
        (b) => b.textContent?.toLowerCase().includes('cancel')
      );
      expect(btn).toBeDefined();
      return btn!;
    });
    fireEvent.click(cancelBtn);
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('registers submit state with the compose submit context', async () => {
    render(<ListingTab {...defaultProps} />);
    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith(
        expect.objectContaining({
          canSubmit: false,
          isSubmitting: false,
          buttonLabel: expect.any(String),
          gradientClass: expect.stringContaining('emerald'),
        })
      );
    });
  });

  it('mirrors form values into the persisted draft', async () => {
    const { container } = render(<ListingTab {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getAllByRole('textbox').length).toBeGreaterThanOrEqual(1);
    });

    fillValidForm(container);

    await waitFor(() => {
      expect(mockSetDraft).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Garden help offered locally' })
      );
    });
  });

  it('blocks submission when validation fails (description too short)', async () => {
    const { container } = render(<ListingTab {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getAllByRole('textbox').length).toBeGreaterThanOrEqual(1);
    });

    const textboxes = screen.getAllByRole('textbox');
    fireEvent.change(textboxes[0], { target: { value: 'Valid title here' } });
    fireEvent.change(
      container.querySelector('textarea') as HTMLTextAreaElement,
      { target: { value: 'too short' } },
    );

    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    await waitFor(() => {
      expect(mockApi.post).not.toHaveBeenCalled();
    });
  });

  it('creates the listing, saves tags, clears the draft and closes on success', async () => {
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <ListingTab {...defaultProps} onSuccess={onSuccess} onClose={onClose} />
    );
    await waitFor(() => {
      expect(screen.getAllByRole('textbox').length).toBeGreaterThanOrEqual(1);
    });

    fillValidForm(container);
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/listings', expect.objectContaining({
        title: 'Garden help offered locally',
        type: 'offer',
        service_type: 'hybrid',
        location: 'Dublin',
      }));
    });
    await waitFor(() => {
      expect(mockApi.put).toHaveBeenCalledWith('/v2/listings/99/tags', { tags: [] });
    });
    await waitFor(() => {
      expect(mockClearDraft).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
      expect(onSuccess).toHaveBeenCalledWith('listing', 99);
    });
  });

  it('does not close or clear the draft when creation fails', async () => {
    mockApi.post.mockResolvedValue({ success: false, error: 'Listing limit reached' });
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <ListingTab {...defaultProps} onSuccess={onSuccess} onClose={onClose} />
    );
    await waitFor(() => {
      expect(screen.getAllByRole('textbox').length).toBeGreaterThanOrEqual(1);
    });

    fillValidForm(container);
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
    expect(mockClearDraft).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
