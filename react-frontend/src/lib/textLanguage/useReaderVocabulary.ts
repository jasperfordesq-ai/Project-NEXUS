// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The reader's everyday vocabulary for isClearlyWrittenIn(). Each language is a
 * separate ~40 KB file, fetched once when first needed. Until it arrives (or if
 * it cannot be fetched) the answer is null, and the Translate button shows —
 * the safe default.
 */

import { useEffect, useState } from 'react';
import { vocabularyCode, vocabularySet } from './textLanguage';

const files = import.meta.glob<{ words: string }>('./vocabulary/*.json', { import: 'default' });
const loaded = new Map<string, ReadonlySet<string>>();
const loading = new Map<string, Promise<ReadonlySet<string> | null>>();

export function loadVocabulary(code: string): Promise<ReadonlySet<string> | null> {
  const ready = loaded.get(code);
  if (ready) return Promise.resolve(ready);
  const existing = loading.get(code);
  if (existing) return existing;
  const file = files[`./vocabulary/${code}.json`];
  if (!file) return Promise.resolve(null);
  const request = file()
    .then((content) => {
      const set = vocabularySet(content);
      loaded.set(code, set);
      return set;
    })
    .catch(() => null)
    .finally(() => loading.delete(code));
  loading.set(code, request);
  return request;
}

export function useReaderVocabulary(locale: string | null | undefined): ReadonlySet<string> | null {
  const code = vocabularyCode(locale);
  const [, setReady] = useState(0);
  useEffect(() => {
    if (!code || loaded.has(code)) return undefined;
    let current = true;
    void loadVocabulary(code).then((set) => {
      if (current && set) setReady((n) => n + 1);
    });
    return () => {
      current = false;
    };
  }, [code]);
  return code ? loaded.get(code) ?? null : null;
}
