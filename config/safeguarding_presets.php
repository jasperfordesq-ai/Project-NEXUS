<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Country/jurisdiction safeguarding presets.
 *
 * What new members are asked (owner decisions, 25 Oct 2026):
 *
 *   1. "I consider myself a vulnerable adult" — the one question that switches
 *      safeguards on, through the community's vetting system: coordinators of
 *      the community, and members whose vetting the community has recorded
 *      (Garda Vetting in Ireland; Enhanced DBS, PVG or AccessNI in the UK — the
 *      jurisdiction's own check), can contact the member; nobody else. The
 *      member can contact the same people. Groups they belong to keep working.
 *      Coordinator approval of exchanges and matches applies too. See
 *      SafeguardingInteractionPolicy.
 *   2. "None of these apply to me" — always last.
 *
 * Kept but not offered to new members (`accepts_new_selections => false`), so
 * members who already chose them keep their protection:
 *   - "I plan to offer help involving children or vulnerable adults" —
 *     retired for now; minors are to be handled separately;
 *   - "a coordinator keeps an eye on my exchanges" (also the target of the
 *     one-step switch away from "vetted members only");
 *   - "no home visits without a coordinator";
 *   - "coordinator arranges all contact";
 *   - "only vetted members may contact me" — folded into the vulnerable-adult
 *     question. UK presets only; NOT in the Ireland preset (Garda Vetting is
 *     requested by a registered organisation for a role, so a separate
 *     member-level "vetted only" preference adds nothing there).
 *
 * Members do not declare their age: the platform is adults only.
 *
 * What each option does is told to the member before they tick it, generated
 * from its triggers by SafeguardingEffectsService; labels and descriptions say
 * why one might choose it.
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
 * @param array{vetting: string, vetted_description: string|null, vulnerable_adults_description: string, vulnerable_adult_label?: string, vulnerable_adults_label?: string, coordinator_contact_description?: string} $j
 */
$preset = static fn (string $key, array $j): array => [
    'name' => "safeguarding.presets.{$key}.name",
    'vetting_authority' => "safeguarding.presets.{$key}.vetting_authority",
    'help_text' => 'safeguarding.presets.common.help_text',
    'options' => array_values(array_filter([
        $option(
            'is_vulnerable_adult',
            $j['vulnerable_adult_label'] ?? $common . 'is_vulnerable_adult.label',
            $common . 'is_vulnerable_adult.description',
            [
                'requires_broker_approval' => true,
                'restricts_matching' => true,
                'notify_admin_on_selection' => true,
                'requires_vetted_interaction' => true,
                'vetting_type_required' => $j['vetting'],
            ],
        ),
        $option(
            'works_with_vulnerable_adults',
            $j['vulnerable_adults_label'] ?? $common . 'works_with_vulnerable_adults.label',
            $j['vulnerable_adults_description'],
            [
                'notify_admin_on_selection' => true,
                'vetting_type_required' => $j['vetting'],
            ],
            false,
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
            false,
        ),
        $option(
            'no_home_visits',
            $common . 'no_home_visits.label',
            $common . 'no_home_visits.description',
            ['notify_admin_on_selection' => true],
            false,
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
            false,
        ),
        $j['vetted_description'] === null ? null : $option(
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
        $option('none_apply', $common . 'none_apply.label', $common . 'none_apply.description', []),
    ])),
];

return [
    'ireland' => $preset('ireland', [
        'vetting' => 'garda_vetting',
        'vetted_description' => null,
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
