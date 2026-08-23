// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The app's entry point, so that start-up can be measured at all — journey 7.16.
 *
 * `package.json` pointed `main` straight at `expo-router/entry`, which meant the first
 * line of our own code to run was inside a lazily-loaded route module. Measured on a
 * device, a timer started there reported **0ms** while the app plainly took seconds to
 * open, because everything expensive — the whole module graph — had already been
 * evaluated by then.
 *
 * 🔴 The import order below is the entire point of this file, and a tidy-up that sorts
 * these two lines alphabetically destroys the measurement. `startupTiming` must be first,
 * and `expo-router/entry` must stay last: it is what actually registers the app.
 *
 * React Native's own `performance.reactNativeStartupTiming` marks would be better still —
 * they start on the native side — but they are not exposed in this Expo SDK build
 * (measured 2026-08-23: the object is undefined on a device), so the earliest honest zero
 * available to us is right here.
 */

import '@/lib/startupTiming';

import 'expo-router/entry';
