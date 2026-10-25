<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Country/jurisdiction safeguarding presets.
 *
 * What new members are asked (owner, 25 Oct 2026: "just the essentials"):
 *
 *   1. "I consider myself a vulnerable adult" — the one question that switches
 *      safeguards on. It routes ALL direct contact through a coordinator
 *      (`restricts_messaging`): coordinators, and members a coordinator
 *      approves for this member, can contact them; nobody else. The member asks
 *      a coordinator to put them in touch with someone. Groups they belong to
 *      keep working. See SafeguardingInteractionPolicy.
 *   2. "I plan to offer help that involves children or vulnerable adults"
 *      (e.g. tutoring a member's child, personal care). Members are adults;
 *      the people they help may not be. A coordinator is told and confirms
 *      whether vetting is needed before such help is arranged through the
 *      timebank (Garda Vetting in Ireland, only through a registered relevant
 *      organisation, and always for teaching, coaching or mentoring children;
 *      in the UK, the DBS told Timebanking UK in 2018 that members are unlikely
 *      to be eligible for standard or enhanced checks because exchanges are
 *      personal arrangements). Informational: nothing is blocked.
 *   3. "None of these apply to me" — always last.
 *
 * Kept but not offered to new members (`accepts_new_selections => false`), so
 * members who already chose them keep their protection:
 *   - "a coordinator keeps an eye on my exchanges" (also the target of the
 *     one-step switch away from "vetted members only");
 *   - "no home visits without a coordinator";
 *   - "coordinator arranges all contact" — the vulnerable-adult question now
 *     does exactly this;
 *   - "only vetted members may contact me" — UK presets only; vetting is done by
 *     an organisation for a role, never a member's personal status. NOT in
 *     the Ireland preset at all: Garda Vetting is not portable between
 *     organisations.
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
                'restricts_messaging' => true,
                'restricts_matching' => true,
                'notify_admin_on_selection' => true,
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
