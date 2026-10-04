// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/contexts', () => createMockContexts());

import { JurisdictionNotice } from './JurisdictionNotice';

// The jurisdiction is set in the Compliance & Safeguarding card of the broker
// Configuration page (Oct 2026). Until then this pointed at the Vetting page.
const CONFIGURATION_PATH = '/test/broker/configuration';
const CONFIGURATION_CARD = '#config-section-compliance_safeguarding';

describe('JurisdictionNotice', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/test/broker/members');
  });

  it('tells an admin where the setting is and takes them to that card', async () => {
    const user = userEvent.setup();
    render(<JurisdictionNotice canSet />);

    expect(screen.getByText('Safeguarding jurisdiction not set')).toBeInTheDocument();
    expect(screen.getByText(/you can set it on the Configuration page/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Set the jurisdiction/ }));
    expect(window.location.pathname).toBe(CONFIGURATION_PATH);
    expect(window.location.hash).toBe(CONFIGURATION_CARD);
  });

  it('drops the button when the admin is already on the Configuration page', () => {
    window.history.replaceState({}, '', CONFIGURATION_PATH);
    render(<JurisdictionNotice canSet />);

    expect(screen.getByText('Safeguarding jurisdiction not set')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Set the jurisdiction/ })).toBeNull();
  });

  it('tells everyone else to ask an admin, with no button', () => {
    render(<JurisdictionNotice canSet={false} />);

    expect(screen.getByText(/Please ask an admin in your community to set it/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Set the jurisdiction/ })).toBeNull();
  });
});
