// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import { buildVideoEmbedSrc, parseVideoEmbedUrl } from './videoEmbed';

describe('parseVideoEmbedUrl (F-195)', () => {
  it('recognises the YouTube and Vimeo link shapes members paste', () => {
    expect(parseVideoEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10')).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' });
    expect(parseVideoEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' });
    expect(parseVideoEmbedUrl('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' });
    expect(parseVideoEmbedUrl('https://youtube.com/shorts/dQw4w9WgXcQ')).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' });
    expect(parseVideoEmbedUrl('https://vimeo.com/76979871')).toEqual({ provider: 'vimeo', id: '76979871' });
    expect(parseVideoEmbedUrl('https://player.vimeo.com/video/76979871')).toEqual({ provider: 'vimeo', id: '76979871' });
  });

  it('rejects look-alike hosts, other sites and non-web schemes', () => {
    for (const url of [
      'https://docs.google.com/forms/d/e/fake/viewform',
      'https://evil.example/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
      'https://evil.example/?next=youtube.com/embed/dQw4w9WgXcQ',
      'https://user@www.youtube.com/watch?v=dQw4w9WgXcQ',
      'javascript:alert(1)//youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=short',
      'https://vimeo.com/channels/staffpicks',
      '',
    ]) {
      expect(parseVideoEmbedUrl(url)).toBeNull();
    }
  });

  it('builds the player address only from the parsed id', () => {
    expect(buildVideoEmbedSrc('https://www.youtube.com/watch?v=dQw4w9WgXcQ&autoplay=1&origin=evil'))
      .toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?cc_load_policy=1');
    expect(buildVideoEmbedSrc('https://docs.google.com/forms/d/e/fake/viewform')).toBeNull();
  });
});
