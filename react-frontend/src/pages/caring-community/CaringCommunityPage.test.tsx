// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tenantState = vi.hoisted(() => ({
  features: new Set<string>(),
  modules: new Set<string>(),
}));

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/components/seo', () => ({ PageMeta: () => null }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/caring-community/OnboardingChoiceModal', () => ({
  OnboardingChoiceModal: () => null,
  clearStoredOnboardingChoice: vi.fn(),
  readStoredOnboardingChoice: () => 'helper',
}));

vi.mock('@/contexts', () => ({
  useTenant: () => ({
    branding: { name: 'Test Timebank' },
    hasFeature: (feature: string) => tenantState.features.has(feature),
    hasModule: (module: string) => tenantState.modules.has(module),
    tenant: { id: 2, slug: 'test-timebank' },
    tenantPath: (path: string) => `/test-timebank${path}`,
    tenantSlug: 'test-timebank',
  }),
}));

import { CaringCommunityPage } from './CaringCommunityPage';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/test-timebank/caring-community']}>
      <CaringCommunityPage />
    </MemoryRouter>,
  );
}

describe('CaringCommunityPage', () => {
  beforeEach(() => {
    tenantState.features = new Set(['caring_community', 'volunteering', 'organisations']);
    tenantState.modules = new Set(['listings', 'messages']);
  });

  it('shows the organisations shortcut when volunteering and organisations are enabled', () => {
    renderPage();

    const organisationsLink = screen.getByRole('link', {
      name: 'caring_community.modules.organisations.title',
    });

    expect(organisationsLink).toHaveAttribute('href', '/test-timebank/organisations');
  });

  it('hides organisation shortcuts when organisations are disabled', () => {
    tenantState.features.delete('organisations');
    renderPage();

    expect(screen.queryByRole('link', {
      name: 'caring_community.modules.organisations.title',
    })).not.toBeInTheDocument();
    expect(screen.queryByText('caring_community.actions.coordinate_org')).not.toBeInTheDocument();
  });

  it('does not show volunteering actions when volunteering is disabled', () => {
    tenantState.features.delete('volunteering');
    renderPage();

    expect(screen.queryByRole('link', { name: 'caring_community.hero.cta_give_help' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'caring_community.modules.volunteering.title' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'caring_community.recruit.cta' })).not.toBeInTheDocument();
  });
});
