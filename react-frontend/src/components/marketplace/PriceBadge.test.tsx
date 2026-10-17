// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/contexts', () => createMockContexts());

import { PriceBadge } from './PriceBadge';

describe('PriceBadge — free', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the free label chip', () => {
    render(<PriceBadge price={null} currency="EUR" priceType="free" />);
    expect(screen.getByText(/free/i)).toBeInTheDocument();
  });

  it('does not show a price amount when priceType is free', () => {
    render(<PriceBadge price={10} currency="EUR" priceType="free" />);
    // Even if a price is supplied, only the free label should appear
    expect(screen.queryByText(/10/)).not.toBeInTheDocument();
  });
});

describe('PriceBadge — lend', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the borrow chip for a lend listing', () => {
    render(<PriceBadge price={null} currency="EUR" priceType="lend" />);
    expect(screen.getByText(/borrow/i)).toBeInTheDocument();
  });

  it('never shows a price amount for a lend listing, even if one is supplied', () => {
    render(<PriceBadge price={10} currency="EUR" priceType="lend" />);
    expect(screen.queryByText(/10/)).not.toBeInTheDocument();
    expect(screen.queryByText(/free/i)).not.toBeInTheDocument();
  });

  it('renders the borrow chip in overlay mode', () => {
    render(<PriceBadge price={null} currency="EUR" priceType="lend" isOverlay />);
    expect(screen.getByText(/borrow/i)).toBeInTheDocument();
  });
});

describe('PriceBadge — contact', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the contact chip', () => {
    render(<PriceBadge price={null} currency="EUR" priceType="contact" />);
    expect(screen.getByText(/contact/i)).toBeInTheDocument();
  });
});

describe('PriceBadge — null price with non-special type', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing (no visible content) when price is null and priceType is fixed', () => {
    // The ToastProvider wrapper always renders a toast-container div, so container.firstChild
    // is never null. We instead confirm no meaningful text or price is in the document.
    render(<PriceBadge price={null} currency="EUR" priceType="fixed" />);
    expect(screen.queryByText(/free/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/contact/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/negotiable/i)).not.toBeInTheDocument();
    // No number rendered
    expect(screen.queryByText(/\d/)).not.toBeInTheDocument();
  });
});

describe('PriceBadge — negotiable', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows formatted price and negotiable chip together', () => {
    render(<PriceBadge price={50} currency="USD" priceType="negotiable" />);
    // The negotiable chip
    expect(screen.getByText(/negotiable/i)).toBeInTheDocument();
    // Some rendered dollar amount (exact locale string varies; just assert the number appears)
    expect(screen.getByText(/50/)).toBeInTheDocument();
  });

  it('shows time-credit suffix when timeCreditPrice > 0', () => {
    render(<PriceBadge price={30} currency="USD" priceType="negotiable" timeCreditPrice={5} />);
    expect(screen.getByText(/5 TC/)).toBeInTheDocument();
  });

  it('omits TC suffix when timeCreditPrice is null', () => {
    render(<PriceBadge price={30} currency="USD" priceType="negotiable" timeCreditPrice={null} />);
    expect(screen.queryByText(/TC/)).not.toBeInTheDocument();
  });

  it('omits TC suffix when timeCreditPrice is 0', () => {
    render(<PriceBadge price={30} currency="USD" priceType="negotiable" timeCreditPrice={0} />);
    expect(screen.queryByText(/TC/)).not.toBeInTheDocument();
  });
});

describe('PriceBadge — fixed / auction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders formatted price for fixed priceType', () => {
    render(<PriceBadge price={99} currency="USD" priceType="fixed" />);
    expect(screen.getByText(/99/)).toBeInTheDocument();
  });

  it('renders formatted price for auction priceType', () => {
    render(<PriceBadge price={200} currency="EUR" priceType="auction" />);
    expect(screen.getByText(/200/)).toBeInTheDocument();
  });

  it('does not render a negotiable chip for fixed type', () => {
    render(<PriceBadge price={45} currency="USD" priceType="fixed" />);
    expect(screen.queryByText(/negotiable/i)).not.toBeInTheDocument();
  });

  it('appends TC suffix when timeCreditPrice > 0', () => {
    render(<PriceBadge price={100} currency="USD" priceType="fixed" timeCreditPrice={3} />);
    expect(screen.getByText(/3 TC/)).toBeInTheDocument();
  });

  it('falls back to "CURRENCY PRICE" for an unrecognised currency code', () => {
    // Intl.NumberFormat will throw for a bad code; the component catches it
    render(<PriceBadge price={10} currency="XYZ" priceType="fixed" />);
    // Fallback format: "XYZ 10"
    expect(screen.getByText(/XYZ 10/)).toBeInTheDocument();
  });
});

describe('PriceBadge — overlay mode', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders in overlay mode without crashing (fixed type)', () => {
    render(<PriceBadge price={25} currency="USD" priceType="fixed" isOverlay />);
    expect(screen.getByText(/25/)).toBeInTheDocument();
  });

  it('renders free chip in overlay mode', () => {
    render(<PriceBadge price={null} currency="USD" priceType="free" isOverlay />);
    expect(screen.getByText(/free/i)).toBeInTheDocument();
  });
});
