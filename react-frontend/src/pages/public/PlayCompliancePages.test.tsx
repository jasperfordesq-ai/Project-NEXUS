// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';

const tenantContext = {
  tenant: { id: 2, slug: 'timebank-global', name: 'Timebank Global' },
  branding: { name: 'Timebank Global' },
  tenantPath: (path: string) => path,
  hasFeature: () => true,
  hasModule: () => true,
  isLoading: false,
  error: null,
};

vi.mock('@/contexts/TenantContext', () => ({
  TenantProvider: ({ children }: { children: React.ReactNode }) => children,
  useTenant: () => tenantContext,
  useFeature: () => true,
  useModule: () => true,
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

import { AccountDeletionPage } from './AccountDeletionPage';
import { ChildSafetyStandardsPage } from './ChildSafetyStandardsPage';

describe('Google Play compliance pages', () => {
  it('publishes a usable account-deletion request path and retention disclosure', () => {
    render(<AccountDeletionPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Delete your Timebank Global account' })).toBeInTheDocument();
    expect(screen.getByText(/hOUR Timebank Company Limited by Guarantee/)).toBeInTheDocument();
    expect(screen.getByText(/package ie\.project\.nexus/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the account deletion request form' }))
      .toHaveAttribute('href', '/contact?topic=account-deletion');
    expect(screen.getByText(/retained for up to seven years/)).toBeInTheDocument();
  });

  it('publishes explicit CSAE standards, reporting, and authority escalation', () => {
    render(<ChildSafetyStandardsPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Child safety standards' })).toBeInTheDocument();
    expect(screen.getByText(/child sexual abuse and exploitation \(CSAE\)/)).toBeInTheDocument();
    expect(screen.getByText(/child sexual abuse material \(CSAM\)/)).toBeInTheDocument();
    expect(screen.getByText(/competent law-enforcement or child-protection authority/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the child-safety report form' }))
      .toHaveAttribute('href', '/contact?topic=child-safety');
  });
});
