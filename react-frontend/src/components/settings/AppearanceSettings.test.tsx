// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// Spy references — must be defined before vi.mock()
const mockSetAccentColor = vi.fn();
const mockSetFontSize = vi.fn();
const mockSetDensity = vi.fn();
const mockSetLargeText = vi.fn();
const mockSetHighContrast = vi.fn();
const mockSetReducedMotion = vi.fn();
const mockSetSimplifiedLayout = vi.fn();

vi.mock('@/contexts', () =>
  createMockContexts({
    useTheme: () => ({
      resolvedTheme: 'light' as const,
      theme: 'system' as const,
      toggleTheme: vi.fn(),
      setTheme: vi.fn(),
      // ThemePreferences
      accentColor: '#6366f1',
      fontSize: 'medium' as const,
      density: 'comfortable' as const,
      largeText: false,
      highContrast: false,
      reducedMotion: false,
      simplifiedLayout: false,
      // Setters — spied
      setAccentColor: mockSetAccentColor,
      setFontSize: mockSetFontSize,
      setDensity: mockSetDensity,
      setLargeText: mockSetLargeText,
      setHighContrast: mockSetHighContrast,
      setReducedMotion: mockSetReducedMotion,
      setSimplifiedLayout: mockSetSimplifiedLayout,
      isLoading: false,
      isInitialized: true,
    }),
  })
);

import { AppearanceSettings } from './AppearanceSettings';

describe('AppearanceSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Accent color ──────────────────────────────────────────────────────────

  it('renders accent color swatch buttons', () => {
    render(<AppearanceSettings />);
    // Each swatch has an aria-label "Select {color} color" (or similar key)
    const swatches = screen.getAllByRole('button', { hidden: false });
    // At least 10 color swatches + font size buttons + density buttons
    expect(swatches.length).toBeGreaterThanOrEqual(10);
  });

  it('calls setAccentColor when a color swatch is pressed', () => {
    render(<AppearanceSettings />);
    // Find the indigo swatch by aria-label (i18n returns key in test env)
    const indigo = screen.getByRole('button', {
      name: /indigo/i,
    });
    fireEvent.click(indigo);
    expect(mockSetAccentColor).toHaveBeenCalledWith('#6366f1');
  });

  it('renders a checkmark icon on the currently selected accent color', () => {
    render(<AppearanceSettings />);
    // The selected swatch (#6366f1 = indigo) renders a Check icon (aria-hidden)
    // Confirm the swatch button contains an svg or aria-hidden child
    const indigoBtn = screen.getByRole('button', { name: /indigo/i });
    // The button has a child with aria-hidden="true" (the lucide icon)
    const hiddenChild = indigoBtn.querySelector('[aria-hidden="true"]');
    expect(hiddenChild).not.toBeNull();
  });

  // ── Font size ─────────────────────────────────────────────────────────────
  // The settings locale maps font_small → "S", font_medium → "M", font_large → "L"

  it('renders font size buttons (S / M / L)', () => {
    render(<AppearanceSettings />);
    expect(screen.getByRole('button', { name: 'S' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'M' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'L' })).toBeInTheDocument();
  });

  it('calls setFontSize with "small" when S button is pressed', () => {
    render(<AppearanceSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'S' }));
    expect(mockSetFontSize).toHaveBeenCalledWith('small');
  });

  it('calls setFontSize with "large" when L button is pressed', () => {
    render(<AppearanceSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'L' }));
    expect(mockSetFontSize).toHaveBeenCalledWith('large');
  });

  // ── Density ───────────────────────────────────────────────────────────────

  it('renders density buttons (Compact / Comfortable / Spacious)', () => {
    render(<AppearanceSettings />);
    expect(screen.getByRole('button', { name: /compact/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /comfortable/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /spacious/i })).toBeInTheDocument();
  });

  it('calls setDensity with "compact" when Compact is pressed', () => {
    render(<AppearanceSettings />);
    fireEvent.click(screen.getByRole('button', { name: /compact/i }));
    expect(mockSetDensity).toHaveBeenCalledWith('compact');
  });

  it('calls setDensity with "spacious" when Spacious is pressed', () => {
    render(<AppearanceSettings />);
    fireEvent.click(screen.getByRole('button', { name: /spacious/i }));
    expect(mockSetDensity).toHaveBeenCalledWith('spacious');
  });

  // ── Accessibility toggles ────────────────────────────────────────────────

  it('renders 4 accessibility toggle switches', () => {
    render(<AppearanceSettings />);
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(4);
  });

  it('calls setLargeText when Large Text switch is toggled', () => {
    render(<AppearanceSettings />);
    // i18n resolves appearance_prefs.large_text → "Large Text"
    const largeTextSwitch = screen.getByRole('switch', { name: 'Large Text' });
    fireEvent.click(largeTextSwitch);
    expect(mockSetLargeText).toHaveBeenCalled();
  });

  it('calls setHighContrast when High Contrast switch is toggled', () => {
    render(<AppearanceSettings />);
    const switch_ = screen.getByRole('switch', { name: 'High Contrast' });
    fireEvent.click(switch_);
    expect(mockSetHighContrast).toHaveBeenCalled();
  });

  it('calls setReducedMotion when Reduced Motion switch is toggled', () => {
    render(<AppearanceSettings />);
    const switch_ = screen.getByRole('switch', { name: 'Reduced Motion' });
    fireEvent.click(switch_);
    expect(mockSetReducedMotion).toHaveBeenCalled();
  });

  it('calls setSimplifiedLayout when Simplified Layout switch is toggled', () => {
    render(<AppearanceSettings />);
    const switch_ = screen.getByRole('switch', { name: 'Simplified Layout' });
    fireEvent.click(switch_);
    expect(mockSetSimplifiedLayout).toHaveBeenCalled();
  });

  // ── Structure ─────────────────────────────────────────────────────────────

  it('renders without crashing', () => {
    const { container } = render(<AppearanceSettings />);
    expect(container.firstChild).not.toBeNull();
  });
});

describe('AppearanceSettings — light/dark choice and live preview (warmth D3)', () => {
  it('shows a live preview card that is not a control', () => {
    render(<AppearanceSettings />);
    const preview = screen.getByTestId('appearance-preview');
    expect(preview.querySelector('button')).toBeNull();
  });

  it('offers light, dark and system as one radio group, with the current choice checked', () => {
    render(<AppearanceSettings />);
    const options = screen.getAllByRole('radio');
    expect(options).toHaveLength(3);
    expect(screen.getByTestId('scheme-system')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('scheme-dark')).toHaveAttribute('aria-checked', 'false');
  });
});
