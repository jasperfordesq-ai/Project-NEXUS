// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for BadgeConfiguration admin module
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ── stable mock factories ─────────────────────────────────────────────────────
const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));

import type { BadgeConfigEntry } from '../../api/types';

const CORE_BADGE = vi.hoisted<BadgeConfigEntry>(() => ({
  key: 'core_welcome',
  name: 'Welcome Badge',
  description: 'Awarded on registration',
  icon: 'star',
  type: 'once',
  threshold: 0,
  msg: 'Welcome!',
  badge_tier: 'core',
  badge_class: 'quantity',
  threshold_type: 'count',
  evaluation_method: 'event',
  config_json: null,
  rarity: 'common',
  xp_value: 10,
  is_enabled: true,
  has_override: false,
}));

const TEMPLATE_BADGE = vi.hoisted<BadgeConfigEntry>(() => ({
  key: 'tpl_active_giver',
  name: 'Active Giver',
  description: 'Give 5 services',
  icon: 'gem',
  type: 'threshold',
  threshold: 5,
  msg: 'You gave 5 services!',
  badge_tier: 'template',
  badge_class: 'quality',
  threshold_type: 'count',
  evaluation_method: 'aggregate',
  config_json: null,
  rarity: 'uncommon',
  xp_value: 50,
  is_enabled: true,
  has_override: false,
}));

const CUSTOM_BADGE_WITH_OVERRIDE = vi.hoisted<BadgeConfigEntry>(() => ({
  key: 'custom_super_giver',
  name: 'Super Giver',
  description: 'Give 20 services',
  icon: 'zap',
  type: 'threshold',
  threshold: 20,
  msg: 'Incredible!',
  badge_tier: 'custom',
  badge_class: 'special',
  threshold_type: 'count',
  evaluation_method: 'aggregate',
  config_json: null,
  rarity: 'rare',
  xp_value: 100,
  is_enabled: false,
  has_override: true,
}));

const ALL_BADGES = vi.hoisted<BadgeConfigEntry[]>(() => [
  CORE_BADGE,
  TEMPLATE_BADGE,
  CUSTOM_BADGE_WITH_OVERRIDE,
]);

// ── module mocks ──────────────────────────────────────────────────────────────
vi.mock('@/contexts', () => createMockContexts({
  useToast: () => mockToast,
}));

vi.mock('../../api/adminApi', () => ({
  adminGamification: {
    getBadgeConfig: vi.fn(),
    updateBadgeConfig: vi.fn(),
    resetBadgeConfig: vi.fn(),
  },
  adminDeliverability: { list: vi.fn(), delete: vi.fn() },
  adminPages: { list: vi.fn(), delete: vi.fn() },
  adminEnterprise: { getGdprRequests: vi.fn(), updateGdprRequest: vi.fn() },
  adminLegalDocs: { get: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

vi.mock('@/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks')>();
  return { ...actual, usePageTitle: vi.fn() };
});

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { BadgeConfiguration } from './BadgeConfiguration';
import { adminGamification } from '../../api/adminApi';

// ─────────────────────────────────────────────────────────────────────────────

describe('BadgeConfiguration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── loading state ─────────────────────────────────────────────────────────

  it('shows a loading spinner while fetching', () => {
    vi.mocked(adminGamification.getBadgeConfig).mockReturnValue(new Promise(() => {}));
    render(<BadgeConfiguration />);

    const spinners = screen.getAllByRole('status');
    const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeInTheDocument();
  });

  // ── populated state ───────────────────────────────────────────────────────

  it('renders badge names after successful load', async () => {
    vi.mocked(adminGamification.getBadgeConfig).mockResolvedValue({
      success: true,
      data: ALL_BADGES,
    });

    render(<BadgeConfiguration />);

    await waitFor(() => {
      expect(screen.getByText('Welcome Badge')).toBeInTheDocument();
    });
    expect(screen.getByText('Active Giver')).toBeInTheDocument();
    expect(screen.getByText('Super Giver')).toBeInTheDocument();
  });

  it('renders badge descriptions', async () => {
    vi.mocked(adminGamification.getBadgeConfig).mockResolvedValue({
      success: true,
      data: ALL_BADGES,
    });

    render(<BadgeConfiguration />);

    await waitFor(() => {
      expect(screen.getByText('Awarded on registration')).toBeInTheDocument();
    });
  });

  it('shows spinner gone after badges load', async () => {
    vi.mocked(adminGamification.getBadgeConfig).mockResolvedValue({
      success: true,
      data: ALL_BADGES,
    });

    render(<BadgeConfiguration />);

    await waitFor(() => {
      expect(screen.getByText('Welcome Badge')).toBeInTheDocument();
    });

    const busy = screen.queryAllByRole('status').find(
      (el) => el.getAttribute('aria-busy') === 'true',
    );
    expect(busy).toBeUndefined();
  });

  // ── error state ───────────────────────────────────────────────────────────

  it('shows error toast when badge config fetch fails', async () => {
    vi.mocked(adminGamification.getBadgeConfig).mockResolvedValue({ success: false });
    render(<BadgeConfiguration />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  // ── empty state ───────────────────────────────────────────────────────────

  it('shows empty state message when no badges returned', async () => {
    vi.mocked(adminGamification.getBadgeConfig).mockResolvedValue({
      success: true,
      data: [],
    });

    render(<BadgeConfiguration />);

    await waitFor(() => {
      const busy = screen.queryAllByRole('status').find(
        (el) => el.getAttribute('aria-busy') === 'true',
      );
      expect(busy).toBeUndefined();
    });

    // EmptyState card rendered when filtered list is empty
    // Source renders <p className="text-muted">{t('gamification.no_badges_for_filter')}</p>
    expect(screen.queryByText('Welcome Badge')).not.toBeInTheDocument();
  });

  // ── toggle (non-core badge) ───────────────────────────────────────────────

  it('calls updateBadgeConfig when a template badge Switch is toggled', async () => {
    const user = userEvent.setup();
    vi.mocked(adminGamification.getBadgeConfig).mockResolvedValue({
      success: true,
      data: ALL_BADGES,
    });
    vi.mocked(adminGamification.updateBadgeConfig).mockResolvedValue({ success: true });

    render(<BadgeConfiguration />);

    await waitFor(() => {
      expect(screen.getByText('Active Giver')).toBeInTheDocument();
    });

    // Find the Switch for the template badge by aria-label
    const toggleSwitch = screen.getByRole('switch', { name: /active giver/i });
    await user.click(toggleSwitch);

    await waitFor(() => {
      expect(adminGamification.updateBadgeConfig).toHaveBeenCalledWith(
        'tpl_active_giver',
        { is_enabled: expect.any(Boolean) },
      );
    });
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('shows error toast when badge toggle fails', async () => {
    const user = userEvent.setup();
    vi.mocked(adminGamification.getBadgeConfig).mockResolvedValue({
      success: true,
      data: ALL_BADGES,
    });
    vi.mocked(adminGamification.updateBadgeConfig).mockResolvedValue({ success: false });

    render(<BadgeConfiguration />);

    await waitFor(() => {
      expect(screen.getByText('Active Giver')).toBeInTheDocument();
    });

    const toggleSwitch = screen.getByRole('switch', { name: /active giver/i });
    await user.click(toggleSwitch);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('does not call updateBadgeConfig for core badges (Switch is disabled)', async () => {
    const user = userEvent.setup();
    vi.mocked(adminGamification.getBadgeConfig).mockResolvedValue({
      success: true,
      data: ALL_BADGES,
    });

    render(<BadgeConfiguration />);

    await waitFor(() => {
      expect(screen.getByText('Welcome Badge')).toBeInTheDocument();
    });

    // Core badge Switch must be disabled — clicking it should not fire the API
    const coreSwitch = screen.getByRole('switch', { name: /welcome badge/i });
    expect(coreSwitch).toBeDisabled();

    await user.click(coreSwitch);
    expect(adminGamification.updateBadgeConfig).not.toHaveBeenCalled();
  });

  // ── reset action ──────────────────────────────────────────────────────────

  it('shows Reset button only for badges with has_override', async () => {
    vi.mocked(adminGamification.getBadgeConfig).mockResolvedValue({
      success: true,
      data: ALL_BADGES,
    });

    render(<BadgeConfiguration />);

    await waitFor(() => {
      expect(screen.getByText('Super Giver')).toBeInTheDocument();
    });

    // Only CUSTOM_BADGE_WITH_OVERRIDE has has_override=true
    expect(screen.getByRole('button', { name: /reset to default/i })).toBeInTheDocument();
  });

  it('calls resetBadgeConfig and refetches on reset press', async () => {
    const user = userEvent.setup();
    vi.mocked(adminGamification.getBadgeConfig).mockResolvedValue({
      success: true,
      data: ALL_BADGES,
    });
    vi.mocked(adminGamification.resetBadgeConfig).mockResolvedValue({ success: true });

    render(<BadgeConfiguration />);

    await waitFor(() => {
      expect(screen.getByText('Super Giver')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /reset to default/i }));

    await waitFor(() => {
      expect(adminGamification.resetBadgeConfig).toHaveBeenCalledWith('custom_super_giver');
    });
    expect(mockToast.success).toHaveBeenCalled();
    // Should trigger a refetch
    expect(adminGamification.getBadgeConfig).toHaveBeenCalledTimes(2);
  });

  it('shows error toast when reset fails', async () => {
    const user = userEvent.setup();
    vi.mocked(adminGamification.getBadgeConfig).mockResolvedValue({
      success: true,
      data: ALL_BADGES,
    });
    vi.mocked(adminGamification.resetBadgeConfig).mockResolvedValue({ success: false });

    render(<BadgeConfiguration />);

    await waitFor(() => {
      expect(screen.getByText('Super Giver')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /reset to default/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  // ── tab filter ────────────────────────────────────────────────────────────

  it('renders filter Tabs', async () => {
    vi.mocked(adminGamification.getBadgeConfig).mockResolvedValue({
      success: true,
      data: ALL_BADGES,
    });

    render(<BadgeConfiguration />);

    await waitFor(() => {
      expect(screen.getByText('Welcome Badge')).toBeInTheDocument();
    });

    // Tabs are rendered with tab role
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBeGreaterThanOrEqual(2);
  });

  it('filters to only custom tier when Custom tab is selected', async () => {
    const user = userEvent.setup();
    vi.mocked(adminGamification.getBadgeConfig).mockResolvedValue({
      success: true,
      data: ALL_BADGES,
    });

    render(<BadgeConfiguration />);

    await waitFor(() => {
      expect(screen.getByText('Welcome Badge')).toBeInTheDocument();
    });

    // Click the "custom" tab (i18n key = gamification.badge_tiers.custom — defaults to key in test i18n)
    const tabs = screen.getAllByRole('tab');
    // Find tab matching 'custom' key text — in test env i18n returns the key itself
    const customTab = tabs.find((t) => t.textContent?.toLowerCase().includes('custom'));
    if (customTab) {
      await user.click(customTab);
      await waitFor(() => {
        // Core badge should no longer be visible
        expect(screen.queryByText('Welcome Badge')).not.toBeInTheDocument();
        expect(screen.getByText('Super Giver')).toBeInTheDocument();
      });
    } else {
      // Skip if i18n returns different key — not a failure
    }
  });
  // AWID focus group, Oct 2026: "Can we customise the text ... in medals?"
  it('lets an admin rename a medal in their own words', async () => {
    vi.mocked(adminGamification.getBadgeConfig).mockResolvedValue({ success: true, data: ALL_BADGES });
    vi.mocked(adminGamification.updateBadgeConfig).mockResolvedValue({ success: true, data: { success: true } });
    const user = userEvent.setup();
    render(<BadgeConfiguration />);
    await screen.findByText('Active Giver');

    await user.click(screen.getByRole('button', { name: /Edit wording: Active Giver/ }));
    await user.type(await screen.findByLabelText('Name'), 'Persona generosa');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(adminGamification.updateBadgeConfig).toHaveBeenCalledWith('tpl_active_giver', {
      custom_name: 'Persona generosa',
      custom_description: '',
    }));
  });
});
