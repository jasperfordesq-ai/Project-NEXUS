// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
//
// Progressive enhancement: measure the selected voice clip's length so the
// server can store a real duration. Laravel's /v2/messages/voice endpoint
// stores whatever `duration` the client sends (clamped to a 1-second floor),
// so without this every voice note sent from this site is persisted as one
// second long and other clients render it as "0:00".
//
// CSP note: script-src is 'self' plus one pinned hash — inline scripts are
// dead on this site, which is why this lives in its own file.
//
// Without JavaScript the form still submits; the hidden field stays empty and
// the server simply omits the duration, which is today's behaviour.
(function () {
  'use strict';

  var input = document.querySelector('input[type="file"][data-voice-duration-target]');
  if (!input) return;
  var target = document.getElementById(input.getAttribute('data-voice-duration-target'));
  if (!target) return;

  input.addEventListener('change', function () {
    target.value = '';
    var file = input.files && input.files[0];
    if (!file) return;

    var url = URL.createObjectURL(file);
    var audio = new Audio();

    var cleanup = function () {
      URL.revokeObjectURL(url);
      audio.removeAttribute('src');
    };

    audio.addEventListener('loadedmetadata', function () {
      // Some encoders (notably MediaRecorder webm) report Infinity until the
      // whole file is scanned; leave the field empty rather than send junk.
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        target.value = String(Math.round(audio.duration));
      }
      cleanup();
    });
    audio.addEventListener('error', cleanup);
    audio.preload = 'metadata';
    audio.src = url;
  });
}());
