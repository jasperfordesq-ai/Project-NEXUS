// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Client-side form validation following GOV.UK Design System patterns
 * Provides immediate feedback while maintaining progressive enhancement
 */

(function() {
  'use strict';

  // Validation rules
  const validators = {
    required: {
      validate: (value) => value.trim().length > 0,
      message: (label) => `Enter ${label.toLowerCase()}`
    },
    email: {
      validate: (value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
      message: () => 'Enter a valid email address'
    },
    minLength: {
      validate: (value, min) => !value || value.length >= min,
      message: (label, min) => `${label} must be at least ${min} characters`
    },
    maxLength: {
      validate: (value, max) => !value || value.length <= max,
      message: (label, max) => `${label} must be ${max} characters or fewer`
    },
    matches: {
      validate: (value, otherFieldName, form) => {
        const otherField = form.querySelector(`[name="${otherFieldName}"]`);
        return !value || !otherField || value === otherField.value;
      },
      message: (label, otherLabel) => `${label} must match ${otherLabel.toLowerCase()}`
    },
    number: {
      validate: (value) => !value || !isNaN(parseFloat(value)),
      message: (label) => `${label} must be a number`
    },
    min: {
      validate: (value, min) => !value || parseFloat(value) >= min,
      message: (label, min) => `${label} must be ${min} or more`
    },
    max: {
      validate: (value, max) => !value || parseFloat(value) <= max,
      message: (label, max) => `${label} must be ${max} or fewer`
    },
    pattern: {
      validate: (value, pattern) => !value || new RegExp(pattern).test(value),
      message: (label) => `Enter a valid ${label.toLowerCase()}`
    }
  };

  /**
   * Initialize validation on a form
   * @param {HTMLFormElement} form - The form element to validate
   */
  function initFormValidation(form) {
    if (!form || form.dataset.validated) return;
    form.dataset.validated = 'true';

    const fields = form.querySelectorAll('[data-validate]');

    // Add blur validation for each field
    fields.forEach(field => {
      field.addEventListener('blur', () => {
        validateField(field, form);
      });

      // Clear error on input (provides immediate feedback)
      field.addEventListener('input', () => {
        const formGroup = field.closest('.govuk-form-group');
        if (formGroup && formGroup.classList.contains('govuk-form-group--error')) {
          clearFieldError(field);
        }
      });
    });

    // Validate all fields on submit
    form.addEventListener('submit', (e) => {
      const errors = validateForm(form);

      if (errors.length > 0) {
        e.preventDefault();
        showErrorSummary(form, errors);
      }
    });
  }

  /**
   * Validate a single field
   * @param {HTMLElement} field - The field to validate
   * @param {HTMLFormElement} form - The parent form
   * @returns {Object|null} Error object or null if valid
   */
  function validateField(field, form) {
    const rules = field.dataset.validate.split(' ');
    const label = getFieldLabel(field);
    const value = field.value;

    for (const rule of rules) {
      const [ruleName, ...params] = rule.split(':');
      const validator = validators[ruleName];

      if (!validator) continue;

      const isValid = validator.validate(value, ...params, form);

      if (!isValid) {
        const message = field.dataset[`${ruleName}Message`]
          || form.dataset[`${ruleName}Message`]
          || validator.message(label, ...params);
        showFieldError(field, message, form.dataset.validationErrorPrefix || 'Error:');
        return { field: field.id || field.name, message, href: `#${field.id || field.name}` };
      }
    }

    clearFieldError(field);
    return null;
  }

  /**
   * Validate all fields in a form
   * @param {HTMLFormElement} form - The form to validate
   * @returns {Array} Array of error objects
   */
  function validateForm(form) {
    const errors = [];
    const fields = form.querySelectorAll('[data-validate]');

    fields.forEach(field => {
      const error = validateField(field, form);
      if (error) {
        errors.push(error);
      }
    });

    return errors;
  }

  /**
   * Get the label text for a field
   * @param {HTMLElement} field - The field element
   * @returns {string} The label text
   */
  function getFieldLabel(field) {
    // Check for data-label attribute first
    if (field.dataset.label) {
      return field.dataset.label;
    }

    // Try to find associated label
    const label = document.querySelector(`label[for="${field.id}"]`);
    if (label) {
      return label.textContent.trim().replace(/\*$/, '').trim();
    }

    // Fall back to name or placeholder
    return field.name || field.placeholder || 'this field';
  }

  /**
   * Show error on a field (GOV.UK style)
   * @param {HTMLElement} field - The field with the error
   * @param {string} message - The error message
   */
  function showFieldError(field, message, errorPrefix = 'Error:') {
    const formGroup = field.closest('.govuk-form-group');
    if (!formGroup) return;

    // Remove existing error
    clearFieldError(field);

    // Add error class to form group
    formGroup.classList.add('govuk-form-group--error');

    // Add error class to input - use correct class for element type
    if (field.tagName === 'TEXTAREA') {
      field.classList.add('govuk-textarea--error');
    } else if (field.tagName === 'SELECT') {
      field.classList.add('govuk-select--error');
    } else {
      field.classList.add('govuk-input--error');
    }

    // Create error message element
    const errorSpan = document.createElement('p');
    errorSpan.id = `${field.id || field.name}-error`;
    errorSpan.className = 'govuk-error-message';
    errorSpan.innerHTML = '<span class="govuk-visually-hidden">' + escapeHtml(errorPrefix) + '</span> ' + escapeHtml(message);

    // Insert before the input
    const inputWrapper = field.closest('.govuk-input__wrapper') || field;
    inputWrapper.parentNode.insertBefore(errorSpan, inputWrapper);

    // Append to existing aria-describedby rather than replacing it
    const existing = field.getAttribute('aria-describedby');
    if (existing) {
      field.setAttribute('aria-describedby', existing + ' ' + errorSpan.id);
    } else {
      field.setAttribute('aria-describedby', errorSpan.id);
    }
  }

  /**
   * Clear error from a field
   * @param {HTMLElement} field - The field to clear
   */
  function clearFieldError(field) {
    const formGroup = field.closest('.govuk-form-group');
    if (!formGroup) return;

    formGroup.classList.remove('govuk-form-group--error');
    field.classList.remove('govuk-input--error');
    field.classList.remove('govuk-textarea--error');
    field.classList.remove('govuk-select--error');

    const errorSpan = formGroup.querySelector('.govuk-error-message');
    if (errorSpan) {
      // Remove only the error ID from aria-describedby, not the whole attribute
      const errorId = errorSpan.id;
      const described = field.getAttribute('aria-describedby');
      if (described) {
        const updated = described.split(' ').filter(id => id !== errorId).join(' ');
        if (updated) {
          field.setAttribute('aria-describedby', updated);
        } else {
          field.removeAttribute('aria-describedby');
        }
      }
      errorSpan.remove();
    }
  }

  /**
   * Show error summary at top of form
   * @param {HTMLFormElement} form - The form
   * @param {Array} errors - Array of error objects
   */
  function showErrorSummary(form, errors) {
    // Remove existing summary
    const existingSummary = form.querySelector('.govuk-error-summary');
    if (existingSummary) {
      existingSummary.remove();
    }

    // Create error summary
    const summary = document.createElement('div');
    summary.className = 'govuk-error-summary';
    summary.setAttribute('data-module', 'govuk-error-summary');
    summary.setAttribute('tabindex', '-1');
    summary.setAttribute('role', 'alert');

    const errorList = errors.map(err =>
      '<li><a href="' + escapeHtml(err.href) + '">' + escapeHtml(err.message) + '</a></li>'
    ).join('');

    summary.innerHTML = `
      <div>
        <h2 class="govuk-error-summary__title">${escapeHtml(form.dataset.validationErrorTitle || 'There is a problem')}</h2>
        <div class="govuk-error-summary__body">
          <ul class="govuk-list govuk-error-summary__list">
            ${errorList}
          </ul>
        </div>
      </div>
    `;

    summary.querySelectorAll('a[href^="#"]').forEach(link => {
      link.addEventListener('click', () => {
        const target = document.getElementById(link.getAttribute('href').slice(1));
        if (target && typeof target.focus === 'function') {
          target.focus();
        }
      });
    });

    // Insert at top of form or before first form group
    const firstFormGroup = form.querySelector('.govuk-form-group');
    if (firstFormGroup) {
      form.insertBefore(summary, firstFormGroup);
    } else {
      form.prepend(summary);
    }

    // Focus the summary
    summary.focus();

    // Scroll to summary
    summary.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /**
   * Auto-initialize forms with data-validate-form attribute
   */
  function autoInit() {
    const forms = document.querySelectorAll('form[data-validate-form]');
    forms.forEach(form => initFormValidation(form));
  }

  // Auto-initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
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

  // Export for manual initialization
  window.NEXUSValidation = {
    init: initFormValidation,
    validate: validateForm,
    validators: validators
  };
})();
