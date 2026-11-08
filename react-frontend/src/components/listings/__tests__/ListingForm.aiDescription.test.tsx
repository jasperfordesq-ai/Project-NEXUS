// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The "AI: Help me write this" button shows only when the server says the
 * community can use it (tenant bootstrap `ai_descriptions.listings`). Owner
 * decision, 8 Nov 2026: off by default, and never offered to a community
 * without AI switched on and its own OpenAI key with credit.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const { mockApi, mockTenantState } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
  },
  mockTenantState: { aiDescriptions: undefined as { listings?: boolean } | undefined },
}));
vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Member' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
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
  } as unknown as Parameters<typeof createMockContexts>[0])
);

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
  useDraftPersistence: vi.fn(() => [{ title: '', description: '', type: 'offer' as const }, vi.fn(), vi.fn()]),
  useMediaQuery: vi.fn(() => false),
}));
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: vi.fn(() => false) }));
vi.mock('@/components/listings/SkillTagsInput', () => ({
  SkillTagsInput: () => <div data-testid="skill-tags-input" />,
}));
vi.mock('@/components/feedback', () => ({
  LoadingScreen: ({ message }: { message: string }) => <div data-testid="loading-screen">{message}</div>,
}));

import { ListingForm } from '../ListingForm';

async function renderForm(): Promise<void> {
  render(<ListingForm variant="page" />);
  await waitFor(() => expect(screen.getByLabelText(/^title/i)).toBeInTheDocument());
}

describe('ListingForm — AI description button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.get.mockResolvedValue({ success: true, data: [] });
    mockTenantState.aiDescriptions = undefined;
  });

  it('shows the button when the community can use it', async () => {
    mockTenantState.aiDescriptions = { listings: true };
    await renderForm();

    expect(screen.getByRole('button', { name: /help me write this/i })).toBeInTheDocument();
    expect(screen.getByText(/enter a title first to get ai help/i)).toBeInTheDocument();
  });

  it.each([
    ['the server sends nothing', undefined],
    ['the server sends no listings flag', {}],
    ['the server says no', { listings: false }],
  ])('hides the button and its hint when %s', async (_label, flags) => {
    mockTenantState.aiDescriptions = flags;
    await renderForm();

    expect(screen.queryByRole('button', { name: /help me write this/i })).toBeNull();
    expect(screen.queryByText(/enter a title first to get ai help/i)).toBeNull();
  });
});
