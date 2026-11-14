// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * B1 walk 4.2 (13 Nov 2026): on a 375px phone the floating language button sat
 * on top of the sign-in card's top-right corner. jsdom cannot measure layout, so
 * this pins the arrangement that prevents it: on a phone the button takes its
 * own row above the card; it only floats over the page from the `sm` width up,
 * where the card is narrower than the screen.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';

vi.mock('@/components/LanguageSwitcher', () => ({
  LanguageSwitcher: () => <button type="button">EN</button>,
}));
vi.mock('./SourceRepositoryLink', () => ({ SourceRepositoryLink: () => null }));

import { AuthLayout } from './AuthLayout';

describe('AuthLayout — language button', () => {
  it('takes its own row on a phone and floats only from the sm width up', () => {
    render(<AuthLayout />);
    const holder = screen.getByTestId('auth-language-switcher');
    const classes = holder.className.split(/\s+/);

    // Phone: in the normal flow, so it cannot cover the card.
    expect(classes).not.toContain('absolute');
    expect(classes).toContain('flex');
    expect(classes).toContain('justify-end');
    // Wider screens: floats in the corner as before.
    expect(classes).toContain('sm:absolute');
    expect(holder).toContainElement(screen.getByRole('button', { name: 'EN' }));
  });
});
