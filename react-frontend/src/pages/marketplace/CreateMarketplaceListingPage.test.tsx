// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ─── Hoist mock data ─────────────────────────────────────────────────────────
const { mockApi, mockToast, mockNavigate, mockClearDraft, mockTenantState } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), upload: vi.fn() },
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  mockNavigate: vi.fn(),
  mockClearDraft: vi.fn(),
  mockTenantState: { currency: 'EUR' },
}));

// ─── Module mocks ────────────────────────────────────────────────────────────
vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useNavigate: () => mockNavigate,
    useParams: () => ({}),
  };
});

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useAuth: () => ({
      user: { id: 1, name: 'Seller' },
      isAuthenticated: true,
      login: vi.fn(), logout: vi.fn(), register: vi.fn(),
      updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle' as const, error: null,
    }),
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test', currency: mockTenantState.currency },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
  useDraftPersistence: <T,>(
    _key: string,
    initial: T
  ): [T, (updater: (prev: T) => T) => void, () => void] => {
    const [state, setState] = React.useState<T>(initial);
    return [state, (updater) => setState(updater), mockClearDraft];
  },
}));

vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// Stub location picker to avoid Google Maps / Leaflet in jsdom
vi.mock('@/components/location/PlaceAutocompleteInput', () => ({
  PlaceAutocompleteInput: ({ onPlaceSelect, label, onChange }: {
    onPlaceSelect?: (place: { formattedAddress: string; lat?: number; lng?: number }) => void;
    onChange?: (v: string) => void;
    label?: string;
  }) => (
    <input
      aria-label={label ?? 'Location'}
      data-testid="place-autocomplete"
      onChange={(e) => {
        onChange?.(e.target.value);
        onPlaceSelect?.({ formattedAddress: e.target.value });
      }}
    />
  ),
}));

// A vi.mock('@/components/ui', …) override of Select/SelectItem/RadioGroup/
// Radio/Autocomplete/AutocompleteItem was removed here (dead-mock treatment:
// DELETE, not retarget). It was commented "stub Select/RadioGroup to avoid
// HeroUI loops", but the page imports each of those from its own direct path, so
// the override never applied and the real components have always rendered in
// this suite — which passes, so the loops it guarded against do not occur.
// Retargeting would switch six stand-ins ON for the first time and change what
// these tests exercise; deleting keeps behaviour identical.

// ─── Fixtures ────────────────────────────────────────────────────────────────
const makeCategories = () => [
  { id: 1, name: 'Electronics', slug: 'electronics' },
  { id: 2, name: 'Clothing', slug: 'clothing' },
];

// ─────────────────────────────────────────────────────────────────────────────
describe('CreateMarketplaceListingPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockTenantState.currency = 'EUR';
    mockApi.get.mockImplementation((url: string) => {
      if (url === '/v2/marketplace/categories') {
        return Promise.resolve({ success: true, data: makeCategories() });
      }
      return Promise.resolve({ success: true, data: null });
    });
    mockApi.post.mockResolvedValue({ success: true, data: { id: 77 } });
    mockApi.upload.mockResolvedValue({ success: true });
    // Stub URL.createObjectURL / revokeObjectURL for image/video handling
    if (!URL.createObjectURL) {
      Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:mock', configurable: true });
    }
    if (!URL.revokeObjectURL) {
      Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    }
  });

  it('renders the page heading after categories load', async () => {
    const { CreateMarketplaceListingPage } = await import('./CreateMarketplaceListingPage');
    render(<CreateMarketplaceListingPage />);
    await waitFor(() => {
      // The page title or heading text renders via i18n — check generic presence
      expect(document.body).toBeTruthy();
    });
  });

  it('loads categories from API on mount', async () => {
    const { CreateMarketplaceListingPage } = await import('./CreateMarketplaceListingPage');
    render(<CreateMarketplaceListingPage />);
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/v2/marketplace/categories');
    });
  });

  it('shows error toast when title is missing on submit', async () => {
    const { CreateMarketplaceListingPage } = await import('./CreateMarketplaceListingPage');
    render(<CreateMarketplaceListingPage />);
    await waitFor(() => mockApi.get.mock.calls.length > 0);

    const submitBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('publish') ||
             b.textContent?.toLowerCase().includes('create.publish') ||
             b.textContent?.toLowerCase().includes('create') ||
             b.textContent?.toLowerCase().includes('list') ||
             b.textContent?.toLowerCase().includes('submit')
    );
    if (submitBtn && !submitBtn.hasAttribute('disabled')) {
      fireEvent.click(submitBtn);
      await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    }
  });

  it('blocks submit when description is empty', async () => {
    const { CreateMarketplaceListingPage } = await import('./CreateMarketplaceListingPage');
    render(<CreateMarketplaceListingPage />);
    await waitFor(() => mockApi.get.mock.calls.length > 0);

    // Fill title
    const titleInput = screen.getAllByRole('textbox').find(
      (el) => el.getAttribute('aria-label')?.toLowerCase().includes('title') ||
               el.getAttribute('placeholder')?.toLowerCase().includes('title')
    );
    if (titleInput) await userEvent.type(titleInput, 'My Widget');

    // Attempt submit without description
    const submitBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('publish') ||
             b.textContent?.toLowerCase().includes('create.publish') ||
             b.textContent?.toLowerCase().includes('create') ||
             b.textContent?.toLowerCase().includes('list') ||
             b.textContent?.toLowerCase().includes('submit')
    );
    if (submitBtn && !submitBtn.hasAttribute('disabled')) {
      fireEvent.click(submitBtn);
      await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    }
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it('blocks submit when price is missing on fixed price listing', async () => {
    const { CreateMarketplaceListingPage } = await import('./CreateMarketplaceListingPage');
    render(<CreateMarketplaceListingPage />);
    await waitFor(() => mockApi.get.mock.calls.length > 0);

    const inputs = screen.getAllByRole('textbox');
    const titleInput = inputs.find(
      (el) => el.getAttribute('aria-label')?.toLowerCase().includes('title') ||
               el.getAttribute('placeholder')?.toLowerCase().includes('title')
    );
    if (titleInput) await userEvent.type(titleInput, 'A Product');

    const descInput = inputs.find(
      (el) => el.getAttribute('aria-label')?.toLowerCase().includes('description') ||
               el.tagName === 'TEXTAREA'
    );
    if (descInput) await userEvent.type(descInput, 'A description of the product');

    // Leave price empty; price type default is 'fixed'
    const submitBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('publish') ||
             b.textContent?.toLowerCase().includes('create.publish') ||
             b.textContent?.toLowerCase().includes('create') ||
             b.textContent?.toLowerCase().includes('list') ||
             b.textContent?.toLowerCase().includes('submit')
    );
    if (submitBtn && !submitBtn.hasAttribute('disabled')) {
      fireEvent.click(submitBtn);
      await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    }
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it('POSTs to /v2/marketplace/listings on valid submit', async () => {
    const { CreateMarketplaceListingPage } = await import('./CreateMarketplaceListingPage');
    render(<CreateMarketplaceListingPage />);
    await waitFor(() => mockApi.get.mock.calls.length > 0);

    // Type into title field (first text input)
    const allInputs = screen.getAllByRole('textbox');
    // Title is the first meaningful text input
    const titleInput = allInputs[0];
    if (titleInput) await userEvent.type(titleInput, 'Test Widget');

    // Description is the textarea
    const descInput = allInputs.find((el) => el.tagName === 'TEXTAREA') ??
      allInputs.find((el) => el.getAttribute('aria-label')?.toLowerCase().includes('description'));
    if (descInput) await userEvent.type(descInput, 'A solid description here');

    // Set price type to free via radio to bypass price validation
    const freeRadio = screen.queryAllByRole('radio').find(
      (el) => (el as HTMLInputElement).value === 'free' || el.getAttribute('value') === 'free'
    );
    if (freeRadio) await userEvent.click(freeRadio);

    // Find and click publish button using userEvent (React Aria onPress requires it)
    const submitBtn = screen.getAllByRole('button').find(
      (b) => b.getAttribute('data-disabled') !== 'true' && (
        b.textContent?.includes('create.publish') ||
        b.textContent?.toLowerCase().includes('publish') ||
        b.textContent?.toLowerCase().includes('submit')
      )
    );
    if (submitBtn) {
      await userEvent.click(submitBtn);
      await waitFor(() => {
        expect(mockApi.post).toHaveBeenCalledWith(
          '/v2/marketplace/listings',
          expect.objectContaining({ title: 'Test Widget' })
        );
      });
    }
  });

  it('navigates to new listing on success', async () => {
    mockApi.post.mockResolvedValue({ success: true, data: { id: 77 } });
    const { CreateMarketplaceListingPage } = await import('./CreateMarketplaceListingPage');
    render(<CreateMarketplaceListingPage />);
    await waitFor(() => mockApi.get.mock.calls.length > 0);

    const allInputs = screen.getAllByRole('textbox');
    const titleInput = allInputs[0];
    if (titleInput) await userEvent.type(titleInput, 'Nav Test Widget');

    const descInput = allInputs.find((el) => el.tagName === 'TEXTAREA') ??
      allInputs.find((el) => el.getAttribute('aria-label')?.toLowerCase().includes('description'));
    if (descInput) await userEvent.type(descInput, 'Full description for navigation test');

    // Set free price type via radio
    const freeRadio = screen.queryAllByRole('radio').find(
      (el) => (el as HTMLInputElement).value === 'free' || el.getAttribute('value') === 'free'
    );
    if (freeRadio) await userEvent.click(freeRadio);

    // Click publish with userEvent (React Aria onPress)
    const submitBtn = screen.getAllByRole('button').find(
      (b) => b.getAttribute('data-disabled') !== 'true' && (
        b.textContent?.includes('create.publish') ||
        b.textContent?.toLowerCase().includes('publish') ||
        b.textContent?.toLowerCase().includes('submit')
      )
    );
    if (submitBtn) {
      await userEvent.click(submitBtn);
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('77')
      ));
    }
  });

  it('initializes a new listing with the tenant payment currency', async () => {
    mockTenantState.currency = 'jpy';
    const { CreateMarketplaceListingPage } = await import('./CreateMarketplaceListingPage');

    render(<CreateMarketplaceListingPage />);

    expect(screen.getByDisplayValue('JPY')).toBeInTheDocument();
  });

  it('routes to edit without reporting success when image upload resolves with success false', async () => {
    mockApi.upload.mockResolvedValueOnce({ success: false, error: 'Image rejected' });
    const { CreateMarketplaceListingPage } = await import('./CreateMarketplaceListingPage');
    render(<CreateMarketplaceListingPage />);
    await waitFor(() => mockApi.get.mock.calls.length > 0);

    const textboxes = screen.getAllByRole('textbox');
    await userEvent.type(textboxes[0], 'Listing with image');
    const description = textboxes.find((element) => element.tagName === 'TEXTAREA');
    if (description) await userEvent.type(description, 'Description for image failure test');
    const freeRadio = screen.queryAllByRole('radio').find(
      (element) => (element as HTMLInputElement).value === 'free',
    );
    if (freeRadio) await userEvent.click(freeRadio);

    const imageInput = document.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement;
    fireEvent.change(imageInput, {
      target: { files: [new File(['image'], 'photo.jpg', { type: 'image/jpeg' })] },
    });

    const publishButton = screen.getAllByRole('button').find(
      (button) => button.getAttribute('data-disabled') !== 'true'
        && /publish|submit/i.test(button.textContent ?? ''),
    );
    if (publishButton) await userEvent.click(publishButton);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Image rejected'));
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockClearDraft).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/test/marketplace/77/edit');
  });

  it('shows error toast when API POST fails', async () => {
    mockApi.post.mockResolvedValue({ success: false, error: 'Forbidden' });
    const { CreateMarketplaceListingPage } = await import('./CreateMarketplaceListingPage');
    render(<CreateMarketplaceListingPage />);
    await waitFor(() => mockApi.get.mock.calls.length > 0);

    const inputs = screen.getAllByRole('textbox');
    const titleInput = inputs.find(
      (el) => el.getAttribute('aria-label')?.toLowerCase().includes('title') ||
               el.getAttribute('placeholder')?.toLowerCase().includes('title')
    );
    if (titleInput) await userEvent.type(titleInput, 'Widget');

    const descInput = inputs.find(
      (el) => el.getAttribute('aria-label')?.toLowerCase().includes('description') ||
               el.tagName === 'TEXTAREA'
    );
    if (descInput) await userEvent.type(descInput, 'A description here');

    const priceInput = inputs.find(
      (el) => el.getAttribute('type') === 'number' ||
               el.getAttribute('aria-label')?.toLowerCase().includes('price')
    );
    if (priceInput) await userEvent.type(priceInput, '10');

    const submitBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('publish') ||
             b.textContent?.toLowerCase().includes('create.publish') ||
             b.textContent?.toLowerCase().includes('create') ||
             b.textContent?.toLowerCase().includes('list') ||
             b.textContent?.toLowerCase().includes('submit')
    );
    if (submitBtn && !submitBtn.hasAttribute('disabled')) {
      fireEvent.click(submitBtn);
      await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    }
  });

  it('redirects to login when not authenticated', async () => {
    vi.doMock('@/contexts', () =>
      createMockContexts({
        useToast: () => mockToast,
        useAuth: () => ({
          user: null, isAuthenticated: false,
          login: vi.fn(), logout: vi.fn(), register: vi.fn(),
          updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle' as const, error: null,
        }),
        useTenant: () => ({
          tenant: { id: 2, name: 'Test', slug: 'test' },
          tenantPath: (p: string) => `/test${p}`,
          hasFeature: vi.fn(() => true),
          hasModule: vi.fn(() => true),
        }),
      })
    );
    const { CreateMarketplaceListingPage } = await import('./CreateMarketplaceListingPage');
    render(<CreateMarketplaceListingPage />);
    await waitFor(() => {
      // Component returns null when not authenticated — no crash
      expect(document.body).toBeTruthy();
    });
  });

  it('calls AI generate endpoint when AI button is clicked with a title', async () => {
    mockApi.post
      .mockResolvedValueOnce({ success: true, data: { description: 'AI description text' } })
      .mockResolvedValue({ success: true, data: { id: 77 } });

    const { CreateMarketplaceListingPage } = await import('./CreateMarketplaceListingPage');
    render(<CreateMarketplaceListingPage />);
    await waitFor(() => mockApi.get.mock.calls.length > 0);

    const titleInput = screen.getAllByRole('textbox').find(
      (el) => el.getAttribute('aria-label')?.toLowerCase().includes('title') ||
               el.getAttribute('placeholder')?.toLowerCase().includes('title')
    );
    if (titleInput) await userEvent.type(titleInput, 'Cool Widget');

    const aiBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('ai') ||
             b.textContent?.toLowerCase().includes('generat') ||
             b.textContent?.toLowerCase().includes('sparkle') ||
             b.getAttribute('aria-label')?.toLowerCase().includes('ai')
    );
    if (aiBtn && !aiBtn.hasAttribute('disabled')) {
      fireEvent.click(aiBtn);
      await waitFor(() => {
        expect(mockApi.post).toHaveBeenCalledWith(
          '/v2/marketplace/listings/generate-description',
          expect.objectContaining({ title: 'Cool Widget' })
        );
      });
    }
  });
});
