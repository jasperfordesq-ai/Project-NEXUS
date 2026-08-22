// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The visible half of the force-update lever, and the wiring that makes it appear.
 *
 * Includes a source-scan guard on the root layout: a rendering test cannot tell whether
 * the gate is mounted ABOVE the providers, and mounting it below them would mean a build
 * too old to resolve its tenant never gets to show the message at all.
 */

import fs from 'node:fs';
import path from 'node:path';

import React from 'react';
import { Text } from 'react-native';
import { Linking } from 'react-native';
import { act, render, screen, userEvent } from '@testing-library/react-native';

import UpdateRequiredGate from './UpdateRequiredGate';
import { updateRequiredStore } from '@/lib/updates/updateRequiredStore';

const REQUIREMENT = {
  clientVersion: '1.1.0',
  minimumVersion: '1.2.0',
  currentVersion: '1.3.0',
  updateUrl: 'https://mobile.project-nexus.ie',
};

function App() {
  return (
    <UpdateRequiredGate>
      <Text>the whole app</Text>
    </UpdateRequiredGate>
  );
}

describe('UpdateRequiredGate', () => {
  beforeEach(() => {
    updateRequiredStore.__resetForTests();
    jest.restoreAllMocks();
  });

  it('renders the app when no update is required', () => {
    render(<App />);

    expect(screen.getByText('the whole app')).toBeTruthy();
  });

  it('🔴 REPLACES the app once the server has refused this build', () => {
    // Replaces rather than overlays: an overlay leaves the refused build mounted,
    // still retrying and still collecting 426s, and on Android a back press can find
    // its way past one.
    updateRequiredStore.require(REQUIREMENT);

    render(<App />);

    expect(screen.getByTestId('update-required-screen')).toBeTruthy();
    expect(screen.queryByText('the whole app')).toBeNull();
  });

  it('appears when the refusal arrives while the app is already running', () => {
    // The realistic case: the member is mid-session when the server minimum is raised.
    // act() because the store notifies from outside React — which is the point of it
    // being a module store, and exactly how the API client will call it in the app.
    render(<App />);
    expect(screen.getByText('the whole app')).toBeTruthy();

    act(() => {
      updateRequiredStore.require(REQUIREMENT);
    });

    expect(screen.getByTestId('update-required-screen')).toBeTruthy();
  });

  it('explains itself and offers the update', () => {
    updateRequiredStore.require(REQUIREMENT);

    render(<App />);

    expect(screen.getByText('Time to update')).toBeTruthy();
    expect(screen.getByText('Get the update')).toBeTruthy();
  });

  it('🔴 opens the URL the SERVER supplied, not one of its own', async () => {
    // The copies that need this URL are exactly the ones that cannot be updated any
    // other way, so it must be changeable without shipping a new binary.
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    updateRequiredStore.require({ ...REQUIREMENT, updateUrl: 'https://elsewhere.example/apk' });

    render(<App />);
    await userEvent.press(screen.getByText('Get the update'));

    expect(openURL).toHaveBeenCalledWith('https://elsewhere.example/apk');
  });

  it('survives a device with nothing able to open the link', async () => {
    // Linking.openURL REJECTS when nothing can handle the URL. An unhandled rejection
    // on the one screen offering a way forward would be the worst place for it.
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
    updateRequiredStore.require(REQUIREMENT);

    render(<App />);

    await expect(userEvent.press(screen.getByText('Get the update'))).resolves.not.toThrow();
  });

  it('says so plainly when the server gave no link', () => {
    // Rather than a button that does nothing — an unexplained dead end is what this
    // screen exists to prevent, so it must not become one itself.
    updateRequiredStore.require({ ...REQUIREMENT, updateUrl: '' });

    render(<App />);

    expect(screen.queryByText('Get the update')).toBeNull();
    expect(screen.getByText(/couldn't find the download link/i)).toBeTruthy();
  });

  it('shows the version detail quietly, without printing undefined', () => {
    updateRequiredStore.require({ ...REQUIREMENT, currentVersion: '', clientVersion: '' });

    render(<App />);

    // Both blank means the line is not worth showing at all.
    expect(screen.queryByTestId('update-required-versions')).toBeNull();
  });

  it('renders the version line when the server told us the numbers', () => {
    updateRequiredStore.require(REQUIREMENT);

    render(<App />);

    const line = screen.getByTestId('update-required-versions');
    expect(line).toBeTruthy();
    expect(String(line.props.children)).not.toContain('undefined');
  });

  /**
   * 🔴 Measured on a device on 2026-08-22, firing the lever for the first time. With the
   * server floor raised to 1.3.0 while the newest build was still 1.2.0, this line read
   * "Latest version 1.2.0 · you have 1.2.0" on a screen refusing to let the member continue —
   * a sentence that tells them the block is a bug and leaves them nothing to do.
   */
  it('🔴 never offers a "latest" that is not newer than what the member has', () => {
    updateRequiredStore.require({
      ...REQUIREMENT,
      clientVersion: '1.2.0',
      minimumVersion: '1.3.0',
      currentVersion: '1.2.0', // the server's newest build is the one they already have
    });

    render(<App />);

    const line = screen.getByTestId('update-required-versions');
    // Falls back to the version actually required, which IS ahead of theirs.
    expect(String(line.props.children)).toContain('1.3.0');
    expect(String(line.props.children)).not.toMatch(/1\.2\.0.*1\.2\.0/);
  });

  it('says nothing at all when no offered version is ahead', () => {
    updateRequiredStore.require({
      ...REQUIREMENT,
      clientVersion: '1.2.0',
      minimumVersion: '1.2.0',
      currentVersion: '1.2.0',
    });

    render(<App />);

    expect(screen.queryByTestId('update-required-versions')).toBeNull();
  });

  it('ignores an unparseable version rather than claiming an upgrade', () => {
    updateRequiredStore.require({
      ...REQUIREMENT,
      clientVersion: '1.2.0',
      minimumVersion: 'not-a-version',
      currentVersion: 'also-not',
    });

    render(<App />);

    expect(screen.queryByTestId('update-required-versions')).toBeNull();
  });

  it('🔴 offers no dismiss, back or skip', () => {
    // The exit IS the policy. Any "continue anyway" leads straight to a wall of
    // unexplained failures, because the API refuses every request from this build.
    updateRequiredStore.require(REQUIREMENT);

    render(<App />);

    for (const escape of [/dismiss/i, /skip/i, /not now/i, /later/i, /continue/i, /^back$/i]) {
      expect(screen.queryByText(escape)).toBeNull();
    }
  });

  describe('the root layout wiring', () => {
    const layout = fs.readFileSync(path.resolve(__dirname, '..', 'app', '_layout.tsx'), 'utf8');

    it('🔴 mounts the gate ABOVE the providers', () => {
      // A build old enough to be refused may fail to resolve its tenant or restore its
      // session at all — that is the whole point — so the message must not depend on
      // any of that having worked. Below TenantProvider it would never be seen.
      const gateAt = layout.indexOf('<UpdateRequiredGate>');
      const tenantAt = layout.indexOf('<TenantProvider>');
      const authAt = layout.indexOf('<AuthProvider>');

      expect(gateAt).toBeGreaterThan(-1);
      expect(tenantAt).toBeGreaterThan(-1);
      expect(gateAt).toBeLessThan(tenantAt);
      expect(gateAt).toBeLessThan(authAt);
    });

    it('mounts it above the error boundary too', () => {
      // A crash inside the app must not be able to hide the reason the app is refusing
      // to work.
      expect(layout.indexOf('<UpdateRequiredGate>')).toBeLessThan(layout.indexOf('<ErrorBoundary>'));
    });
  });
});
