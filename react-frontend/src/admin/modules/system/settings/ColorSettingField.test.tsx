// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/test-utils';
import { ColorSettingField } from './ColorSettingField';

// The real HeroUI picker, area and slider, not mocks: the hue slider takes its
// colour from the picker around it, and that hand-over is what these pin. On
// 12 Nov 2026 opening the picker crashed the whole settings page with
// "useColorSliderState requires a value or defaultValue" on a dev server that
// had loaded two copies of the slider; nothing had ever opened the picker in a
// test, so nothing could tell a broken hand-over from a working one.
describe('ColorSettingField', () => {
  function renderField(value: string, onChange = vi.fn()) {
    render(
      <ColorSettingField
        id="community-colour"
        label="Or use your own brand colour"
        value={value}
        fallback="#6366f1"
        onChange={onChange}
      />,
    );
    return onChange;
  }

  it('opens the picker with the hue slider set from the chosen colour', async () => {
    renderField('#a3195b');

    await userEvent.click(screen.getByRole('button', { name: 'Or use your own brand colour' }));

    // #a3195b is hue 331 in HSB; the slider only shows that if the picker
    // handed it the colour.
    const hue = await screen.findByRole('slider', { name: /hex/i });
    expect(hue).toHaveValue('331');
  });

  it('opens on the standard colour when the community has not chosen one', async () => {
    renderField('');

    await userEvent.click(screen.getByRole('button', { name: 'Or use your own brand colour' }));

    // #6366f1 is hue 239 in HSB.
    expect(await screen.findByRole('slider', { name: /hex/i })).toHaveValue('239');
  });

  it('saves a pasted hex code once it is a full colour, and not before', async () => {
    const onChange = renderField('');
    const hex = screen.getByRole('textbox');

    // Half a code is marked invalid without the box being replaced: the
    // cursor has to stay in it for the rest of the code to land.
    await userEvent.type(hex, '#15');
    expect(onChange).not.toHaveBeenCalled();
    expect(hex).toHaveValue('#15');
    expect(hex).toHaveAttribute('aria-invalid', 'true');
    expect(hex).toHaveFocus();

    await userEvent.type(hex, '803D');
    expect(onChange).toHaveBeenLastCalledWith('#15803d');
  });
});
