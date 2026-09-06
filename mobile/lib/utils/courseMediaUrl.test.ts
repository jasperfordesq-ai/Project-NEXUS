// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { courseMediaFileName, normalizeCourseMediaUrl } from './courseMediaUrl';

describe('normalizeCourseMediaUrl', () => {
  it('keeps ordinary http and https media', () => {
    expect(normalizeCourseMediaUrl('https://cdn.example.org/lesson.mp4'))
      .toBe('https://cdn.example.org/lesson.mp4');
    expect(normalizeCourseMediaUrl('http://cdn.example.org/lesson.pdf'))
      .toBe('http://cdn.example.org/lesson.pdf');
  });

  it.each([
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html;base64,PHNjcmlwdD4=',
    'content://com.android.providers/document/1',
  ])('refuses %s', (value) => {
    // These fields are typed by an instructor and reach a player or `Linking.openURL`. On a
    // phone the last three address the device itself, not the web.
    expect(normalizeCourseMediaUrl(value)).toBeNull();
  });

  it('treats absent, blank and unparseable values as no media rather than throwing', () => {
    // "The instructor has not supplied usable media" is an ordinary state the lesson has to
    // render honestly, not an error to crash the player.
    expect(normalizeCourseMediaUrl(null)).toBeNull();
    expect(normalizeCourseMediaUrl(undefined)).toBeNull();
    expect(normalizeCourseMediaUrl('   ')).toBeNull();
    expect(normalizeCourseMediaUrl('not a url')).toBeNull();
  });
});

describe('courseMediaFileName', () => {
  it('names the file so a learner knows what they are opening', () => {
    expect(courseMediaFileName('https://cdn.example.org/course/handbook.pdf')).toBe('handbook.pdf');
  });

  it('decodes an escaped name', () => {
    expect(courseMediaFileName('https://cdn.example.org/Week%201%20notes.pdf')).toBe('Week 1 notes.pdf');
  });

  it('drops the query string, which is signing noise rather than information', () => {
    expect(courseMediaFileName('https://cdn.example.org/a.pdf?sig=abc&exp=999')).toBe('a.pdf');
  });

  it('returns nothing rather than a useless label', () => {
    expect(courseMediaFileName('https://cdn.example.org/')).toBeNull();
    expect(courseMediaFileName('nonsense')).toBeNull();
    expect(courseMediaFileName(`https://cdn.example.org/${'a'.repeat(200)}.pdf`)).toBeNull();
  });
});
