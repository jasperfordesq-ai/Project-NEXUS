// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const mockGet = vi.fn();
let mockUserId = 7;

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenantPath: (p: string) => `/c${p}` }),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: mockUserId } }),
}));
vi.mock('@/components/feedback/LoadingScreen', () => ({
  LoadingScreen: () => <p>Loading</p>,
}));
vi.mock('@/lib/api', () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
}));

import { EmailLinkRedirect, MarketplaceOrderLinkRedirect } from './EmailLinkRedirects';

function Landed() {
  const location = useLocation();
  return <p data-testid="landed">{location.pathname + location.search + location.hash}</p>;
}

function renderAt(entry: string, routePath: string, element: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path={routePath} element={element} />
        <Route path="*" element={<Landed />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EmailLinkRedirect — old email link shapes', () => {
  it('forwards /marketplace/listings/{id} to the listing page', async () => {
    renderAt('/marketplace/listings/42', '/marketplace/listings/:id', <EmailLinkRedirect target="/marketplace/:id" />);
    expect((await screen.findByTestId('landed')).textContent).toBe('/c/marketplace/42');
  });

  it('turns /settings/safeguarding into the settings tab, keeping the link query', async () => {
    renderAt('/settings/safeguarding?from=email#top', '/settings/safeguarding', <EmailLinkRedirect target="/settings?tab=safeguarding" />);
    expect((await screen.findByTestId('landed')).textContent).toBe('/c/settings?tab=safeguarding&from=email#top');
  });

  it('can drop the query when the target page would not understand it', async () => {
    renderAt('/polls/6?x=1', '/polls/:id', <EmailLinkRedirect target="/polls" keepQuery={false} />);
    expect((await screen.findByTestId('landed')).textContent).toBe('/c/polls');
  });
});

describe('MarketplaceOrderLinkRedirect — /marketplace/orders/{id}', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockUserId = 7;
  });

  it('sends the seller to their sales', async () => {
    mockGet.mockResolvedValue({ success: true, data: { seller: { id: 7 }, buyer: { id: 9 } } });
    renderAt('/marketplace/orders/19', '/marketplace/orders/:id', <MarketplaceOrderLinkRedirect />);
    expect((await screen.findByTestId('landed')).textContent).toBe('/c/marketplace/orders/sales');
    expect(mockGet).toHaveBeenCalledWith('/v2/marketplace/orders/19');
  });

  it('sends the buyer to their purchases', async () => {
    mockGet.mockResolvedValue({ success: true, data: { seller: { id: 3 }, buyer: { id: 7 } } });
    renderAt('/marketplace/orders/19', '/marketplace/orders/:id', <MarketplaceOrderLinkRedirect />);
    expect((await screen.findByTestId('landed')).textContent).toBe('/c/marketplace/orders');
  });

  it('falls back to purchases when the order cannot be read', async () => {
    mockGet.mockResolvedValue({ success: false, error: 'not found' });
    renderAt('/marketplace/orders/19', '/marketplace/orders/:id', <MarketplaceOrderLinkRedirect />);
    expect((await screen.findByTestId('landed')).textContent).toBe('/c/marketplace/orders');
  });

  it('does not ask the server about an id that is not a number', async () => {
    renderAt('/marketplace/orders/abc', '/marketplace/orders/:id', <MarketplaceOrderLinkRedirect />);
    expect((await screen.findByTestId('landed')).textContent).toBe('/c/marketplace/orders');
    expect(mockGet).not.toHaveBeenCalled();
  });
});
