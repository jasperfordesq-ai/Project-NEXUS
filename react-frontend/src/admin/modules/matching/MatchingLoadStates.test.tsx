// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@/test/test-utils';

const apiMocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  getMatchingStats: vi.fn(),
  clearCache: vi.fn(),
  updateConfig: vi.fn(),
}));
const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);
vi.mock('@/contexts', () => ({
  useTenant: () => ({ tenantPath: (path: string) => `/test${path}`, hasFeature: vi.fn((_key: string) => true), hasModule: vi.fn((_key: string) => true) }),
  useToast: () => toastMock,
}));
vi.mock('../../api/adminApi', () => ({
  adminMatching: {
    getConfig: apiMocks.getConfig,
    getMatchingStats: apiMocks.getMatchingStats,
    clearCache: apiMocks.clearCache,
    updateConfig: apiMocks.updateConfig,
  },
}));
vi.mock('../../components/PageHeader', () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <header><h1>{title}</h1>{actions}</header>
  ),
}));
vi.mock('../../components/EmptyState', () => ({
  EmptyState: ({ title, actionLabel, onAction }: { title: string; actionLabel?: string; onAction?: () => void }) => (
    <section><h2>{title}</h2>{actionLabel && onAction && <button type="button" onClick={onAction}>{actionLabel}</button>}</section>
  ),
}));
vi.mock('../../components/StatCard', () => ({
  StatCard: ({ label, value }: { label: string; value: string | number }) => <div><span>{label}</span><strong>{value}</strong></div>,
}));
vi.mock('../../components/ConfirmModal', () => ({ ConfirmModal: () => null }));

import { MatchingAnalytics } from './MatchingAnalytics';
import { MatchingConfig } from './MatchingConfig';
import { SmartMatchingOverview } from './SmartMatchingOverview';
import { isMatchingStatsResponse, isSmartMatchingConfig, parseMatchingStatsResponse } from './matchingResponseGuards';

const backendDetail = 'SQLSTATE secret backend detail';
const validConfig = {
  category_weight: 0.25,
  skill_weight: 0.2,
  proximity_weight: 0.25,
  freshness_weight: 0.1,
  reciprocity_weight: 0.15,
  quality_weight: 0.05,
  proximity_bands: [{ distance_km: 5 }],
  enabled: true,
};
const zeroStats = {
  overview: {
    total_matches_today: 0,
    total_matches_week: 0,
    total_matches_month: 0,
    hot_matches_count: 0,
    mutual_matches_count: 0,
    avg_match_score: 0,
    avg_distance_km: 0,
    cache_entries: 0,
    active_users_matching: 0,
  },
  score_distribution: {},
  distance_distribution: {},
  pending_approvals: 0,
  approved_count: 0,
  rejected_count: 0,
  approval_rate: 0,
};
const laravelStats = {
  ...zeroStats,
  overview: {
    total_cached_matches: 12,
    total_matches_month: 7,
    average_score: 81.5,
    average_distance_km: 4.25,
    active_users_with_matches: 6,
    hot_matches: 3,
  },
  score_distribution: [
    { range: '0-20', count: 2 },
    { range: '20-40', count: 5 },
  ],
  distance_distribution: [
    { range: '0-5', count: 4 },
    { range: '5-15', count: 3 },
  ],
};
// What the server sends today: the names above plus the three counts it used
// to leave out.
const liveStats = {
  ...zeroStats,
  overview: {
    total_cached_matches: 9,
    total_matches_month: 9,
    total_matches_week: 4,
    total_matches_today: 2,
    average_score: 61.2,
    average_distance_km: 12.5,
    active_users_with_matches: 3,
    hot_matches: 2,
    mutual_matches_count: 1,
  },
  score_distribution: [
    { range: '0-20', count: 1 },
    { range: '20-40', count: 1 },
    { range: '40-60', count: 3 },
    { range: '60-80', count: 2 },
    { range: '80-100', count: 2 },
  ],
  distance_distribution: [
    { range: '0-5', count: 4 },
    { range: '5-15', count: 2 },
    { range: '15-30', count: 1 },
    { range: '30-50', count: 1 },
    { range: '50+', count: 0 },
    { range: 'unknown', count: 1 },
  ],
  pending_approvals: 4,
  gate_impact: {
    degraded_users_count: 0,
    active_users_count: 5,
    listings_without_coords: 0,
    remote_listings_count: 1,
    active_listings_count: 6,
    dismiss_reasons: { not_relevant: 2, already_done: 1, not_my_skills: 1, too_far: 1 },
    algorithm_version_mix: { v2: 9 },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getConfig.mockResolvedValue({ success: true, data: validConfig });
  apiMocks.getMatchingStats.mockResolvedValue({ success: true, data: zeroStats });
  apiMocks.clearCache.mockResolvedValue({ success: true, data: { entries_cleared: 0 } });
  apiMocks.updateConfig.mockResolvedValue({ success: true });
});

describe('matching response guards', () => {
  it('accepts explicit numeric zeroes but rejects incomplete payloads', () => {
    expect(isMatchingStatsResponse(zeroStats)).toBe(true);
    expect(isMatchingStatsResponse({ ...zeroStats, distance_distribution: undefined })).toBe(false);
    expect(isSmartMatchingConfig(validConfig)).toBe(true);
    expect(isSmartMatchingConfig({ ...validConfig, quality_weight: undefined })).toBe(false);
  });

  it('normalizes the Laravel analytics aliases without inventing unavailable metrics', () => {
    const parsed = parseMatchingStatsResponse(laravelStats);

    expect(parsed?.overview).toMatchObject({
      cache_entries: 12,
      total_matches_month: 7,
      avg_match_score: 81.5,
      avg_distance_km: 4.25,
      active_users_matching: 6,
      hot_matches_count: 3,
    });
    expect(parsed?.overview.total_matches_today).toBeUndefined();
    expect(parsed?.overview.total_matches_week).toBeUndefined();
    expect(parsed?.overview.mutual_matches_count).toBeUndefined();
    expect(parsed?.score_distribution).toEqual({ '0-20': 2, '20-40': 5 });
    expect(parsed?.distance_distribution).toEqual({ '0-5': 4, '5-15': 3 });
  });

  it('no longer needs (or keeps) the broker-approval flag or a band score', () => {
    // The server stopped sending both: the flag described a switch nothing
    // read, and a band's score was never saved.
    expect(parseMatchingStatsResponse(zeroStats)).not.toBeNull();
    const withOldFlag = parseMatchingStatsResponse({ ...zeroStats, broker_approval_enabled: true });
    expect(withOldFlag).not.toBeNull();
    expect(withOldFlag).not.toHaveProperty('broker_approval_enabled');
    expect(isSmartMatchingConfig({ ...validConfig, proximity_bands: [{ distance_km: 5 }, { distance_km: 15 }] })).toBe(true);
    expect(isSmartMatchingConfig({ ...validConfig, proximity_bands: [{ score: 1 }] })).toBe(false);
  });

  it('reads the today / week / mutual counts the server now sends', () => {
    const parsed = parseMatchingStatsResponse(liveStats);

    expect(parsed?.overview).toMatchObject({
      total_matches_today: 2,
      total_matches_week: 4,
      mutual_matches_count: 1,
      cache_entries: 9,
    });
    expect(parsed?.overview).not.toHaveProperty('cache_hit_rate');
  });
});

describe('MatchingConfig load safety', () => {
  it.each([
    ['resolved failure', () => Promise.resolve({ success: false, error: backendDetail })],
    ['rejected request', () => Promise.reject(new Error(backendDetail))],
  ])('blocks the default form for an initial %s', async (_label, response) => {
    apiMocks.getConfig.mockImplementationOnce(response);
    render(<MatchingConfig />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load matching configuration');
    expect(screen.queryByText('Scoring weights')).not.toBeInTheDocument();
    expect(screen.queryByText(backendDetail)).not.toBeInTheDocument();
    expect(apiMocks.updateConfig).not.toHaveBeenCalled();
  });

  it('retries the initial failure and only then mounts the confirmed form', async () => {
    apiMocks.getConfig
      .mockResolvedValueOnce({ success: false, error: backendDetail })
      .mockResolvedValueOnce({ success: true, data: validConfig });
    render(<MatchingConfig />);

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Scoring weights')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('retains confirmed configuration but disables save after a failed refresh', async () => {
    apiMocks.getConfig
      .mockResolvedValueOnce({ success: true, data: validConfig })
      .mockResolvedValueOnce({ success: false, error: backendDetail });
    render(<MatchingConfig />);

    expect(await screen.findByText('Scoring weights')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load matching configuration');
    expect(screen.getByText('Scoring weights')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  });
});

describe('SmartMatchingOverview partial load safety', () => {
  it('surfaces a failed stats envelope without inventing a setting or a count', async () => {
    apiMocks.getMatchingStats.mockResolvedValueOnce({ success: false, error: backendDetail });
    render(<SmartMatchingOverview />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load matching analytics');
    expect(screen.queryByText(backendDetail)).not.toBeInTheDocument();
    expect(screen.queryByText('Disabled')).not.toBeInTheDocument();
    expect(screen.getByText('Scoring weights')).toBeInTheDocument();
  });

  it('retains both confirmed response branches when a later refresh rejects', async () => {
    apiMocks.getConfig
      .mockResolvedValueOnce({ success: true, data: validConfig })
      .mockRejectedValueOnce(new Error(backendDetail));
    apiMocks.getMatchingStats
      .mockResolvedValueOnce({ success: true, data: zeroStats })
      .mockRejectedValueOnce(new Error(backendDetail));
    render(<SmartMatchingOverview />);

    expect(await screen.findByText('Matching Activity')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load matching configuration');
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load matching analytics');
    expect(screen.getByText('Matching Activity')).toBeInTheDocument();
  });
});

describe('MatchingAnalytics zero and failure states', () => {
  it('renders success:false as an error with retry', async () => {
    apiMocks.getMatchingStats.mockResolvedValueOnce({ success: false, error: backendDetail });
    render(<MatchingAnalytics />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load matching analytics');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText(backendDetail)).not.toBeInTheDocument();
  });

  it('renders a valid all-zero payload as numeric zeroes rather than an empty state', async () => {
    render(<MatchingAnalytics />);

    expect(await screen.findByText('Matches on record now')).toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    expect(screen.queryByText('No matching data yet')).not.toBeInTheDocument();
    expect(screen.getByText('No score data')).toBeInTheDocument();
    expect(screen.getByText('No distance data')).toBeInTheDocument();
  });

  it('renders Laravel analytics aliases and marks omitted metrics as unknown', async () => {
    apiMocks.getMatchingStats.mockResolvedValueOnce({ success: true, data: laravelStats });
    render(<MatchingAnalytics />);

    expect(await screen.findByText('81.5%')).toBeInTheDocument();
    expect(screen.getAllByText('---').length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('names every score and distance bucket by the key the server sends', async () => {
    apiMocks.getMatchingStats.mockResolvedValueOnce({ success: true, data: liveStats });
    render(<MatchingAnalytics />);

    expect(await screen.findByText('40 to 60')).toBeInTheDocument();
    for (const label of [
      '0 to 20', '20 to 40', '60 to 80', '80 to 100',
      '0 to 5 km', '5 to 15 km', '15 to 30 km', '30 to 50 km', 'Over 50 km',
      'No distance (remote or no location)',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // Every bar used to read "Other score range" / "Other distance band".
    expect(screen.queryByText('Other score range')).not.toBeInTheDocument();
    expect(screen.queryByText('Other distance band')).not.toBeInTheDocument();
  });

  it('names the reasons members can really give for dismissing a match', async () => {
    apiMocks.getMatchingStats.mockResolvedValueOnce({ success: true, data: liveStats });
    render(<MatchingAnalytics />);

    expect(await screen.findByText('Not relevant')).toBeInTheDocument();
    expect(screen.getByText('Already done')).toBeInTheDocument();
    expect(screen.getByText('Not my skills')).toBeInTheDocument();
    expect(screen.getByText('Too far away')).toBeInTheDocument();
    expect(screen.queryByText('Other reason')).not.toBeInTheDocument();
  });

  it('shows real counts, a labelled total and a distance with its unit, and no broker-approval row', async () => {
    apiMocks.getMatchingStats.mockResolvedValueOnce({ success: true, data: liveStats });
    render(<MatchingAnalytics />);

    expect(await screen.findByText('Matches on record now')).toBeInTheDocument();
    expect(screen.getByText('Members with matches')).toBeInTheDocument();
    expect(screen.getByText(/^12\.5\s?km$/)).toBeInTheDocument();
    // Today, this week and mutual are numbers now, not "---".
    expect(screen.queryByText('---')).not.toBeInTheDocument();
    expect(screen.queryByText('Broker Approval')).not.toBeInTheDocument();
    expect(screen.queryByText('Total Matches')).not.toBeInTheDocument();
    expect(screen.queryByText('Cache Entries')).not.toBeInTheDocument();
  });
});

describe('SmartMatchingOverview shows what is real', () => {
  it('shows the matches waiting for a coordinator instead of a broker-approval setting', async () => {
    apiMocks.getMatchingStats.mockResolvedValueOnce({ success: true, data: liveStats });
    render(<SmartMatchingOverview />);

    const tile = (await screen.findByText('Pending Approvals')).parentElement as HTMLElement;
    expect(tile).toHaveTextContent('4');
    // The same count, under the same name, on the tile and in the activity grid.
    expect(screen.getAllByText('Members with matches')).toHaveLength(2);
    expect(screen.queryByText('Broker Approval')).not.toBeInTheDocument();
    expect(screen.queryByText('Active Matches')).not.toBeInTheDocument();
    expect(screen.queryByText('Enabled')).not.toBeInTheDocument();
  });

  it('shows the three scoring weights on the current scoring method', async () => {
    apiMocks.getConfig.mockResolvedValueOnce({
      success: true,
      data: { ...validConfig, engine_version: 2, pillars: { relevance: 0.5, feasibility: 0.3, trust: 0.2 } },
    });
    render(<SmartMatchingOverview />);

    expect(await screen.findByText('Scoring weights')).toBeInTheDocument();
    expect(screen.getAllByText('Relevance').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Feasibility').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Trust').length).toBeGreaterThan(0);
    // The six older weights do not drive scoring here, so they are not shown.
    expect(screen.queryByText('Skill')).not.toBeInTheDocument();
    expect(screen.queryByText('Reciprocity')).not.toBeInTheDocument();
  });

  it('shows the six older weights only when the community is on the older scoring method', async () => {
    apiMocks.getConfig.mockResolvedValueOnce({ success: true, data: { ...validConfig, engine_version: 1 } });
    render(<SmartMatchingOverview />);

    expect(await screen.findByText('Scoring weights')).toBeInTheDocument();
    expect(screen.getAllByText('Skill').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Reciprocity').length).toBeGreaterThan(0);
    expect(screen.queryByText('Feasibility')).not.toBeInTheDocument();
  });
});
