// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Automated accessibility audit using axe-core / vitest-axe.
 * Tests key UI components for WCAG 2.1 AA violations.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { MemoryRouter } from 'react-router-dom';
import { EmptyState } from '@/components/feedback/EmptyState';
import { GlassCard } from '@/components/ui/GlassCard';
import { GlassInput } from '@/components/ui/GlassInput';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { BackToTop } from '@/components/ui/BackToTop';
import { LoadingScreen } from '@/components/feedback/LoadingScreen';
import { LevelProgress } from '@/components/ui/LevelProgress';
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/motion', () => ({
  motion: new Proxy({} as Record<string, unknown>, {
    get: (_target, prop: string) => {
      const { forwardRef, createElement } = require('react');
      return forwardRef(({ children, ...rest }: Record<string, unknown>, ref: unknown) => {
        const clean: Record<string, unknown> = {};
        const motionProps = ['variants','initial','animate','exit','transition',
          'whileHover','whileTap','whileInView','layout','layoutId','viewport',
          'drag','dragConstraints','dragElastic','dragMomentum'];
        for (const [k, v] of Object.entries(rest)) {
          if (!motionProps.includes(k)) clean[k] = v;
        }
        return createElement(prop as string, { ...clean, ref }, children);
      });
    },
  }),
  AnimatePresence: ({ children }: { children: unknown }) => children,
  useAnimation: () => ({ start: () => Promise.resolve() }),
  useInView: () => true,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOpts?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        level_plain: 'Level {{level}}',
        level_named: 'Level {{level}}: {{name}}',
        xp_progress: '{{current}} / {{required}} XP',
        level_progress_aria: 'Level {{level}} progress: {{percentage}}%',
      };
      const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : translations[key] ?? key;
      const vars = typeof fallbackOrOpts === 'object' ? fallbackOrOpts : opts;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars?.[k] ?? ''));
    },
    i18n: { language: 'en', changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children: unknown }) => children,
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('i18next', () => {
  const i18nMock: Record<string, unknown> = {
    t: (key: string, opts?: Record<string, unknown>) =>
      (opts as { fallbackValue?: string } | undefined)?.fallbackValue ?? key,
    language: 'en',
    changeLanguage: () => Promise.resolve(),
    use: () => i18nMock,
    init: () => Promise.resolve(),
    on: () => i18nMock,
    off: () => i18nMock,
  };
  return { default: i18nMock, __esModule: true };
});

vi.mock('@/contexts', () => ({
  useTenant: () => ({
    tenant: { id: 2, name: 'Test Timebank', slug: 'test-timebank' },
    tenantSlug: 'test-timebank',
    tenantPath: (path: string) => `/test-timebank${path}`,
    hasFeature: () => true,
    hasModule: () => true,
    features: {},
    modules: {},
    branding: {},
    isLoading: false,
    error: null,
    notFoundSlug: null,
    refreshTenant: () => Promise.resolve(),
  }),
  useFeature: () => true,
  useModule: () => true,
  useCookieConsent: () => ({
    consent: { analytics: false, marketing: false },
    showBanner: false,
    acceptAll: () => {},
    rejectAll: () => {},
    updateConsent: () => {},
  }),
}));

// Breadcrumbs imports the direct context module rather than the barrel above.
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    tenant: { id: 2, name: 'Test Timebank', slug: 'test-timebank' },
    tenantSlug: 'test-timebank',
    tenantPath: (path: string) => `/test-timebank${path}`,
    hasFeature: () => true,
    hasModule: () => true,
    features: {},
    modules: {},
    branding: {},
    isLoading: false,
    error: null,
    notFoundSlug: null,
    refreshTenant: () => Promise.resolve(),
  }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function withProviders(ui: React.ReactElement) {
  return render(
    <>
      <MemoryRouter>
        {ui}
      </MemoryRouter>
    </>
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Accessibility: EmptyState', () => {
  it('has no violations with title only', async () => {
    const { container } = withProviders(
      <EmptyState title="No items found" />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no violations with title, description, and action button', async () => {
    const { container } = withProviders(
      <EmptyState
        title="No listings"
        description="Be the first to post a listing in your community."
        action={{ label: 'Post a listing', onClick: () => {} }}
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('Accessibility: GlassCard', () => {
  it('has no violations as a static card', async () => {
    const { container } = withProviders(
      <GlassCard>
        <h2>Card heading</h2>
        <p>Card body content.</p>
      </GlassCard>
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('Accessibility: skip link markup', () => {
  it('renders an anchor pointing to #main-content with descriptive text', () => {
    const { container } = render(
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only"
      >
        Skip to main content
      </a>
    );
    const link = container.querySelector('a[href="#main-content"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe('Skip to main content');
  });
});

// ─── New accessibility tests ────────────────────────────────────────────────

describe('Accessibility: GlassInput', () => {
  it('has no violations with a label', async () => {
    const { container } = withProviders(
      <GlassInput label="Email address" type="email" />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no violations with an error message', async () => {
    const { container } = withProviders(
      <GlassInput label="Username" error="Username is required" />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no violations when disabled', async () => {
    const { container } = withProviders(
      <GlassInput label="Disabled field" isDisabled />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('Accessibility: Breadcrumbs', () => {
  it('has no violations with multiple items', async () => {
    const { container } = withProviders(
      <Breadcrumbs
        items={[
          { label: 'Events', href: '/events' },
          { label: 'Community Meetup' },
        ]}
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no violations without home icon', async () => {
    const { container } = withProviders(
      <Breadcrumbs
        items={[{ label: 'Settings' }]}
        showHome={false}
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('Accessibility: BackToTop', () => {
  it('has no violations when rendered (button hidden by default)', async () => {
    const { container } = withProviders(<BackToTop />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('Accessibility: LoadingScreen', () => {
  it('has no violations with default message', async () => {
    const { container } = withProviders(
      <LoadingScreen />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no violations with custom message', async () => {
    const { container } = withProviders(
      <LoadingScreen message="Fetching your data..." />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('Accessibility: LevelProgress', () => {
  it('has no violations in default mode', async () => {
    const { container } = withProviders(
      <LevelProgress currentXP={250} requiredXP={500} level={3} />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no violations in compact mode', async () => {
    const { container } = withProviders(
      <LevelProgress currentXP={100} requiredXP={200} level={1} compact />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('Accessibility: ImagePlaceholder', () => {
  it('has no violations with default props', async () => {
    const { container } = withProviders(
      <ImagePlaceholder />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no violations with small size', async () => {
    const { container } = withProviders(
      <ImagePlaceholder size="sm" />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
