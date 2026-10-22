// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import { webPageAudioService } from './audioLinks';

describe('webPageAudioService', () => {
  it('names the service for links that open a web page', () => {
    // The link saved on 21 Oct 2026 that would not play.
    expect(webPageAudioService('https://open.spotify.com/episode/2RYoWagC')).toBe('Spotify');
    expect(webPageAudioService('https://podcasts.apple.com/ie/podcast/x/id1?i=2')).toBe('Apple Podcasts');
    expect(webPageAudioService('https://soundcloud.com/artist/track')).toBe('SoundCloud');
    expect(webPageAudioService('https://www.youtube.com/watch?v=abc')).toBe('YouTube');
    expect(webPageAudioService('https://youtu.be/abc')).toBe('YouTube');
    expect(webPageAudioService('https://drive.google.com/file/d/abc/view?usp=sharing')).toBe('Google Drive');
    expect(webPageAudioService('https://www.dropbox.com/s/abc/episode.mp3?dl=0')).toBe('Dropbox');
    expect(webPageAudioService('https://archive.org/details/my-show-ep1')).toBe('Internet Archive');
  });

  it('lets audio-file links through', () => {
    expect(webPageAudioService('https://example.org/episode.mp3')).toBeNull();
    expect(webPageAudioService('https://www.dropbox.com/s/abc/episode.mp3?raw=1')).toBeNull();
    expect(webPageAudioService('https://www.dropbox.com/scl/fi/abc/ep.mp3?rlkey=x&dl=1')).toBeNull();
    expect(webPageAudioService('https://archive.org/download/my-show-ep1/ep1.mp3')).toBeNull();
    // Spotify for Creators serves the files themselves from anchor.fm.
    expect(webPageAudioService('https://anchor.fm/s/abc/podcast/play/123/ep.mp3')).toBeNull();
  });

  it('is not fooled by a look-alike host and ignores text that is not a link', () => {
    expect(webPageAudioService('https://open.spotify.com.example.org/ep.mp3')).toBeNull();
    expect(webPageAudioService('not a link')).toBeNull();
  });
});
