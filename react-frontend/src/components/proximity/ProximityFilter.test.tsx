// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for proximity/ProximityFilter
 *
 * ProximityFilter imports `useAuth` from '@/contexts/AuthContext' and
 * `useToast` from '@/contexts/ToastContext' — both DIRECT paths. Vitest
 * resolves mocks per specifier, so the old '@/contexts' barrel mock was never
 * consulted: the real useAuth threw ("must be used within an AuthProvider") and
 * killed every test, while the real useToast quietly took over, so the
 * mockToast.error assertion was measuring nothing.
 *
 * AuthContext is mocked totally (no importOriginal) because the real module
 * imports '@/i18n', which unconditionally re-initialises i18next with the
 * HTTP/localStorage backends and would wipe the English locale resources
 * src/test/setup.ts preloads. ToastContext is mocked PARTIALLY so the real
 * ToastProvider that src/test/test-utils.tsx renders stays intact — only
 * useToast is swapped for a spy, because the real one dispatches into a
 * lazily-imported ToastViewport chunk this unit test has no business owning.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, isAuthenticated: false }),
}));

vi.mock('@/contexts/ToastContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/contexts/ToastContext')>()),
  useToast: () => mockToast,
}));

import { ProximityFilter, type ProximityFilterParams } from './ProximityFilter';

const ACTIVE_VALUE: ProximityFilterParams = {
  near_lat: 53.3498,
  near_lng: -6.2603,
  radius_km: 25,
};

describe('proximity/ProximityFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Real copy, from the English locales src/test/setup.ts preloads:
  //   common.members.near_me      -> "Near me"  (toggle button text)
  //   common.members.radius_label -> "Radius"   (Select trigger aria-label)
  //   common.radius_50            -> "50 km"    (Select value / option text)
  //
  // The real HeroUI v3 Select trigger is a <button aria-haspopup="listbox">
  // carrying aria-expanded — the only element in this component that does — so
  // `{ expanded: false }` addresses it uniquely. It is NOT reachable by the
  // accessible name "Radius": React Aria also sets aria-labelledby on the
  // trigger (value spans), and aria-labelledby outranks aria-label in the
  // accessible-name computation.
  const NEAR_ME = 'Near me';
  const RADIUS = 'Radius';

  // ── Inactive state (value === null) ────────────────────────────────────

  it('renders only the "Near me" button when value is null', () => {
    render(<ProximityFilter value={null} onFilter={vi.fn()} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: NEAR_ME })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('does NOT render a Select trigger when value is null', () => {
    render(<ProximityFilter value={null} onFilter={vi.fn()} />);
    // No select trigger — neither the real HeroUI trigger button (the only
    // aria-expanded element) nor the hidden native <select> React Aria renders
    // alongside it.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { expanded: false })).not.toBeInTheDocument();
  });

  // ── Toggle ON — user has NO location (default mock has user: null) ─────

  it('fires toast.error and does NOT call onFilter when user has no location', () => {
    const onFilter = vi.fn();
    render(<ProximityFilter value={null} onFilter={onFilter} />);
    fireEvent.click(screen.getByRole('button', { name: NEAR_ME }));
    expect(mockToast.error).toHaveBeenCalledTimes(1);
    // common.members.near_me_no_location
    expect(mockToast.error).toHaveBeenCalledWith(
      'Set your location in your profile to use Near me'
    );
    expect(onFilter).not.toHaveBeenCalled();
  });

  // ── Active state (value !== null) ──────────────────────────────────────

  it('sets aria-pressed=true on the Near-me button when value is non-null', () => {
    render(<ProximityFilter value={ACTIVE_VALUE} onFilter={vi.fn()} />);
    expect(screen.getByRole('button', { name: NEAR_ME })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('renders a Select trigger alongside the Near-me button when active', () => {
    render(<ProximityFilter value={ACTIVE_VALUE} onFilter={vi.fn()} />);
    // Near-me toggle + the actual radius Select trigger, each identified
    // individually rather than by a button count.
    expect(screen.getByRole('button', { name: NEAR_ME })).toBeInTheDocument();
    const radiusTrigger = screen.getByRole('button', { expanded: false });
    expect(radiusTrigger).toHaveAttribute('aria-haspopup', 'listbox');
    expect(radiusTrigger).toHaveAttribute('aria-label', RADIUS);
  });

  it('calls onFilter(null) when toggling OFF', () => {
    const onFilter = vi.fn();
    render(<ProximityFilter value={ACTIVE_VALUE} onFilter={onFilter} />);
    fireEvent.click(screen.getByRole('button', { name: NEAR_ME }));
    expect(onFilter).toHaveBeenCalledWith(null);
  });

  // ── Select shows the current radius ───────────────────────────────────

  it('shows the current radius_km value in the Select when active', () => {
    render(<ProximityFilter value={{ near_lat: 1, near_lng: 2, radius_km: 50 }} onFilter={vi.fn()} />);
    // The radius trigger must display the selected option's real label, so a
    // wrong/blank/unselected value now fails (the old /50/ regex also matched
    // the un-selected "50 km" <option> in the hidden native select).
    expect(screen.getByRole('button', { expanded: false })).toHaveTextContent('50 km');
  });

  // ── className prop ──────────────────────────────────────────────────────

  it('applies additional className to the wrapper div', () => {
    const { container } = render(
      <ProximityFilter value={null} onFilter={vi.fn()} className="extra-class" />
    );
    const wrapper = container.querySelector('.extra-class');
    expect(wrapper).toBeInTheDocument();
    // …and it is the real filter wrapper, not some incidental node.
    expect(wrapper).toContainElement(screen.getByRole('button', { name: NEAR_ME }));
  });
});
