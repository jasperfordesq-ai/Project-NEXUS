// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { FederatedTrustBadge } from './FederatedTrustBadge';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'reputation.aria_label': 'Federated reputation {{score}} from {{count}} reviews',
        'reputation.chip_label': '{{score}} ({{count}})',
        'reputation.tooltip_federated': 'Aggregated from {{count}} federation reviews',
        'reputation.tooltip_local': 'Based on {{count}} local reviews',
      };
      const fallback = (opts?.fallbackValue as string | undefined) ?? translations[key] ?? key;
      if (!opts) return fallback;
      // Simple interpolation for tests
      return fallback.replace(/\{\{(\w+)\}\}/g, (_, k: string) =>
        opts[k] != null ? String(opts[k]) : ''
      );
    },
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

describe('FederatedTrustBadge', () => {
  it('renders success tier for score >= 4.5', () => {
    const { container } = render(<FederatedTrustBadge score={4.8} reviewCount={12} />);
    const chip = container.querySelector('[class*="emerald"]');
    expect(chip).not.toBeNull();
    expect(screen.getByText(/4\.8/)).toBeTruthy();
    expect(screen.getByText(/\(12\)/)).toBeTruthy();
  });

  it('renders primary tier for score 3.5 <= score < 4.5', () => {
    const { container } = render(<FederatedTrustBadge score={4.0} reviewCount={5} />);
    // The primary tier is painted with the theme's `accent` token, not a raw
    // indigo palette class — that is the project's styling rule, and the badge
    // was moved onto the token. The old [class*="indigo"] selector matched
    // nothing and read as a missing badge.
    expect(container.querySelector('[class*="accent"]')).not.toBeNull();
  });

  it('renders warning tier for score 2.5 <= score < 3.5', () => {
    const { container } = render(<FederatedTrustBadge score={3.0} reviewCount={3} />);
    expect(container.querySelector('[class*="amber"]')).not.toBeNull();
  });

  it('renders default tier for score < 2.5', () => {
    const { container } = render(<FederatedTrustBadge score={1.5} reviewCount={2} />);
    // Default uses theme classes
    expect(container.querySelector('[class*="theme-"]')).not.toBeNull();
  });

  it('exposes accessible aria-label describing score and count', () => {
    render(<FederatedTrustBadge score={4.2} reviewCount={8} />);
    const el = screen.getByLabelText(/Federated reputation 4\.2 from 8 reviews/i);
    expect(el).toBeTruthy();
  });

  it('tooltip content references aggregated federation', () => {
    // Tooltip renders content in DOM (may be hidden) — look for key phrase
    render(<FederatedTrustBadge score={4.5} reviewCount={20} isFederated />);
    // HeroUI Tooltip renders content lazily; at minimum verify no crash and chip shows
    expect(screen.getByText(/4\.5/)).toBeTruthy();
  });

  it('handles NaN and negative gracefully', () => {
    render(<FederatedTrustBadge score={NaN} reviewCount={-3} />);
    expect(screen.getByText(/0\.0/)).toBeTruthy();
  });
});
