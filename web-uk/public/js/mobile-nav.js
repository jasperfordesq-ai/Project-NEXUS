// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Mobile navigation toggle
(function() {
  const menuButton = document.querySelector('.js-header-toggle');
  const navigation = document.querySelector('.js-header-navigation');

  if (menuButton && navigation) {
    // Set initial state based on screen size
    function setInitialState() {
      const isMobile = window.innerWidth < 769;
      if (isMobile) {
        navigation.setAttribute('aria-hidden', 'true');
        menuButton.setAttribute('aria-expanded', 'false');
      } else {
        navigation.setAttribute('aria-hidden', 'false');
        menuButton.setAttribute('aria-expanded', 'true');
      }
    }

    setInitialState();

    menuButton.addEventListener('click', function() {
      const isExpanded = menuButton.getAttribute('aria-expanded') === 'true';
      menuButton.setAttribute('aria-expanded', !isExpanded);
      navigation.setAttribute('aria-hidden', isExpanded);
      menuButton.classList.toggle('app-header__menu-button--open', !isExpanded);

      // Focus management: move focus to first menu item when opening
      if (!isExpanded) {
        const firstLink = navigation.querySelector('a, button');
        if (firstLink) {
          firstLink.focus();
        }
      }
    });

    // Close menu and return focus to button when Escape is pressed
    navigation.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') {
        const isExpanded = menuButton.getAttribute('aria-expanded') === 'true';
        if (isExpanded && window.innerWidth < 769) {
          menuButton.setAttribute('aria-expanded', 'false');
          navigation.setAttribute('aria-hidden', 'true');
          menuButton.classList.remove('app-header__menu-button--open');
          menuButton.focus();
        }
      }
    });

    // Reset on resize
    window.addEventListener('resize', function() {
      if (window.innerWidth >= 769) {
        navigation.setAttribute('aria-hidden', 'false');
        menuButton.setAttribute('aria-expanded', 'true');
        menuButton.classList.remove('app-header__menu-button--open');
      }
    });
  }
})();
