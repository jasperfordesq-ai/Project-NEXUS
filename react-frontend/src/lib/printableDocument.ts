// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import DOMPurify from 'dompurify';

/**
 * F-299: `window.open('')` returns an about:blank document that INHERITS this
 * app's origin, so markup written into it runs as the app — outside the page's
 * CSP nonce discipline, with the member's session in reach. The server escapes
 * every field of the certificate it sends today; this makes the client stop
 * depending on that alone.
 *
 * Keeps a whole printable document (head, title, embedded <style>) and removes
 * anything that can run script, load other content, or submit anywhere.
 */
export function sanitizePrintableDocument(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ['style', 'title', 'meta'],
    ADD_ATTR: ['charset', 'lang'],
    FORBID_TAGS: ['script', 'iframe', 'frame', 'object', 'embed', 'base', 'link', 'form', 'input', 'button', 'textarea', 'select'],
    FORBID_ATTR: ['http-equiv', 'content'],
  });
  return `<!DOCTYPE html>${clean}`;
}

/** Write a sanitised, printable document into a window this app opened. */
export function writePrintableDocument(win: Window, html: string): void {
  win.document.write(sanitizePrintableDocument(html));
  win.document.close();
}
