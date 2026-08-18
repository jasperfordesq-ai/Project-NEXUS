// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Print trigger
 *
 * Opens the browser print dialog for any control marked with
 * data-print-trigger.
 *
 * This replaces an inline onclick="window.print()" attribute, which the Content
 * Security Policy blocked (script-src has no 'unsafe-inline'), leaving the
 * button visibly present but completely inert.
 *
 * Progressive enhancement: the button is styled to appear only under the
 * js-enabled body class that layouts/base.njk sets, so a member without
 * JavaScript is not offered a control that cannot work. They can still print
 * through the browser's own menu, and the page carries a print stylesheet.
 */
(function () {
  'use strict';

  var triggers = document.querySelectorAll('[data-print-trigger]');

  if (!triggers.length || typeof window.print !== 'function') {
    return;
  }

  Array.prototype.forEach.call(triggers, function (trigger) {
    trigger.addEventListener('click', function (event) {
      event.preventDefault();
      window.print();
    });
  });
}());
