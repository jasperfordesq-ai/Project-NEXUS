// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const nunjucks = require('nunjucks');
const path = require('path');

/**
 * A video lesson had no text alternative at all, and `course_lessons` had
 * nowhere to store one — a WCAG 1.2 failure found by the accessible-frontend
 * audit (2026-08-23). There is still no captions file in the schema, so the
 * instructor's transcript is the alternative a learner who cannot hear or watch
 * the video actually has.
 *
 * This renders the real template so it proves what a learner sees, and pins the
 * escaping: a transcript is typed prose, not authored HTML, so markup inside it
 * must appear as text.
 */
const env = nunjucks.configure(
  [path.join(__dirname, '..', 'src', 'views'), path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
  { autoescape: true, noCache: true }
);

// The partial uses the same nl2br filter the podcast episode page does.
const { nl2br } = require('../src/lib/nl2br');
env.addFilter('nl2br', nl2br);

function render(lesson) {
  return env.render('courses/_lesson-transcript.njk', {
    t: (key) => key,
    currentLesson: lesson
  });
}

describe('course lesson transcript', () => {
  it('shows the transcript in a disclosure when the instructor provided one', () => {
    const html = render({ transcript: 'Hello and welcome.\nThis is the second line.' });

    expect(html).toContain('govuk-details');
    expect(html).toContain('govuk_alpha_commerce.builder.transcript_label');
    expect(html).toContain('Hello and welcome.');
    // Line breaks survive, so a transcript is readable rather than one long run.
    expect(html).toContain('<br');
  });

  it('renders nothing at all when there is no transcript', () => {
    for (const lesson of [{}, { transcript: '' }, { transcript: null }]) {
      expect(render(lesson).trim()).toBe('');
    }
  });

  it('shows markup inside a transcript as text, never as HTML', () => {
    const html = render({ transcript: 'Then I said <script>alert(1)</script> on stage.' });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
