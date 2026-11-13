// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';

// The stand-in renders a real admin PageHeader with an action button, because
// the regression this file guards is about what happens to that header: until
// November 2026 the panel hid the duplicate title with CSS selectors keyed on
// the header's markup, and when the markup changed the selectors hid every
// action button on the panel (Refresh, New agreement, Add partner, Create key…).
const { mockAdmin } = vi.hoisted(() => ({
  mockAdmin: vi.fn(),
}));

vi.mock('@/admin/modules/federation/Partnerships', async () => {
  const { PageHeader } = await import('@/admin/components/PageHeader');
  mockAdmin.mockImplementation(() => (
    <div data-testid="admin-partnerships">
      <PageHeader
        title="Admin duplicate title"
        description="Admin duplicate description"
        actions={<button type="button">Refresh partnerships</button>}
      />
    </div>
  ));
  return { __esModule: true, default: mockAdmin };
});

describe('PartnershipsPage (partner timebanks panel)', () => {
  it('frames the admin module in the panel shell with partners-namespace copy', async () => {
    const Component = (await import('./PartnershipsPage')).default;
    render(<Component />);

    expect(screen.getByRole('heading', { level: 1, name: 'Partnerships' })).toBeInTheDocument();
    expect(screen.getByTestId('admin-partnerships')).toBeInTheDocument();
    expect(mockAdmin).toHaveBeenCalled();
  });

  it('drops the embedded module\'s duplicate title but keeps its action buttons, in the page header', async () => {
    const Component = (await import('./PartnershipsPage')).default;
    render(<Component />);

    // One title only — the panel's own.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.queryByText('Admin duplicate title')).not.toBeInTheDocument();
    expect(screen.queryByText('Admin duplicate description')).not.toBeInTheDocument();

    // The action button is rendered, and it lives next to the panel title
    // rather than in a leftover card inside the content area.
    const action = await screen.findByRole('button', { name: 'Refresh partnerships' });
    expect(action).toBeInTheDocument();
    expect(screen.getByTestId('admin-partnerships')).not.toContainElement(action);
  });

  it('no partner page still uses the markup-keyed CSS trick', async () => {
    const pages = import.meta.glob('./*Page.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(pages).length).toBeGreaterThan(10);
    for (const [file, source] of Object.entries(pages)) {
      expect(source, file).not.toContain('EMBED_RESTYLE');
      expect(source, file).not.toMatch(/:first-child\]:hidden/);
    }
  });
});
