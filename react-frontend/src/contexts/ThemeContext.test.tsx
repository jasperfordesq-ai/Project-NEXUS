// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for ThemeContext
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useEffect } from 'react';
import { render, screen, act } from '@testing-library/react';
import { getContrastRatio } from '@/lib/colorContrast';
import { ThemeProvider, useTheme } from './ThemeContext';
import { useSiteVivid } from './SiteAccentContext';

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

  describe('light or dark to start with (the community default)', () => {
    function StartProbe({ start }: { start: string | null }) {
      const { setCommunityDefaultTheme } = useTheme();
      useEffect(() => {
        setCommunityDefaultTheme(start);
      }, [start, setCommunityDefaultTheme]);
      return null;
    }

    const html = () => document.documentElement;

    it('starts someone who has not chosen on the community default', async () => {
      render(
        <ThemeProvider>
          <StartProbe start="dark" />
          <TestComponent />
        </ThemeProvider>
      );

      await act(async () => {});
      expect(screen.getByTestId('theme')).toHaveTextContent('dark');
      expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
      expect(html().getAttribute('data-theme')).toBe('dark');
      expect(html().classList.contains('dark')).toBe(true);
      // Following the community is not a choice: nothing is remembered, so the
      // same person visiting a light community next is light there.
      expect(localStorage.getItem('nexus_theme')).toBeNull();
    });

    it('never overrides a choice the person made themselves', async () => {
      localStorage.setItem('nexus_theme', 'light');

      render(
        <ThemeProvider>
          <StartProbe start="dark" />
          <TestComponent />
        </ThemeProvider>
      );

      await act(async () => {});
      expect(screen.getByTestId('theme')).toHaveTextContent('light');
      expect(html().getAttribute('data-theme')).toBe('light');
      expect(localStorage.getItem('nexus_theme')).toBe('light');
    });

    it('lets the person switch away from it, and remembers that', async () => {
      render(
        <ThemeProvider>
          <StartProbe start="dark" />
          <TestComponent />
        </ThemeProvider>
      );
      await act(async () => {});

      await act(async () => {
        screen.getByText('Set Light').click();
      });

      expect(screen.getByTestId('theme')).toHaveTextContent('light');
      expect(html().getAttribute('data-theme')).toBe('light');
      expect(localStorage.getItem('nexus_theme')).toBe('light');
    });

    it('toggles away from a dark start to light', async () => {
      render(
        <ThemeProvider>
          <StartProbe start="dark" />
          <TestComponent />
        </ThemeProvider>
      );
      await act(async () => {});

      await act(async () => {
        screen.getByText('Toggle').click();
      });

      expect(screen.getByTestId('resolved')).toHaveTextContent('light');
      expect(localStorage.getItem('nexus_theme')).toBe('light');
    });

    it('follows the device when the community chose that', async () => {
      const original = window.matchMedia;
      window.matchMedia = ((query: string) => ({
        ...original(query),
        matches: query.includes('prefers-color-scheme: dark'),
      })) as typeof window.matchMedia;

      try {
        render(
          <ThemeProvider>
            <StartProbe start="system" />
            <TestComponent />
          </ThemeProvider>
        );

        await act(async () => {});
        expect(screen.getByTestId('theme')).toHaveTextContent('system');
        expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
        expect(html().getAttribute('data-theme')).toBe('dark');
      } finally {
        window.matchMedia = original;
      }
    });

    it('goes back to light when the community does, and when the person moves to a light community', async () => {
      const { rerender } = render(
        <ThemeProvider>
          <StartProbe start="dark" />
          <TestComponent />
        </ThemeProvider>
      );
      await act(async () => {});
      expect(html().getAttribute('data-theme')).toBe('dark');

      rerender(
        <ThemeProvider>
          <StartProbe start={null} />
          <TestComponent />
        </ThemeProvider>
      );
      await act(async () => {});
      expect(screen.getByTestId('theme')).toHaveTextContent('light');
      expect(html().getAttribute('data-theme')).toBe('light');
    });

    it('ignores a value that is not one of the three names', async () => {
      render(
        <ThemeProvider>
          <StartProbe start={'dark" onload="x'} />
          <TestComponent />
        </ThemeProvider>
      );

      await act(async () => {});
      expect(screen.getByTestId('theme')).toHaveTextContent('light');
      expect(html().getAttribute('data-theme')).toBe('light');
    });
  });

  it('follows the device live while on "system": the page and resolvedTheme change together', async () => {
    // Until Nov 2026 the page was repainted but resolvedTheme stayed as it was
    // (the "force re-render" was a state update React skipped).
    const original = window.matchMedia;
    let deviceDark = false;
    const listeners = new Set<() => void>();
    window.matchMedia = ((query: string) => ({
      ...original(query),
      get matches() {
        return query.includes('prefers-color-scheme: dark') && deviceDark;
      },
      addEventListener: (_: string, listener: () => void) => { listeners.add(listener); },
      removeEventListener: (_: string, listener: () => void) => { listeners.delete(listener); },
    })) as unknown as typeof window.matchMedia;

    try {
      render(
        <ThemeProvider defaultTheme="system">
          <TestComponent />
        </ThemeProvider>
      );
      await act(async () => {});
      expect(screen.getByTestId('resolved')).toHaveTextContent('light');

      await act(async () => {
        deviceDark = true;
        listeners.forEach((listener) => listener());
      });

      expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    } finally {
      window.matchMedia = original;
    }
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
    // The member's green as painted on the light theme: deepened just enough
    // to read as text on the warm page (warmth plan W4) — #22c55e itself reads
    // at 2.2:1 there.
    const painted = '#16803d';
    expect(htmlStyle.getPropertyValue('--accent-color')).toBe(painted);
    expect(htmlStyle.getPropertyValue('--accent')).toBe(painted);
    expect(htmlStyle.getPropertyValue('--accent-foreground')).toBe('#ffffff');
    expect(htmlStyle.getPropertyValue('--focus')).toBe(painted);
    expect(htmlStyle.getPropertyValue('--link')).toBe(painted);
    expect(htmlStyle.getPropertyValue('--border-focus')).toContain(painted);
    expect(htmlStyle.getPropertyValue('--input-focus-border')).toContain(painted);
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

  describe('community colour', () => {
    function CommunityProbe({ colour }: { colour: string | null }) {
      const { setCommunityAccent } = useTheme();
      useEffect(() => {
        setCommunityAccent(colour);
      }, [colour, setCommunityAccent]);
      return null;
    }

    const accent = () => document.documentElement.style.getPropertyValue('--accent');

    it('colours the site when the member has not chosen a colour of their own', async () => {
      render(
        <ThemeProvider>
          <CommunityProbe colour="#a3195b" />
        </ThemeProvider>
      );

      await act(async () => {});
      expect(accent()).toBe('#a3195b');
      expect(document.documentElement.style.getPropertyValue('--link')).toBe('#a3195b');
      expect(document.documentElement.style.getPropertyValue('--accent-foreground')).toBe('#ffffff');
    });

    it('brings a companion colour with it: a near neighbour on the colour wheel', async () => {
      const companion = () => document.documentElement.style.getPropertyValue('--companion');
      const { rerender } = render(
        <ThemeProvider>
          <CommunityProbe colour="#0f766e" />
        </ThemeProvider>
      );

      await act(async () => {});
      // Teal's companion is sky; the standard colour's is pink.
      expect(companion()).toMatch(/^var\(--color-sky-[45]00\)$/);

      rerender(
        <ThemeProvider>
          <CommunityProbe colour={null} />
        </ThemeProvider>
      );
      await act(async () => {});
      expect(companion()).toMatch(/^var\(--color-pink-[45]00\)$/);
    });

    it('steps aside for a colour the member picked themselves', async () => {
      render(
        <ThemeProvider>
          <CommunityProbe colour="#a3195b" />
          <TestComponent />
        </ThemeProvider>
      );

      await act(async () => {
        screen.getByRole('button', { name: 'Set Green Accent' }).click();
      });
      // The member's own green (deepened to read on the light theme), not the community's.
      expect(accent()).toBe('#16803d');
    });

    it('goes back to the standard colour when the community clears its colour', async () => {
      const { rerender } = render(
        <ThemeProvider>
          <CommunityProbe colour="#a3195b" />
        </ThemeProvider>
      );
      await act(async () => {});

      rerender(
        <ThemeProvider>
          <CommunityProbe colour={null} />
        </ThemeProvider>
      );
      await act(async () => {});
      // The standard colour, as painted on the light theme.
      expect(accent()).toBe('#5b5ede');
    });

    it('ignores a value that is not a colour', async () => {
      render(
        <ThemeProvider>
          <CommunityProbe colour="red;background:url(x)" />
        </ThemeProvider>
      );

      await act(async () => {});
      expect(accent()).toBe('#5b5ede');
    });

    it('paints the standard colour a touch deeper on the light theme, so white text on it and coloured text on the page both pass AA', async () => {
      // #6366f1 itself measures 4.47:1 under white text and 4.28:1 as text on
      // the warm page (#fafaf9) — both just under 4.5:1 (owner, 9 Nov).
      render(
        <ThemeProvider>
          <CommunityProbe colour={null} />
        </ThemeProvider>
      );

      await act(async () => {});
      const painted = accent();
      expect(painted).not.toBe('#6366f1');
      expect(getContrastRatio(painted, '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(painted, '#fafaf9')).toBeGreaterThanOrEqual(4.5);
      expect(document.documentElement.style.getPropertyValue('--accent-foreground')).toBe('#ffffff');
    });

    it('lightens the standard colour on the dark theme so it reads as text there, like a community colour', async () => {
      render(
        <ThemeProvider defaultTheme="dark">
          <CommunityProbe colour={null} />
        </ThemeProvider>
      );

      await act(async () => {});
      expect(getContrastRatio(accent(), '#18181b')).toBeGreaterThanOrEqual(4.5);
    });

    // Warmth plan W4 (10 Nov 2026), measured with real community colours: a
    // colour saved before Admin → Settings began refusing pale ones (or a
    // bright colour a member picks) was used as-is for text on the light
    // theme — a pale yellow read at 1.5:1. It is now deepened just enough,
    // keeping its family, as the dark theme already lightens.
    it.each(['#facc15', '#22c55e', '#ef4444'])(
      'deepens a colour too pale to read as text on the light theme (%s)',
      async (colour) => {
        render(
          <ThemeProvider defaultTheme="light">
            <CommunityProbe colour={colour} />
          </ThemeProvider>
        );
        await act(async () => {});
        expect(accent()).not.toBe(colour);
        expect(getContrastRatio(accent(), '#fafaf9')).toBeGreaterThanOrEqual(4.5);
        expect(getContrastRatio(accent(), '#ffffff')).toBeGreaterThanOrEqual(4.5);
        expect(accent()).not.toBe('#000000');
      },
    );

    it('leaves a colour that already reads on the light theme exactly as chosen', async () => {
      render(
        <ThemeProvider defaultTheme="light">
          <CommunityProbe colour="#1e3a8a" />
        </ThemeProvider>
      );
      await act(async () => {});
      expect(accent()).toBe('#1e3a8a');
    });

    const strong = () => document.documentElement.style.getPropertyValue('--accent-strong');

    it.each(['light', 'dark'] as const)(
      'gives the colour a button shade that carries white text at 4.5:1 or better (%s theme)',
      async (theme) => {
        render(
          <ThemeProvider defaultTheme={theme}>
            <CommunityProbe colour={null} />
          </ThemeProvider>
        );
        await act(async () => {});
        expect(getContrastRatio(strong(), '#ffffff')).toBeGreaterThanOrEqual(4.5);
      },
    );

    it('deepens a light colour for buttons, keeping its family, and leaves a dark enough one alone', async () => {
      const { rerender } = render(
        <ThemeProvider>
          <CommunityProbe colour="#22c55e" />
        </ThemeProvider>
      );
      await act(async () => {});
      expect(getContrastRatio(strong(), '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(strong()).not.toBe('#22c55e');

      rerender(
        <ThemeProvider>
          <CommunityProbe colour="#a3195b" />
        </ThemeProvider>
      );
      await act(async () => {});
      expect(strong()).toBe('#a3195b');
    });

    it('uses the same button shade on the dark theme as on the light one', async () => {
      render(
        <ThemeProvider defaultTheme="dark">
          <CommunityProbe colour="#a3195b" />
        </ThemeProvider>
      );
      await act(async () => {});
      // The text shade is lightened for the dark page; the button shade is not.
      expect(accent()).not.toBe('#a3195b');
      expect(strong()).toBe('#a3195b');
    });

    it("colours a phone's browser bar with the button shade on the light theme, and the page colour on the dark one", async () => {
      const meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      document.head.appendChild(meta);
      try {
        const { unmount } = render(
          <ThemeProvider>
            <CommunityProbe colour="#a3195b" />
          </ThemeProvider>
        );
        await act(async () => {});
        expect(meta.getAttribute('content')).toBe('#a3195b');
        unmount();

        render(
          <ThemeProvider defaultTheme="dark">
            <CommunityProbe colour="#a3195b" />
          </ThemeProvider>
        );
        await act(async () => {});
        expect(meta.getAttribute('content')).toBe('#0c0a09');
      } finally {
        meta.remove();
      }
    });

    it('uses a lighter shade in dark mode so links stay readable on the dark page', async () => {
      render(
        <ThemeProvider defaultTheme="dark">
          <CommunityProbe colour="#a3195b" />
        </ThemeProvider>
      );

      await act(async () => {});
      const darkAccent = accent();
      expect(darkAccent).not.toBe('#a3195b');
      expect(getContrastRatio(darkAccent, '#18181b')).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe('community look (warmth plan D1)', () => {
    function LookProbe({ colour, look }: { colour: string | null; look: string | null }) {
      const { setCommunityAccent, setCommunityLook } = useTheme();
      useEffect(() => {
        setCommunityAccent(colour);
        setCommunityLook(look);
      }, [colour, look, setCommunityAccent, setCommunityLook]);
      return null;
    }
    const radius = () => document.documentElement.style.getPropertyValue('--radius');
    const companion = () => document.documentElement.style.getPropertyValue('--companion');

    it('brings its own companion colour and corners, and takes them away again', async () => {
      const { rerender } = render(
        <ThemeProvider>
          <LookProbe colour="#334155" look="slate" />
        </ThemeProvider>
      );
      await act(async () => {});
      expect(companion()).toMatch(/^var\(--color-sky-[45]00\)$/);
      expect(radius()).toBe('0.25rem');

      rerender(
        <ThemeProvider>
          <LookProbe colour="#15803d" look="meadow" />
        </ThemeProvider>
      );
      await act(async () => {});
      expect(companion()).toMatch(/^var\(--color-amber-[45]00\)$/);
      expect(radius()).toBe('0.875rem');

      rerender(
        <ThemeProvider>
          <LookProbe colour="#15803d" look={null} />
        </ThemeProvider>
      );
      await act(async () => {});
      expect(radius()).toBe('');
    });

    it('ignores a name that is not one of ours', async () => {
      render(
        <ThemeProvider>
          <LookProbe colour={null} look="neon;x" />
        </ThemeProvider>
      );
      await act(async () => {});
      expect(radius()).toBe('');
    });
  });
  describe('colour strength: soft or vivid (warmth phase 5)', () => {
    function StrengthProbe({ strength, highContrast = false }: { strength: string | null; highContrast?: boolean }) {
      const { setCommunityColourStrength, setHighContrast } = useTheme();
      useEffect(() => {
        setCommunityColourStrength(strength);
        setHighContrast(highContrast);
      }, [strength, highContrast, setCommunityColourStrength, setHighContrast]);
      return null;
    }
    const strength = () => document.documentElement.getAttribute('data-colour-strength');

    it('is soft unless the community chose vivid, and is taken away again', async () => {
      const { rerender } = render(
        <ThemeProvider>
          <StrengthProbe strength={null} />
        </ThemeProvider>
      );
      await act(async () => {});
      expect(strength()).toBeNull();

      rerender(
        <ThemeProvider>
          <StrengthProbe strength="vivid" />
        </ThemeProvider>
      );
      await act(async () => {});
      expect(strength()).toBe('vivid');

      rerender(
        <ThemeProvider>
          <StrengthProbe strength="soft" />
        </ThemeProvider>
      );
      await act(async () => {});
      expect(strength()).toBeNull();
    });

    it('accepts only our own two names', async () => {
      render(
        <ThemeProvider>
          <StrengthProbe strength="neon" />
        </ThemeProvider>
      );
      await act(async () => {});
      expect(strength()).toBeNull();
    });

    // High contrast is a member's own accessibility choice: plain surfaces,
    // no decorative fills. It wins over the community's vivid look.
    it("is switched off by the member's high-contrast setting", async () => {
      render(
        <ThemeProvider>
          <StrengthProbe strength="vivid" highContrast />
        </ThemeProvider>
      );
      await act(async () => {});
      expect(strength()).toBeNull();
    });

    // Covers and kind tiles choose their vivid palette fills in code
    // (useSiteVivid), so the value must follow the same rule as <html>.
    it('tells components that read it as a value the same thing as the page', async () => {
      function VividValue() {
        return <span data-testid="vivid-value">{useSiteVivid() ? 'vivid' : 'soft'}</span>;
      }
      const { rerender } = render(
        <ThemeProvider>
          <StrengthProbe strength="vivid" />
          <VividValue />
        </ThemeProvider>
      );
      await act(async () => {});
      expect(screen.getByTestId('vivid-value')).toHaveTextContent('vivid');

      rerender(
        <ThemeProvider>
          <StrengthProbe strength="vivid" highContrast />
          <VividValue />
        </ThemeProvider>
      );
      await act(async () => {});
      expect(screen.getByTestId('vivid-value')).toHaveTextContent('soft');
      expect(strength()).toBeNull();
    });
  });
});
