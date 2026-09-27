// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import i18n from 'i18next';
import { cleanup, render, screen, fireEvent } from '@/test/test-utils';
import { SearchField } from './SearchField';

// SearchField is a thin variant-mapping wrapper over HeroUI SearchField.
// No context imports — no vi.mock('@/contexts') needed.

describe('SearchField', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it('renders a search input', () => {
    render(<SearchField aria-label="Search" />);
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });

  it('renders with placeholder text', () => {
    render(<SearchField placeholder="Search members…" aria-label="Search" />);
    expect(screen.getByPlaceholderText('Search members…')).toBeInTheDocument();
  });

  it('calls onValueChange with the typed value', () => {
    const onValueChange = vi.fn();
    render(<SearchField onValueChange={onValueChange} aria-label="Search" />);
    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'hello' } });
    expect(onValueChange).toHaveBeenCalledWith('hello');
  });

  it('calls legacy onChange with synthetic event shape { target: { value } }', () => {
    const onChange = vi.fn();
    render(<SearchField onChange={onChange} aria-label="Search" />);
    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'test' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.objectContaining({ value: 'test' }) }),
    );
  });

  it('fires both onValueChange and onChange when both provided', () => {
    const onValueChange = vi.fn();
    const onChange = vi.fn();
    render(<SearchField onValueChange={onValueChange} onChange={onChange} aria-label="Search" />);
    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'dual' } });
    expect(onValueChange).toHaveBeenCalledWith('dual');
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.objectContaining({ value: 'dual' }) }),
    );
  });

  it('renders startContent inside the search icon slot', () => {
    render(
      <SearchField
        startContent={<span data-testid="search-icon">icon</span>}
        aria-label="Search"
      />,
    );
    expect(screen.getByTestId('search-icon')).toBeInTheDocument();
  });

  it('renders endContent after the input', () => {
    render(
      <SearchField
        endContent={<span data-testid="end-slot">filter</span>}
        aria-label="Search"
      />,
    );
    expect(screen.getByTestId('end-slot')).toBeInTheDocument();
  });

  it('maps flat variant without crashing', () => {
    render(<SearchField variant="flat" aria-label="Search" />);
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });

  it('maps bordered variant without crashing', () => {
    render(<SearchField variant="bordered" aria-label="Search" />);
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });

  it('maps underlined variant without crashing', () => {
    render(<SearchField variant="underlined" aria-label="Search" />);
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });

  it('maps faded variant without crashing', () => {
    render(<SearchField variant="faded" aria-label="Search" />);
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });

  it('accepts size="sm" without crashing', () => {
    render(<SearchField size="sm" aria-label="Search" />);
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });

  it('accepts size="lg" without crashing', () => {
    render(<SearchField size="lg" aria-label="Search" />);
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });

  it('accepts a defaultValue prop', () => {
    render(<SearchField defaultValue="prefilled" aria-label="Search" />);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('prefilled');
  });

  it('uses the active locale for the clear-search action', async () => {
    i18n.addResource('fr', 'common', 'search.clear', 'Effacer la recherche');
    await i18n.changeLanguage('fr');

    render(<SearchField defaultValue="membres" aria-label="Rechercher" />);

    expect(screen.getByRole('button', { name: 'Effacer la recherche' })).toBeInTheDocument();
  });

  it('accepts a translated search-specific clear label override', () => {
    render(
      <SearchField
        defaultValue="members"
        aria-label="Search members"
        clearButtonLabel="Clear member search"
      />,
    );

    expect(screen.getByRole('button', { name: 'Clear member search' })).toBeInTheDocument();
  });

  it('omits the optional clear action when isClearable is false', () => {
    render(
      <SearchField
        value=""
        aria-label="Search groups"
        clearButtonLabel="Clear group search"
        isClearable={false}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Clear group search' })).not.toBeInTheDocument();
  });
});
