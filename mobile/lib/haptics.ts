// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Every vibration the app makes goes through here, and a member can switch them all off.
 *
 * 🔴 Why the switch exists. The shared `Button` fired an impact on EVERY press, including
 * plain navigation — a Back button, a "See all", a ghost link — and toasts and confirmations
 * added their own on top. For a member who finds haptics unpleasant, or who is holding the
 * phone against a sore hand, or whose device buzzes loudly on a desk, the app was
 * continuously buzzing with no way to stop it short of turning off system haptics entirely.
 * Audit 2026-09-09, item 15.
 *
 * 🔴 The preference is read from a module-level flag, not a hook. These functions are called
 * from render callbacks, plain functions and effects all over the app, and threading a hook
 * through every one of them would be a far larger change than the problem warrants. The flag
 * is seeded once at startup from storage and updated when the member changes the setting.
 *
 * Default ON. Haptics are the established behaviour and most people want them; the point is
 * that leaving is now possible, not that it is the new default.
 */

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { STORAGE_KEYS } from '@/lib/constants';
import { storage } from '@/lib/storage';

let enabled = true;
const listeners = new Set<(value: boolean) => void>();

function isNativePlatform(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

/** Whether the app should vibrate. Read by the Settings switch to show its state. */
export function hapticsEnabled(): boolean {
  return enabled;
}

/** Change the preference and remember it. Called by the Settings switch. */
export async function setHapticsEnabled(value: boolean): Promise<void> {
  enabled = value;
  listeners.forEach((listener) => listener(value));
  // A failed write leaves the setting correct for this session; it is a preference, not data.
  await storage.set(STORAGE_KEYS.HAPTICS_ENABLED, value ? '1' : '0').catch(() => undefined);
}

/** Seed the flag from storage. Called once at startup, alongside the theme. */
export async function initHaptics(): Promise<void> {
  const stored = await storage.get(STORAGE_KEYS.HAPTICS_ENABLED);
  if (stored === '0' || stored === '1') {
    enabled = stored === '1';
    listeners.forEach((listener) => listener(enabled));
  }
}

/** Subscribe to changes, so a rendered switch can follow the flag. */
export function subscribeToHaptics(listener: (value: boolean) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only: put the flag back to its default. */
export function resetHapticsForTests(): void {
  enabled = true;
  listeners.clear();
}

export const ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle;
export const NotificationFeedbackType = Haptics.NotificationFeedbackType;

export async function impactAsync(style: Haptics.ImpactFeedbackStyle): Promise<void> {
  if (!enabled || !isNativePlatform()) return;

  try {
    await Haptics.impactAsync(style);
  } catch {
    // Haptics are non-essential and may be unavailable in previews or simulators.
  }
}

export async function notificationAsync(type: Haptics.NotificationFeedbackType): Promise<void> {
  if (!enabled || !isNativePlatform()) return;

  try {
    await Haptics.notificationAsync(type);
  } catch {
    // Haptics are non-essential and may be unavailable in previews or simulators.
  }
}

export async function selectionAsync(): Promise<void> {
  if (!enabled || !isNativePlatform()) return;

  try {
    await Haptics.selectionAsync();
  } catch {
    // Haptics are non-essential and may be unavailable in previews or simulators.
  }
}
