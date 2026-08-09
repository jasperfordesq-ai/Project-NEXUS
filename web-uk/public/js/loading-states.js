// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Loading States
 * Provides accessible loading indicators for async operations
 * Following GOV.UK patterns for progressive enhancement
 */
(function() {
  'use strict';

  /**
   * Add loading state to a button
   * @param {HTMLButtonElement} button - The button element
   * @param {string} loadingText - Optional loading text (defaults to "Loading...")
   */
  function setButtonLoading(button, loadingText) {
    if (!button || button.disabled) return;

    // Store original state
    button.dataset.originalText = button.textContent;
    button.dataset.originalAriaLabel = button.getAttribute('aria-label') || '';

    // Set loading state
    button.disabled = true;
    button.classList.add('app-button--loading');
    button.setAttribute('aria-busy', 'true');

    // Add spinner and loading text
    const text = loadingText || button.dataset.loadingText || 'Loading...';
    button.innerHTML = '<span class="app-button__spinner" aria-hidden="true"></span>' +
                       '<span class="app-button__text">' + escapeHtml(text) + '</span>';
    button.setAttribute('aria-label', text);
  }

  /**
   * Remove loading state from a button
   * @param {HTMLButtonElement} button - The button element
   */
  function clearButtonLoading(button) {
    if (!button) return;

    // Restore original state
    button.disabled = false;
    button.classList.remove('app-button--loading');
    button.removeAttribute('aria-busy');

    if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }

    if (button.dataset.originalAriaLabel) {
      button.setAttribute('aria-label', button.dataset.originalAriaLabel);
      delete button.dataset.originalAriaLabel;
    } else {
      button.removeAttribute('aria-label');
    }
  }

  /**
   * Show inline loading indicator
   * @param {HTMLElement} container - Container element
   * @param {string} message - Loading message
   * @returns {HTMLElement} The loading element
   */
  function showInlineLoading(container, message) {
    if (!container) return null;

    const loader = document.createElement('div');
    loader.className = 'app-loading app-loading--inline';
    loader.setAttribute('role', 'status');
    loader.setAttribute('aria-live', 'polite');
    loader.innerHTML = '<span class="app-loading__spinner" aria-hidden="true"></span>' +
                       '<span class="app-loading__text">' + escapeHtml(message || 'Loading...') + '</span>';

    container.appendChild(loader);
    return loader;
  }

  /**
   * Show full-page loading overlay
   * @param {string} message - Loading message
   * @returns {HTMLElement} The overlay element
   */
  function showPageLoading(message) {
    // Remove existing overlay if present
    hidePageLoading();

    const overlay = document.createElement('div');
    overlay.id = 'app-page-loading';
    overlay.className = 'app-loading-overlay';
    overlay.setAttribute('role', 'alert');
    overlay.setAttribute('aria-live', 'assertive');
    overlay.innerHTML = '<div class="app-loading-overlay__content">' +
                        '<span class="app-loading__spinner app-loading__spinner--large" aria-hidden="true"></span>' +
                        '<p class="govuk-body-l">' + escapeHtml(message || 'Loading...') + '</p>' +
                        '</div>';

    document.body.appendChild(overlay);
    document.body.classList.add('app-loading-overlay--active');

    return overlay;
  }

  /**
   * Hide full-page loading overlay
   */
  function hidePageLoading() {
    const overlay = document.getElementById('app-page-loading');
    if (overlay) {
      overlay.remove();
      document.body.classList.remove('app-loading-overlay--active');
    }
  }

  /**
   * Remove loading indicator
   * @param {HTMLElement} loader - The loading element to remove
   */
  function hideLoading(loader) {
    if (loader && loader.parentNode) {
      loader.remove();
    }
  }

  /**
   * Auto-enhance forms to show loading on submit
   */
  function enhanceForms() {
    document.querySelectorAll('form[data-loading]').forEach(function(form) {
      form.addEventListener('submit', function(event) {
        // Don't disable if the browser prevented submission (e.g. validation failure)
        if (event.defaultPrevented) return;

        const submitButton = form.querySelector('button[type="submit"], input[type="submit"]');
        if (submitButton && submitButton.tagName === 'BUTTON') {
          setButtonLoading(submitButton, form.dataset.loading);

          // Re-enable the button after 10 seconds as a fallback (in case navigation
          // is prevented by a same-page error or the user stays on the page)
          var fallbackTimer = setTimeout(function() {
            clearButtonLoading(submitButton);
          }, 10000);

          // Clear the fallback timer if the page navigates away
          window.addEventListener('pagehide', function() {
            clearTimeout(fallbackTimer);
          }, { once: true });
        }
      });
    });
  }

  /**
   * Auto-enhance buttons that trigger async actions
   */
  function enhanceButtons() {
    document.querySelectorAll('[data-loading-trigger]').forEach(function(button) {
      button.addEventListener('click', function() {
        setButtonLoading(button, button.dataset.loadingText);
      });
    });
  }

  // Initialize on DOM ready
  function init() {
    enhanceForms();
    enhanceButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /**
   * Escape HTML to prevent XSS in dynamically created elements
   * @param {string} str - The string to escape
   * @returns {string} The escaped string
   */
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  // Export API
  window.NEXUSLoading = {
    setButtonLoading: setButtonLoading,
    clearButtonLoading: clearButtonLoading,
    showInlineLoading: showInlineLoading,
    showPageLoading: showPageLoading,
    hidePageLoading: hidePageLoading,
    hideLoading: hideLoading
  };
})();
