// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Mock api ────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Contexts ────────────────────────────────────────────────────────────────
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  showToast: vi.fn(),
};

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Test User' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// NOTE: no `vi.mock('@/components/ui', ...)` here on purpose. AdvancedSearchFilters
// imports Button/Chip/GlassCard/Input/Select from their DIRECT paths, so a barrel
// override would never be reached. The real HeroUI components render and the
// assertions below target the real DOM and the real English copy that
// src/test/setup.ts loads from public/locales/en/search_page.json.

// ─── Fixtures ────────────────────────────────────────────────────────────────
const defaultFilters = {
  type: 'all',
  category_id: '',
  date_from: '',
  date_to: '',
  sort: 'relevance',
  skills: '',
  location: '',
};

describe('AdvancedSearchFilters', () => {
  const onChangeMock = vi.fn();
  const onApplyMock = vi.fn();
  const onResetMock = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue({ success: true, data: [] });
  });

  it('renders the Advanced Filters toggle button', async () => {
    const { AdvancedSearchFilters } = await import('./AdvancedSearchFilters');
    render(
      <AdvancedSearchFilters
        filters={defaultFilters}
        onChange={onChangeMock}
        onApply={onApplyMock}
        onReset={onResetMock}
      />
    );
    // aria-label={t('advanced_filters')} → the real English copy from search_page.json.
    expect(screen.getByRole('button', { name: 'Advanced Filters' })).toBeInTheDocument();
  });

  it('does not show filter panel when collapsed', async () => {
    const { AdvancedSearchFilters } = await import('./AdvancedSearchFilters');
    const { container } = render(
      <AdvancedSearchFilters
        filters={defaultFilters}
        onChange={onChangeMock}
        onApply={onApplyMock}
        onReset={onResetMock}
      />
    );
    // Positive precondition — without it the absences below could pass on an empty render.
    expect(screen.getByRole('button', { name: 'Advanced Filters' })).toBeInTheDocument();

    // The real GlassCard root carries the `glass-card` class (GlassCard.tsx).
    expect(container.querySelector('.glass-card')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply Filters' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Add a skill tag...' })).not.toBeInTheDocument();
    expect(screen.queryByText('Content Type')).not.toBeInTheDocument();
  });

  it('expands filter panel when toggle button is clicked', async () => {
    const { AdvancedSearchFilters } = await import('./AdvancedSearchFilters');
    const { container } = render(
      <AdvancedSearchFilters
        filters={defaultFilters}
        onChange={onChangeMock}
        onApply={onApplyMock}
        onReset={onResetMock}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Advanced Filters' }));

    await waitFor(() => {
      expect(container.querySelector('.glass-card')).not.toBeNull();
    });
    // The panel's own controls, not just its container.
    expect(screen.getByText('Content Type')).toBeInTheDocument();
    expect(screen.getByText('Category')).toBeInTheDocument();
    expect(screen.getByText('Sort By')).toBeInTheDocument();
    expect(screen.getByText('Skill Tags')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Location' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Add a skill tag...' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply Filters' })).toBeInTheDocument();
  });

  it('fetches categories and tags when expanded', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/v2/categories')) {
        return Promise.resolve({ success: true, data: [{ id: 5, name: 'Tech', slug: 'tech' }] });
      }
      if (url.includes('/v2/listings/tags')) {
        return Promise.resolve({ success: true, data: [{ tag: 'coding', count: 10 }] });
      }
      return Promise.resolve({ success: true, data: [] });
    });

    const { AdvancedSearchFilters } = await import('./AdvancedSearchFilters');
    render(
      <AdvancedSearchFilters
        filters={defaultFilters}
        onChange={onChangeMock}
        onApply={onApplyMock}
        onReset={onResetMock}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Advanced Filters' }));

    // Exact URLs, not substrings — these are the endpoints the panel contracts on.
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/v2/categories');
    });
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/v2/listings/tags/popular?limit=10');
    });
    // ...and the tag response is actually consumed into the popular-tag row.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'coding' })).toBeInTheDocument();
    });
  });

  it('shows popular tags as clickable buttons when expanded', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/v2/listings/tags')) {
        return Promise.resolve({
          success: true,
          data: [{ tag: 'gardening', count: 5 }, { tag: 'cooking', count: 3 }],
        });
      }
      return Promise.resolve({ success: true, data: [] });
    });

    const { AdvancedSearchFilters } = await import('./AdvancedSearchFilters');
    render(
      <AdvancedSearchFilters
        filters={defaultFilters}
        onChange={onChangeMock}
        onApply={onApplyMock}
        onReset={onResetMock}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Advanced Filters' }));

    // "clickable buttons" — assert the role, not just the text node.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'gardening' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'cooking' })).toBeInTheDocument();
    expect(screen.getByText('Popular:')).toBeInTheDocument();
  });

  it('clicking a popular tag calls onChange with that skill', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/v2/listings/tags')) {
        return Promise.resolve({ success: true, data: [{ tag: 'painting', count: 7 }] });
      }
      return Promise.resolve({ success: true, data: [] });
    });

    const { AdvancedSearchFilters } = await import('./AdvancedSearchFilters');
    render(
      <AdvancedSearchFilters
        filters={defaultFilters}
        onChange={onChangeMock}
        onApply={onApplyMock}
        onReset={onResetMock}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Advanced Filters' }));

    const tagBtn = await waitFor(() => screen.getByRole('button', { name: 'painting' }));
    fireEvent.click(tagBtn);

    // Exact payload: the whole filters object with only `skills` changed.
    expect(onChangeMock).toHaveBeenCalledWith({ ...defaultFilters, skills: 'painting' });
  });

  it('shows active skill chips when skills filter is set', async () => {
    const { AdvancedSearchFilters } = await import('./AdvancedSearchFilters');
    const { container } = render(
      <AdvancedSearchFilters
        filters={{ ...defaultFilters, skills: 'coding,design' }}
        onChange={onChangeMock}
        onApply={onApplyMock}
        onReset={onResetMock}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Advanced Filters' }));

    // Real Chip DOM: <span data-slot="chip"><span data-slot="chip-label">…
    await waitFor(() => {
      expect(container.querySelector('[data-slot="chip-label"]')).not.toBeNull();
    });
    const chipLabels = Array.from(container.querySelectorAll('[data-slot="chip-label"]')).map(
      (node) => node.textContent
    );
    expect(chipLabels).toContain('coding');
    expect(chipLabels).toContain('design');
  });

  it('removing a skill chip calls onChange without that skill', async () => {
    const { AdvancedSearchFilters } = await import('./AdvancedSearchFilters');
    render(
      <AdvancedSearchFilters
        filters={{ ...defaultFilters, skills: 'coding,design' }}
        onChange={onChangeMock}
        onApply={onApplyMock}
        onReset={onResetMock}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Advanced Filters' }));

    // Chip onClose renders a real HeroUI CloseButton labelled common:aria.remove.
    const removeButtons = await waitFor(() => {
      const found = screen.getAllByRole('button', { name: 'Remove' });
      expect(found).toHaveLength(2);
      return found;
    });
    fireEvent.click(removeButtons[0]!);

    // The first chip is 'coding' (skills split order), so only 'design' survives.
    expect(onChangeMock).toHaveBeenCalledWith({ ...defaultFilters, skills: 'design' });
  });

  it('calls onApply when Apply Filters button is clicked', async () => {
    const { AdvancedSearchFilters } = await import('./AdvancedSearchFilters');
    render(
      <AdvancedSearchFilters
        filters={defaultFilters}
        onChange={onChangeMock}
        onApply={onApplyMock}
        onReset={onResetMock}
      />
    );
    // Expand the panel first, then address Apply by its accessible name rather
    // than by DOM position (the real Selects add trigger buttons of their own).
    fireEvent.click(screen.getByRole('button', { name: 'Advanced Filters' }));
    const applyBtn = await waitFor(() => screen.getByRole('button', { name: 'Apply Filters' }));
    fireEvent.click(applyBtn);

    expect(onApplyMock).toHaveBeenCalledTimes(1);
    // Apply submits what is already staged; it must not mutate the filters itself.
    expect(onChangeMock).not.toHaveBeenCalled();
    expect(onResetMock).not.toHaveBeenCalled();
  });

  it('calls onReset when Reset button is clicked', async () => {
    const { AdvancedSearchFilters } = await import('./AdvancedSearchFilters');
    render(
      <AdvancedSearchFilters
        filters={{ ...defaultFilters, type: 'users' }}
        onChange={onChangeMock}
        onApply={onApplyMock}
        onReset={onResetMock}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Advanced Filters' }));
    const resetBtn = await waitFor(() => screen.getByRole('button', { name: 'Reset' }));
    fireEvent.click(resetBtn);

    expect(onResetMock).toHaveBeenCalledTimes(1);
    // handleReset also pushes the defaults back up before notifying the parent,
    // so type:'users' is cleared rather than silently kept.
    expect(onChangeMock).toHaveBeenCalledWith(defaultFilters);
  });

  it('shows active filter count badge when filters are set', async () => {
    const { AdvancedSearchFilters } = await import('./AdvancedSearchFilters');
    render(
      <AdvancedSearchFilters
        filters={{ ...defaultFilters, type: 'events', date_from: '2025-01-01' }}
        onChange={onChangeMock}
        onApply={onApplyMock}
        onReset={onResetMock}
      />
    );
    // 2 active filters (type + date_from). The badge is a real Chip in the
    // toggle's endContent, so scope the lookup to the toggle button.
    const toggle = screen.getByRole('button', { name: 'Advanced Filters' });
    const badge = toggle.querySelector('[data-slot="chip-label"]');
    expect(badge).not.toBeNull();
    expect(badge).toHaveTextContent('2');
  });

  it('shows no count badge when no filters are active', async () => {
    const { AdvancedSearchFilters } = await import('./AdvancedSearchFilters');
    render(
      <AdvancedSearchFilters
        filters={defaultFilters}
        onChange={onChangeMock}
        onApply={onApplyMock}
        onReset={onResetMock}
      />
    );
    // Positive precondition, then the absence: endContent is null at count 0.
    const toggle = screen.getByRole('button', { name: 'Advanced Filters' });
    expect(toggle).toHaveTextContent('Advanced Filters');
    expect(toggle.querySelector('[data-slot="chip"]')).toBeNull();
  });

  it('adding a skill via Enter key calls onChange', async () => {
    const { AdvancedSearchFilters } = await import('./AdvancedSearchFilters');
    render(
      <AdvancedSearchFilters
        filters={defaultFilters}
        onChange={onChangeMock}
        onApply={onApplyMock}
        onReset={onResetMock}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Advanced Filters' }));

    // aria-label={t('filter_skills_placeholder')} on the real Input.
    const skillInput = await waitFor(() =>
      screen.getByRole('textbox', { name: 'Add a skill tag...' })
    );
    fireEvent.change(skillInput, { target: { value: 'yoga' } });
    fireEvent.keyDown(skillInput, { key: 'Enter' });

    expect(onChangeMock).toHaveBeenCalledWith({ ...defaultFilters, skills: 'yoga' });
  });

  it('does not add a skill on a non-Enter keypress', async () => {
    const { AdvancedSearchFilters } = await import('./AdvancedSearchFilters');
    render(
      <AdvancedSearchFilters
        filters={defaultFilters}
        onChange={onChangeMock}
        onApply={onApplyMock}
        onReset={onResetMock}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Advanced Filters' }));

    const skillInput = await waitFor(() =>
      screen.getByRole('textbox', { name: 'Add a skill tag...' })
    );
    fireEvent.change(skillInput, { target: { value: 'yoga' } });
    fireEvent.keyDown(skillInput, { key: 'a' });

    // Typing alone stages nothing upward — only Enter commits the tag.
    expect(onChangeMock).not.toHaveBeenCalled();
  });

  it('location input calls onChange with updated location', async () => {
    const { AdvancedSearchFilters } = await import('./AdvancedSearchFilters');
    render(
      <AdvancedSearchFilters
        filters={defaultFilters}
        onChange={onChangeMock}
        onApply={onApplyMock}
        onReset={onResetMock}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Advanced Filters' }));

    // label={t('filter_location')} on the real Input → accessible name "Location".
    const locInput = await waitFor(() => screen.getByRole('textbox', { name: 'Location' }));
    fireEvent.change(locInput, { target: { value: 'Bristol' } });

    expect(onChangeMock).toHaveBeenCalledWith({ ...defaultFilters, location: 'Bristol' });
  });
});
