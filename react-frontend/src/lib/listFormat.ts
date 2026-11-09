// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

type ListFormatter = { format: (items: string[]) => string };
type ListFormatConstructor = new (locale: string, options: { style?: 'long'; type: 'conjunction' }) => ListFormatter;

/**
 * "Maeve, Tom and Ann", in the reader's language. Intl.ListFormat is in every
 * supported browser but not in this TypeScript lib, so it is reached through a
 * typed cast; without it (or on a bad locale) the items are comma-joined.
 */
export function joinList(items: string[], locale: string): string {
  const ListFormat = (Intl as unknown as { ListFormat?: ListFormatConstructor }).ListFormat;
  if (ListFormat) {
    try {
      return new ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items);
    } catch {
      // Fall through to a plain list.
    }
  }
  return items.join(', ');
}
