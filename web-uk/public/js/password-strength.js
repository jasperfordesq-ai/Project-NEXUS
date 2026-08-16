// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Live NIST SP 800-63B aligned password strength check on the GOV.UK
// alpha register form. Mirrors the React usePasswordCheck hook so the
// user gets identical feedback regardless of which frontend they're
// registering through.
//
// What it does:
//   1. Length check — instant.
//   2. HIBP k-anonymity check via api.pwnedpasswords.com/range/{prefix}
//      after 350ms of inactivity. SHA-1 hashed locally; only the first
//      5 hex chars leave the browser.
//   3. Shows advisory feedback. It does NOT disable the submit button.
//
// 🔴 It used to disable the submit button until the HIBP check passed
// (`lastPwned === false`). Two problems, fixed 2026-08-14:
//   - GDS is explicit: do not disable submit buttons. Let people submit and
//     answer with an error summary. A disabled control gives no reason why.
//   - `lastPwned` only leaves `null` when the fetch RESOLVES. A network ERROR
//     was caught (fail-open), but a fetch that HANGS (corporate proxy black-hole,
//     no timeout) left `lastPwned` at `null` forever, so the button stayed
//     permanently disabled with no explanation — while a no-JS visitor could
//     register fine. This is now advisory-only; the server validates on submit.
//
// Wires up to:
//   - #password (input)
//   - #password-strength-msg (status output, aria-live polite)

(function () {
    var MIN_LEN = 12;
    var input = document.getElementById('password');
    var msg = document.getElementById('password-strength-msg');
    if (!input || !msg) return;

    var debounceTimer = null;
    var checkCache = Object.create(null);

    function setMessage(text, tone) {
        msg.textContent = text;
        msg.className = 'govuk-body-s govuk-!-margin-top-2 ' +
            (tone === 'error' ? 'govuk-error-message' :
             tone === 'success' ? 'app-success-message' : '');
    }

    // Advisory strings are rendered into #password-strength-msg data-* attributes
    // in the member's language (see register.njk / reset-password.njk). This region
    // is aria-live, so a screen-reader user hears it — it MUST NOT be English-only.
    // Fall back to English if the template didn't supply a translation, and swap the
    // :min token for the actual minimum so the number stays in sync with MIN_LEN.
    function msgText(key, fallback) {
        var raw = (msg.dataset && msg.dataset[key]) ? msg.dataset[key] : fallback;
        return raw.replace(/:min/g, MIN_LEN);
    }

    async function sha1Hex(s) {
        var enc = new TextEncoder().encode(s);
        var buf = await crypto.subtle.digest('SHA-1', enc);
        return Array.prototype.map.call(new Uint8Array(buf),
            function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    }

    async function checkHibp(pw) {
        var hash = (await sha1Hex(pw)).toUpperCase();
        if (hash in checkCache) return checkCache[hash];
        var prefix = hash.slice(0, 5);
        var suffix = hash.slice(5);
        // A hung connection (proxy black-hole) neither resolves nor rejects, so
        // abort after 5s and treat it as "could not check" — the advisory message
        // must never wait forever, even though it no longer gates the button.
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, 5000);
        try {
            var resp = await fetch('https://api.pwnedpasswords.com/range/' + prefix,
                { headers: { 'Add-Padding': 'true' }, signal: controller.signal });
            if (!resp.ok) return false;
            var body = await resp.text();
            var pwned = body.split('\n').some(function (line) {
                var parts = line.trim().split(':');
                return parts[0] === suffix && Number(parts[1]) > 0;
            });
            checkCache[hash] = pwned;
            return pwned;
        } catch (e) {
            return false; // fail-open on network error, timeout or abort
        } finally {
            clearTimeout(timer);
        }
    }

    function onInput() {
        var pw = input.value;
        if (pw.length === 0) {
            setMessage(msgText('msgIdle', 'Use :min or more characters. A memorable passphrase is stronger than a short complex one.'), 'idle');
            return;
        }
        if (pw.length < MIN_LEN) {
            // A single plural-safe requirement rather than a counted-down "N more
            // characters", which cannot be translated correctly across 11 locales'
            // plural rules from a static string.
            setMessage(msgText('msgTooShort', 'Enter at least :min characters.'), 'warn');
            return;
        }
        setMessage(msgText('msgChecking', 'Checking against known data breaches…'), 'idle');
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
            checkHibp(pw).then(function (pwned) {
                if (pw !== input.value) return; // user kept typing
                if (pwned) {
                    setMessage(msgText('msgBreached', 'This password appears in a known data breach. Please choose a different one.'), 'error');
                } else {
                    setMessage(msgText('msgStrong', 'Strong enough.'), 'success');
                }
            });
        }, 350);
    }

    input.addEventListener('input', onInput);
})();
