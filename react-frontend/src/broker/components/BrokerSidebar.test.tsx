// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Mock contexts ───────────────────────────────────────────────────────────
const mockOnToggle = vi.fn();

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, role: 'admin', is_admin: true },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Default badge counts ─────────────────────────────────────────────────────
const ZERO_BADGES = {
  pending_members: 0,
  safeguarding_alerts: 0,
  vetting_review_requests: 0,
  pending_exchanges: 0,
  unreviewed_messages: 0,
  monitored_users: 0,
  high_risk_listings: 0,
  pending_matches: 0,
  support_needs_unseen: 0,
  pending_support_actions: 0,
  open_reports: 0,
  insurance_attention: 0,
};

const WITH_BADGES = {
  pending_members: 3,
  safeguarding_alerts: 1,
  vetting_review_requests: 7,
  pending_exchanges: 5,
  unreviewed_messages: 2,
  monitored_users: 0,
  high_risk_listings: 0,
  pending_matches: 0,
  support_needs_unseen: 0,
  pending_support_actions: 0,
  open_reports: 0,
  insurance_attention: 0,
};

import { BrokerSidebar } from './BrokerSidebar';

describe('BrokerSidebar — expanded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the sidebar navigation landmark', () => {
    render(<BrokerSidebar collapsed={false} onToggle={mockOnToggle} badges={ZERO_BADGES} />);
    // i18n: broker.sidebar.nav_label → "Broker navigation"
    expect(screen.getByRole('navigation', { name: /Broker navigation/i })).toBeInTheDocument();
  });

  it('renders section labels when expanded', () => {
    render(<BrokerSidebar collapsed={false} onToggle={mockOnToggle} badges={ZERO_BADGES} />);
    // i18n: broker.sidebar.section_daily → "Daily Workflow"
    expect(screen.getByText('Daily Workflow')).toBeInTheDocument();
    // i18n: broker.sidebar.section_compliance → "Compliance & Oversight"
    expect(screen.getByText('Compliance & Oversight')).toBeInTheDocument();
  });

  it('renders nav links for key routes', () => {
    render(<BrokerSidebar collapsed={false} onToggle={mockOnToggle} badges={ZERO_BADGES} />);
    // i18n: broker.nav.members → "Members"
    expect(screen.getByRole('link', { name: /^Members$/i })).toBeInTheDocument();
    // i18n: broker.nav.exchanges → "Exchanges"
    expect(screen.getByRole('link', { name: /Exchanges/i })).toBeInTheDocument();
    // Safeguarding is a section of its own pages (was one page with four tabs).
    expect(screen.getByText('Safeguarding')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Members' support needs/i })).toHaveAttribute('href', '/test/broker/safeguarding/support-needs');
    // Flagged messages are the Messages queue's "Urgent" view, not a second page.
    expect(screen.queryByRole('link', { name: /Flagged messages/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Guardians$/i })).toHaveAttribute('href', '/test/broker/safeguarding/guardians');
    expect(screen.getByRole('link', { name: /Support actions/i })).toHaveAttribute('href', '/test/broker/safeguarding/support-actions');
    expect(screen.getByRole('link', { name: /Volunteering incidents/i })).toHaveAttribute('href', '/test/broker/safeguarding/volunteering');
  });

  it('counts unseen support needs and waiting support actions on their own links', () => {
    render(
      <BrokerSidebar
        collapsed={false}
        onToggle={mockOnToggle}
        badges={{ ...ZERO_BADGES, support_needs_unseen: 4, pending_support_actions: 6 }}
      />,
    );
    expect(screen.getByRole('link', { name: /Members' support needs/i })).toHaveTextContent('4');
    expect(screen.getByRole('link', { name: /Support actions/i })).toHaveTextContent('6');
  });

  it('renders the Full Admin link for admin users', () => {
    render(<BrokerSidebar collapsed={false} onToggle={mockOnToggle} badges={ZERO_BADGES} />);
    // i18n: broker.sidebar.full_admin → "Full Admin Panel"
    expect(screen.getByRole('link', { name: /Full Admin Panel/i })).toBeInTheDocument();
  });

  it('shows badge counts in chips for non-zero badges', () => {
    render(<BrokerSidebar collapsed={false} onToggle={mockOnToggle} badges={WITH_BADGES} />);
    expect(screen.getByText('3')).toBeInTheDocument(); // pending_members
    expect(screen.getByText('5')).toBeInTheDocument(); // pending_exchanges
    expect(screen.getByText('2')).toBeInTheDocument(); // unreviewed_messages
    expect(screen.getByText('7')).toBeInTheDocument(); // vetting_review_requests
  });

  it('does not show badge chips when all badge counts are zero', () => {
    render(<BrokerSidebar collapsed={false} onToggle={mockOnToggle} badges={ZERO_BADGES} />);
    // No numeric badge chips should appear (0 values are hidden)
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('calls onToggle when the collapse button is pressed', async () => {
    const user = userEvent.setup();
    render(<BrokerSidebar collapsed={false} onToggle={mockOnToggle} badges={ZERO_BADGES} />);

    // i18n: broker.sidebar.collapse → "Collapse sidebar"
    const collapseBtn = screen.getByRole('button', { name: /Collapse sidebar/i });
    await user.click(collapseBtn);

    expect(mockOnToggle).toHaveBeenCalledTimes(1);
  });

  it('shows sidebar title text when expanded', () => {
    render(<BrokerSidebar collapsed={false} onToggle={mockOnToggle} badges={ZERO_BADGES} />);
    // i18n: broker.sidebar.title → "Broker Panel"
    expect(screen.getByText('Broker Panel')).toBeInTheDocument();
  });
});

describe('BrokerSidebar — collapsed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides section label text when collapsed', () => {
    render(<BrokerSidebar collapsed={true} onToggle={mockOnToggle} badges={ZERO_BADGES} />);
    // "Daily Workflow" section paragraph only renders when !collapsed
    expect(screen.queryByText('Daily Workflow')).not.toBeInTheDocument();
  });

  it('expand button has correct aria-label when collapsed', () => {
    render(<BrokerSidebar collapsed={true} onToggle={mockOnToggle} badges={ZERO_BADGES} />);
    // i18n: broker.sidebar.expand → "Expand sidebar"
    expect(screen.getByRole('button', { name: /Expand sidebar/i })).toBeInTheDocument();
  });

  it('calls onToggle when expand button is pressed', async () => {
    const user = userEvent.setup();
    render(<BrokerSidebar collapsed={true} onToggle={mockOnToggle} badges={ZERO_BADGES} />);

    const expandBtn = screen.getByRole('button', { name: /Expand sidebar/i });
    await user.click(expandBtn);

    expect(mockOnToggle).toHaveBeenCalledTimes(1);
  });

  it('shows the number on the icon in collapsed mode, not a bare dot', () => {
    render(<BrokerSidebar collapsed={true} onToggle={mockOnToggle} badges={WITH_BADGES} />);
    expect(screen.getByText('3')).toBeInTheDocument(); // pending_members
    expect(screen.getByText('7')).toBeInTheDocument(); // vetting_review_requests
    expect(screen.getByText('3').closest('[data-tone]')).toHaveAttribute('data-tone', 'queue');
  });

  it('caps the collapsed number at 99+', () => {
    render(<BrokerSidebar collapsed={true} onToggle={mockOnToggle} badges={{ ...ZERO_BADGES, unreviewed_messages: 250 }} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('does not render sidebar title text when collapsed', () => {
    render(<BrokerSidebar collapsed={true} onToggle={mockOnToggle} badges={ZERO_BADGES} />);
    // "Broker Panel" title span only renders when !collapsed
    expect(screen.queryByText('Broker Panel')).not.toBeInTheDocument();
  });
});

describe('BrokerSidebar — badge tone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('colours a queue that should fall to zero as danger', () => {
    render(<BrokerSidebar collapsed={false} onToggle={mockOnToggle} badges={{ ...ZERO_BADGES, unreviewed_messages: 2 }} />);
    const link = screen.getByRole('link', { name: /^Messages/i });
    expect(within(link).getByText('2').closest('[data-tone]')).toHaveAttribute('data-tone', 'queue');
  });

  it('colours an inventory count that never falls as neutral', () => {
    render(<BrokerSidebar collapsed={false} onToggle={mockOnToggle} badges={{ ...ZERO_BADGES, monitored_users: 4, high_risk_listings: 9 }} />);
    const monitoring = screen.getByRole('link', { name: /User Monitoring/i });
    expect(within(monitoring).getByText('4').closest('[data-tone]')).toHaveAttribute('data-tone', 'inventory');
    const risk = screen.getByRole('link', { name: /Risk Tags/i });
    expect(within(risk).getByText('9').closest('[data-tone]')).toHaveAttribute('data-tone', 'inventory');
  });

  it('counts insurance needing attention on the Insurance link as a warning', () => {
    render(<BrokerSidebar collapsed={false} onToggle={mockOnToggle} badges={{ ...ZERO_BADGES, insurance_attention: 5 }} />);
    const insurance = screen.getByRole('link', { name: /^Insurance/i });
    expect(within(insurance).getByText('5').closest('[data-tone]')).toHaveAttribute('data-tone', 'attention');
  });
});

describe('BrokerSidebar — distinct icons', () => {
  it('gives Guardians a different icon from Members', () => {
    render(<BrokerSidebar collapsed={false} onToggle={mockOnToggle} badges={ZERO_BADGES} />);
    expect(screen.getByRole('link', { name: /^Members$/i }).querySelector('svg.lucide-users')).not.toBeNull();
    expect(screen.getByRole('link', { name: /^Guardians$/i }).querySelector('svg.lucide-user-round-check')).not.toBeNull();
    expect(screen.getByRole('link', { name: /^Guardians$/i }).querySelector('svg.lucide-users')).toBeNull();
  });

  it('gives Configuration a different icon from Safeguarding Options', () => {
    render(<BrokerSidebar collapsed={false} onToggle={mockOnToggle} badges={ZERO_BADGES} />);
    expect(screen.getByRole('link', { name: /Safeguarding Options/i }).querySelector('svg.lucide-sliders-horizontal')).not.toBeNull();
    const configuration = screen.getByRole('link', { name: /^Configuration$/i });
    expect(configuration.querySelector('svg[class*="lucide-settings"]')).not.toBeNull();
    expect(configuration.querySelector('svg.lucide-sliders-horizontal')).toBeNull();
  });
});

describe('BrokerSidebar — badge capping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows "99+" when badge count exceeds 99', () => {
    const bigBadges = { ...ZERO_BADGES, pending_members: 150 };
    render(<BrokerSidebar collapsed={false} onToggle={mockOnToggle} badges={bigBadges} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });
});
