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
//   3. Disables the submit button until both pass.
//
// Wires up to:
//   - #password (input)
//   - #password-strength-msg (status output, aria-live polite)
//   - the form's first <button type="submit">

(function () {
    var MIN_LEN = 12;
    var input = document.getElementById('password');
    var msg = document.getElementById('password-strength-msg');
    if (!input || !msg) return;
    var form = input.closest('form');
    var submitBtn = form ? form.querySelector('button[type="submit"]') : null;

    var debounceTimer = null;
    var lastPwned = null;
    var checkCache = Object.create(null);

    function setMessage(text, tone) {
        msg.textContent = text;
        msg.className = 'govuk-body-s govuk-!-margin-top-2 ' +
            (tone === 'error' ? 'govuk-error-message' :
             tone === 'success' ? 'app-success-message' : '');
    }

    function updateGate() {
        var ok = input.value.length >= MIN_LEN && lastPwned === false;
        if (submitBtn) {
            submitBtn.disabled = !ok;
            submitBtn.setAttribute('aria-disabled', String(!ok));
        }
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
        try {
            var resp = await fetch('https://api.pwnedpasswords.com/range/' + prefix,
                { headers: { 'Add-Padding': 'true' } });
            if (!resp.ok) return false;
            var body = await resp.text();
            var pwned = body.split('\n').some(function (line) {
                var parts = line.trim().split(':');
                return parts[0] === suffix && Number(parts[1]) > 0;
            });
            checkCache[hash] = pwned;
            return pwned;
        } catch (e) {
            return false; // fail-open on network error
        }
    }

    function onInput() {
        var pw = input.value;
        if (pw.length === 0) {
            setMessage('Use ' + MIN_LEN + ' or more characters. A memorable passphrase is stronger than a short complex one.', 'idle');
            lastPwned = null; updateGate(); return;
        }
        if (pw.length < MIN_LEN) {
            var remaining = MIN_LEN - pw.length;
            setMessage('Add ' + remaining + ' more character' + (remaining === 1 ? '' : 's') + '.', 'warn');
            lastPwned = null; updateGate(); return;
        }
        setMessage('Checking against known data breaches…', 'idle');
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
            checkHibp(pw).then(function (pwned) {
                if (pw !== input.value) return; // user kept typing
                lastPwned = pwned;
                if (pwned) {
                    setMessage('This password appears in a known data breach. Please choose a different one.', 'error');
                } else {
                    setMessage('Strong enough.', 'success');
                }
                updateGate();
            });
        }, 350);
    }

    input.addEventListener('input', onInput);
    updateGate();
})();
