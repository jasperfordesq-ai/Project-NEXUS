// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getFeatureModules } from './moduleRegistry';

const adminLocale = JSON.parse(
  readFileSync('public/locales/en/admin_config.json', 'utf8')
) as { config: Record<string, string> };

function slugConfigText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'value';
}

function optionToken(optionKey: string): string {
  return optionKey.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

describe('module registry podcast module', () => {
  it('registers podcasts with editable member authoring and moderation options', () => {
    const modules = getFeatureModules();
    const podcasts = modules.find(module => module.id === 'podcasts');

    expect(podcasts).toBeDefined();
    // Promoted out of alpha 2026-07-03, then labelled beta 2026-09-02: the
    // module works end to end but has not been signed off as finished/tested.
    expect(podcasts?.stage).toBe('beta');
    expect(podcasts?.configSource).toBe('podcast_config');
    expect(podcasts?.detailPageUrl).toBe('/admin/podcasts');

    const options = new Map(podcasts?.configOptions.map(option => [option.key, option]));
    expect(options.get('podcasts.allow_member_show_creation')?.defaultValue).toBe(true);
    expect(options.get('podcasts.moderation_enabled')?.defaultValue).toBe(false);
    expect(options.get('podcasts.enable_rss_feed')?.defaultValue).toBe(true);
    expect(options.get('podcasts.enable_transcripts')?.defaultValue).toBe(true);
    expect(options.get('podcasts.enable_chapters')?.defaultValue).toBe(true);
  });

  it('places podcasts after courses and before donations support', () => {
    const ids = getFeatureModules().map(module => module.id);

    expect(ids.indexOf('courses')).toBeLessThan(ids.indexOf('podcasts'));
    expect(ids.indexOf('podcasts')).toBeLessThan(ids.indexOf('member_premium'));
  });

  it('links the donations support module to its admin detail page', () => {
    const support = getFeatureModules().find(module => module.id === 'member_premium');

    expect(support).toBeDefined();
    expect(support?.detailPageUrl).toBe('/admin/member-premium');
    expect(support?.configOptions).toEqual([]);
  });

  // Display copy lives in admin_config.json, not on ModuleDefinition — the
  // registry carries no name/description fields. Assert the translated copy at
  // its real source, and that it still frames this module as donations rather
  // than paid features (the distinction the module was renamed to make).
  it('describes the donations support module as donations, not paid features', () => {
    const config = adminLocale.config;

    expect(config.module_name_member_premium).toBe('Donations & Support');
    expect(config.module_desc_member_premium).toBeTypeOf('string');
    expect(config.module_desc_member_premium).toMatch(/donations/i);
    expect(config.module_desc_member_premium).toMatch(/not paid features/i);
  });

  it('has admin translations for every podcast configuration control', () => {
    const podcasts = getFeatureModules().find(module => module.id === 'podcasts');
    expect(podcasts).toBeDefined();

    const config = adminLocale.config;
    for (const option of podcasts?.configOptions ?? []) {
      const token = optionToken(option.key);
      expect(config[`option_${token}_label`], `${option.key} label`).toBeTypeOf('string');
      expect(config[`option_${token}_desc`], `${option.key} description`).toBeTypeOf('string');
      expect(config[`option_category_${slugConfigText(option.category)}`], `${option.category} category`).toBeTypeOf('string');

      for (const choice of option.choices ?? []) {
        expect(
          config[`option_choice_${token}_${slugConfigText(choice.value)}`],
          `${option.key} choice ${choice.value}`,
        ).toBeTypeOf('string');
      }
    }
  });
});

describe('module registry newsletter module', () => {
  it('registers newsletter as a tenant feature with its admin surface', () => {
    const newsletter = getFeatureModules().find(module => module.id === 'newsletter');

    expect(newsletter).toBeDefined();
    expect(newsletter?.configSource).toBe('tenant_features');
    expect(newsletter?.detailPageUrl).toBe('/admin/newsletters');
  });
});

describe('module registry groups module', () => {
  it('only exposes enforced policies and links to operational administration', () => {
    const groups = getFeatureModules().find(module => module.id === 'groups');
    const keys = groups?.configOptions.map(option => option.key) ?? [];

    expect(groups?.detailPageUrl).toBe('/admin/groups');
    expect(keys).toContain('max_description_length');
    expect(keys).not.toEqual(expect.arrayContaining([
      'enable_feedback',
      'enable_achievements',
      'moderation_enabled',
      'content_filter_enabled',
      'profanity_filter_enabled',
    ]));

    for (const option of groups?.configOptions ?? []) {
      const token = optionToken(option.key);
      expect(adminLocale.config[`option_${token}_label`], `${option.key} label`).toBeTypeOf('string');
      expect(adminLocale.config[`option_${token}_desc`], `${option.key} description`).toBeTypeOf('string');
    }
  });
});

describe('module registry exchange workflow module', () => {
  // Owner decision, 26 Oct 2026: hide switches nothing enforces.
  it('does not offer the broker messaging or require-exchange switches', () => {
    const exchange = getFeatureModules().find(module => module.id === 'exchange_workflow');
    const keys = exchange?.configOptions.map(option => option.key) ?? [];

    expect(keys.length).toBeGreaterThan(0);
    expect(keys).not.toContain('broker_messaging_enabled');
    expect(keys).not.toContain('require_exchange_for_listings');
  });
});

describe('module registry authentication modules', () => {
  it('registers lockout-safe two-factor and passkey enrollment controls', () => {
    const modules = getFeatureModules();
    const twoFactor = modules.find(module => module.id === 'two_factor_authentication');
    const passkeys = modules.find(module => module.id === 'biometric_login');

    expect(twoFactor?.configSource).toBe('authentication_config');
    expect(passkeys?.configSource).toBe('authentication_config');

    expect(twoFactor?.configOptions.map(option => option.key)).toEqual([
      'two_factor.require_members',
      'two_factor.allow_trusted_devices',
      'two_factor.trusted_device_days',
      'two_factor.allow_staff_trusted_devices',
      'two_factor.staff_trusted_device_days',
      'two_factor.backup_code_count',
    ]);
    // E-085: staff remembering is capped at 30 days, matching the server.
    expect(twoFactor?.configOptions.find(option => option.key === 'two_factor.staff_trusted_device_days')?.max).toBe(30);
    expect(passkeys?.configOptions.map(option => option.key)).toEqual([
      'passkeys.enrollment_enabled',
      'passkeys.conditional_autofill',
      'passkeys.max_credentials_per_user',
    ]);
  });

  it('has translated names, descriptions, categories, and option copy', () => {
    const config = adminLocale.config;

    for (const moduleId of ['two_factor_authentication', 'biometric_login']) {
      const module = getFeatureModules().find(candidate => candidate.id === moduleId);
      expect(module).toBeDefined();
      expect(config[`module_name_${moduleId}`]).toBeTypeOf('string');
      expect(config[`module_desc_${moduleId}`]).toBeTypeOf('string');

      for (const option of module?.configOptions ?? []) {
        const token = optionToken(option.key);
        expect(config[`option_${token}_label`]).toBeTypeOf('string');
        expect(config[`option_${token}_desc`]).toBeTypeOf('string');
        expect(config[`option_category_${slugConfigText(option.category)}`]).toBeTypeOf('string');
      }
    }
  });
});

describe('module registry volunteering module', () => {
  // Three switches were offered here from 2026-03 to 2026-10 while nothing on
  // the server read them: an admin could toggle "burnout detection" and
  // nothing changed. A control that does nothing must not be offered.
  it('does not offer switches the server never reads', () => {
    const volunteering = getFeatureModules().find(candidate => candidate.id === 'volunteering');
    expect(volunteering).toBeDefined();

    const keys = volunteering?.configOptions.map(option => option.key) ?? [];
    expect(keys).not.toContain('volunteering.alert_default_expiry_hours');
    expect(keys).not.toContain('volunteering.alert_skill_matching');
    expect(keys).not.toContain('volunteering.burnout_detection');

    const categories = new Set(volunteering?.configOptions.map(option => option.category));
    expect(categories.has('emergency_alerts')).toBe(false);
    expect(categories.has('wellbeing_safety')).toBe(false);
  });

  // The five reminders moved here from the retired /admin/volunteering/config
  // page on 2026-10-18: one on/off switch and one timing each, in their own
  // category, with the same ranges the server enforces
  // (VolunteeringConfigurationService::RANGES).
  it('offers the five reminders as on/off plus timing pairs with the server ranges', () => {
    const volunteering = getFeatureModules().find(candidate => candidate.id === 'volunteering');
    const reminders = volunteering?.configOptions.filter(option => option.category === 'reminders') ?? [];

    expect(reminders.map(option => [option.key, option.type, option.defaultValue, option.min, option.max])).toEqual([
      ['volunteering.reminder_pre_shift_enabled', 'boolean', true, undefined, undefined],
      ['volunteering.reminder_pre_shift_hours_before', 'number', 24, 1, 168],
      ['volunteering.reminder_post_shift_feedback_enabled', 'boolean', true, undefined, undefined],
      ['volunteering.reminder_post_shift_feedback_hours_after', 'number', 2, 1, 168],
      ['volunteering.reminder_lapsed_volunteer_enabled', 'boolean', true, undefined, undefined],
      ['volunteering.reminder_lapsed_volunteer_days_inactive', 'number', 30, 1, 365],
      ['volunteering.reminder_credential_expiry_enabled', 'boolean', true, undefined, undefined],
      ['volunteering.reminder_credential_expiry_days_before', 'number', 30, 1, 90],
      ['volunteering.reminder_training_expiry_enabled', 'boolean', true, undefined, undefined],
      ['volunteering.reminder_training_expiry_days_before', 'number', 14, 1, 90],
    ]);

    const config = adminLocale.config;
    expect(config.option_category_reminders).toBeTypeOf('string');
    for (const option of reminders) {
      const token = optionToken(option.key);
      expect(config[`option_${token}_label`], `${option.key} label`).toBeTypeOf('string');
      expect(config[`option_${token}_desc`], `${option.key} description`).toBeTypeOf('string');
    }
  });

  // The window shows the registry default only until the server answers, and
  // the server always answers with its own DEFAULTS — so a registry default
  // that disagrees is a flash of a wrong number. Mirror the server.
  it('matches the server defaults for the three numbers that used to disagree', () => {
    const volunteering = getFeatureModules().find(candidate => candidate.id === 'volunteering');
    const byKey = new Map(volunteering?.configOptions.map(option => [option.key, option]));

    expect(byKey.get('volunteering.cancellation_deadline_hours')?.defaultValue).toBe(0);
    expect(byKey.get('volunteering.max_hours_per_shift')?.defaultValue).toBe(24);
    expect(byKey.get('volunteering.min_hours_for_certificate')?.defaultValue).toBe(0);
    expect(byKey.get('volunteering.min_hours_for_certificate')?.min).toBe(0);
  });
});
