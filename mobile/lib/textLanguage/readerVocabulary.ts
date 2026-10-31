// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The reader's everyday vocabulary for isClearlyWrittenIn() (textLanguage.ts,
 * a copy of the website's detector).
 *
 * The word lists are bundled files (data/*.txt), not JavaScript: compiled into
 * the app's code they added ~0.85 MB and broke its start-up budget
 * (mobile/startup-budget.json). So they are read on first use, which is
 * asynchronous. Until the markers and the reader's list are in — or if they
 * cannot be read — readerVocabulary() answers null and the Translate button
 * stays: the safe default. Metro needs a literal require per file.
 */

import { useEffect, useState } from 'react';
import { readBundledText } from './bundledText';
import { markers } from './onDeviceData';
import { isClearlyWrittenIn, vocabularyCode, vocabularySet } from './textLanguage';

type VocabularyFile = { words: string };

const MARKERS = (): number => require('./data/markers.txt') as number;

const FILES: Readonly<Record<string, () => number>> = {
  ara: () => require('./data/ara.txt') as number,
  deu: () => require('./data/deu.txt') as number,
  eng: () => require('./data/eng.txt') as number,
  fra: () => require('./data/fra.txt') as number,
  gle: () => require('./data/gle.txt') as number,
  ita: () => require('./data/ita.txt') as number,
  nld: () => require('./data/nld.txt') as number,
  pol: () => require('./data/pol.txt') as number,
  por: () => require('./data/por.txt') as number,
  spa: () => require('./data/spa.txt') as number,
};

const loaded = new Map<string, ReadonlySet<string>>();
const pending = new Map<string, Promise<ReadonlySet<string> | null>>();
let markersLoad: Promise<boolean> | null = null;

function loadMarkers(): Promise<boolean> {
  markersLoad ??= readBundledText(MARKERS())
    .then((text) => {
      Object.assign(markers.words, (JSON.parse(text) as { words: Record<string, string> }).words);
      return true;
    })
    .catch(() => {
      markersLoad = null; // try again next time
      return false;
    });
  return markersLoad;
}

/** Read the markers and the reader's list; null when there is none or it cannot be read. */
export function loadReaderVocabulary(locale: string | null | undefined): Promise<ReadonlySet<string> | null> {
  const code = vocabularyCode(locale);
  if (!code) return Promise.resolve(null);
  const ready = loaded.get(code);
  if (ready) return Promise.resolve(ready);
  let load = pending.get(code);
  if (!load) {
    load = (async () => {
      try {
        const file = FILES[code];
        if (!file || !(await loadMarkers())) return null;
        const set = vocabularySet(JSON.parse(await readBundledText(file())) as VocabularyFile);
        loaded.set(code, set);
        return set;
      } catch {
        return null;
      } finally {
        pending.delete(code);
      }
    })();
    pending.set(code, load);
  }
  return load;
}

/** The reader's list if it has been read already, else null. */
export function readerVocabulary(locale: string | null | undefined): ReadonlySet<string> | null {
  const code = vocabularyCode(locale);
  return code ? loaded.get(code) ?? null : null;
}

/**
 * Starts reading the reader's list and re-renders once it is in. Returns
 * whether it is in, for use as a memo dependency.
 */
export function useReaderVocabulary(locale: string | null | undefined): boolean {
  const ready = readerVocabulary(locale) !== null;
  const [, setLoads] = useState(0);
  useEffect(() => {
    if (ready || !vocabularyCode(locale)) return;
    let live = true;
    void loadReaderVocabulary(locale).then((set) => {
      if (live && set) setLoads((count) => count + 1);
    });
    return () => {
      live = false;
    };
  }, [locale, ready]);
  return ready;
}

/** Everything shown is, beyond doubt, already in the reader's language. */
export function alreadyInReaderLanguage(parts: readonly (string | null | undefined)[], locale: string | null | undefined): boolean {
  return isClearlyWrittenIn(parts, locale, readerVocabulary(locale));
}
