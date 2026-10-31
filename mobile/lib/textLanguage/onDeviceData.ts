// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The detector's distinctive-word markers, as the app's copy of textLanguage.ts
 * sees them. Empty until readerVocabulary.ts reads data/markers.txt; it fills
 * this same object, so the detector's captured reference sees the words.
 * readerVocabulary() answers null until the markers are in, so an empty object
 * never decides anything (no list, no hiding: the button stays).
 */
export const markers: { words: Record<string, string> } = { words: {} };
