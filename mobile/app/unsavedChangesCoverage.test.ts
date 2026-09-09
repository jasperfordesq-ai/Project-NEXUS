// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Every form that a member can lose work from asks before it lets them go — or is recorded
 * here with the reason it should not.
 *
 * 🔴 The reasoning matters more than the count. The audit listed six screens as "missing the
 * guard", and reading them showed only one of the six actually needed it:
 *
 *   - `marketplace-merchant-onboarding` genuinely did. Four steps of business name, bio,
 *     registration number, address and opening hours, with nothing between a stray Back
 *     gesture and losing all of it. Fixed here.
 *   - `onboarding` cannot be left. `decideAuthRedirect` sends a member with incomplete
 *     onboarding straight back to it, so the guard's own "Leave" button would be a lie.
 *   - `settings-delete-account` and `change-password` hold a typed password. Offering to
 *     preserve it across a navigation is the opposite of what should happen.
 *   - `CourseBuilder` renders inside `new-course`, which already guards. A second guard on
 *     the same screen prompts twice.
 *   - `EventRegistrationPanel` is a panel on the event detail screen. Guarding it would
 *     block leaving a whole detail page because one guest-name field has a character in it.
 *
 * Audit 2026-09-09, item 16. A "gap" that is a deliberate absence is not a gap, and writing
 * that down is what stops the next audit re-reporting it.
 */

import fs from 'fs';
import path from 'path';

const MOBILE_ROOT = path.join(__dirname, '..');

/** Screens that must ask before discarding what the member typed. */
const MUST_GUARD = [
  'app/(auth)/register.tsx',
  'app/(modals)/new-event.tsx',
  'app/(modals)/new-group.tsx',
  'app/(modals)/new-job.tsx',
  'app/(modals)/new-exchange.tsx',
  'app/(modals)/new-volunteering.tsx',
  'app/(modals)/new-marketplace-listing.tsx',
  'app/(modals)/new-course.tsx',
  'app/(modals)/new-challenge.tsx',
  'app/(modals)/new-group-exchange.tsx',
  'app/(modals)/edit-profile.tsx',
  'app/(modals)/edit-exchange.tsx',
  'app/(modals)/event-communications.tsx',
  'app/(modals)/match-preferences.tsx',
  'app/(modals)/podcast-studio.tsx',
  'app/(modals)/marketplace-merchant-onboarding.tsx',
];

/** Form-ish screens that deliberately do NOT guard, and why. */
const DELIBERATELY_UNGUARDED: Record<string, string> = {
  'app/(modals)/onboarding.tsx':
    'Cannot be left: decideAuthRedirect sends an incomplete member straight back, so a "Leave" button would be a lie.',
  'app/(modals)/settings-delete-account.tsx':
    'Holds a typed password. Preserving it across a navigation is the opposite of what should happen.',
  'app/(modals)/change-password.tsx':
    'Holds a typed password, for the same reason.',
  'components/courses/CourseBuilder.tsx':
    'Renders inside new-course, which already guards. A second guard on the same screen prompts twice.',
  'components/events/EventRegistrationPanel.tsx':
    'A panel on the event detail screen; guarding it would block leaving a whole detail page over one guest-name field.',
};

function read(relative: string): string {
  return fs.readFileSync(path.join(MOBILE_ROOT, relative), 'utf8');
}

describe('unsaved-changes guard', () => {
  it.each(MUST_GUARD)('%s asks before discarding what was typed', (relative) => {
    expect(read(relative)).toContain('useUnsavedChangesGuard');
  });

  it.each(Object.entries(DELIBERATELY_UNGUARDED))('%s stays unguarded on purpose', (relative, reason) => {
    expect(reason.length).toBeGreaterThan(20);
    expect(read(relative)).not.toContain('useUnsavedChangesGuard');
  });

  it('the guard still uses the supported navigation hook', () => {
    /*
      🔴 `navigation.addListener('beforeRemove')` is BROKEN on native-stack and was the first
      implementation of this. `usePreventRemove` is the supported route to the same
      behaviour; the module comment records the whole story.
    */
    // Comments only: the module's own documentation names `beforeRemove` to explain why it
    // is NOT used, and matching that prose would be reading the warning as the fault.
    const code = read('lib/hooks/useUnsavedChangesGuard.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(code).toContain('usePreventRemove');
    expect(code).not.toMatch(/addListener\(\s*'beforeRemove'/);
  });
});
