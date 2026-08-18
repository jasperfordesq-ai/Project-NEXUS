// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Event recurrence interval sync
 *
 * The recurrence choices are a single radio group, but two of them ("Every
 * week" and "Every 2 weeks") post the same recurrence_frequency value of
 * "weekly" and are told apart only by recurrence_interval. This copies the
 * selected radio's data-recurrence-interval into that hidden field.
 *
 * This lived as an inline <script> in events/new.njk, where the Content
 * Security Policy blocked it (script-src allows 'self' plus one pinned hash and
 * has no 'unsafe-inline'). The hidden field therefore kept its default of "1",
 * so choosing "Every 2 weeks" silently created a WEEKLY series.
 *
 * Progressive enhancement: without JavaScript the hidden field keeps the value
 * the server rendered, which is the previously saved interval.
 */
(function () {
  'use strict';

  var intervalInput = document.getElementById('recurrence_interval');
  var frequencyInputs = document.querySelectorAll(
    'input[name="recurrence_frequency"][data-recurrence-interval]'
  );

  if (!intervalInput || !frequencyInputs.length) {
    return;
  }

  function syncRecurrenceInterval(event) {
    var input = event && event.target
      ? event.target
      : document.querySelector('input[name="recurrence_frequency"]:checked');

    if (input && input.dataset.recurrenceInterval) {
      intervalInput.value = input.dataset.recurrenceInterval;
    }
  }

  Array.prototype.forEach.call(frequencyInputs, function (input) {
    input.addEventListener('change', syncRecurrenceInterval);
  });

  syncRecurrenceInterval();
}());
