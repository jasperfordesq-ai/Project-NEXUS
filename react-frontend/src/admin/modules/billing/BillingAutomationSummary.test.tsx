// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import { formatDateTime } from '@/lib/helpers';

const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), download: vi.fn() },
}));
vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));

vi.mock('@/contexts', () => createMockContexts({
  useTenant: () => ({
    tenant: { id: 2, name: 'Test', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  }) as never,
}));

const NEVER_RAN = { at: null, result: null, actions: 0 };

const serve = (settings: unknown, lastRun: unknown = NEVER_RAN) => {
  mockApi.get.mockImplementation((url: string) => {
    if (url === '/v2/admin/super/billing/settings') return Promise.resolve(settings);
    if (url === '/v2/admin/super/billing/standing/last-run') return Promise.resolve({ success: true, data: lastRun });
    return Promise.resolve({ success: false, error: 'unexpected' });
  });
};

const settings = (overrides: Record<string, unknown> = {}) => ({
  success: true,
  data: { automation_enabled: false, limit_warning_percent: 80, ...overrides },
});

const renderSummary = async (onWarningPercent?: (percent: number) => void) => {
  const { BillingAutomationSummary } = await import('./BillingAutomationSummary');
  render(<BillingAutomationSummary onWarningPercent={onWarningPercent} />);
};

describe('BillingAutomationSummary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    serve(settings());
  });

  it('says the checks are off, and what that means', async () => {
    await renderSummary();

    expect(await screen.findByText('Automatic checks are off. Nothing is sent and no community is paused.')).toBeInTheDocument();
    expect(screen.queryByText('Automatic checks are on.')).not.toBeInTheDocument();
  });

  it('says the checks are on', async () => {
    serve(settings({ automation_enabled: true }));
    await renderSummary();

    expect(await screen.findByText('Automatic checks are on.')).toBeInTheDocument();
  });

  it('links to the page the settings are on', async () => {
    await renderSummary();

    expect(screen.getByRole('link', { name: 'Open automatic checks' })).toHaveAttribute(
      'href',
      '/test/platform-team/billing/automatic-checks',
    );
  });

  it('says when the check last ran and how many actions it took', async () => {
    serve(settings({ automation_enabled: true }), { at: '2026-11-21T08:00:04Z', result: 'ok', actions: 3 });
    await renderSummary();

    expect(await screen.findByTestId('automation-summary-last-run')).toHaveTextContent(
      `Last ran ${formatDateTime('2026-11-21T08:00:04Z')}. Actions taken: 3.`,
    );
  });

  it('says the check has not run yet', async () => {
    await renderSummary();

    expect(await screen.findByTestId('automation-summary-last-run')).toHaveTextContent('The morning check has not run yet.');
  });

  it('warns plainly when the last run failed', async () => {
    serve(settings({ automation_enabled: true }), { at: '2026-11-21T08:00:04Z', result: 'failed', actions: 0 });
    await renderSummary();

    const line = await screen.findByTestId('automation-summary-last-run');
    expect(line).toHaveAttribute('role', 'alert');
    expect(line).toHaveTextContent('failed');
  });

  it('tells the page the saved warning percent, so the list is coloured by it', async () => {
    serve(settings({ limit_warning_percent: 70 }));
    const onWarningPercent = vi.fn();
    await renderSummary(onWarningPercent);

    await waitFor(() => expect(onWarningPercent).toHaveBeenCalledWith(70));
  });

  it('says so when the settings cannot be loaded, and still links to the page', async () => {
    serve({ success: false, error: 'nope' });
    const onWarningPercent = vi.fn();
    await renderSummary(onWarningPercent);

    expect(await screen.findByText('The settings could not be loaded.')).toBeInTheDocument();
    // Not "off": the truth is that it is not known.
    expect(screen.queryByText('Automatic checks are off. Nothing is sent and no community is paused.')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open automatic checks' })).toBeInTheDocument();
    expect(onWarningPercent).not.toHaveBeenCalled();
  });

  it('asks only for the settings and the last run, not the list of what would happen today', async () => {
    await renderSummary();
    await screen.findByTestId('automation-summary-last-run');

    expect(mockApi.get.mock.calls.map(([url]) => url).sort()).toEqual([
      '/v2/admin/super/billing/settings',
      '/v2/admin/super/billing/standing/last-run',
    ]);
  });
});
