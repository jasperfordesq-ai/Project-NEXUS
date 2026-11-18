// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for MatchPreferencesPage — data-integrity regression coverage.
 *
 * api.get resolves { success:false } on a 4xx WITHOUT throwing. Before the
 * fix, a failed preferences load left the form editable with DEFAULTS, and
 * saving overwrote the user's real stored preferences. The page must now
 * show an error + retry and block the entire save path until a successful
 * load has populated the form.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () => createMockContexts({
  useAuth: () => ({
    user: { id: 1, first_name: 'Test', last_name: 'User', latitude: 53.3, longitude: -6.2 },
    isAuthenticated: true,
  }),
  useToast: () => mockToast,
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/components/navigation', () => ({ Breadcrumbs: () => null }));

// Lightweight UI stubs (label/title/children render as text, onPress → onClick)
// so form-control presence is queryable without HeroUI internals in jsdom.
vi.mock('@/components/ui/Alert', async () => (await import('@/test/uiMock')).uiMock);
vi.mock('@/components/ui/Button', async () => (await import('@/test/uiMock')).uiMock);
vi.mock('@/components/ui/Checkbox', async () => (await import('@/test/uiMock')).uiMock);
vi.mock('@/components/ui/GlassCard', async () => (await import('@/test/uiMock')).uiMock);
vi.mock('@/components/ui/Radio', async () => (await import('@/test/uiMock')).uiMock);
// A real range input, so the limits the page gives each slider can be read
// and the value changed — the generic stub renders the label only.
vi.mock('@/components/ui/Slider', () => ({
  Slider: ({ label, minValue, maxValue, step, value, onChange, getValue }: {
    label: string;
    minValue: number;
    maxValue: number;
    step: number;
    value: number;
    onChange: (value: number) => void;
    getValue?: () => string;
  }) => (
    <div>
      <input
        type="range"
        aria-label={label}
        min={minValue}
        max={maxValue}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output>{getValue?.()}</output>
    </div>
  ),
}));
vi.mock('@/components/ui/Spinner', async () => (await import('@/test/uiMock')).uiMock);
vi.mock('@/components/ui/Switch', async () => (await import('@/test/uiMock')).uiMock);

import { MatchPreferencesPage } from './MatchPreferencesPage';
import { api } from '@/lib/api';

const STORED_PREFS = {
  max_distance_km: 42,
  min_match_score: 60,
  notification_frequency: 'monthly',
  notify_hot_matches: true,
  notify_mutual_matches: false,
  matching_paused: false,
  categories: [],
  availability: [],
};

/** Mock api.get: fail the preferences call `prefsFailTimes` times, then succeed. */
function mockGet({ prefsFailTimes = 0, prefs = STORED_PREFS }: { prefsFailTimes?: number; prefs?: Record<string, unknown> } = {}) {
  let prefsCalls = 0;
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url.includes('match-preferences')) {
      prefsCalls += 1;
      if (prefsCalls <= prefsFailTimes) {
        return Promise.resolve({ success: false, error: 'Forbidden' });
      }
      return Promise.resolve({ success: true, data: prefs });
    }
    // /v2/categories
    return Promise.resolve({ success: true, data: [] });
  });
}

describe('MatchPreferencesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the editable form when preferences load successfully', async () => {
    mockGet();
    render(<MatchPreferencesPage />);

    expect(await screen.findByText('Pause matching')).toBeInTheDocument();
    expect(screen.queryByText("We couldn't load your match preferences")).not.toBeInTheDocument();
  });

  it('shows an error with retry and BLOCKS the form/save path when the load fails', async () => {
    mockGet({ prefsFailTimes: 99 });
    render(<MatchPreferencesPage />);

    expect(await screen.findByText("We couldn't load your match preferences")).toBeInTheDocument();
    expect(
      screen.getByText("Your saved preferences couldn't be loaded. Editing is disabled so they aren't overwritten with defaults."),
    ).toBeInTheDocument();
    expect(screen.getByText('Try again')).toBeInTheDocument();

    // DATA-INTEGRITY: the editable form (defaults!) must NOT render, so there is
    // no way to become "dirty" and reach the save bar / overwrite stored prefs.
    expect(screen.queryByText('Pause matching')).not.toBeInTheDocument();
    expect(screen.queryByText('Save preferences')).not.toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('recovers via retry and only then renders the form populated from the server', async () => {
    mockGet({ prefsFailTimes: 1 });
    render(<MatchPreferencesPage />);

    const retryBtn = await screen.findByText('Try again');
    fireEvent.click(retryBtn);

    expect(await screen.findByText('Pause matching')).toBeInTheDocument();
    expect(screen.queryByText("We couldn't load your match preferences")).not.toBeInTheDocument();

    // Preferences endpoint hit twice: failed initial load + successful retry.
    const prefsCalls = vi.mocked(api.get).mock.calls
      .filter(([url]) => typeof url === 'string' && url.includes('match-preferences'));
    expect(prefsCalls).toHaveLength(2);
  });

  it('keeps blocking after repeated failed retries', async () => {
    mockGet({ prefsFailTimes: 99 });
    render(<MatchPreferencesPage />);

    const retryBtn = await screen.findByText('Try again');
    fireEvent.click(retryBtn);

    await waitFor(() => {
      const prefsCalls = vi.mocked(api.get).mock.calls
        .filter(([url]) => typeof url === 'string' && url.includes('match-preferences'));
      expect(prefsCalls.length).toBeGreaterThanOrEqual(2);
    });

    expect(await screen.findByText("We couldn't load your match preferences")).toBeInTheDocument();
    expect(screen.queryByText('Save preferences')).not.toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  it("stops the distance slider at the community's own limit", async () => {
    // The server clamps to this figure anyway; a slider that ran to 100 let a
    // member "choose" a distance that was then quietly cut back.
    mockGet({ prefs: { ...STORED_PREFS, max_distance_limit_km: 50 } });
    render(<MatchPreferencesPage />);

    const distance = await screen.findByRole('slider', { name: 'Maximum distance' });
    expect(distance).toHaveAttribute('max', '50');
    expect(distance).toHaveAttribute('min', '1');
    expect(screen.getByText('42 km')).toBeInTheDocument();
  });

  it('falls back to 100 km when the server does not say what the community allows', async () => {
    mockGet();
    render(<MatchPreferencesPage />);

    expect(await screen.findByRole('slider', { name: 'Maximum distance' })).toHaveAttribute('max', '100');
  });

  it('offers the whole 0 to 100 range for minimum match quality, in steps of 5', async () => {
    // One range on the website and the phone app, so a value saved on one
    // always shows correctly on the other.
    mockGet();
    render(<MatchPreferencesPage />);

    const quality = await screen.findByRole('slider', { name: 'Minimum match quality' });
    expect(quality).toHaveAttribute('min', '0');
    expect(quality).toHaveAttribute('max', '100');
    expect(quality).toHaveAttribute('step', '5');
  });

  it('shows the value the server kept after a save, and never sends the limit back', async () => {
    mockGet({ prefs: { ...STORED_PREFS, max_distance_limit_km: 80 } });
    // The server keeps 60, not the 75 that was asked for.
    vi.mocked(api.put).mockResolvedValue({
      success: true,
      data: { ...STORED_PREFS, max_distance_km: 60, max_distance_limit_km: 80 },
    });
    render(<MatchPreferencesPage />);

    const distance = await screen.findByRole('slider', { name: 'Maximum distance' });
    fireEvent.change(distance, { target: { value: '75' } });
    expect(screen.getByText('75 km')).toBeInTheDocument();

    fireEvent.click(await screen.findByText('Save preferences'));

    expect(await screen.findByText('60 km')).toBeInTheDocument();
    expect(screen.queryByText('75 km')).not.toBeInTheDocument();
    expect(api.put).toHaveBeenCalledWith('/v2/users/me/match-preferences', { ...STORED_PREFS, max_distance_km: 75 });
    // Saved, so nothing is left to save.
    await waitFor(() => expect(screen.queryByText('Save preferences')).not.toBeInTheDocument());
    expect(mockToast.success).toHaveBeenCalledWith('Match preferences saved');
  });
});
