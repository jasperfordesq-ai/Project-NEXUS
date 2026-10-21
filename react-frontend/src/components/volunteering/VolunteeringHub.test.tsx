// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@/test/test-utils';

vi.mock('@/contexts', () => ({
  useTenant: () => ({ tenantPath: (p: string) => `/test${p}` }),
}));

import { VolunteeringHub, VolunteeringUrgentBanner } from './VolunteeringHub';
import type { VolunteeringHubSummary } from './useVolunteeringHubSummary';

const NO_NUMBERS: VolunteeringHubSummary = {
  pendingApplications: null,
  pendingApplicationsCapped: false,
  approvedHours: null,
  nextShift: null,
  urgentRequests: 0,
  hasApprovedApplication: null,
};

const sections = (...keys: string[]) => keys.map((key) => ({ key, label: key }));

describe('VolunteeringHub', () => {
  it('shows nothing when the opportunities list is the only section', () => {
    render(<VolunteeringHub sections={sections('opportunities')} onSelect={vi.fn()} summary={NO_NUMBERS} />);
    expect(screen.queryByTestId('volunteering-hub')).not.toBeInTheDocument();
  });

  it('drops a card whose sections are all switched off, and lets an odd card out span the row', () => {
    render(<VolunteeringHub sections={sections('opportunities', 'applications', 'expenses')} onSelect={vi.fn()} summary={NO_NUMBERS} />);
    expect(screen.queryByRole('heading', { name: 'Make a difference together' })).not.toBeInTheDocument();
    const cards = ['Find your next role', 'My volunteering', 'Support & recognition']
      .map((name) => screen.getByRole('heading', { name }).closest('[class*="rounded-2xl"]'));
    expect(cards[2]).toHaveClass('md:col-span-2');
    expect(cards[0]).not.toHaveClass('md:col-span-2');
  });

  it('gives the support card its own description, not the safety strip’s', () => {
    render(<VolunteeringHub sections={sections('opportunities', 'expenses', 'safeguarding')} onSelect={vi.fn()} summary={NO_NUMBERS} />);
    expect(screen.getByText('Claim expenses, keep your qualifications and certificates, and look after your wellbeing.')).toBeInTheDocument();
    expect(screen.getByText('A safe, inclusive and welcoming volunteering community.')).toBeInTheDocument();
  });

  it('uses clear link names and shows live numbers beside them', () => {
    const onSelect = vi.fn();
    render(<VolunteeringHub
      sections={sections('opportunities', 'recommended', 'alerts', 'applications', 'hours')}
      onSelect={onSelect}
      summary={{ ...NO_NUMBERS, pendingApplications: 50, pendingApplicationsCapped: true, urgentRequests: 1, approvedHours: 12, nextShift: { startTime: '2099-01-01T10:00:00Z', title: 'Garden day' } }}
    />);
    const hub = within(screen.getByTestId('volunteering-hub'));
    expect(hub.getByRole('button', { name: /Recommended for you/ })).toBeInTheDocument();
    expect(hub.getByRole('button', { name: /Urgent requests/ })).toHaveTextContent('To answer: 1');
    expect(hub.getByRole('button', { name: /My applications/ })).toHaveTextContent('Waiting: 50+');
    const glance = within(hub.getByTestId('volunteering-hub-glance'));
    expect(glance.getByText(/^Next shift: .+ · Garden day$/)).toBeInTheDocument();
    expect(glance.getByText('Hours approved: 12')).toBeInTheDocument();
    fireEvent.click(hub.getByRole('button', { name: /My applications/ }));
    expect(onSelect).toHaveBeenCalledWith('applications');
  });
});

describe('VolunteeringUrgentBanner', () => {
  it('stays away when nothing is waiting', () => {
    render(<VolunteeringUrgentBanner count={0} onOpen={vi.fn()} />);
    expect(screen.queryByTestId('volunteering-urgent-banner')).not.toBeInTheDocument();
  });

  it('says how many requests are waiting and opens them', () => {
    const onOpen = vi.fn();
    render(<VolunteeringUrgentBanner count={2} onOpen={onOpen} />);
    expect(screen.getByText('Urgent requests for help: 2')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'See urgent requests' })[0]!);
    expect(onOpen).toHaveBeenCalled();
  });
});
