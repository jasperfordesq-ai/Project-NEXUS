// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';
import { getContrastRatio, AA_NORMAL_TEXT_CONTRAST } from '@/lib/colorContrast';
import { DEFAULT_SETTINGS, type SettingsForm } from '../settingsForm';
import { COMMUNITY_LOOKS } from '@/lib/communityLooks';
import type { AdminSettingsFormState } from '../useAdminSettingsForm';
import {
  CommunityColourSection,
  COMMUNITY_COLOUR_PRESETS,
  communityColourTooLight,
} from './CommunityColourSection';

function stateWith(form: Partial<SettingsForm>, setField = vi.fn()): AdminSettingsFormState {
  return {
    form: { ...DEFAULT_SETTINGS, ...form },
    setField,
  } as unknown as AdminSettingsFormState;
}

describe('CommunityColourSection', () => {
  it('only suggests colours that are readable as text on white', () => {
    expect(COMMUNITY_COLOUR_PRESETS.length).toBeGreaterThanOrEqual(6);
    for (const preset of COMMUNITY_COLOUR_PRESETS) {
      expect(getContrastRatio(preset, '#ffffff')).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_CONTRAST);
    }
  });

  it('calls a colour too light only when it cannot be read on white', () => {
    expect(communityColourTooLight('')).toBe(false);
    expect(communityColourTooLight('#a3195b')).toBe(false);
    expect(communityColourTooLight('#facc15')).toBe(true);
  });

  it('saves a suggested colour when the admin picks it', () => {
    const setField = vi.fn();
    render(<CommunityColourSection state={stateWith({}, setField)} />);

    const swatches = screen.getAllByRole('option');
    expect(swatches.length).toBe(COMMUNITY_COLOUR_PRESETS.length);
    fireEvent.click(swatches[0]!);

    expect(setField).toHaveBeenCalledWith('community_color', COMMUNITY_COLOUR_PRESETS[0]);
  });

  it('warns about a colour too light to read, and says nothing about a good one', () => {
    const { rerender } = render(<CommunityColourSection state={stateWith({ community_color: '#facc15' })} />);
    expect(screen.getByText(/too light to read on a white page/i)).toBeInTheDocument();

    rerender(<CommunityColourSection state={stateWith({ community_color: '#a3195b' })} />);
    expect(screen.queryByText(/too light to read on a white page/i)).toBeNull();
  });

  it('previews the chosen colour on real HeroUI controls', () => {
    render(<CommunityColourSection state={stateWith({ community_color: '#a3195b' })} />);
    const preview = screen.getByTestId('community-colour-preview');
    expect(preview.style.getPropertyValue('--accent')).toBe('#a3195b');
    expect(screen.getByRole('button', { name: 'Offer help' })).toBeInTheDocument();
  });

  // Ready-made looks (warmth plan D1)
  it('fills in the colour and the look together when a look is chosen', () => {
    const setField = vi.fn();
    render(<CommunityColourSection state={stateWith({}, setField)} />);
    fireEvent.click(screen.getByTestId('community-look-meadow'));
    expect(setField).toHaveBeenCalledWith('community_color', '#15803d');
    expect(setField).toHaveBeenCalledWith('community_look', 'meadow');
  });

  it('marks the chosen look, and "no look" clears it', () => {
    const setField = vi.fn();
    render(<CommunityColourSection state={stateWith({ community_look: 'slate' }, setField)} />);
    expect(screen.getByTestId('community-look-slate')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('community-look-none')).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByTestId('community-look-none'));
    expect(setField).toHaveBeenCalledWith('community_look', '');
  });

  it('only offers looks whose colour reads on white', () => {
    for (const look of COMMUNITY_LOOKS) {
      expect(getContrastRatio(look.colour, '#ffffff')).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_CONTRAST);
    }
  });
});

