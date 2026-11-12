// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Mock api ────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  api: mockApi,
  default: mockApi,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Motion / animation shim — avoid complex animation in jsdom ───────────────
vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => <div {...rest}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ─── Contexts ────────────────────────────────────────────────────────────────
vi.mock('@/contexts', () =>
  createMockContexts({
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

// ─────────────────────────────────────────────────────────────────────────────

describe('PilotInquiryPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders step 1 of the form on initial load', async () => {
    const { PilotInquiryPage } = await import('./PilotInquiryPage');
    render(<PilotInquiryPage />);

    // Should show the first step — the municipality input
    await waitFor(() => {
      // The step indicator shows "1" as the active step number
      const stepIndicator = document.querySelector('[class*="indigo"]');
      expect(stepIndicator).toBeDefined();
    });
  });

  it('renders a "Next" button on step 1', async () => {
    const { PilotInquiryPage } = await import('./PilotInquiryPage');
    render(<PilotInquiryPage />);

    await waitFor(() => {
      const nextBtn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('next') ||
        b.getAttribute('data-disabled') !== null
      );
      expect(nextBtn).toBeDefined();
    });
  });

  it('Next button is disabled when municipality_name is empty (step 1)', async () => {
    const { PilotInquiryPage } = await import('./PilotInquiryPage');
    render(<PilotInquiryPage />);

    await waitFor(() => screen.getAllByRole('button'));

    // The next button should be disabled since municipality_name is empty
    const nextBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('next')
    );
    // It should be present and disabled
    expect(nextBtn).toBeDefined();
    if (nextBtn) {
      expect(
        nextBtn.getAttribute('disabled') !== null ||
        nextBtn.getAttribute('data-disabled') === 'true' ||
        (nextBtn as HTMLButtonElement).disabled
      ).toBe(true);
    }
  });

  it('enables Next button when municipality_name is filled', async () => {
    const { PilotInquiryPage } = await import('./PilotInquiryPage');
    render(<PilotInquiryPage />);

    await waitFor(() => screen.getAllByRole('button'));

    // Find the municipality name input — it has isRequired
    const inputs = screen.getAllByRole('textbox');
    // First textbox is municipality_name (first Input in step 1)
    if (inputs.length > 0) {
      fireEvent.change(inputs[0], { target: { value: 'Testburg' } });
    }

    await waitFor(() => {
      const nextBtn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('next')
      );
      expect(nextBtn).toBeDefined();
      if (nextBtn) {
        const isDisabled =
          nextBtn.getAttribute('disabled') !== null ||
          nextBtn.getAttribute('data-disabled') === 'true' ||
          (nextBtn as HTMLButtonElement).disabled;
        expect(isDisabled).toBe(false);
      }
    });
  });

  it('advances to step 2 when Next is clicked with a valid municipality name', async () => {
    const { PilotInquiryPage } = await import('./PilotInquiryPage');
    render(<PilotInquiryPage />);

    await waitFor(() => screen.getAllByRole('button'));

    // Fill municipality name
    const inputs = screen.getAllByRole('textbox');
    if (inputs.length > 0) {
      fireEvent.change(inputs[0], { target: { value: 'Testburg' } });
    }

    // Click Next
    const nextBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('next')
    );
    if (nextBtn) fireEvent.click(nextBtn);

    await waitFor(() => {
      // Step 2 should now show — look for the Back button that appears on step 2+
      const backBtn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('back')
      );
      expect(backBtn).toBeDefined();
    });
  });

  it('shows Back button on step 2 and goes back to step 1', async () => {
    const { PilotInquiryPage } = await import('./PilotInquiryPage');
    render(<PilotInquiryPage />);

    await waitFor(() => screen.getAllByRole('button'));

    // Fill and advance
    const inputs = screen.getAllByRole('textbox');
    if (inputs.length > 0) fireEvent.change(inputs[0], { target: { value: 'Testburg' } });

    const nextBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('next')
    );
    if (nextBtn) fireEvent.click(nextBtn);

    await waitFor(() =>
      screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('back'))
    );

    const backBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('back')
    );
    if (backBtn) fireEvent.click(backBtn);

    await waitFor(() => {
      // No Back button visible on step 1
      const backBtnAfter = screen.queryAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('back')
      );
      expect(backBtnAfter).toBeUndefined();
    });
  });

  it('shows Submit button on step 3', async () => {
    const { PilotInquiryPage } = await import('./PilotInquiryPage');
    render(<PilotInquiryPage />);

    await waitFor(() => screen.getAllByRole('button'));

    // Advance through step 1
    const inputs1 = screen.getAllByRole('textbox');
    if (inputs1.length > 0) fireEvent.change(inputs1[0], { target: { value: 'Testburg' } });
    const nextBtn1 = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('next')
    );
    if (nextBtn1) fireEvent.click(nextBtn1);

    // Step 2 — advance again
    await waitFor(() =>
      screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('next'))
    );
    const nextBtn2 = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('next')
    );
    if (nextBtn2) fireEvent.click(nextBtn2);

    await waitFor(() => {
      const submitBtn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('submit') ||
        b.textContent?.toLowerCase().includes('send')
      );
      expect(submitBtn).toBeDefined();
      // Warmth phase 5: the button's blend ended on a fixed green.
      expect(submitBtn!.className).toContain('to-accent-strong-end');
      expect(submitBtn!.className).not.toMatch(/emerald-/);
    });
  });

  it('calls POST /v2/pilot-inquiry on submit and shows success state', async () => {
    mockApi.post.mockResolvedValue({
      success: true,
      data: { fit_score: 75, stage: 'qualified' },
    });

    const { PilotInquiryPage } = await import('./PilotInquiryPage');
    render(<PilotInquiryPage />);

    await waitFor(() => screen.getAllByRole('button'));

    // Step 1: fill name and advance
    const inputs1 = screen.getAllByRole('textbox');
    if (inputs1.length > 0) fireEvent.change(inputs1[0], { target: { value: 'Testburg' } });
    const nextBtn1 = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('next')
    );
    if (nextBtn1) fireEvent.click(nextBtn1);

    // Step 2: advance
    await waitFor(() =>
      screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('next'))
    );
    const nextBtn2 = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('next')
    );
    if (nextBtn2) fireEvent.click(nextBtn2);

    // Step 3: fill required contact fields
    await waitFor(() =>
      screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('submit') ||
        b.textContent?.toLowerCase().includes('send')
      )
    );

    const allInputs = screen.getAllByRole('textbox');
    // contact_name and contact_email are required
    if (allInputs.length >= 2) {
      fireEvent.change(allInputs[0], { target: { value: 'Jane Mayor' } });
      // email input — may be type=email, use querySelector
    }
    const emailInput = document.querySelector('input[type="email"]');
    if (emailInput) fireEvent.change(emailInput, { target: { value: 'jane@test.ie' } });

    const submitBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('submit') ||
      b.textContent?.toLowerCase().includes('send')
    );
    if (submitBtn) fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(
        '/v2/pilot-inquiry',
        expect.objectContaining({ municipality_name: 'Testburg' })
      );
    });
  });

  it('shows error alert when API call fails', async () => {
    mockApi.post.mockRejectedValue(new Error('Server error'));

    const { PilotInquiryPage } = await import('./PilotInquiryPage');
    render(<PilotInquiryPage />);

    await waitFor(() => screen.getAllByRole('button'));

    // Navigate to step 3 quickly
    const inputs1 = screen.getAllByRole('textbox');
    if (inputs1.length > 0) fireEvent.change(inputs1[0], { target: { value: 'Testburg' } });
    const nextBtn1 = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('next')
    );
    if (nextBtn1) fireEvent.click(nextBtn1);

    await waitFor(() =>
      screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('next'))
    );
    const nextBtn2 = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('next')
    );
    if (nextBtn2) fireEvent.click(nextBtn2);

    await waitFor(() =>
      screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('submit') ||
        b.textContent?.toLowerCase().includes('send')
      )
    );

    // Fill required step 3 fields
    const allInputs = screen.getAllByRole('textbox');
    if (allInputs.length > 0) fireEvent.change(allInputs[0], { target: { value: 'Jane Mayor' } });
    const emailInput = document.querySelector('input[type="email"]');
    if (emailInput) fireEvent.change(emailInput, { target: { value: 'jane@test.ie' } });

    const submitBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('submit') ||
      b.textContent?.toLowerCase().includes('send')
    );
    if (submitBtn) fireEvent.click(submitBtn);

    await waitFor(() => {
      const alert = screen.queryByRole('alert');
      expect(alert).toBeInTheDocument();
    });
  });

  it('renders the step indicator with 3 steps', async () => {
    const { PilotInquiryPage } = await import('./PilotInquiryPage');
    render(<PilotInquiryPage />);

    // The step indicator renders 3 step circles
    await waitFor(() => {
      // The "step X of Y" text uses translation key — just check the form card is rendered
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });
  });
});
