// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('react-router-dom', () => ({
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>{children}</a>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.community !== undefined ? `${key}:${String(options.community)}` : key,
  }),
}));

const mockUseAuth = vi.fn();
const mockUseTenant = vi.fn();
const mockWarning = vi.fn();
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: (...args: unknown[]) => mockUseAuth(...args),
}));
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: (...args: unknown[]) => mockUseTenant(...args),
}));
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ warning: mockWarning }),
}));

import { VisitingManagerBanner } from './VisitingManagerBanner';
import { VISITOR_READ_ONLY_EVENT } from '@/lib/api';

const visitor = {
  id: 7,
  role: 'admin',
  is_tenant_super_admin: true,
  tenant_id: 2,
};

function refuse() {
  act(() => {
    window.dispatchEvent(new CustomEvent(VISITOR_READ_ONLY_EVENT, { detail: { endpoint: '/v2/feed/posts' } }));
  });
}

describe('VisitingManagerBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTenant.mockReturnValue({ tenant: { id: 101, name: 'Bridgwater Timebank' }, tenantPath: (p: string) => `/child${p}` });
  });

  it('tells a manager from a community above that it is only looking around', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true, user: visitor });
    render(<VisitingManagerBanner />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('visiting_manager.banner:Bridgwater Timebank')).toBeInTheDocument();
    expect(screen.getByText('visiting_manager.read_only')).toBeInTheDocument();
    expect(screen.getByText('visiting_manager.open_admin').closest('a')).toHaveAttribute('href', '/child/admin');
  });

  it('explains a refused action once, not once per request', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true, user: visitor });
    render(<VisitingManagerBanner />);

    refuse();
    refuse();

    expect(mockWarning).toHaveBeenCalledTimes(1);
    expect(mockWarning).toHaveBeenCalledWith('visiting_manager.refused_title', 'visiting_manager.refused_body');
  });

  it('shows nothing to a member of the community', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true, user: { ...visitor, tenant_id: 101 } });
    const { container } = render(<VisitingManagerBanner />);
    refuse();

    expect(container).toBeEmptyDOMElement();
    expect(mockWarning).not.toHaveBeenCalled();
  });

  it('never shows to the platform owner, who may take part anywhere', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true, user: { ...visitor, is_super_admin: true, is_god: true } });
    const { container } = render(<VisitingManagerBanner />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing when signed out', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, user: null });
    const { container } = render(<VisitingManagerBanner />);

    expect(container).toBeEmptyDOMElement();
  });
});
