// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { groupPictureDescription, imageDescription, labelWithImageDescription } from './imageDescription';

describe('imageDescription', () => {
  it('returns the trimmed description a member wrote', () => {
    expect(imageDescription('  A red bicycle leaning on a wall  ')).toBe('A red bicycle leaning on a wall');
  });

  it('treats blank, missing and non-text values as no description', () => {
    expect(imageDescription('')).toBeNull();
    expect(imageDescription('   ')).toBeNull();
    expect(imageDescription(null)).toBeNull();
    expect(imageDescription(undefined)).toBeNull();
    expect(imageDescription(42)).toBeNull();
  });
});

describe('labelWithImageDescription', () => {
  it('keeps the visible title alone when nobody described the photo', () => {
    expect(labelWithImageDescription('Garden help', null)).toBe('Garden help');
    expect(labelWithImageDescription('Garden help', '  ')).toBe('Garden help');
  });

  it('adds the description after the title so a screen reader hears both', () => {
    expect(labelWithImageDescription('Garden help', 'Raised vegetable beds')).toBe('Garden help. Raised vegetable beds');
  });

  it('uses the description alone when there is no title', () => {
    expect(labelWithImageDescription('', 'Raised vegetable beds')).toBe('Raised vegetable beds');
  });
});

describe('groupPictureDescription', () => {
  it('describes the cover when the cover is the picture shown', () => {
    expect(groupPictureDescription({
      cover_image: '/uploads/cover.jpg',
      image_url: '/uploads/avatar.jpg',
      image_alt: 'Group logo',
      cover_image_alt: 'Members at the summer picnic',
    })).toBe('Members at the summer picnic');
  });

  it('describes the group picture when there is no cover', () => {
    expect(groupPictureDescription({
      cover_image: null,
      image_url: '/uploads/avatar.jpg',
      image_alt: 'Group logo',
      cover_image_alt: 'Members at the summer picnic',
    })).toBe('Group logo');
  });

  it('returns null when the picture shown has no description', () => {
    expect(groupPictureDescription({ cover_image: null, image_url: '/uploads/avatar.jpg', image_alt: null })).toBeNull();
  });
});
