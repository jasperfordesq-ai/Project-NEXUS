// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for ThemeContext
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ThemeProvider, useTheme } from './ThemeContext';

// Mock the API module
vi.mock('@/lib/api', () => ({
  api: {
    put: vi.fn().mockResolvedValue({ success: true }),
  },
  tokenManager: {
    getAccessToken: vi.fn().mockReturnValue(null),
  },
}));

vi.mock('@/lib/logger', () => ({
  logWarn: vi.fn(),
}));

function TestComponent() {
  const {
    theme,
    resolvedTheme,
    isInitialized,
    setTheme,
    toggleTheme,
    isLoading,
    setAccentColor,
  } = useTheme();

  return (
    <div>
      <div data-testid="theme">{theme}</div>
      <div data-testid="resolved">{resolvedTheme}</div>
      <div data-testid="initialized">{String(isInitialized)}</div>
      <div data-testid="loading">{String(isLoading)}</div>
      <button onClick={() => setTheme('light')}>Set Light</button>
      <button onClick={() => setTheme('dark')}>Set Dark</button>
      <button onClick={() => setTheme('system')}>Set System</button>
      <button onClick={() => toggleTheme()}>Toggle</button>
      <button onClick={() => setAccentColor('#22c55e')}>Set Green Accent</button>
      <button onClick={() => setAccentColor('#111827')}>Set Dark Accent</button>
    </div>
  );
}

describe('ThemeContext', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset DOM
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.classList.remove('light', 'dark');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('provides default theme (light)', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    // Light is the platform default — see DEFAULT_THEME in ThemeContext.
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
  });

  it('accepts custom default theme', () => {
    render(
      <ThemeProvider defaultTheme="light">
        <TestComponent />
      </ThemeProvider>
    );

    expect(screen.getByTestId('theme')).toHaveTextContent('light');
  });

  it('restores theme from localStorage', () => {
    localStorage.setItem('nexus_theme', 'light');

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    expect(screen.getByTestId('theme')).toHaveTextContent('light');
  });

  it('applies theme to DOM', async () => {
    render(
      <ThemeProvider defaultTheme="dark">
        <TestComponent />
      </ThemeProvider>
    );

    // Wait for useEffect
    await screen.findByText('true', { selector: '[data-testid="initialized"]' });

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('sets theme and persists to localStorage', async () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    await act(async () => {
      screen.getByRole('button', { name: 'Set Light' }).click();
    });

    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(localStorage.getItem('nexus_theme')).toBe('light');
  });

  it('toggles between light and dark', async () => {
    render(
      <ThemeProvider defaultTheme="dark">
        <TestComponent />
      </ThemeProvider>
    );

    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');

    await act(async () => {
      screen.getByRole('button', { name: 'Toggle' }).click();
    });

    expect(screen.getByTestId('resolved')).toHaveTextContent('light');

    await act(async () => {
      screen.getByRole('button', { name: 'Toggle' }).click();
    });

    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
  });

  it('syncs theme to backend when authenticated', async () => {
    const { tokenManager } = await import('@/lib/api');
    const { api } = await import('@/lib/api');
    (tokenManager.getAccessToken as ReturnType<typeof vi.fn>).mockReturnValue('test-token');

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    await act(async () => {
      screen.getByRole('button', { name: 'Set Light' }).click();
    });

    expect(api.put).toHaveBeenCalledWith('/v2/users/me/theme', { theme: 'light' });
  });

  it('does not sync to backend when not authenticated', async () => {
    const { tokenManager } = await import('@/lib/api');
    const { api } = await import('@/lib/api');
    (tokenManager.getAccessToken as ReturnType<typeof vi.fn>).mockReturnValue(null);

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    await act(async () => {
      screen.getByRole('button', { name: 'Set Light' }).click();
    });

    expect(api.put).not.toHaveBeenCalled();
  });

  it('resolves system theme based on matchMedia', () => {
    // matchMedia is mocked in setup.ts to return matches: false (light)
    render(
      <ThemeProvider defaultTheme="system">
        <TestComponent />
      </ThemeProvider>
    );

    expect(screen.getByTestId('theme')).toHaveTextContent('system');
    // matchMedia mock returns matches: false = light mode
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
  });

  it('throws error when useTheme is used outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<TestComponent />);
    }).toThrow('useTheme must be used within a ThemeProvider');

    spy.mockRestore();
  });

  it('ignores invalid stored theme values', () => {
    localStorage.setItem('nexus_theme', 'invalid-theme');

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    // Falls back to default (light)
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
  });

  it('marks as initialized after mount', async () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    await screen.findByText('true', { selector: '[data-testid="initialized"]' });
  });

  it('bridges the runtime accent to HeroUI canonical variables', async () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    await act(async () => {
      screen.getByRole('button', { name: 'Set Green Accent' }).click();
    });

    const htmlStyle = document.documentElement.style;
    expect(htmlStyle.getPropertyValue('--accent-color')).toBe('#22c55e');
    expect(htmlStyle.getPropertyValue('--accent')).toBe('#22c55e');
    expect(htmlStyle.getPropertyValue('--accent-foreground')).toBe('#000000');
    expect(htmlStyle.getPropertyValue('--focus')).toBe('#22c55e');
    expect(htmlStyle.getPropertyValue('--link')).toBe('#22c55e');
    expect(htmlStyle.getPropertyValue('--border-focus')).toContain('#22c55e');
    expect(htmlStyle.getPropertyValue('--input-focus-border')).toContain('#22c55e');
  });

  it('uses a light foreground for dark accent colors', async () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    await act(async () => {
      screen.getByRole('button', { name: 'Set Dark Accent' }).click();
    });

    expect(document.documentElement.style.getPropertyValue('--accent-foreground')).toBe('#ffffff');
  });
});
