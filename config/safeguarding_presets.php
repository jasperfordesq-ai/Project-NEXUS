<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Country/jurisdiction safeguarding presets.
 *
 * STRUCTURE: Each preset has TWO sections of options:
 *
 *   1. SUPPORT REQUESTS (priority — these protect the member who ticks them)
 *      Options for members who would like extra care. These trigger broker
 *      protections. What each one actually does is told to the member before
 *      they tick it, generated from its triggers by SafeguardingEffectsService
 *      — so the label/description say why you would choose it, never what it
 *      enforces.
 *
 *   2. SERVICE PROVIDER DECLARATIONS (secondary — informational)
 *      Members who intend to provide services to vulnerable adults. Country-
 *      specific vetting terminology. Informational for coordinators.
 *
 * Overhauled 25 Oct 2026:
 *  - no under-18 question: the platform is adults only;
 *  - "only vetted members may contact me" (requires_vetted_partners) is
 *    `accepts_new_selections => false`. It blocks all contact from anyone
 *    whose vetting the community has not recorded, which in practice cut
 *    members off entirely. It stays defined so members who already chose it
 *    keep their protection, and a community that genuinely records vetting
 *    can re-offer it from the broker panel;
 *  - "coordinator introductions" is the gentler route: coordinator oversight
 *    without cutting the member off;
 *  - "I consider myself a vulnerable adult" no longer blocks every direct
 *    message. Blocking direct contact is what requires_coordinator_contact is
 *    for, and that option says so.
 *
 * When an admin selects a preset, it populates tenant_safeguarding_options rows.
 * The admin can then freely edit, add, or remove options. The preset is a
 * convenience template — no conditional logic checks which preset was used.
 *
 * `vetting_type_required` values are controlled attestation codes. They never
 * represent member self-declarations or certificate records; an automated
 * contact gate can be activated only when the tenant's explicit jurisdiction
 * policy supports the selected code.
 */

$option = static fn (string $key, string $label, string $description, array $triggers, bool $acceptsNew = true): array => [
    'option_key' => $key,
    'option_type' => 'checkbox',
    'label' => $label,
    'description' => $description,
    'triggers' => $triggers,
    'accepts_new_selections' => $acceptsNew,
];

$common = 'safeguarding.presets.common.options.';

/**
 * @param array{vetting: string, vetted_description: string, vulnerable_adults_description: string, vulnerable_adult_label?: string, vulnerable_adults_label?: string, coordinator_contact_description?: string} $j
 */
$preset = static fn (string $key, array $j): array => [
    'name' => "safeguarding.presets.{$key}.name",
    'vetting_authority' => "safeguarding.presets.{$key}.vetting_authority",
    'help_text' => 'safeguarding.presets.common.help_text',
    'options' => [
        // ── SUPPORT REQUESTS ─────────────────────────────────────────────
        $option(
            'is_vulnerable_adult',
            $j['vulnerable_adult_label'] ?? $common . 'is_vulnerable_adult.label',
            $common . 'is_vulnerable_adult.description',
            [
                'requires_broker_approval' => true,
                'restricts_matching' => true,
                'notify_admin_on_selection' => true,
            ],
        ),
        $option(
            'coordinator_introductions',
            $common . 'coordinator_introductions.label',
            $common . 'coordinator_introductions.description',
            [
                'requires_broker_approval' => true,
                'restricts_matching' => true,
                'notify_admin_on_selection' => true,
            ],
        ),
        $option(
            'requires_coordinator_contact',
            $common . 'requires_coordinator_contact.label',
            $j['coordinator_contact_description'] ?? $common . 'requires_coordinator_contact.description',
            [
                'requires_broker_approval' => true,
                'restricts_messaging' => true,
                'notify_admin_on_selection' => true,
            ],
        ),
        $option(
            'requires_vetted_partners',
            $common . 'requires_vetted_partners.label',
            $j['vetted_description'],
            [
                'requires_vetted_interaction' => true,
                'restricts_matching' => true,
                'notify_admin_on_selection' => true,
                'vetting_type_required' => $j['vetting'],
            ],
            false,
        ),
        $option(
            'no_home_visits',
            $common . 'no_home_visits.label',
            $common . 'no_home_visits.description',
            ['notify_admin_on_selection' => true],
        ),

        // ── SERVICE PROVIDER DECLARATIONS (informational) ────────────────
        $option(
            'works_with_vulnerable_adults',
            $j['vulnerable_adults_label'] ?? $common . 'works_with_vulnerable_adults.label',
            $j['vulnerable_adults_description'],
            [
                'notify_admin_on_selection' => true,
                'vetting_type_required' => $j['vetting'],
            ],
        ),

        // ── DECLINATION (always last) ─────────────────────────────────────
        $option('none_apply', $common . 'none_apply.label', $common . 'none_apply.description', []),
    ],
];

return [
    'ireland' => $preset('ireland', [
        'vetting' => 'garda_vetting',
        'vetted_description' => 'safeguarding.presets.ireland.options.requires_vetted_partners.description',
        'vulnerable_adults_description' => 'safeguarding.presets.ireland.options.works_with_vulnerable_adults.description',
        'coordinator_contact_description' => 'safeguarding.presets.ireland.options.requires_coordinator_contact.description',
    ]),

    'united_kingdom' => $preset('united_kingdom', [
        'vetting' => 'uk_safeguarding_clearance',
        'vetted_description' => 'safeguarding.presets.united_kingdom.options.requires_vetted_partners.description',
        'vulnerable_adults_description' => 'safeguarding.presets.united_kingdom.options.works_with_vulnerable_adults.description',
    ]),

    'england_wales' => $preset('england_wales', [
        'vetting' => 'dbs_enhanced',
        'vetted_description' => 'safeguarding.presets.england_wales.options.requires_vetted_partners.description',
        'vulnerable_adults_description' => 'safeguarding.presets.england_wales.options.works_with_vulnerable_adults.description',
    ]),

    'scotland' => $preset('scotland', [
        'vetting' => 'pvg_scotland',
        'vetted_description' => 'safeguarding.presets.scotland.options.requires_vetted_partners.description',
        'vulnerable_adults_description' => 'safeguarding.presets.scotland.options.works_with_vulnerable_adults.description',
        'vulnerable_adult_label' => 'safeguarding.presets.scotland.options.is_vulnerable_adult.label',
        'vulnerable_adults_label' => 'safeguarding.presets.scotland.options.works_with_vulnerable_adults.label',
    ]),

    'northern_ireland' => $preset('northern_ireland', [
        'vetting' => 'access_ni',
        'vetted_description' => 'safeguarding.presets.northern_ireland.options.requires_vetted_partners.description',
        'vulnerable_adults_description' => 'safeguarding.presets.northern_ireland.options.works_with_vulnerable_adults.description',
    ]),

    'custom' => [
        'name' => 'safeguarding.presets.custom.name',
        'vetting_authority' => null,
        'help_text' => null,
        'options' => [],
    ],
];
