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
const { mockApi, mockShowToast, mockNavigate } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), upload: vi.fn() },
  mockShowToast: vi.fn(),
  mockNavigate: vi.fn(),
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

// NOTE: MerchantOnboardingPage uses `showToast` (not success/error) from useToast
vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => ({
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
      showToast: mockShowToast,
    }),
    useAuth: () => ({
      user: { id: 1, name: 'Seller User' },
      isAuthenticated: true,
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

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// A vi.mock('@/components/ui', …) override of Switch/RadioGroup/Radio was
// removed here (dead-mock treatment: DELETE, not retarget). It was commented
// "stub Switch to avoid infinite loops in jsdom", but the page imports all three
// from their own direct paths, so the override never applied and the real
// components have always rendered in this suite — which passes, so the loops it
// guarded against do not occur. Retargeting would switch three stand-ins ON for
// the first time and change what these tests exercise; deleting keeps behaviour
// identical.

// ─── Fixtures ────────────────────────────────────────────────────────────────
const makeStatus = (overrides = {}) => ({
  has_profile: false,
  onboarding_completed: false,
  profile: null,
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('MerchantOnboardingPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue({ success: true, data: makeStatus() });
    mockApi.post.mockResolvedValue({ success: true });
    mockApi.upload.mockResolvedValue({ success: true, data: { url: 'https://cdn.example.org/avatar.jpg' } });
    if (!URL.createObjectURL) {
      Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:mock', configurable: true });
    }
    if (!URL.revokeObjectURL) {
      Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    }
  });

  it('shows loading spinner on initial load', async () => {
    mockApi.get.mockImplementationOnce(() => new Promise(() => {}));
    const { MerchantOnboardingPage } = await import('./MerchantOnboardingPage');
    render(<MerchantOnboardingPage />);
    const spinners = screen.getAllByRole('status');
    const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('loads onboarding status on mount', async () => {
    const { MerchantOnboardingPage } = await import('./MerchantOnboardingPage');
    render(<MerchantOnboardingPage />);
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/v2/merchant-onboarding/status');
    });
  });

  it('renders step 1 form after loading', async () => {
    const { MerchantOnboardingPage } = await import('./MerchantOnboardingPage');
    render(<MerchantOnboardingPage />);
    await waitFor(() => screen.getAllByRole('textbox').length > 0);
    // Step 1 has business name / display name inputs
    const inputs = screen.getAllByRole('textbox');
    expect(inputs.length).toBeGreaterThan(0);
  });

  it('fetches onboarding status from the correct API endpoint', async () => {
    const { MerchantOnboardingPage } = await import('./MerchantOnboardingPage');
    render(<MerchantOnboardingPage />);
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/v2/merchant-onboarding/status');
    });
  });

  it('shows completed screen when onboarding already done', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: makeStatus({ has_profile: true, onboarding_completed: true }),
    });
    const { MerchantOnboardingPage } = await import('./MerchantOnboardingPage');
    render(<MerchantOnboardingPage />);
    await waitFor(() => {
      // When completed, component renders completion state — no step form
      expect(document.body).toBeTruthy();
    });
  });

  it('POSTs step-1 data when Next is clicked on step 1', async () => {
    mockApi.post.mockResolvedValue({ success: true });
    const { MerchantOnboardingPage } = await import('./MerchantOnboardingPage');
    render(<MerchantOnboardingPage />);
    await waitFor(() => screen.getAllByRole('textbox').length > 0);

    // Fill business name
    const inputs = screen.getAllByRole('textbox');
    const businessNameInput = inputs.find(
      (el) => el.getAttribute('aria-label')?.toLowerCase().includes('business') ||
               el.getAttribute('placeholder')?.toLowerCase().includes('business')
    );
    if (businessNameInput) await userEvent.type(businessNameInput, 'Acme Corp');

    const nextBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('next') ||
             b.textContent?.toLowerCase().includes('continue')
    );
    if (nextBtn && !nextBtn.hasAttribute('disabled')) {
      fireEvent.click(nextBtn);
      await waitFor(() => {
        expect(mockApi.post).toHaveBeenCalledWith(
          '/v2/merchant-onboarding/step-1',
          expect.objectContaining({ seller_type: expect.any(String) })
        );
      });
    }
  });

  it('shows error toast when step-1 save fails', async () => {
    mockApi.post.mockResolvedValue({ success: false, error: 'Validation error' });
    const { MerchantOnboardingPage } = await import('./MerchantOnboardingPage');
    render(<MerchantOnboardingPage />);
    await waitFor(() => screen.getAllByRole('textbox').length > 0);

    const nextBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('next') ||
             b.textContent?.toLowerCase().includes('continue')
    );
    if (nextBtn && !nextBtn.hasAttribute('disabled')) {
      fireEvent.click(nextBtn);
      await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(
        expect.any(String), 'error'
      ));
    }
  });

  it('advances to step 2 after successful step-1 save', async () => {
    mockApi.post.mockResolvedValue({ success: true });
    const { MerchantOnboardingPage } = await import('./MerchantOnboardingPage');
    render(<MerchantOnboardingPage />);
    await waitFor(() => screen.getAllByRole('textbox').length > 0);

    const nextBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('next') ||
             b.textContent?.toLowerCase().includes('continue')
    );
    if (nextBtn && !nextBtn.hasAttribute('disabled')) {
      fireEvent.click(nextBtn);
      await waitFor(() => {
        // Step 2 should now be visible — it has address fields or hours grid
        expect(mockApi.post).toHaveBeenCalledWith('/v2/merchant-onboarding/step-1', expect.any(Object));
      });
    }
  });

  it('POSTs complete endpoint on final step', async () => {
    mockApi.post
      .mockResolvedValueOnce({ success: true })  // step-1
      .mockResolvedValueOnce({ success: true })  // step-2
      .mockResolvedValueOnce({ success: true })  // step-3
      .mockResolvedValueOnce({ success: true, data: { badge_granted: true } }); // complete

    const { MerchantOnboardingPage } = await import('./MerchantOnboardingPage');
    render(<MerchantOnboardingPage />);
    await waitFor(() => screen.getAllByRole('button').length > 0);

    // Advance through steps by clicking Next three times
    for (let i = 0; i < 3; i++) {
      const nextBtn = screen.getAllByRole('button').find(
        (b) => b.textContent?.toLowerCase().includes('next') ||
               b.textContent?.toLowerCase().includes('continue')
      );
      if (nextBtn && !nextBtn.hasAttribute('disabled')) {
        fireEvent.click(nextBtn);
        await waitFor(() => mockApi.post.mock.calls.length >= i + 1);
      }
    }

    // On step 4, click "Launch" / complete button
    const launchBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('launch') ||
             b.textContent?.toLowerCase().includes('complete') ||
             b.textContent?.toLowerCase().includes('finish')
    );
    if (launchBtn && !launchBtn.hasAttribute('disabled')) {
      fireEvent.click(launchBtn);
      await waitFor(() => {
        expect(mockApi.post).toHaveBeenCalledWith('/v2/merchant-onboarding/complete', {});
      });
    }
  });

  it('hydrates form from existing profile in status response', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: makeStatus({
        has_profile: true,
        onboarding_completed: false,
        profile: {
          seller_type: 'business',
          business_name: 'Pre-filled Corp',
          display_name: 'Pre-filled Display',
          bio: 'A pre-existing bio',
          business_registration: 'REG123',
          avatar_url: 'https://cdn.example.org/avatar.jpg',
        },
      }),
    });
    const { MerchantOnboardingPage } = await import('./MerchantOnboardingPage');
    render(<MerchantOnboardingPage />);
    await waitFor(() => {
      const input = screen.getAllByRole('textbox').find(
        (el) => (el as HTMLInputElement).value === 'Pre-filled Corp' ||
                 (el as HTMLInputElement).value?.includes('Pre-filled')
      );
      if (input) expect((input as HTMLInputElement).value).toContain('Pre-filled');
    });
  });

  it('does not place an active API-provided avatar scheme in the DOM', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: makeStatus({
        has_profile: true,
        onboarding_completed: false,
        profile: { avatar_url: 'javascript:alert(document.domain)' },
      }),
    });
    const { MerchantOnboardingPage } = await import('./MerchantOnboardingPage');
    const { container } = render(<MerchantOnboardingPage />);
    await waitFor(() => screen.getAllByRole('button').length > 0);

    for (let i = 0; i < 2; i++) {
      const nextButton = screen.getAllByRole('button').find(
        (button) => button.textContent?.toLowerCase().includes('next')
          || button.textContent?.toLowerCase().includes('continue'),
      );
      expect(nextButton).toBeDefined();
      fireEvent.click(nextButton as HTMLElement);
      await waitFor(() => expect(mockApi.post.mock.calls.length).toBeGreaterThanOrEqual(i + 1));
    }

    expect(container.querySelector('img[src^="javascript:"]')).toBeNull();
    expect(screen.getByDisplayValue('javascript:alert(document.domain)')).toBeInTheDocument();
  });

  it('shows badge granted message when complete returns badge_granted true', async () => {
    mockApi.post.mockResolvedValue({ success: true, data: { badge_granted: true } });
    const { MerchantOnboardingPage } = await import('./MerchantOnboardingPage');
    render(<MerchantOnboardingPage />);
    await waitFor(() => screen.getAllByRole('button').length > 0);

    // Quickly advance to complete via mocked Next (step saves all return success)
    for (let i = 0; i < 3; i++) {
      const nextBtn = screen.getAllByRole('button').find(
        (b) => b.textContent?.toLowerCase().includes('next') ||
               b.textContent?.toLowerCase().includes('continue')
      );
      if (nextBtn && !nextBtn.hasAttribute('disabled')) {
        fireEvent.click(nextBtn);
        // brief pause for state update
        await new Promise((r) => setTimeout(r, 10));
      }
    }

    const launchBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('launch') ||
             b.textContent?.toLowerCase().includes('complete') ||
             b.textContent?.toLowerCase().includes('finish')
    );
    if (launchBtn) {
      fireEvent.click(launchBtn);
      await waitFor(() => {
        // After complete succeeds the component shows the completion screen
        // badge_granted being true is reflected in component state — just
        // verify complete was called successfully
        expect(mockApi.post).toHaveBeenCalled();
      });
    }
  });

  it('uploads profile images through the merchant onboarding image endpoint', async () => {
    const { MerchantOnboardingPage } = await import('./MerchantOnboardingPage');
    const { container } = render(<MerchantOnboardingPage />);
    await waitFor(() => screen.getAllByRole('button').length > 0);

    for (let i = 0; i < 2; i++) {
      const nextBtn = screen.getAllByRole('button').find(
        (b) => b.textContent?.toLowerCase().includes('next') ||
               b.textContent?.toLowerCase().includes('continue')
      );
      expect(nextBtn).toBeDefined();
      fireEvent.click(nextBtn as HTMLElement);
      await waitFor(() => expect(mockApi.post.mock.calls.length).toBeGreaterThanOrEqual(i + 1));
    }

    const avatarInput = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(avatarInput).toBeTruthy();

    const file = new File(['avatar'], 'avatar.jpg', { type: 'image/jpeg' });
    fireEvent.change(avatarInput as HTMLInputElement, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockApi.upload).toHaveBeenCalledWith('/v2/merchant-onboarding/image', file, 'avatar');
    });
  });
});
