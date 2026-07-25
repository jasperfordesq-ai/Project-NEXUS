// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * useFilterDraft — the draft filter machine behind every phone filter sheet,
 * generic over the page's draft shape. Extracted from ListingsPage.
 *
 * The point of a draft: taps inside the sheet must NOT refetch the list behind
 * it. `open()` snapshots the live filter values, `patch()` mutates only the
 * snapshot, and `apply()` is the single moment the page's real filter state
 * changes.
 *
 * The count probe is optional and that matters: six of the target pages read
 * from `respondWithCollection`, whose meta is only
 * `{ base_url, per_page, has_more, cursor }` — no total. Those pages pass no
 * `countFor`, the hook then never issues a request, `count` stays `null`, and
 * `FilterSheet` correctly renders "Show results" instead of a made-up number.
 *
 * ```ts
 * const sheet = useFilterDraft<MyDraft>({
 *   emptyDraft: { type: 'all', category: '' },      // merged over the open draft
 *   countFor: probe,                                 // optional
 *   countKey: searchQuery,                           // re-probes when this changes
 *   onApply: (draft) => { setType(draft.type); … },
 * });
 * ```
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseFilterDraftOptions<TDraft> {
  /**
   * Commits the draft to the page's real filter state. Called by `apply()`
   * immediately before the sheet closes.
   */
  onApply: (draft: TDraft) => void;
  /**
   * Values `clear()` merges over the open draft. Keys you leave out survive the
   * reset — that is how Listings keeps the chosen sort order while clearing
   * type/category/duration/format/posted/distance.
   */
  emptyDraft: Partial<TDraft>;
  /**
   * Optional debounced probe for the live result count. Return `null` when the
   * endpoint cannot report a total. Omit the option entirely and the hook never
   * fetches.
   *
   * Its identity is held in a ref, so an inline arrow is safe — declare the
   * values it closes over in `countKey` instead.
   */
  countFor?: (draft: TDraft, signal: AbortSignal) => Promise<number | null>;
  /**
   * Extra scalar the probe depends on (e.g. the committed search query).
   * Changing it re-probes the current draft.
   */
  countKey?: string | number | boolean | null;
  /** Probe debounce in ms. Default 250. */
  debounceMs?: number;
}

export interface UseFilterDraftResult<TDraft> {
  /** Whether the sheet should be open. */
  isOpen: boolean;
  /** The draft snapshot; `null` until `open()` has been called once. */
  draft: TDraft | null;
  /** Live result count for the draft, or `null` when unknown / not probed. */
  count: number | null;
  /** Snapshot the live filter values and open the sheet. */
  open: (current: TDraft, initialCount?: number | null) => void;
  /** Close without applying. Any in-flight probe is aborted. */
  close: () => void;
  /** Patch the draft only — the page's real filters are untouched. */
  patch: (partial: Partial<TDraft>) => void;
  /** Hand the committed draft to `onApply` and close. */
  apply: () => void;
  /** Reset the draft to `emptyDraft` (merged); the sheet stays open. */
  clear: () => void;
}

export function useFilterDraft<TDraft>({
  onApply,
  emptyDraft,
  countFor,
  countKey = null,
  debounceMs = 250,
}: UseFilterDraftOptions<TDraft>): UseFilterDraftResult<TDraft> {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<TDraft | null>(null);
  const [count, setCount] = useState<number | null>(null);

  // Latest-value refs so callbacks stay stable and effects don't re-fire when a
  // caller passes inline closures.
  const onApplyRef = useRef(onApply);
  onApplyRef.current = onApply;
  const emptyDraftRef = useRef(emptyDraft);
  emptyDraftRef.current = emptyDraft;
  const countForRef = useRef(countFor);
  countForRef.current = countFor;
  const draftRef = useRef<TDraft | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const open = useCallback((current: TDraft, initialCount: number | null = null) => {
    draftRef.current = current;
    setDraft(current);
    setCount(initialCount);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  // `patch`/`clear` write `draftRef` synchronously as well as scheduling the
  // state update, so `patch(); apply();` (or `clear(); apply();`) inside ONE
  // event handler commits the new draft rather than the pre-mutation snapshot.
  const patch = useCallback((partial: Partial<TDraft>) => {
    const prev = draftRef.current;
    if (!prev) return;
    const next = { ...prev, ...partial };
    draftRef.current = next;
    setDraft(next);
  }, []);

  const apply = useCallback(() => {
    const current = draftRef.current;
    if (current) onApplyRef.current(current);
    setIsOpen(false);
  }, []);

  const clear = useCallback(() => {
    const prev = draftRef.current;
    if (!prev) return;
    const next = { ...prev, ...emptyDraftRef.current };
    draftRef.current = next;
    setDraft(next);
  }, []);

  // Live count for the sheet footer — debounced, aborted on every change, and
  // never fired while the sheet is closed or when no probe was supplied.
  const hasProbe = countFor != null;
  useEffect(() => {
    if (!isOpen || !draft || !hasProbe) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(async () => {
      try {
        const next = await countForRef.current?.(draft, controller.signal);
        if (controller.signal.aborted) return;
        setCount(next ?? null);
      } catch {
        if (!controller.signal.aborted) setCount(null);
      }
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [isOpen, draft, countKey, hasProbe, debounceMs]);

  return { isOpen, draft, count, open, close, patch, apply, clear };
}

export default useFilterDraft;
