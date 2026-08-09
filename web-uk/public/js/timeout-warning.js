// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Session Timeout Warning
 * Based on GOV.UK Design System timeout warning pattern
 * https://design-system.service.gov.uk/components/timeout-warning/
 */
(function() {
  'use strict';

  // Configuration
  var SESSION_TIMEOUT_MINUTES = 30;
  var WARNING_BEFORE_MINUTES = 5; // Show warning 5 minutes before timeout
  var COUNTDOWN_SECONDS = 60; // Countdown in the modal

  var sessionTimeoutMs = SESSION_TIMEOUT_MINUTES * 60 * 1000;
  var warningTimeMs = (SESSION_TIMEOUT_MINUTES - WARNING_BEFORE_MINUTES) * 60 * 1000;

  var warningTimer = null;
  var logoutTimer = null;
  var countdownTimer = null;
  var countdownSeconds = COUNTDOWN_SECONDS;
  var modalOpen = false;
  var lastFocusedElement = null;

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
          '<h2 id="timeout-warning-title" class="govuk-heading-l">You will be signed out soon</h2>' +
          '<p id="timeout-warning-description" class="govuk-body">' +
            'For your security, we will sign you out in <span id="timeout-countdown" class="govuk-!-font-weight-bold">' + COUNTDOWN_SECONDS + ' seconds</span>.' +
          '</p>' +
          '<p class="govuk-body">Any unsaved changes will be lost.</p>' +
          '<div class="govuk-button-group">' +
            '<button type="button" id="timeout-extend-button" class="govuk-button" data-module="govuk-button">' +
              'Stay signed in' +
            '</button>' +
            '<button type="submit" form="session-timeout-logout-form" class="app-link-button">Sign out now</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);
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

    // Reset countdown
    countdownSeconds = COUNTDOWN_SECONDS;
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

    // Start countdown
    countdownTimer = setInterval(function() {
      countdownSeconds--;
      updateCountdown();

      if (countdownSeconds <= 0) {
        clearInterval(countdownTimer);
        submitLogout();
      }
    }, 1000);

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

      // Clear countdown
      if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }

      // Restore focus
      if (lastFocusedElement) {
        lastFocusedElement.focus();
      }
    }
  }

  // Update countdown display
  function updateCountdown() {
    var countdownEl = document.getElementById('timeout-countdown');
    if (countdownEl) {
      var minutes = Math.floor(countdownSeconds / 60);
      var seconds = countdownSeconds % 60;
      var text = '';

      if (minutes > 0 && seconds > 0) {
        text = minutes + ' minute' + (minutes !== 1 ? 's' : '') + ' and ' + seconds + ' second' + (seconds !== 1 ? 's' : '');
      } else if (minutes > 0) {
        text = minutes + ' minute' + (minutes !== 1 ? 's' : '');
      } else {
        text = seconds + ' second' + (seconds !== 1 ? 's' : '');
      }

      countdownEl.textContent = text;

      // Announce to screen readers at key intervals
      if (countdownSeconds === 30 || countdownSeconds === 10) {
        announceToScreenReader('You will be signed out in ' + text);
      }
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
        hideModal();
        resetTimers();
      } else {
        redirectToLogin();
      }
    }).catch(function() {
      // If request fails, redirect to login
      redirectToLogin();
    });
  }

  function redirectToLogin() {
    var authEl = document.querySelector('[data-authenticated="true"]');
    var loginUrl = authEl ? authEl.getAttribute('data-login-url') : '';
    window.location.href = loginUrl || '/login';
  }

  function submitLogout() {
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

  // Reset timers
  function resetTimers() {
    clearTimeout(warningTimer);
    clearTimeout(logoutTimer);

    // Set warning timer
    warningTimer = setTimeout(showModal, warningTimeMs);

    // Set logout timer (backup)
    logoutTimer = setTimeout(function() {
      submitLogout();
    }, sessionTimeoutMs);
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

  // Reset timers on user activity
  function onUserActivity() {
    if (!modalOpen) {
      resetTimers();
    }
  }

  // Initialize
  function init() {
    // Only run for authenticated users
    var isAuthenticated = document.querySelector('[data-authenticated="true"]');
    if (!isAuthenticated) return;

    // Start timers
    resetTimers();

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
