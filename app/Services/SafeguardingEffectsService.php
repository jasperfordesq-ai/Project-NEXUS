<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Facades\Log;

/**
 * What a safeguarding choice actually does, in plain words for the member.
 *
 * 🔴 Why this exists. Until 25 Oct 2026 every option's member-facing wording
 * was hand-written next to its triggers, and the two drifted: "I would prefer
 * to only interact with vetted members … coordinators will ensure you are only
 * matched with vetted members" was in fact a fail-closed block on every
 * message, reply, credit transfer and exchange from anyone without
 * community-recorded vetting — in a community that had recorded none. "I
 * consider myself a vulnerable adult" said only that coordinators would know,
 * while blocking every direct message.
 *
 * These lines are derived from the same triggers SafeguardingInteractionPolicy
 * enforces, so the wizard, the settings page and the emails cannot promise more
 * or less than the platform does. Labels and descriptions say why a member
 * might choose an option; these lines say what happens.
 */
class SafeguardingEffectsService
{
    /** @var array<int, int|null> tenant id => confirmed vetting count (null = unknown) */
    private array $vettedCounts = [];

    public function __construct(
        private readonly MemberVettingAttestationService $attestations,
    ) {}

    /**
     * @param array<string, mixed> $triggers
     * @return list<string>
     */
    public function forOption(int $tenantId, string $optionKey, array $triggers): array
    {
        return array_column($this->describe($tenantId, [['option_key' => $optionKey, 'triggers' => $triggers]]), 'text');
    }

    /**
     * Effects of everything a member has chosen, merged and de-duplicated.
     *
     * @param list<array{option_key: string, triggers: array<string, mixed>}> $selections
     * @return list<array{key: string, text: string}>
     */
    public function describe(int $tenantId, array $selections): array
    {
        $merged = [];
        $optionKeys = [];
        $vettingCodes = [];
        foreach ($selections as $selection) {
            $optionKeys[] = $selection['option_key'];
            foreach ($selection['triggers'] as $key => $value) {
                if ($value === true || $value === 1 || $value === '1') {
                    $merged[$key] = true;
                }
            }
            $code = $selection['triggers']['vetting_type_required'] ?? null;
            if (! empty($selection['triggers']['requires_vetted_interaction']) && is_string($code) && $code !== '') {
                $vettingCodes[$code] = true;
            }
        }

        $lines = [];
        if (! empty($merged['restricts_messaging'])) {
            $lines[] = ['key' => 'restricts_messaging', 'text' => __('safeguarding.effects.restricts_messaging')];
        }
        if (! empty($merged['requires_vetted_interaction'])) {
            $vetting = $this->vettingLabel(array_keys($vettingCodes));
            $lines[] = ['key' => 'vetted_only', 'text' => __('safeguarding.effects.vetted_only', ['vetting' => $vetting])];
            $count = $this->vettedCount($tenantId);
            if ($count !== null) {
                $lines[] = [
                    'key' => 'vetted_count',
                    'text' => trans_choice('safeguarding.effects.vetted_count', $count, ['count' => $count, 'vetting' => $vetting]),
                ];
            }
        }
        if (! empty($merged['requires_broker_approval'])) {
            $lines[] = ['key' => 'broker_approval', 'text' => __('safeguarding.effects.broker_approval')];
        }
        if (! empty($merged['restricts_matching'])) {
            $lines[] = ['key' => 'restricts_matching', 'text' => __('safeguarding.effects.restricts_matching')];
        }
        if (in_array('no_home_visits', $optionKeys, true)) {
            $lines[] = ['key' => 'no_home_visits', 'text' => __('safeguarding.effects.no_home_visits')];
        }
        if (! empty($merged['notify_admin_on_selection'])) {
            $lines[] = ['key' => 'notify_coordinator', 'text' => __('safeguarding.effects.notify_coordinator')];
        }

        if ($lines === []) {
            $declinedOnly = $optionKeys !== [] && array_unique($optionKeys) === ['none_apply'];
            $lines[] = $declinedOnly
                ? ['key' => 'declined', 'text' => __('safeguarding.effects.declined')]
                : ['key' => 'informational', 'text' => __('safeguarding.effects.informational')];
        }

        return $lines;
    }

    /**
     * Current confirmed vetting records under the community's policy, or null
     * when it cannot be read — the caller then says nothing about the number
     * rather than guess it.
     */
    public function vettedCount(int $tenantId): ?int
    {
        if (array_key_exists($tenantId, $this->vettedCounts)) {
            return $this->vettedCounts[$tenantId];
        }

        try {
            $count = (int) ($this->attestations->stats($tenantId)['confirmed'] ?? 0);
        } catch (\Throwable $e) {
            Log::warning('SafeguardingEffectsService: vetted count unavailable', [
                'tenant_id' => $tenantId,
                'exception_class' => $e::class,
            ]);
            $count = null;
        }

        return $this->vettedCounts[$tenantId] = $count;
    }

    /** @param list<string> $codes */
    private function vettingLabel(array $codes): string
    {
        $labels = array_map(static function (string $code): string {
            $key = 'safeguarding.vetting_types.' . $code;
            $label = __($key);

            return $label === $key ? __('safeguarding.effects.vetting_fallback') : $label;
        }, $codes);

        return $labels === [] ? __('safeguarding.effects.vetting_fallback') : implode(' / ', array_unique($labels));
    }
}
