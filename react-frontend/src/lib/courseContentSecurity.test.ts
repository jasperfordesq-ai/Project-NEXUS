// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import { courseEmbedSrc, normalizeCourseMediaUrl } from './courseContentSecurity';

describe('normalizeCourseMediaUrl', () => {
  it('allows http and https media URLs', () => {
    expect(normalizeCourseMediaUrl('https://example.com/lesson.pdf')).toBe('https://example.com/lesson.pdf');
    expect(normalizeCourseMediaUrl('http://example.com/video.mp4')).toBe('http://example.com/video.mp4');
  });

  it('blocks scriptable and non-web URL schemes', () => {
    expect(normalizeCourseMediaUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeCourseMediaUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(normalizeCourseMediaUrl('file:///C:/secret.pdf')).toBeNull();
  });

  it('returns null for malformed URLs', () => {
    expect(normalizeCourseMediaUrl('not a url')).toBeNull();
    expect(normalizeCourseMediaUrl('')).toBeNull();
  });
});

describe('courseEmbedSrc (F-195)', () => {
  it('rebuilds YouTube and Vimeo players from the parsed id', () => {
    expect(courseEmbedSrc('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?cc_load_policy=1');
    expect(courseEmbedSrc('https://player.vimeo.com/video/76979871?h=abc')).toBe('https://player.vimeo.com/video/76979871');
  });

  it('refuses every other site, including Google-hosted pages the CSP allows', () => {
    expect(courseEmbedSrc('https://docs.google.com/forms/d/e/fake/viewform')).toBeNull();
    expect(courseEmbedSrc('https://sites.google.com/view/fake-login')).toBeNull();
    expect(courseEmbedSrc('https://example.com/embed')).toBeNull();
    expect(courseEmbedSrc('javascript:alert(1)')).toBeNull();
    expect(courseEmbedSrc(null)).toBeNull();
  });
});
