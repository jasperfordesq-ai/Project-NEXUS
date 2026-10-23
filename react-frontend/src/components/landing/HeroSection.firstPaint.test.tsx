// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The home page headline is its largest paint (LCP). With the REAL motion shim
 * (HeroSection.test.tsx mocks it away), the headline must not start invisible:
 * an element at opacity 0 does not count as painted until its fade ends
 * (2026-10-23 real-user speed audit).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { HeroSection } from './HeroSection';

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({ user: null, isAuthenticated: false })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    branding: { name: 'Test Community', logo_url: null },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
}));

describe('HeroSection first paint', () => {
  it('shows the headline from the first frame (moves, never fades)', () => {
    render(<HeroSection />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.style.opacity).not.toBe('0');
  });
});
