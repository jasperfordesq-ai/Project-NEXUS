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
  proximity_bands: [{ distance_km: 5, score: 1 }],
  enabled: true,
  broker_approval_enabled: true,
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
    cache_hit_rate: 0,
    active_users_matching: 0,
  },
  score_distribution: {},
  distance_distribution: {},
  broker_approval_enabled: false,
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
    { range: '21-40', count: 5 },
  ],
  distance_distribution: [
    { range: '0-5km', count: 4 },
    { range: '5-15km', count: 3 },
  ],
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
    expect(parsed?.overview.cache_hit_rate).toBeUndefined();
    expect(parsed?.score_distribution).toEqual({ '0-20': 2, '21-40': 5 });
    expect(parsed?.distance_distribution).toEqual({ '0-5km': 4, '5-15km': 3 });
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
    expect(screen.queryByText('Algorithm Weights')).not.toBeInTheDocument();
    expect(screen.queryByText(backendDetail)).not.toBeInTheDocument();
    expect(apiMocks.updateConfig).not.toHaveBeenCalled();
  });

  it('retries the initial failure and only then mounts the confirmed form', async () => {
    apiMocks.getConfig
      .mockResolvedValueOnce({ success: false, error: backendDetail })
      .mockResolvedValueOnce({ success: true, data: validConfig });
    render(<MatchingConfig />);

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Algorithm Weights')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('retains confirmed configuration but disables save after a failed refresh', async () => {
    apiMocks.getConfig
      .mockResolvedValueOnce({ success: true, data: validConfig })
      .mockResolvedValueOnce({ success: false, error: backendDetail });
    render(<MatchingConfig />);

    expect(await screen.findByText('Algorithm Weights')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load matching configuration');
    expect(screen.getByText('Algorithm Weights')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  });
});

describe('SmartMatchingOverview partial load safety', () => {
  it('surfaces a failed stats envelope without claiming broker approval is disabled', async () => {
    apiMocks.getMatchingStats.mockResolvedValueOnce({ success: false, error: backendDetail });
    render(<SmartMatchingOverview />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load matching analytics');
    expect(screen.queryByText(backendDetail)).not.toBeInTheDocument();
    expect(screen.queryByText('Disabled')).not.toBeInTheDocument();
    expect(screen.getByText('Algorithm Weights')).toBeInTheDocument();
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

    expect(await screen.findByText('Total Matches')).toBeInTheDocument();
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
});
