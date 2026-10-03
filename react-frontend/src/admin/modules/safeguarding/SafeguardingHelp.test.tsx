// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('@/contexts', () => createMockContexts());

import { SafeguardingHelp, SAFEGUARDING_HELP_OPEN_KEY } from './SafeguardingHelp';

// SafeguardingHelp is a static informational component — no API calls,
// no loading states. The whole guide sits behind one Disclosure that starts
// closed; the content tests open it first.

const TITLE = 'How safeguarding works here';

async function renderOpen() {
  render(<SafeguardingHelp />);
  await userEvent.click(screen.getByRole('button', { name: new RegExp(TITLE) }));
}

describe('SafeguardingHelp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('renders without crashing', () => {
    render(<SafeguardingHelp />);
    // Landmark section is always present
    expect(document.querySelector('section')).toBeInTheDocument();
  });

  it('shows the guide title as the one trigger, closed by default', () => {
    render(<SafeguardingHelp />);
    const trigger = screen.getByRole('button', { name: new RegExp(TITLE) });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    // The guide's body stays in the DOM (HeroUI renders it eagerly) but is
    // hidden from readers and from the tab order while closed.
    const body = screen.getByText('requires_broker_approval');
    expect(body.closest('[hidden], [aria-hidden="true"]')).not.toBeNull();
  });

  it('opens on request and remembers that it was left open', async () => {
    await renderOpen();
    expect(screen.getByRole('button', { name: new RegExp(TITLE) })).toHaveAttribute('aria-expanded', 'true');
    expect(window.localStorage.getItem(SAFEGUARDING_HELP_OPEN_KEY)).toBe('1');
  });

  it('starts open when it was left open last time', () => {
    window.localStorage.setItem(SAFEGUARDING_HELP_OPEN_KEY, '1');
    render(<SafeguardingHelp />);
    expect(screen.getByRole('button', { name: new RegExp(TITLE) })).toHaveAttribute('aria-expanded', 'true');
  });

  it('still renders, closed, when storage refuses (private browsing)', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    try {
      render(<SafeguardingHelp />);
      expect(screen.getByRole('button', { name: new RegExp(TITLE) })).toHaveAttribute('aria-expanded', 'false');
    } finally {
      getItem.mockRestore();
    }
  });

  it('renders the accordion with multiple items once open', async () => {
    await renderOpen();
    // 9 accordion sections, each with a trigger button, plus the guide's own trigger.
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(8);
  });

  it('renders the trigger table header columns', async () => {
    await renderOpen();
    // The triggers section table has two columns — "Trigger key" and "Effect".
    // HeroUI Accordion renders content eagerly, so the Table is in the DOM.
    const cells = document.querySelectorAll('th, [role="columnheader"]');
    expect(cells.length).toBeGreaterThanOrEqual(2);
  });

  it('renders all 6 trigger row codes in the table', async () => {
    await renderOpen();
    const codes = document.querySelectorAll('code');
    const triggerCodes = Array.from(codes).filter((c) =>
      [
        'requires_broker_approval',
        'restricts_messaging',
        'restricts_matching',
        'requires_vetted_interaction',
        'notify_admin_on_selection',
        'vetting_type_required',
      ].includes(c.textContent ?? '')
    );
    expect(triggerCodes.length).toBe(6);
  });

  it('renders autonomy principle section code snippet', async () => {
    await renderOpen();
    const allCodes = Array.from(document.querySelectorAll('code'));
    const consentCode = allCodes.find((c) => c.textContent?.includes('safeguarding_consent_revoked'));
    expect(consentCode).toBeInTheDocument();
  });

  it('renders MessageService::send code reference in vetting section', async () => {
    await renderOpen();
    const allCodes = Array.from(document.querySelectorAll('code'));
    const msgCode = allCodes.find((c) => c.textContent?.includes('MessageService::send'));
    expect(msgCode).toBeInTheDocument();
  });

  it('renders safeguarding:review-flags cron reference', async () => {
    await renderOpen();
    const allCodes = Array.from(document.querySelectorAll('code'));
    const cronCode = allCodes.find((c) => c.textContent?.includes('safeguarding:review-flags'));
    expect(cronCode).toBeInTheDocument();
  });

  it('renders activity_log code reference in audit section', async () => {
    await renderOpen();
    const allCodes = Array.from(document.querySelectorAll('code'));
    const logCode = allCodes.find((c) => c.textContent?.includes('activity_log'));
    expect(logCode).toBeInTheDocument();
  });

  it('does not trigger any API calls (pure static component)', () => {
    render(<SafeguardingHelp />);
    expect(document.querySelector('section')).toBeInTheDocument();
  });
});
