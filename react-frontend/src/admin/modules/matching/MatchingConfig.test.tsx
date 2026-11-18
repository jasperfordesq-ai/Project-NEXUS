// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Mock adminApi ────────────────────────────────────────────────────────────
const { mockAdminMatching } = vi.hoisted(() => ({
  mockAdminMatching: {
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
    clearCache: vi.fn(),
  },
}));

vi.mock('../../api/adminApi', () => ({
  adminMatching: mockAdminMatching,
}));

// ─── Toast / Tenant / Router ──────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return { ...orig, useNavigate: () => mockNavigate };
});

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
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
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Stub heavy admin components ──────────────────────────────────────────────
// The real component imports PageHeader/ConfirmModal from their own files
// ('../../components/PageHeader', '../../components/ConfirmModal'), not the
// barrel ('../../components'), so both specifiers must be mocked.
const mockPageHeader = ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
  <div data-testid="page-header">
    <span>{title}</span>
    {actions}
  </div>
);

const mockConfirmModal = ({
  isOpen,
  onConfirm,
  onClose,
  title,
}: {
  isOpen: boolean;
  onConfirm: () => void;
  onClose: () => void;
  title: string;
}) =>
  isOpen ? (
    <div role="dialog" aria-label="Dialog" data-testid="confirm-modal">
      <span>{title}</span>
      <button onClick={onConfirm}>Confirm</button>
      <button onClick={onClose}>Cancel</button>
    </div>
  ) : null;

vi.mock('../../components', () => ({
  PageHeader: mockPageHeader,
  ConfirmModal: mockConfirmModal,
}));
vi.mock('../../components/PageHeader', () => ({ PageHeader: mockPageHeader }));
vi.mock('../../components/ConfirmModal', () => ({ ConfirmModal: mockConfirmModal }));

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeConfig = (overrides = {}) => ({
  category_weight: 0.25,
  skill_weight: 0.20,
  proximity_weight: 0.25,
  freshness_weight: 0.10,
  reciprocity_weight: 0.15,
  quality_weight: 0.05,
  proximity_bands: [
    { distance_km: 5 },
    { distance_km: 15 },
    { distance_km: 30 },
    { distance_km: 50 },
    { distance_km: 100 },
  ],
  enabled: true,
  max_distance_km: 50,
  min_match_score: 40,
  hot_match_threshold: 80,
  ...overrides,
});

const successConfig = { success: true, data: makeConfig() };

// ─────────────────────────────────────────────────────────────────────────────
describe('MatchingConfig', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminMatching.getConfig.mockResolvedValue(successConfig);
    mockAdminMatching.updateConfig.mockResolvedValue({ success: true });
    mockAdminMatching.clearCache.mockResolvedValue({ success: true, data: { entries_cleared: 12 } });
  });

  it('shows loading spinner while config is fetching', async () => {
    mockAdminMatching.getConfig.mockImplementationOnce(() => new Promise(() => {}));
    const { MatchingConfig } = await import('./MatchingConfig');
    render(<MatchingConfig />);

    const statuses = screen.getAllByRole('status');
    const busy = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders algorithm settings after load', async () => {
    const { MatchingConfig } = await import('./MatchingConfig');
    render(<MatchingConfig />);

    await waitFor(() => {
      // Save button appears once config is loaded (disabled by default when not dirty)
      const btns = screen.getAllByRole('button');
      expect(btns.length).toBeGreaterThan(0);
    });
  });

  it('shows a retryable error state when config load fails', async () => {
    mockAdminMatching.getConfig.mockRejectedValueOnce(new Error('network'));
    const { MatchingConfig } = await import('./MatchingConfig');
    render(<MatchingConfig />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/failed to load matching configuration/i);
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
      expect(mockToast.error).not.toHaveBeenCalled();
    });
  });

  it('save button is disabled initially (not dirty)', async () => {
    const { MatchingConfig } = await import('./MatchingConfig');
    render(<MatchingConfig />);

    await waitFor(() => {
      // Find save button by text containing "save" (case-insensitive via textContent)
      const saveBtns = screen.getAllByRole('button').filter((b) =>
        b.textContent?.toLowerCase().includes('save')
      );
      // The save-changes button should be disabled when not dirty
      const saveBtn = saveBtns.find((b) =>
        b.textContent?.toLowerCase().includes('save')
      );
      expect(saveBtn).toBeDefined();
      // data-disabled for HeroUI
      const isDisabled =
        saveBtn?.hasAttribute('disabled') ||
        saveBtn?.getAttribute('data-disabled') === 'true';
      expect(isDisabled).toBe(true);
    });
  });

  it('opens clear cache confirm modal on button click', async () => {
    const { MatchingConfig } = await import('./MatchingConfig');
    render(<MatchingConfig />);

    await waitFor(() =>
      screen.getAllByRole('button').some((b) =>
        b.textContent?.toLowerCase().includes('cache')
      )
    );

    const cacheBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('cache')
    );
    expect(cacheBtn).toBeDefined();
    fireEvent.click(cacheBtn!);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('calls clearCache when cache modal is confirmed', async () => {
    const { MatchingConfig } = await import('./MatchingConfig');
    render(<MatchingConfig />);

    await waitFor(() =>
      screen.getAllByRole('button').some((b) =>
        b.textContent?.toLowerCase().includes('cache')
      )
    );

    const cacheBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('cache')
    );
    fireEvent.click(cacheBtn!);
    await waitFor(() => screen.getByRole('dialog'));

    const confirmBtn = screen.getByRole('button', { name: /confirm/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockAdminMatching.clearCache).toHaveBeenCalled();
    });
  });

  it('shows success toast after clearing cache', async () => {
    const { MatchingConfig } = await import('./MatchingConfig');
    render(<MatchingConfig />);

    await waitFor(() =>
      screen.getAllByRole('button').some((b) =>
        b.textContent?.toLowerCase().includes('cache')
      )
    );

    const cacheBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('cache')
    );
    fireEvent.click(cacheBtn!);
    await waitFor(() => screen.getByRole('dialog'));

    const confirmBtn = screen.getByRole('button', { name: /confirm/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('opens reset-to-defaults confirm modal', async () => {
    const { MatchingConfig } = await import('./MatchingConfig');
    render(<MatchingConfig />);

    await waitFor(() =>
      screen.getAllByRole('button').some((b) =>
        b.textContent?.toLowerCase().includes('reset')
      )
    );

    const resetBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('reset')
    );
    expect(resetBtn).toBeDefined();
    fireEvent.click(resetBtn!);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('calls toast.info and closes modal after confirming reset', async () => {
    const { MatchingConfig } = await import('./MatchingConfig');
    render(<MatchingConfig />);

    await waitFor(() =>
      screen.getAllByRole('button').some((b) =>
        b.textContent?.toLowerCase().includes('reset')
      )
    );

    const resetBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('reset')
    );
    fireEvent.click(resetBtn!);
    await waitFor(() => screen.getByRole('dialog'));

    const confirmBtn = screen.getByRole('button', { name: /confirm/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockToast.info).toHaveBeenCalled();
      // Modal should close
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('navigates back when Back button is clicked', async () => {
    const { MatchingConfig } = await import('./MatchingConfig');
    render(<MatchingConfig />);

    await waitFor(() =>
      screen.getAllByRole('button').some((b) =>
        b.textContent?.toLowerCase().includes('back')
      )
    );

    const backBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('back')
    );
    expect(backBtn).toBeDefined();
    fireEvent.click(backBtn!);

    expect(mockNavigate).toHaveBeenCalledWith('/test/admin/smart-matching');
  });

  it('calls updateConfig with current config on save when weights valid', async () => {
    // Load config and mark dirty by simulating reset (which sets dirty=true)
    const { MatchingConfig } = await import('./MatchingConfig');
    render(<MatchingConfig />);

    // Wait for config to load
    await waitFor(() =>
      screen.getAllByRole('button').some((b) =>
        b.textContent?.toLowerCase().includes('reset')
      )
    );

    // Reset to defaults → makes config dirty
    const resetBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('reset')
    );
    fireEvent.click(resetBtn!);
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Now save button should be enabled
    const saveBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('save')
    );
    expect(saveBtn).toBeDefined();
    fireEvent.click(saveBtn!);

    await waitFor(() => {
      expect(mockAdminMatching.updateConfig).toHaveBeenCalled();
    });
  });

  it('shows error toast when save fails', async () => {
    mockAdminMatching.updateConfig.mockRejectedValueOnce(new Error('fail'));
    const { MatchingConfig } = await import('./MatchingConfig');
    render(<MatchingConfig />);

    await waitFor(() =>
      screen.getAllByRole('button').some((b) =>
        b.textContent?.toLowerCase().includes('reset')
      )
    );

    // Make dirty via reset
    const resetBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('reset')
    );
    fireEvent.click(resetBtn!);
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const saveBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('save')
    );
    fireEvent.click(saveBtn!);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  // ── What the page offers, and what it refuses to send (audit of Nov 2026) ──

  const DEFAULT_GATES = {
    geo_hard_gate: true,
    missing_coords_mode: 'remote_only',
    dormancy_days: 90,
    owner_dismissal_threshold: 3,
  };
  const DEFAULT_PILLARS = { relevance: 0.45, feasibility: 0.35, trust: 0.2 };

  /** The whole payload the server sends, on the current scoring method. */
  const liveConfig = (overrides = {}) =>
    makeConfig({
      engine_version: 2,
      pillars: DEFAULT_PILLARS,
      gates: DEFAULT_GATES,
      ai: { semantic_signal: true, llm_explanations: true, explanation_top_n: 5, available: true },
      ...overrides,
    });

  async function renderLoaded(config: Record<string, unknown> = liveConfig()) {
    mockAdminMatching.getConfig.mockResolvedValue({ success: true, data: config });
    const { MatchingConfig } = await import('./MatchingConfig');
    render(<MatchingConfig />);
    await screen.findByText('Scoring weights');
  }

  const saveButton = () =>
    screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('save changes')) as HTMLElement;

  const typeInto = (label: string | RegExp, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

  const sentPayload = () => mockAdminMatching.updateConfig.mock.calls[0]?.[0] as Record<string, unknown>;

  it('offers one master switch that says what it does, and no broker-approval switch', async () => {
    await renderLoaded();

    expect(
      screen.getByText('When this is off, members get no matches, nothing new is stored and no match alerts are sent.')
    ).toBeInTheDocument();
    expect(screen.getAllByLabelText('Toggle Smart Matching').length).toBeGreaterThan(0);
    expect(screen.queryByText(/broker approval/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/broker approval/i)).not.toBeInTheDocument();
  });

  it('shows the three scoring weights on the current method, not the six older ones', async () => {
    await renderLoaded();

    for (const label of ['Relevance', 'Feasibility', 'Trust']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText('Category Weight')).not.toBeInTheDocument();
    expect(screen.queryByText('Reciprocity Weight')).not.toBeInTheDocument();
  });

  it('shows the six older weights only for a community on the older scoring method', async () => {
    await renderLoaded(liveConfig({ engine_version: 1 }));

    expect(screen.getAllByText('Category Weight').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Reciprocity Weight').length).toBeGreaterThan(0);
    expect(screen.queryByText('Feasibility')).not.toBeInTheDocument();
  });

  it('lets a band have a distance but no editable score', async () => {
    await renderLoaded();

    expect(screen.getAllByLabelText(/ distance$/)).toHaveLength(5);
    expect(screen.queryByLabelText(/ score$/)).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Score' })).not.toBeInTheDocument();
  });

  it('marks a maximum distance of -5 and does not send it', async () => {
    await renderLoaded();

    typeInto('Max Distance', '-5');

    expect(await screen.findByText('Enter a distance from 1 to 20,000 km.')).toBeInTheDocument();
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith('Please correct the fields marked in red, then save again.')
    );
    expect(mockAdminMatching.updateConfig).not.toHaveBeenCalled();
  });

  it('treats a cleared field as an error, never as a silent default', async () => {
    await renderLoaded();

    typeInto('Min Match Score', '');

    expect(await screen.findByText('Enter a number from 0 to 100.')).toBeInTheDocument();
    fireEvent.click(saveButton());
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(mockAdminMatching.updateConfig).not.toHaveBeenCalled();
  });

  it('refuses a hot-match score below the minimum score', async () => {
    await renderLoaded();

    typeInto('Min Match Score', '70');
    typeInto('Hot Match Threshold', '60');

    expect(await screen.findByText('This cannot be lower than the minimum match score.')).toBeInTheDocument();
    fireEvent.click(saveButton());
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(mockAdminMatching.updateConfig).not.toHaveBeenCalled();
  });

  it('refuses distance bands that are not each further than the one before', async () => {
    await renderLoaded();

    typeInto('Local distance', '3'); // walking is 5

    expect(
      await screen.findByText('Enter a distance above 0 km that is further than the band before it.')
    ).toBeInTheDocument();
    fireEvent.click(saveButton());
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(mockAdminMatching.updateConfig).not.toHaveBeenCalled();
  });

  it('sends only what the page shows: limits, bands as distances, gates and the three weights', async () => {
    await renderLoaded();

    typeInto('Max Distance', '75');
    fireEvent.click(saveButton());

    await waitFor(() => expect(mockAdminMatching.updateConfig).toHaveBeenCalledTimes(1));
    const payload = sentPayload();
    expect(payload).toMatchObject({
      enabled: true,
      max_distance_km: 75,
      min_match_score: 40,
      hot_match_threshold: 80,
      pillars: DEFAULT_PILLARS,
      gates: DEFAULT_GATES,
      proximity_bands: [
        { distance_km: 5 }, { distance_km: 15 }, { distance_km: 30 }, { distance_km: 50 }, { distance_km: 100 },
      ],
    });
    expect(payload).not.toHaveProperty('broker_approval_enabled');
    // The older method's weights are not on screen, so they are not sent.
    expect(payload).not.toHaveProperty('category_weight');
    for (const band of payload.proximity_bands as Array<Record<string, unknown>>) {
      expect(Object.keys(band)).toEqual(['distance_km']);
    }
  });

  it('resets gates, AI and weights too, and keeps every card on the page', async () => {
    await renderLoaded(
      liveConfig({
        enabled: false,
        max_distance_km: 9,
        pillars: { relevance: 1, feasibility: 0, trust: 0 },
        gates: { geo_hard_gate: false, missing_coords_mode: 'tenant_wide', dormancy_days: 10, owner_dismissal_threshold: 8 },
        ai: { semantic_signal: false, llm_explanations: false, explanation_top_n: 2, available: true },
      })
    );

    const resetBtn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('reset'));
    fireEvent.click(resetBtn!);
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // The Gates card used to vanish here until the page was reloaded.
    expect(screen.getByText('Gates & Intelligence')).toBeInTheDocument();
    expect(screen.getByText('Proximity Bands')).toBeInTheDocument();
    expect(screen.getByText('Scoring weights')).toBeInTheDocument();

    fireEvent.click(saveButton());
    await waitFor(() => expect(mockAdminMatching.updateConfig).toHaveBeenCalledTimes(1));
    expect(sentPayload()).toMatchObject({
      enabled: true,
      max_distance_km: 50,
      min_match_score: 40,
      hot_match_threshold: 80,
      pillars: DEFAULT_PILLARS,
      gates: DEFAULT_GATES,
      // Whether AI is available is a fact about the community, not a setting.
      ai: { semantic_signal: true, llm_explanations: true, explanation_top_n: 5, available: true },
    });
  });

  it('says which limit the server refused, in the page\'s own words', async () => {
    mockAdminMatching.updateConfig.mockResolvedValue({
      success: false,
      code: 'VALIDATION_ERROR',
      error: 'raw server text',
      errors: [{ code: 'VALIDATION_ERROR', message: 'raw server text', field: 'max_distance_km' }],
    });
    await renderLoaded();

    typeInto('Max Distance', '60');
    fireEvent.click(saveButton());

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Enter a distance from 1 to 20,000 km.'));
    expect(mockToast.error).not.toHaveBeenCalledWith('raw server text');
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('says the save failed when the server refuses without naming a field', async () => {
    mockAdminMatching.updateConfig.mockResolvedValue({ success: false, code: 'SERVER_ERROR', error: 'raw server text' });
    await renderLoaded();

    typeInto('Max Distance', '60');
    fireEvent.click(saveButton());

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Failed to save configuration'));
  });
});
