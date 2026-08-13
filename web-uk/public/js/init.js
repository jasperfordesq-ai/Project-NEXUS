// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Initialize GOV.UK Frontend components
import { initAll } from '/js/govuk-frontend.min.js';

function prepareCharacterCounts() {
  const translations = document.getElementById('character-count-translations');
  if (!translations) return;

  function translatedCharacterCount(maximum) {
    let category = maximum === 1 ? 'one' : 'other';
    try {
      category = new Intl.PluralRules(document.documentElement.lang || 'en').select(maximum);
    } catch (error) {
      // The one/other fallback covers older browsers without Intl.PluralRules.
    }

    const template = translations.getAttribute(`data-i18n.characters-under-limit.${category}`)
      || translations.getAttribute('data-i18n.characters-under-limit.other');
    return template ? template.replace('%{count}', String(maximum)) : '';
  }

  for (const textarea of document.querySelectorAll('textarea[maxlength]')) {
    if (!textarea.id || textarea.closest('[data-module="govuk-character-count"]')) continue;

    const maximum = textarea.getAttribute('maxlength');
    if (!maximum) continue;

    const wrapper = document.createElement('div');
    wrapper.className = 'govuk-character-count';
    wrapper.setAttribute('data-module', 'govuk-character-count');
    wrapper.setAttribute('data-maxlength', maximum);
    for (const attribute of translations.attributes) {
      if (attribute.name.startsWith('data-i18n.')) {
        wrapper.setAttribute(attribute.name, attribute.value);
      }
    }

    const message = document.createElement('div');
    message.id = `${textarea.id}-info`;
    message.className = 'govuk-hint govuk-character-count__message';
    message.textContent = translatedCharacterCount(Number(maximum));

    const describedBy = (textarea.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    if (!describedBy.includes(message.id)) describedBy.push(message.id);
    textarea.setAttribute('aria-describedby', describedBy.join(' '));
    textarea.classList.add('govuk-js-character-count');

    textarea.parentNode.insertBefore(wrapper, textarea);
    wrapper.appendChild(textarea);
    wrapper.appendChild(message);
  }
}

prepareCharacterCounts();
initAll();
