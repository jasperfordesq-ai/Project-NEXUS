// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The presentation half of the sign-out notice.
 *
 * Also guards the shape of the fix: a source scan asserting that no provider reaches for
 * a toast hook again. Two earlier attempts did — a direct `useAppToast()` call (eight
 * suites dead) and a try/catch `useOptionalAppToast()` (lint error for conditional hooks,
 * which shipped in a commit called green because lint had not been run). A rendering test
 * cannot catch either regression, so this reads the source, in the style of
 * `app/modalDeclarations.test.ts`.
 */

import fs from 'node:fs';
import path from 'node:path';

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

import SessionNoticeHost from './SessionNoticeHost';
import { sessionNoticeStore } from '@/lib/notices/sessionNoticeStore';

const mockShow = jest.fn();
jest.mock('./AppToast', () => ({
  useAppToast: () => ({ show: mockShow, hide: jest.fn(), isToastVisible: false }),
}));

const MOBILE_ROOT = path.resolve(__dirname, '..', '..');

/** Non-test source files below a directory. */
function sourceFilesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) found.push(full);
    }
  };
  walk(dir);
  return found;
}

/**
 * Comments removed, so a scan cannot match the very name it is documenting.
 *
 * 🔴 Not paranoia — this exact mistake has been made twice in this codebase's guard tests:
 * a scan for `rounded-button` matched the phrase inside its own explanatory comment, and
 * the sign-out store below discusses `useOptionalAppToast` by name in its own header.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('SessionNoticeHost', () => {
  beforeEach(() => {
    sessionNoticeStore.__resetForTests();
    mockShow.mockClear();
  });

  it('renders nothing', () => {
    const { toJSON } = render(<SessionNoticeHost />);

    expect(toJSON()).toBeNull();
  });

  it('shows a notice published before it mounted', async () => {
    // Ordering matters: AuthProvider can publish during startup, before this host has
    // mounted. The notice must survive that gap rather than being lost.
    sessionNoticeStore.publish({ title: 'Signed out', description: 'Please sign in again.' });

    render(<SessionNoticeHost />);

    await waitFor(() => expect(mockShow).toHaveBeenCalledTimes(1));
    expect(mockShow).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Signed out', description: 'Please sign in again.' })
    );
  });

  it('shows a notice published after it mounted', async () => {
    render(<SessionNoticeHost />);

    sessionNoticeStore.publish({ title: 'Signed out' });

    await waitFor(() => expect(mockShow).toHaveBeenCalledTimes(1));
  });

  it('🔴 shows each notice exactly once', async () => {
    render(<SessionNoticeHost />);
    sessionNoticeStore.publish({ title: 'Signed out' });
    await waitFor(() => expect(mockShow).toHaveBeenCalledTimes(1));

    // The consume() call clears it, so no later re-render can repeat it.
    expect(sessionNoticeStore.getSnapshot()).toBeNull();
    expect(mockShow).toHaveBeenCalledTimes(1);
  });

  it('defaults to the warning tone', async () => {
    render(<SessionNoticeHost />);
    sessionNoticeStore.publish({ title: 'Signed out' });

    await waitFor(() => expect(mockShow).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'warning' })
    ));
  });

  it('🔴 nothing under lib/ shows a toast — infrastructure publishes, it does not present', () => {
    // The regression this whole store exists to prevent, stated as a boundary rather than
    // a list of known offenders: lib/ is infrastructure (API client, stores, contexts) and
    // has no business reaching into the presentation tree. AuthProvider breaking that rule
    // is what killed eight suites, and the try/catch "fix" for it shipped a latent
    // render-order bug. A screen calling useAppToast() is fine — it really is inside the
    // provider tree — so the rule is scoped to lib/, not to the hook.
    const files = sourceFilesUnder(path.join(MOBILE_ROOT, 'lib'));
    expect(files.length).toBeGreaterThan(80);

    const offenders = files
      .filter((file) => /use(Optional)?AppToast\s*\(/.test(stripComments(fs.readFileSync(file, 'utf8'))))
      .map((file) => path.relative(MOBILE_ROOT, file));

    expect(offenders).toEqual([]);
  });

  it('🔴 the try/catch toast hook has not come back', () => {
    // It passed its own tests and shipped; only the lint gate caught it, and that gate had
    // not been run. Named explicitly so reintroducing it fails a test — which is checked —
    // rather than only a lint run that tolerates 506 warnings.
    const files = [
      ...sourceFilesUnder(path.join(MOBILE_ROOT, 'lib')),
      ...sourceFilesUnder(path.join(MOBILE_ROOT, 'components')),
    ];
    expect(files.length).toBeGreaterThan(100);

    const offenders = files
      .filter((file) => /export function useOptionalAppToast/.test(stripComments(fs.readFileSync(file, 'utf8'))))
      .map((file) => path.relative(MOBILE_ROOT, file));

    expect(offenders).toEqual([]);
  });
});
