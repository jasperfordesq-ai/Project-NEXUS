// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The Broker Panel's guide renders the Help Centre's broker articles (real
 * registry, real English text) inside the panel.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { render, screen, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/contexts', () => createMockContexts());
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

import BrokerHelpPage, { BrokerControlsHelp } from './BrokerHelpPage';

function renderAt(path: string) {
  window.history.pushState({}, '', path);
  return render(
    <Routes>
      <Route path="/broker/help" element={<BrokerHelpPage />} />
      <Route path="/broker/help/:sectionId/:articleId" element={<BrokerHelpPage />} />
    </Routes>,
  );
}

describe('BrokerControlsHelp (dashboard card)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('links to the most-needed broker guides and to the full guide', () => {
    render(<BrokerControlsHelp />);
    expect(screen.getByRole('heading', { name: 'Broker and coordinator guide' })).toBeInTheDocument();
    const guideLinks = screen.getAllByRole('link').filter((link) => link.getAttribute('href')?.startsWith('/test/broker/help/'));
    expect(guideLinks.length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Open the full guide' })).toHaveAttribute('href', '/test/broker/help');
  });
});

describe('BrokerHelpPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists every broker topic with its guides', () => {
    renderAt('/broker/help');
    expect(screen.getByRole('heading', { name: 'Workshops and group activities' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Using a Community Pot account for workshops/ }))
      .toHaveAttribute('href', '/test/broker/help/broker_group_activities/broker_community_pot');
  });

  it('searches the broker guides only', () => {
    renderAt('/broker/help');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search the Help Centre' }), { target: { value: 'community pot' } });
    expect(screen.getByRole('link', { name: /Using a Community Pot account for workshops/ })).toBeInTheDocument();
    // The member version of the same topic lives in the member guide, not here.
    expect(screen.queryByRole('link', { name: /Recording hours for a workshop or group activity/ })).not.toBeInTheDocument();
  });

  it('shows an article inside the panel, with a way back', () => {
    renderAt('/broker/help/broker_group_activities/broker_community_pot');
    expect(screen.getByRole('heading', { name: 'Using a Community Pot account for workshops' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /All broker guides/ })).toHaveAttribute('href', '/test/broker/help');
    expect(screen.getByRole('link', { name: /Open in the Help Centre/ }))
      .toHaveAttribute('href', '/test/help/brokers/broker_group_activities/broker_community_pot');
  });

  it('handles a guide that does not exist', () => {
    renderAt('/broker/help/broker_group_activities/nope');
    expect(screen.getByText("We couldn't find that guide")).toBeInTheDocument();
  });
});
