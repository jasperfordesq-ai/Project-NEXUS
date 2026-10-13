// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Serialise schema.org structured data for a `<script type="application/ld+json">`.
 *
 * The script body is raw text to the HTML parser, so a literal `</script>` in
 * member-written text (a title, a description) would close the block early in a
 * prerendered snapshot and let the rest run as markup (F-595, E-104). `<`, `>`
 * and `&` are written as JSON unicode escapes instead: JSON-LD parsers read
 * them back as the same characters, so the structured data is unchanged.
 *
 * Every JSON-LD block in the app must go through this function.
 */
export function toJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}
