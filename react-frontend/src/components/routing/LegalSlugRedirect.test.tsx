// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LegalSlugRedirect } from './LegalSlugRedirect';

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: vi.fn(() => ({
    tenantPath: (path: string) => `/acme${path}`,
  })),
}));

/**
 * Renders the redirect at `entry` and reports where it landed.
 *
 * 🔴 The reason this component exists: notifyUsersOfUpdate() used to emit
 * `/{slug}` in the notification bell and `/legal/{slug}` in the email for the same
 * event, each broken on the frontend the other targeted. Both now emit
 * `/legal/{slug}`, and these tests pin React's side of that.
 */
function landingFor(entry: string) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/legal/:slug" element={<LegalSlugRedirect />} />
        <Route path="/legal/:slug/versions" element={<LegalSlugRedirect suffix="/versions" />} />
        <Route path="/acme/legal" element={<div>legal hub</div>} />
        <Route path="/acme/terms" element={<div>terms page</div>} />
        <Route path="/acme/terms/versions" element={<div>terms versions</div>} />
        <Route path="/acme/privacy" element={<div>privacy page</div>} />
        <Route path="/acme/community-guidelines" element={<div>guidelines page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('LegalSlugRedirect', () => {
  it('sends /legal/terms to this app\'s own terms page', () => {
    landingFor('/legal/terms');

    expect(screen.getByText('terms page')).toBeInTheDocument();
  });

  it('sends /legal/privacy to the privacy page', () => {
    landingFor('/legal/privacy');

    expect(screen.getByText('privacy page')).toBeInTheDocument();
  });

  it('keeps the versions sub-page', () => {
    landingFor('/legal/terms/versions');

    expect(screen.getByText('terms versions')).toBeInTheDocument();
  });

  it('normalises an underscored slug', () => {
    // 🔴 legal_documents.slug falls back to the underscored document_type, and
    // links carrying `community_guidelines` have already been sent to members.
    landingFor('/legal/community_guidelines');

    expect(screen.getByText('guidelines page')).toBeInTheDocument();
  });

  it('normalises capitalisation', () => {
    landingFor('/legal/Terms');

    expect(screen.getByText('terms page')).toBeInTheDocument();
  });

  it('sends an unknown slug to the hub rather than nowhere', () => {
    // The member was sent here by a notification about a real document, so the
    // hub is a better answer than a dead end.
    landingFor('/legal/not-a-document');

    expect(screen.getByText('legal hub')).toBeInTheDocument();
  });
});
