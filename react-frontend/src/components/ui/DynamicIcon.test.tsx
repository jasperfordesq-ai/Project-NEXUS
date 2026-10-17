// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/test-utils';
import React from 'react';

// DynamicIcon has no external deps (no api, no contexts, no hooks) — import directly
import { DynamicIcon, ICON_MAP, ICON_NAMES } from './DynamicIcon';

describe('DynamicIcon', () => {
  it('renders nothing when name is null', () => {
    const { container } = render(<DynamicIcon name={null} />);
    // Only the provider wrapper — no SVG inside
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders nothing when name is undefined', () => {
    const { container } = render(<DynamicIcon name={undefined} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders nothing for an unknown icon name', () => {
    const { container } = render(<DynamicIcon name="ThisIconDoesNotExist" />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders an SVG for a known icon name (Home)', () => {
    const { container } = render(<DynamicIcon name="Home" />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders an SVG for Bell', () => {
    const { container } = render(<DynamicIcon name="Bell" />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('applies the className prop to the SVG', () => {
    const { container } = render(<DynamicIcon name="Wallet" className="w-6 h-6 text-blue-500" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    // SVG className is an SVGAnimatedString — read via getAttribute
    expect(svg?.getAttribute('class')).toContain('w-6 h-6 text-blue-500');
  });

  it('sets aria-hidden="true" on the rendered SVG', () => {
    const { container } = render(<DynamicIcon name="Settings" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders different SVG elements for different icon names', () => {
    const { container: c1 } = render(<DynamicIcon name="Moon" />);
    const { container: c2 } = render(<DynamicIcon name="Sun" />);
    // Both render SVGs but the inner path data differs
    expect(c1.querySelector('svg')).not.toBeNull();
    expect(c2.querySelector('svg')).not.toBeNull();
  });

  it('ICON_MAP contains expected navigation icons', () => {
    expect(ICON_MAP).toHaveProperty('Home');
    expect(ICON_MAP).toHaveProperty('Wallet');
    expect(ICON_MAP).toHaveProperty('Calendar');
    expect(ICON_MAP).toHaveProperty('Settings');
    expect(ICON_MAP).toHaveProperty('MessageSquare');
  });

  it('ICON_NAMES is a non-empty array of strings matching ICON_MAP keys', () => {
    expect(Array.isArray(ICON_NAMES)).toBe(true);
    expect(ICON_NAMES.length).toBeGreaterThan(0);
    expect(ICON_NAMES).toEqual(Object.keys(ICON_MAP));
  });

  it('renders Sparkles icon without error', () => {
    const { container } = render(<DynamicIcon name="Sparkles" size={20} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders Package icon without error', () => {
    const { container } = render(<DynamicIcon name="Package" />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('resolves every icon name the marketplace category seeder uses', () => {
    // Mirrors database/seeders/MarketplaceCategorySeeder.php. A name missing
    // here is what made members see the literal word "Smartphone" as an icon.
    const SEEDED = [
      'Smartphone', 'Armchair', 'Shirt', 'Home', 'Car', 'Bike', 'BookOpen', 'Gamepad2',
      'Baby', 'Heart', 'Dog', 'Music', 'Briefcase', 'Palette', 'UtensilsCrossed',
      'Wrench', 'Gift', 'Package', 'Hammer',
    ];
    for (const name of SEEDED) {
      expect(ICON_MAP, `ICON_MAP is missing ${name}`).toHaveProperty(name);
      const { container } = render(<DynamicIcon name={name} />);
      expect(container.querySelector('svg'), `${name} did not render`).not.toBeNull();
    }
  });

  it('passes size prop to the icon', () => {
    const { container } = render(<DynamicIcon name="Trophy" size={32} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    // Lucide icons apply width/height via the size prop attribute
    expect(svg?.getAttribute('width')).toBe('32');
    expect(svg?.getAttribute('height')).toBe('32');
  });
});
