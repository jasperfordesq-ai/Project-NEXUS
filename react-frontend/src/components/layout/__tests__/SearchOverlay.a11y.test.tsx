// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Regression test: the Cmd+K command palette exposes an ARIA combobox whose
 * active option remains owned by the input, and announces result-count changes.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { SearchOverlay } from '../SearchOverlay';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn().mockResolvedValue({ success: true, data: {} }) },
}));

vi.mock('@/lib/safeStorage', () => ({
  safeLocalStorageGetJSON: () => [],
  safeLocalStorageSetJSON: () => {},
  safeLocalStorageRemove: () => {},
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      key === 'aria.search_results'
        ? `${opts?.count ?? 0} results available`
        : key,
  }),
  Trans: ({ children }: { children: unknown }) => children,
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('@/contexts', () => ({
  useAuth: () => ({ isAuthenticated: true }),
  useTenant: () => ({ tenantPath: (p: string) => p, hasModule: () => true, hasFeature: () => true }),
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn() }),
}));

describe('SearchOverlay — combobox accessibility contract', () => {
  it('announces results and exposes every command through the controlled listbox', () => {
    render(<SearchOverlay isOpen onClose={vi.fn()} />);

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '>' } });

    expect(screen.getByText(/results available/)).toBeInTheDocument();
    const listbox = screen.getByRole('listbox');
    const options = screen.getAllByRole('option');

    expect(input).toHaveAttribute('aria-controls', listbox.id);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(options.length).toBeGreaterThan(0);
    options.forEach(option => {
      expect(option.id).not.toBe('');
      expect(option).toHaveAttribute('aria-selected');
      expect(option).toHaveAttribute('tabindex', '-1');
    });

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', options[0]?.id);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveFocus();
    expect(screen.getByText('user_menu.settings')).toBeInTheDocument();
  });

  it('has no automated accessibility violations in command mode', async () => {
    render(<SearchOverlay isOpen onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '>' } });

    expect(await axe(document.body)).toHaveNoViolations();
  });
});
