<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PartnerApi;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Platform-wide kill switch for the AG60 Partner API.
 *
 * Deliberately separate from FederationFeatureService: the Partner API is a
 * different external system (third-party bearer tokens and scopes over
 * members, listings and the wallet) and folding it into a switch labelled
 * "External Partner Federation" would make that label untrue.
 *
 * Fails CLOSED — a missing control row, a missing column or any error resolves
 * to "blocked". An unaudited third-party API answering during a fault is worse
 * than downtime, and this one can write wallet credits.
 */
class PartnerApiKillSwitch
{
    private ?bool $cache = null;

    /** Emergency lockdown stops the Partner API too — one big red button. */
    public function isEnabled(): bool
    {
        if ($this->cache !== null) {
            return $this->cache;
        }

        try {
            $row = DB::table('federation_system_control')->where('id', 1)->first();
            if (! $row) {
                return $this->cache = false;
            }

            $row = (array) $row;
            if (! array_key_exists('partner_api_enabled', $row)) {
                // Migration not yet run — stay closed.
                return $this->cache = false;
            }
            if (! empty($row['emergency_lockdown_active'])) {
                return $this->cache = false;
            }

            return $this->cache = (bool) $row['partner_api_enabled'];
        } catch (\Throwable $e) {
            Log::error('PartnerApiKillSwitch: control read failed, failing closed - ' . $e->getMessage());
            return false;
        }
    }

    /** @return array{enabled: bool, reason: ?string, emergency_lockdown_active: bool} */
    public function status(): array
    {
        try {
            $row = DB::table('federation_system_control')->where('id', 1)->first();
            $row = $row ? (array) $row : [];

            return [
                'enabled' => $this->isEnabled(),
                'reason' => isset($row['partner_api_disabled_reason']) && $row['partner_api_disabled_reason'] !== null
                    ? (string) $row['partner_api_disabled_reason']
                    : null,
                'emergency_lockdown_active' => (bool) ($row['emergency_lockdown_active'] ?? false),
            ];
        } catch (\Throwable) {
            return ['enabled' => false, 'reason' => null, 'emergency_lockdown_active' => false];
        }
    }

    public function clearCache(): void
    {
        $this->cache = null;
    }
}
