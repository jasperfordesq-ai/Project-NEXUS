// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { get: apiGet } }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/contexts', () => ({ useTenant: () => ({ tenantPath: (p: string) => `/test${p}` }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const values = options
        ? Object.entries(options)
            .map(([k, v]) => `${k}=${String(v)}`)
            .join(',')
        : '';
      return values ? `${key}|${values}` : key;
    },
    i18n: { language: 'en' },
  }),
}));

import { AssuranceFactsPage, type AssuranceFacts } from './AssuranceFactsPage';

const facts = (over: Partial<Record<string, Record<string, unknown>>> = {}): AssuranceFacts => ({
  generated_at: '2026-11-16T10:00:00+00:00',
  facts: [
    { key: 'release', available: true, version: '3.2.0', commit_short: 'abc123def456', deployed_at: '2026-11-15T11:10:00+00:00', ...over.release },
    { key: 'two_step', available: true, senior_accounts: 9, with_two_step: 7, truncated: false, ...over.two_step },
    { key: 'access_review', available: true, last_review_at: '2026-10-01T09:00:00+00:00', due: false, ...over.access_review },
    { key: 'backup', available: true, state: 'healthy', newest_at: '2026-11-16T03:00:00+00:00', checked_at: '2026-11-16T06:00:00+00:00', ...over.backup },
    { key: 'data_requests', available: true, open: 4, overdue: 1, ...over.data_requests },
    { key: 'failed_sign_ins', available: true, counted_since: '2026-11-16T09:00:00+00:00', ...over.failed_sign_ins },
    { key: 'independent_test', available: true, date: '2020-01-15', ...over.independent_test },
  ] as AssuranceFacts['facts'],
});

const show = () =>
  render(
    <MemoryRouter>
      <AssuranceFactsPage />
    </MemoryRouter>,
  );

describe('AssuranceFactsPage', () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  it('asks the platform team request and says first what the page is', async () => {
    apiGet.mockResolvedValue({ success: true, data: facts() });
    show();

    expect(await screen.findByTestId('assurance-fact-release')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/v2/platform-team/assurance');
    expect(screen.getByText('assurance.intro')).toBeInTheDocument();
    expect(screen.getByText('assurance.findings_note')).toBeInTheDocument();
    expect(screen.getByText('assurance.test_scope_note')).toBeInTheDocument();
  });

  it('shows each fact in words with where it comes from', async () => {
    apiGet.mockResolvedValue({ success: true, data: facts() });
    show();

    const release = await screen.findByTestId('assurance-fact-release');
    expect(within(release).getByText('assurance.release.version|version=3.2.0')).toBeInTheDocument();
    expect(within(release).getByText('assurance.release.commit|code=abc123def456')).toBeInTheDocument();
    expect(within(release).getByRole('link', { name: 'home.title' })).toHaveAttribute('href', '/test/platform-team');

    const twoStep = screen.getByTestId('assurance-fact-two_step');
    expect(within(twoStep).getByText('assurance.two_step.value|with=7,total=9')).toBeInTheDocument();
    expect(within(twoStep).getByRole('link', { name: 'senior_accounts.title' })).toHaveAttribute('href', '/test/platform-team/senior-accounts');

    const review = screen.getByTestId('assurance-fact-access_review');
    expect(within(review).getByText('assurance.access_review.not_due')).toBeInTheDocument();
    expect(within(review).getByRole('link', { name: 'access_review.title' })).toHaveAttribute('href', '/test/platform-team/access-review');

    const backup = screen.getByTestId('assurance-fact-backup');
    expect(within(backup).getByText('assurance.backup.state.healthy')).toBeInTheDocument();
    expect(within(backup).getByRole('link', { name: 'home.title' })).toHaveAttribute('href', '/test/platform-team');

    const requests = screen.getByTestId('assurance-fact-data_requests');
    expect(within(requests).getByText('assurance.data_requests.open|count=4')).toBeInTheDocument();
    expect(within(requests).getByText('assurance.data_requests.overdue|count=1')).toBeInTheDocument();
    expect(within(requests).getByRole('link', { name: 'data_requests.title' })).toHaveAttribute('href', '/test/platform-team/data-requests');

    const signIns = screen.getByTestId('assurance-fact-failed_sign_ins');
    expect(within(signIns).getByRole('link', { name: 'security.title' })).toHaveAttribute('href', '/test/platform-team/security');

    const independent = screen.getByTestId('assurance-fact-independent_test');
    expect(within(independent).getByText(/^assurance\.independent_test\.date\|date=/)).toBeInTheDocument();
    expect(within(independent).queryByRole('link')).not.toBeInTheDocument();
    expect(within(independent).getByText('assurance.source_owner')).toBeInTheDocument();
    // The colon belongs to the wording (French spaces it, Japanese uses its own), never added in code.
    expect(within(independent).getByText('assurance.source_label')).toBeInTheDocument();
    expect(within(independent).queryByText(/assurance\.source_label:/)).not.toBeInTheDocument();
  });

  it('says "could not be read" for a fact that could not be read, never zero', async () => {
    apiGet.mockResolvedValue({
      success: true,
      data: facts({
        two_step: { available: false, senior_accounts: null, with_two_step: null, truncated: null },
        data_requests: { available: false, open: null, overdue: null },
      }),
    });
    show();

    const twoStep = await screen.findByTestId('assurance-fact-two_step');
    expect(within(twoStep).getByText('assurance.could_not_read')).toBeInTheDocument();
    expect(within(twoStep).queryByText(/two_step\.value/)).not.toBeInTheDocument();
    const requests = screen.getByTestId('assurance-fact-data_requests');
    expect(within(requests).getByText('assurance.could_not_read')).toBeInTheDocument();
    expect(within(requests).queryByText(/count=0/)).not.toBeInTheDocument();
    // The others still show.
    expect(within(screen.getByTestId('assurance-fact-release')).queryByText('assurance.could_not_read')).not.toBeInTheDocument();
  });

  it('says the backup check has no recent result when it is not available', async () => {
    apiGet.mockResolvedValue({ success: true, data: facts({ backup: { available: false, state: null, newest_at: null, checked_at: null } }) });
    show();

    const backup = await screen.findByTestId('assurance-fact-backup');
    expect(within(backup).getByText('assurance.backup.not_available')).toBeInTheDocument();
    expect(within(backup).queryByText(/backup\.state\./)).not.toBeInTheDocument();
  });

  it('says plainly when nothing has been counted, no test date is recorded, and no review exists', async () => {
    apiGet.mockResolvedValue({
      success: true,
      data: facts({
        failed_sign_ins: { counted_since: null },
        independent_test: { date: null },
        access_review: { last_review_at: null, due: true },
      }),
    });
    show();

    expect(within(await screen.findByTestId('assurance-fact-failed_sign_ins')).getByText('assurance.failed_sign_ins.none')).toBeInTheDocument();
    expect(within(screen.getByTestId('assurance-fact-independent_test')).getByText('assurance.independent_test.none')).toBeInTheDocument();
    const review = screen.getByTestId('assurance-fact-access_review');
    expect(within(review).getByText('assurance.access_review.never')).toBeInTheDocument();
    expect(within(review).getByText('assurance.access_review.due')).toBeInTheDocument();
  });

  it('offers a retry when the facts could not be loaded, and nothing to export', async () => {
    apiGet.mockRejectedValueOnce(new Error('down')).mockResolvedValue({ success: true, data: facts() });
    show();

    expect(await screen.findByText('assurance.load_error_title')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /couldnt_load_retry/ }));
    await waitFor(() => expect(screen.getByTestId('assurance-fact-release')).toBeInTheDocument());

    // No export, print, PDF or copy: the only control reloads.
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['home.refresh']);
  });

  it('claims nothing: the English wording has none of the forbidden claim-words', () => {
    const file = resolve(__dirname, '../../../public/locales/en/platform_team.json');
    const block = JSON.parse(readFileSync(file, 'utf8')).assurance as unknown;
    expect(block).toBeTruthy();
    const text = JSON.stringify(block).toLowerCase();
    for (const word of ['secure', 'safe', 'compliant', 'certified', 'protected', 'verified', 'guaranteed', 'bombproof', 'assurance level']) {
      expect(text, `the wording must not say "${word}"`).not.toMatch(new RegExp(`\\b${word}`));
    }
    expect(block).toMatchObject({
      title: 'Assurance facts',
      intro: 'Facts the platform can measure about itself today. Check each one before quoting it to anyone.',
      findings_note: 'Open security findings are kept in a private record, not on this server, and are not shown here.',
      test_scope_note: 'An independent test covers the version it tested, not changes made since.',
      independent_test: { none: 'Not recorded on this server' },
    });
  });
});
