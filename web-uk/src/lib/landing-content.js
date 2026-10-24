// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The community's own front-page wording, read from the landing page editor
 * (/admin/landing-page, bootstrap `landing_page_config`), so the accessible
 * home page says what the main site's front page says.
 *
 * Only wording the community actually wrote is returned. An empty box, or a
 * community that never used the editor, gives empty values and the accessible
 * site keeps its own standard wording — the main site's standard sentences are
 * written for its own layout and are not copied here. A section switched off
 * in the editor is left out on both sites.
 *
 * Buttons are deliberately not read: the editor's links point at main-site
 * addresses, some of which have no accessible page.
 *
 * Replaces the "hub heading" / "hub intro" SEO fields (tenants.h1_headline /
 * hero_intro), retired 2026-10-24: they showed on three hub communities only.
 */

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function enabledSection(config, id) {
  const sections = config && Array.isArray(config.sections) ? config.sections : [];
  const section = sections.find((candidate) => candidate && (candidate.id === id || candidate.type === id));
  if (!section || section.enabled === false) return null;
  return section.content && typeof section.content === 'object' ? section.content : {};
}

function landingHomeContent(config) {
  const hero = enabledSection(config, 'hero') || {};
  const heading = [text(hero.headline_1), text(hero.headline_2)].filter(Boolean).join(' ');
  const intro = text(hero.subheadline);

  const howContent = enabledSection(config, 'how_it_works');
  const steps = howContent && Array.isArray(howContent.steps)
    ? howContent.steps
      .map((step) => ({ title: text(step?.title), description: text(step?.description) }))
      .filter((step) => step.title || step.description)
    : [];
  const howItWorks = steps.length
    ? { title: text(howContent.title), subtitle: text(howContent.subtitle), steps }
    : null;

  const ctaContent = enabledSection(config, 'cta');
  const closing = ctaContent && (text(ctaContent.title) || text(ctaContent.description))
    ? { title: text(ctaContent.title), description: text(ctaContent.description) }
    : null;

  return { heading, intro, howItWorks, closing };
}

module.exports = { landingHomeContent };
