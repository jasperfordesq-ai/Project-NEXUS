// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@/test/test-utils';
import { getContrastRatio, AA_NORMAL_TEXT_CONTRAST, DARK_READING_SURFACE } from '@/lib/colorContrast';
import { SiteDarkContext } from '@/contexts/SiteAccentContext';
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

  // Colours from the community's own logo ("Make it yours", warmth phase 6)
  it('shows no "From your logo" row unless the page passes colours from the logo', () => {
    render(<CommunityColourSection state={stateWith({})} />);
    expect(screen.queryByTestId('community-colour-from-logo')).toBeNull();
  });

  it('offers the colours from the logo above the general suggestions, and uses the one picked', () => {
    const setField = vi.fn();
    render(<CommunityColourSection state={stateWith({}, setField)} logoColours={['#0f766e', '#a3195b']} />);

    const fromLogo = screen.getByTestId('community-colour-from-logo');
    expect(within(fromLogo).getByText('From your logo')).toBeInTheDocument();
    // Above the general list, because it is the one that is theirs.
    expect(
      fromLogo.compareDocumentPosition(screen.getByText('Suggested colours')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const swatches = within(fromLogo).getAllByRole('option');
    expect(swatches).toHaveLength(2);
    fireEvent.click(swatches[1]!);
    expect(setField).toHaveBeenCalledWith('community_color', '#a3195b');
    // A logo colour is offered, never applied: nothing is set until it is picked.
    expect(setField).toHaveBeenCalledTimes(1);
  });

  it('marks a logo colour as chosen when it is the community colour', () => {
    render(<CommunityColourSection state={stateWith({ community_color: '#0f766e' })} logoColours={['#0f766e', '#a3195b']} />);
    const swatches = within(screen.getByTestId('community-colour-from-logo')).getAllByRole('option');
    expect(swatches[0]).toHaveAttribute('aria-selected', 'true');
    expect(swatches[1]).toHaveAttribute('aria-selected', 'false');
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

  // In dark mode the live site lightens a colour until it reads on a dark
  // card. Shown raw, this amber's sample link was 4.06:1 there (axe, 13 Nov 2026).
  it('previews words and links in the shade the dark theme will really use', () => {
    render(
      <SiteDarkContext.Provider value={true}>
        <CommunityColourSection state={stateWith({ community_color: '#a46a07' })} />
      </SiteDarkContext.Provider>,
    );
    const preview = screen.getByTestId('community-colour-preview');
    for (const token of ['--link', '--accent', '--focus']) {
      const shade = preview.style.getPropertyValue(token);
      expect(shade).not.toBe('#a46a07');
      expect(getContrastRatio(shade, DARK_READING_SURFACE)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_CONTRAST);
    }
    // The button keeps the shade white words read on, in both themes.
    expect(
      getContrastRatio(preview.style.getPropertyValue('--accent-strong'), '#ffffff'),
    ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_CONTRAST);
  });

  it('previews the colour exactly as typed in light mode, so a too-pale colour looks too pale', () => {
    render(<CommunityColourSection state={stateWith({ community_color: '#facc15' })} />);
    expect(screen.getByTestId('community-colour-preview').style.getPropertyValue('--link')).toBe('#facc15');
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

  // 12 Nov 2026: there were ten suggested colours and six looks, so four
  // colours (rose, amber, teal, indigo) had no look to go with them.
  it('offers a look for every suggested colour, in the same order as the colours', () => {
    expect(COMMUNITY_LOOKS.map((look) => look.colour)).toEqual([...COMMUNITY_COLOUR_PRESETS]);
    expect(new Set(COMMUNITY_LOOKS.map((look) => look.id)).size).toBe(COMMUNITY_LOOKS.length);
  });

  it('draws every look with its own band, button and name', () => {
    render(<CommunityColourSection state={stateWith({})} />);
    for (const look of COMMUNITY_LOOKS) {
      const card = screen.getByTestId(`community-look-${look.id}`);
      // The band and the sample button are written-out classes per look; a
      // look added to the list without them would draw as a blank card.
      const band = card.querySelector('.bg-linear-to-r');
      expect(band?.className).toContain(`from-[${look.colour}]`);
      expect(band?.className).toContain(`to-${look.companion}-500`);
      expect(card.querySelector(`.bg-\\[${look.colour.replace('#', '\\#')}\\]`)).not.toBeNull();
      // A name from the translations, not the raw key.
      expect(card.textContent).not.toContain('community_look_');
    }
  });

  // Warmth phase 5: how strongly the colour is worn.
  it('offers soft and vivid, with soft chosen until the admin picks vivid', () => {
    render(<CommunityColourSection state={stateWith({})} />);
    expect(within(screen.getByTestId('colour-strength-soft')).getByRole('radio')).toBeChecked();
    expect(within(screen.getByTestId('colour-strength-vivid')).getByRole('radio')).not.toBeChecked();
  });

  // A radio group is one stop on the Tab key and moves with the arrow keys.
  // The hand-made buttons were two tab stops with no arrow keys (audit of
  // warmth phase 5, 12 Nov 2026); HeroUI's RadioGroup does it properly.
  it('works like any choice list from the keyboard: one tab stop, arrows move', () => {
    const setField = vi.fn();
    render(<CommunityColourSection state={stateWith({}, setField)} />);
    const group = screen.getByRole('radiogroup', { name: 'How bold should the colour be?' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios.filter((radio) => radio.tabIndex === 0)).toHaveLength(1);

    radios[0]!.focus();
    fireEvent.keyDown(radios[0]!, { key: 'ArrowRight' });
    expect(setField).toHaveBeenCalledWith('colour_strength', 'vivid');
  });

  it('saves vivid when the admin picks it, and soft when they go back', () => {
    const setField = vi.fn();
    const { rerender } = render(<CommunityColourSection state={stateWith({}, setField)} />);
    fireEvent.click(within(screen.getByTestId('colour-strength-vivid')).getByRole('radio'));
    expect(setField).toHaveBeenCalledWith('colour_strength', 'vivid');

    rerender(<CommunityColourSection state={stateWith({ colour_strength: 'vivid' }, setField)} />);
    expect(within(screen.getByTestId('colour-strength-vivid')).getByRole('radio')).toBeChecked();
    fireEvent.click(within(screen.getByTestId('colour-strength-soft')).getByRole('radio'));
    expect(setField).toHaveBeenCalledWith('colour_strength', 'soft');
  });

  it('shows a page opening in the chosen strength: tinted for soft, filled with white text for vivid', () => {
    const { rerender } = render(<CommunityColourSection state={stateWith({ community_color: '#a3195b' })} />);
    const opening = () => screen.getByTestId('community-colour-preview-opening');
    expect(opening().className).toContain('bg-accent-soft');
    expect(opening().className).not.toContain('from-accent-strong');

    rerender(<CommunityColourSection state={stateWith({ community_color: '#a3195b', colour_strength: 'vivid' })} />);
    expect(opening().className).toContain('from-accent-strong');
    expect(opening().className).toContain('text-white');
  });

  it('previews the button shade of the colour being edited, readable under white text', () => {
    render(<CommunityColourSection state={stateWith({ community_color: '#a3195b', colour_strength: 'vivid' })} />);
    const box = screen.getByTestId('community-colour-preview');
    const strong = box.style.getPropertyValue('--accent-strong');
    expect(strong).toMatch(/^#[0-9a-f]{6}$/i);
    expect(getContrastRatio(strong, '#ffffff')).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_CONTRAST);
  });
});

