// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * OrgWellbeingTab — on the organisation dashboard: which of the organisation's
 * volunteers said they are Low or Struggling and asked for someone to get in
 * touch, when, and when the organisation was told. Name and mood only, never
 * the note.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: Record<string, unknown>) => (opts && 'count' in opts ? `${key}:${String(opts.count)}` : key) }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('@/contexts', () => createMockContexts({}));
vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { OrgWellbeingTab } from './OrgWellbeingTab';
import { api } from '@/lib/api';
import { getFormattingLocale } from '@/lib/helpers';

const ITEM = {
  alert_id: 22,
  volunteer: { id: 12, name: 'Pat Murphy', avatar_url: null },
  mood: 1,
  checkin_at: '2026-10-20 12:05:22',
  status: 'active',
  told_at: '2026-10-20 12:05:22',
  raised_at: '2026-10-20 12:05:22',
  updated_at: '2026-10-20 12:14:17',
};

describe('OrgWellbeingTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists the volunteers who asked for someone to get in touch, with how they feel and when the organisation was told', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { organisation: { id: 3, name: 'Riverbank Trust' }, items: [ITEM] } });
    render(<OrgWellbeingTab orgId={3} />);

    expect(await screen.findByText('Pat Murphy')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/v2/volunteering/organisations/3/wellbeing');
    expect(screen.getByText('org_wellbeing.mood_struggling')).toBeInTheDocument();
    expect(screen.getByText(/org_wellbeing.told_on/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /org_wellbeing.view_profile/ })).toHaveAttribute('href', '/test/profile/12');
    expect(screen.getByRole('link', { name: /org_wellbeing.message/ })).toHaveAttribute('href', '/test/messages/12');
    expect(screen.getByText('org_wellbeing.summary:1')).toBeInTheDocument();
  });

  it('says so when nobody has asked, and when the member has no part in the organisation', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: true, data: { organisation: { id: 3, name: 'Riverbank Trust' }, items: [] } });
    const { unmount } = render(<OrgWellbeingTab orgId={3} />);
    expect(await screen.findByText('org_wellbeing.empty')).toBeInTheDocument();
    unmount();

    vi.mocked(api.get).mockResolvedValueOnce({ success: false, code: 'NOT_ORGANISATION_CONTACT' });
    render(<OrgWellbeingTab orgId={3} />);
    expect(await screen.findByText('org_wellbeing.forbidden')).toBeInTheDocument();
  });

  // Deep audit C6 (21 Oct 2026): the legacy stamp is UTC; it was read as local time.
  it.each([
    ['legacy UTC form', '2026-10-21 14:05:00'],
    ['ISO with offset', '2026-10-21T14:05:00+00:00'],
  ])('reads the check-in time as UTC (%s)', async (_label, stamp) => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { organisation: { id: 3, name: 'Riverbank Trust' }, items: [{ ...ITEM, checkin_at: stamp, told_at: stamp }] } });
    render(<OrgWellbeingTab orgId={3} />);
    await screen.findByText('Pat Murphy');
    const expected = new Date(Date.UTC(2026, 9, 21, 14, 5)).toLocaleString(getFormattingLocale(), { dateStyle: 'medium', timeStyle: 'short' });
    expect(screen.getAllByText(expected).length).toBeGreaterThanOrEqual(1);
  });

  // Deep audit C8: the summary is announced through a region that was on the page before it was filled.
  it('fills a status region that exists before the list arrives', async () => {
    let resolve: (value: unknown) => void = () => {};
    vi.mocked(api.get).mockReturnValue(new Promise((r) => { resolve = r; }) as never);
    render(<OrgWellbeingTab orgId={3} />);
    const region = screen.getByTestId('org-wellbeing-summary');
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toBeEmptyDOMElement();
    resolve({ success: true, data: { organisation: { id: 3, name: 'Riverbank Trust' }, items: [ITEM] } });
    await screen.findByText('Pat Murphy');
    expect(screen.getByTestId('org-wellbeing-summary')).toBe(region);
    expect(region).toHaveTextContent('org_wellbeing.summary:1');
  });
});
