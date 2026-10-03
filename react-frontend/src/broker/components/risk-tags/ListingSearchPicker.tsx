// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Find a listing by title. A HeroUI ComboBox over the admin listings search,
 * the listing twin of `MemberSearchPicker`. The results list is a popover in
 * a portal, so a scrolling modal body cannot clip it — the hand-built
 * dropdown this replaces was clipped out of sight inside the Risk Tags modal.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Search from 'lucide-react/icons/search';
import { Button, ComboBox, ComboBoxItem, Spinner } from '@/components/ui';
import { adminListings } from '@/admin/api/adminApi';
import type { ListingSummary } from './riskTagShared';

const SEARCH_DEBOUNCE_MS = 300;
const MAX_RESULTS = 8;

interface ListingSearchPickerProps {
  /** The selected listing id as a string ('' for none). */
  value: string;
  onValueChange: (value: string) => void;
  selectedListing?: ListingSummary | null;
  onSelectedListingChange?: (listing: ListingSummary | null) => void;
  label: string;
  placeholder: string;
  noResultsText: string;
  clearText: string;
  isRequired?: boolean;
  className?: string;
}

function normalizeListings(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>;
  const wrapped = payload as { items?: unknown; data?: unknown } | null | undefined;
  if (Array.isArray(wrapped?.items)) return wrapped.items as Array<Record<string, unknown>>;
  if (Array.isArray(wrapped?.data)) return wrapped.data as Array<Record<string, unknown>>;
  return [];
}

export function ListingSearchPicker({
  value,
  onValueChange,
  selectedListing,
  onSelectedListingChange,
  label,
  placeholder,
  noResultsText,
  clearText,
  isRequired = false,
  className,
}: ListingSearchPickerProps) {
  const { t } = useTranslation('broker');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ListingSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedId = value ? Number(value) : null;
  // There is no single-listing admin endpoint to hydrate a bare id from, so
  // an id arriving without a summary (a `?listing=` deep link) is shown by number.
  const resolved: ListingSummary | null = selectedId
    ? selectedListing && selectedListing.id === selectedId
      ? selectedListing
      : { id: selectedId, title: t('risk_tags.listing_number', { id: selectedId }) }
    : null;

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await adminListings.list({ search: query.trim(), page: 1 });
        if (res.success) {
          setResults(
            normalizeListings(res.data).slice(0, MAX_RESULTS).map((l) => ({
              id: Number(l.id),
              title: (l.title as string) || t('risk_tags.listing_number', { id: l.id }),
              owner_name: ((l.user_name ?? l.owner_name ?? '') as string) || undefined,
            })),
          );
        } else {
          setResults([]);
        }
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [query, t]);

  const handleSelect = (listing: ListingSummary) => {
    onSelectedListingChange?.(listing);
    onValueChange(String(listing.id));
    setQuery('');
    setResults([]);
  };

  const handleClear = () => {
    onSelectedListingChange?.(null);
    onValueChange('');
    setQuery('');
    setResults([]);
  };

  if (resolved) {
    return (
      <div className={className}>
        <p className="mb-2 text-sm font-medium text-foreground">
          {label}
          {isRequired ? <span className="text-danger"> *</span> : null}
        </p>
        <div className="flex items-center justify-between gap-3 rounded-[14px] border border-border bg-surface px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{resolved.title}</p>
            <p className="truncate text-xs text-muted">
              {t('risk_tags.id_label')} {resolved.id}
              {resolved.owner_name ? ` · ${resolved.owner_name}` : ''}
            </p>
          </div>
          <Button size="sm" variant="tertiary" onPress={handleClear}>
            {clearText}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <ComboBox<ListingSummary>
      className={className}
      label={label}
      placeholder={placeholder}
      isRequired={isRequired}
      items={results}
      inputValue={query}
      onInputChange={setQuery}
      menuTrigger="input"
      allowsEmptyCollection
      // The server already searched; React Aria's own filter would re-match
      // on the title alone and hide listings matched by description.
      defaultFilter={() => true}
      selectedKey={null}
      onSelectionChange={(key) => {
        if (key == null) return;
        const listing = results.find((candidate) => String(candidate.id) === String(key));
        if (listing) handleSelect(listing);
      }}
      startContent={
        loading
          ? <Spinner size="sm" className="ml-3 shrink-0" />
          : <Search size={14} className="ml-3 shrink-0 text-muted" aria-hidden="true" />
      }
      renderEmptyState={() => (
        <div role="status" className="flex items-center gap-2 px-3 py-2 text-sm text-muted">
          {loading ? <Spinner size="sm" /> : null}
          {query.trim().length >= 2 && !loading ? noResultsText : placeholder}
        </div>
      )}
    >
      {(listing: ListingSummary) => (
        <ComboBoxItem id={listing.id} textValue={listing.title}>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{listing.title}</p>
            <p className="truncate text-xs text-muted">
              {t('risk_tags.id_label')} {listing.id}
              {listing.owner_name ? ` · ${listing.owner_name}` : ''}
            </p>
          </div>
        </ComboBoxItem>
      )}
    </ComboBox>
  );
}

export default ListingSearchPicker;
