// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Session Timeout Warning
 * Based on GOV.UK Design System timeout warning pattern
 * https://design-system.service.gov.uk/components/timeout-warning/
 *
 * 🔴 Scheduling is WALL-CLOCK based, not timer based. The first version armed
 * a plain setTimeout for "warn in 25 minutes". Browsers throttle and batch
 * timers in background tabs (Chrome batches them to once a minute after five
 * minutes hidden, and suspends them entirely during OS sleep), so the warning
 * fired minutes late — usually at the moment the member re-activated the tab,
 * and sometimes not at all. Because this script is also what actually signs an
 * idle member out (the auth cookies themselves auto-refresh), a throttled
 * timer meant an unattended signed-in tab could stay signed in for hours.
 *
 * The fix: an absolute deadline (Date.now() based) is the single source of
 * truth. A once-a-second check compares the clock against it, and the check
 * also runs immediately on visibilitychange / focus / pageshow, so a
 * re-activated or bfcache-restored tab reconciles with reality at once:
 * past the deadline → sign out now; inside the warning window → show the
 * modal with the TRUE remaining time.
 */
(function() {
  'use strict';

  // Configuration
  //
  // 🔴 The session length comes from the SERVER, via data-session-timeout-minutes on
  // the authenticated marker element (layouts/base.njk, sourced from the Express
  // session maxAge). It used to be hardcoded to 30 here, duplicating the server value
  // with nothing keeping the two in step: changing the server's session length would
  // silently leave this warning firing after the session had already expired, or
  // minutes too early, with no test or error to reveal it.
  //
  // The 30 below is a last-resort fallback for a page that renders the script without
  // the marker; it is deliberately the same as the server default so the fallback is
  // not itself a desync.
  var DEFAULT_SESSION_TIMEOUT_MINUTES = 30;
  // Preferred lead time for the "your session is about to end" warning. The
  // ACTUAL lead is clamped to fit the session below, so a short server-declared
  // session still gets a warning that fires before it expires.
  var WARNING_LEAD_MAX_MINUTES = 5;
  // How often user activity is allowed to ping /session/touch so the server's
  // session window rolls alongside the local one. Local activity (scrolling,
  // typing) does not otherwise reach the server, and the express session
  // carries state (language choice, sign-in flow) that must not die mid-use.
  var KEEP_ALIVE_INTERVAL_MS = 5 * 60 * 1000;
  // Cross-tab activity broadcast. Activity in one tab extends the session for
  // every tab sharing it, so another tab must not count down to a sign-out the
  // server no longer intends. localStorage is per-origin, and so is the
  // session cookie, so the scopes match.
  var ACTIVITY_STORAGE_KEY = 'nexusWebukSessionActivityAt';

  function resolveSessionTimeoutMinutes() {
    var marker = document.querySelector('[data-session-timeout-minutes]');
    var declared = marker && parseInt(marker.getAttribute('data-session-timeout-minutes'), 10);
    // Honour any positive server-declared timeout. Previously a value of 5 or
    // fewer minutes was silently replaced by the 30-minute default — which is
    // LONGER than the real session — so a genuinely short session would log the
    // member out server-side while the warning was still counting down.
    if (declared && isFinite(declared) && declared > 0) {
      return declared;
    }
    return DEFAULT_SESSION_TIMEOUT_MINUTES;
  }

  var SESSION_TIMEOUT_MINUTES = resolveSessionTimeoutMinutes();

  // The warning lead can never be as long as the session itself, or the warning
  // would be scheduled at (or before) t=0. Clamp it to at most the preferred
  // lead and at least one minute, always strictly inside the session.
  var WARNING_BEFORE_MINUTES = Math.min(
    WARNING_LEAD_MAX_MINUTES,
    Math.max(1, SESSION_TIMEOUT_MINUTES - 1)
  );
  // The modal counts down the FULL warning lead, so logout lands exactly at the
  // session timeout. Previously this was a fixed 60s while the warning appeared
  // several minutes early, which signed idle members out minutes before their
  // session actually expired, with a modal that claimed "60 seconds" remaining.
  var COUNTDOWN_SECONDS = WARNING_BEFORE_MINUTES * 60;

  var sessionTimeoutMs = SESSION_TIMEOUT_MINUTES * 60 * 1000;
  var warningLeadMs = COUNTDOWN_SECONDS * 1000;

  // Absolute wall-clock deadline for the session, and the single scheduling
  // source of truth. Timers only decide how often we LOOK at the clock; they
  // never carry the deadline themselves.
  var deadlineAt = 0;
  var checkTimer = null;
  var countdownSeconds = COUNTDOWN_SECONDS;
  var modalOpen = false;
  var lastFocusedElement = null;
  var loggingOut = false;
  var lastKeepAliveAt = 0;
  var announcedThresholds = {};

  function timeoutMarker() {
    return document.querySelector('[data-authenticated="true"]');
  }

  function timeoutText(attribute) {
    var marker = timeoutMarker();
    return marker ? marker.getAttribute(attribute) || '' : '';
  }

  function pluralCategory(count) {
    try {
      return new Intl.PluralRules(document.documentElement.lang || 'en').select(count);
    } catch (error) {
      return count === 1 ? 'one' : 'other';
    }
  }

  function formatTimeoutUnit(count, unit) {
    var category = pluralCategory(count);
    var template = timeoutText('data-timeout-' + unit + '-' + category)
      || timeoutText('data-timeout-' + unit + '-other');
    return template.replace(':count', String(count));
  }

  // Format a countdown duration as localised "N minutes and M seconds" / "N
  // minutes" / "M seconds". Shared by the initial modal notice and the live
  // countdown so they never disagree about the remaining time.
  function formatCountdownText(totalSeconds) {
    var minutes = Math.floor(totalSeconds / 60);
    var seconds = totalSeconds % 60;
    if (minutes > 0 && seconds > 0) {
      return formatTimeoutUnit(minutes, 'minutes') + ' ' + timeoutText('data-timeout-time-separator') + ' ' + formatTimeoutUnit(seconds, 'seconds');
    }
    if (minutes > 0) {
      return formatTimeoutUnit(minutes, 'minutes');
    }
    return formatTimeoutUnit(seconds, 'seconds');
  }

  function appendTimeMessage(element, template, timeText) {
    var parts = template.split(':time');
    element.textContent = '';
    element.appendChild(document.createTextNode(parts[0] || ''));
    var emphasis = document.createElement('span');
    emphasis.id = 'timeout-countdown';
    emphasis.className = 'govuk-!-font-weight-bold';
    emphasis.textContent = timeText;
    element.appendChild(emphasis);
    element.appendChild(document.createTextNode(parts.slice(1).join(':time')));
  }

  // ------------------------------------------------------------------
  // Deadline bookkeeping
  // ------------------------------------------------------------------

  function readSharedActivityAt() {
    try {
      var raw = window.localStorage.getItem(ACTIVITY_STORAGE_KEY);
      var value = raw ? parseInt(raw, 10) : 0;
      // Ignore garbage and clock-skewed future values (another tab cannot have
      // been active later than "now").
      if (isFinite(value) && value > 0 && value <= Date.now()) {
        return value;
      }
    } catch (error) {
      // localStorage unavailable (private mode, storage policy) — single-tab
      // behaviour still works without it.
    }
    return 0;
  }

  function broadcastActivity(activityAt) {
    try {
      window.localStorage.setItem(ACTIVITY_STORAGE_KEY, String(activityAt));
    } catch (error) {
      // Ignore — cross-tab sync is an enhancement, not a requirement.
    }
  }

  function resetDeadline() {
    deadlineAt = Date.now() + sessionTimeoutMs;
    announcedThresholds = {};
  }

  // Adopt activity another tab broadcast, so this tab never signs the member
  // out while they are demonstrably working in a sibling tab.
  function adoptSharedActivity() {
    var sharedActivityAt = readSharedActivityAt();
    if (sharedActivityAt && sharedActivityAt + sessionTimeoutMs > deadlineAt) {
      deadlineAt = sharedActivityAt + sessionTimeoutMs;
      announcedThresholds = {};
    }
  }

  function remainingSeconds() {
    return Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000));
  }

  // ------------------------------------------------------------------
  // The clock check — the heart of the component
  // ------------------------------------------------------------------

  function check() {
    if (loggingOut) {
      return;
    }

    adoptSharedActivity();

    var now = Date.now();

    if (now >= deadlineAt) {
      submitLogout();
      return;
    }

    if (now >= deadlineAt - warningLeadMs) {
      if (!modalOpen) {
        showModal();
      }
      updateCountdown();
      return;
    }

    // Deadline moved forward (another tab extended, or a keep-alive landed)
    // while the modal was showing — stand down.
    if (modalOpen) {
      hideModal();
    }
  }

  // Create modal HTML
  function createModal() {
    var modal = document.createElement('div');
    modal.id = 'timeout-warning-modal';
    modal.className = 'app-timeout-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-labelledby', 'timeout-warning-title');
    modal.setAttribute('aria-describedby', 'timeout-warning-description');
    modal.setAttribute('aria-modal', 'true');
    modal.hidden = true;

    modal.innerHTML =
      '<div class="app-timeout-modal__overlay"></div>' +
      '<div class="app-timeout-modal__container">' +
        '<div class="app-timeout-modal__content">' +
          '<h2 id="timeout-warning-title" class="govuk-heading-l"></h2>' +
          '<p id="timeout-warning-description" class="govuk-body"></p>' +
          '<p id="timeout-warning-unsaved" class="govuk-body"></p>' +
          '<div class="govuk-button-group">' +
            '<button type="button" id="timeout-extend-button" class="govuk-button" data-module="govuk-button"></button>' +
            '<button type="submit" id="timeout-sign-out-button" form="session-timeout-logout-form" class="app-link-button"></button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);
    document.getElementById('timeout-warning-title').textContent = timeoutText('data-timeout-title');
    document.getElementById('timeout-warning-unsaved').textContent = timeoutText('data-timeout-unsaved-changes');
    document.getElementById('timeout-extend-button').textContent = timeoutText('data-timeout-stay-signed-in');
    document.getElementById('timeout-sign-out-button').textContent = timeoutText('data-timeout-sign-out-now');
    appendTimeMessage(
      document.getElementById('timeout-warning-description'),
      timeoutText('data-timeout-security-notice'),
      formatCountdownText(COUNTDOWN_SECONDS)
    );
    return modal;
  }

  // Show the modal
  function showModal() {
    var modal = document.getElementById('timeout-warning-modal');
    if (!modal) {
      modal = createModal();
    }

    // Store last focused element
    lastFocusedElement = document.activeElement;

    // The displayed time comes from the deadline, so a modal that appears late
    // (throttled background tab) shows the TRUE remaining time, not a full
    // countdown it cannot honour.
    announcedThresholds = {};
    updateCountdown();

    // Show modal
    modal.hidden = false;
    modalOpen = true;
    document.body.classList.add('app-timeout-modal--open');

    // Focus the extend button
    var extendButton = document.getElementById('timeout-extend-button');
    if (extendButton) {
      extendButton.focus();
    }

    // Add event listeners (remove first to prevent duplicates on repeated show/hide)
    extendButton.removeEventListener('click', extendSession);
    extendButton.addEventListener('click', extendSession);
    modal.removeEventListener('keydown', handleModalKeydown);
    modal.addEventListener('keydown', handleModalKeydown);

    // Trap focus within modal
    trapFocus(modal);
  }

  // Hide the modal
  function hideModal() {
    var modal = document.getElementById('timeout-warning-modal');
    if (modal) {
      modal.hidden = true;
      modalOpen = false;
      document.body.classList.remove('app-timeout-modal--open');

      // Restore focus
      if (lastFocusedElement) {
        lastFocusedElement.focus();
      }
    }
  }

  // Update countdown display from the wall-clock deadline
  function updateCountdown() {
    countdownSeconds = remainingSeconds();
    var countdownEl = document.getElementById('timeout-countdown');
    if (countdownEl) {
      var text = formatCountdownText(countdownSeconds);
      countdownEl.textContent = text;

      // Announce to screen readers as key thresholds are crossed. Threshold
      // CROSSING (not equality) because a throttled tab can skip individual
      // second values entirely.
      [30, 10].forEach(function(threshold) {
        if (countdownSeconds <= threshold && !announcedThresholds[threshold]) {
          announcedThresholds[threshold] = true;
          announceToScreenReader(timeoutText('data-timeout-announcement').replace(':time', text));
        }
      });
    }
  }

  // Extend the session
  function extendSession() {
    // Read CSRF token from the authenticated marker element
    var authEl = document.querySelector('[data-authenticated="true"]');
    var csrfToken = authEl ? authEl.getAttribute('data-csrf-token') : '';

    // Make a request to keep the session alive by touching an authenticated endpoint
    fetch('/session/touch', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken
      }
    }).then(function(response) {
      if (response.ok) {
        lastKeepAliveAt = Date.now();
        resetDeadline();
        broadcastActivity(Date.now());
        hideModal();
      } else {
        redirectToLogin();
      }
    }).catch(function() {
      // If request fails, redirect to login
      redirectToLogin();
    });
  }

  // Fire-and-forget keep-alive so the SERVER session window rolls with local
  // activity (scrolling and typing never reach the server on their own).
  // Throttled; a transient failure is ignored — the modal's explicit extend
  // path above is the one that must be honest about errors.
  function keepAlive() {
    var now = Date.now();
    if (now - lastKeepAliveAt < KEEP_ALIVE_INTERVAL_MS) {
      return;
    }
    lastKeepAliveAt = now;

    var authEl = document.querySelector('[data-authenticated="true"]');
    var csrfToken = authEl ? authEl.getAttribute('data-csrf-token') : '';
    fetch('/session/touch', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken
      }
    }).catch(function() {
      // Allow a retry sooner than the full interval after a failure.
      lastKeepAliveAt = now - KEEP_ALIVE_INTERVAL_MS + 60 * 1000;
    });
  }

  function redirectToLogin() {
    var loginLink = document.getElementById('session-timeout-login-link');
    if (loginLink) {
      loginLink.click();
      return;
    }
    window.location.href = '/login';
  }

  function submitLogout() {
    // The countdown end and the clock check can coincide — guard against a
    // double submit.
    if (loggingOut) {
      return;
    }
    loggingOut = true;
    if (checkTimer) {
      clearInterval(checkTimer);
      checkTimer = null;
    }

    var logoutForm = document.getElementById('session-timeout-logout-form');
    if (!logoutForm) {
      redirectToLogin();
      return;
    }

    if (typeof logoutForm.requestSubmit === 'function') {
      logoutForm.requestSubmit();
      return;
    }

    logoutForm.submit();
  }

  // Handle keyboard events in modal
  function handleModalKeydown(event) {
    if (event.key === 'Escape') {
      extendSession();
    }
  }

  // Trap focus within modal
  var _trapFocusHandler = null;

  function trapFocus(modal) {
    var focusableElements = modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    var firstElement = focusableElements[0];
    var lastElement = focusableElements[focusableElements.length - 1];

    // Remove any previously registered trap-focus handler to avoid duplicates
    if (_trapFocusHandler) {
      modal.removeEventListener('keydown', _trapFocusHandler);
    }

    _trapFocusHandler = function(event) {
      if (event.key !== 'Tab') return;

      if (event.shiftKey) {
        if (document.activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
        }
      }
    };

    modal.addEventListener('keydown', _trapFocusHandler);
  }

  // Announce to screen readers
  function announceToScreenReader(message) {
    var announcer = document.getElementById('timeout-sr-announcer');
    if (!announcer) {
      announcer = document.createElement('div');
      announcer.id = 'timeout-sr-announcer';
      announcer.setAttribute('role', 'status');
      announcer.setAttribute('aria-live', 'polite');
      announcer.className = 'govuk-visually-hidden';
      document.body.appendChild(announcer);
    }
    announcer.textContent = message;
  }

  // Reset the deadline on user activity. While the modal is open the member
  // must choose explicitly — background activity does not extend.
  function onUserActivity() {
    if (!modalOpen && !loggingOut) {
      resetDeadline();
      broadcastActivity(Date.now());
      keepAlive();
    }
  }

  // Initialize
  function init() {
    // Only run for authenticated users
    var isAuthenticated = document.querySelector('[data-authenticated="true"]');
    if (!isAuthenticated) return;

    // Page load is real server contact (the rolling session cookie was just
    // re-issued), so it both starts the local window and counts as activity
    // for sibling tabs.
    resetDeadline();
    broadcastActivity(Date.now());

    // Look at the clock once a second. Background throttling can slow this to
    // roughly once a minute — acceptable, because the deadline is absolute and
    // the visibility/focus hooks below reconcile immediately on re-activation.
    checkTimer = setInterval(check, 1000);

    // A tab coming back to life must reconcile with the wall clock at once:
    // past the deadline → sign out, inside the warning window → warn with the
    // true remaining time. pageshow also covers bfcache restores, where no
    // load event fires.
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') {
        check();
      }
    });
    window.addEventListener('focus', check);
    window.addEventListener('pageshow', function() {
      check();
    });

    // Activity in another tab extends this one too.
    window.addEventListener('storage', function(event) {
      if (event.key === ACTIVITY_STORAGE_KEY) {
        check();
      }
    });

    // Reset on user activity (debounced)
    var activityTimeout = null;
    var activityEvents = ['mousedown', 'keydown', 'touchstart', 'scroll'];

    activityEvents.forEach(function(eventName) {
      document.addEventListener(eventName, function() {
        if (activityTimeout) {
          clearTimeout(activityTimeout);
        }
        activityTimeout = setTimeout(onUserActivity, 1000);
      }, { passive: true });
    });
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
