<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

use App\Contracts\DomainProber;
use App\Core\ClientIp;
use App\Support\Tenancy\PlatformHostPolicy;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Platform team panel → Addresses and certificates (idea 7).
 *
 * For each address a community has of its own (`tenants.domain`,
 * `tenants.accessible_domain`) and each of the platform's own addresses: does
 * the name resolve, and when does the certificate a visitor's browser is given
 * run out. The result per host lives in the cache under `domain_check:<host>`
 * for KEEP_DAYS: resolves, certificate_expires_at, days_left (at the check),
 * checked_at, error_kind. `days_left` and `status` are worked out again from
 * the expiry whenever the page is read.
 *
 * 🔴 Outbound safety. A host is contacted only when it was read from the
 * tenants table or from the platform's own configured list
 * (CommunitySetupChecklistService::platformAddresses()), never from a request;
 * only when it is a plain host name (HOST_PATTERN); and only after the
 * public-address rule (OutboundUrlGuard, through the prober) has approved
 * every address it resolves to. The connection goes to one of those approved
 * addresses. A raw error message is never stored, sent or logged (it can hold
 * an internal address): only `error_kind`.
 *
 * 🔴 Cross-community on purpose: the list covers every community, read with
 * the query builder (no community scope). It sends each community's id, name,
 * slug, whether it is switched on, and its addresses. Nothing about a member.
 */
final class DomainCheckService
{
    public const KEEP_DAYS = 3;

    public const WARNING_DAYS = 21;

    public const MAX_HOST_LENGTH = 253;

    public const ERROR_KINDS = [
        'does_not_resolve',
        'not_a_public_address',
        'no_answer',
        'certificate_not_trusted',
        'could_not_read_certificate',
    ];

    /** Lower-case labels of letters, digits and hyphens, at least one dot. */
    private const HOST_PATTERN = '/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/';

    private readonly DomainProber $prober;

    /** No container binding: a test binds a fake, everything else gets the real one. */
    public function __construct(?DomainProber $prober = null)
    {
        $this->prober = $prober ?? new SocketDomainProber();
    }

    public static function cacheKey(string $host): string
    {
        return 'domain_check:' . $host;
    }

    /**
     * A plain host name that may be checked, or null. Lower-case, letters,
     * digits, dots and hyphens only; no scheme, port, path or IP literal; at
     * most 253 characters.
     */
    public static function checkableHost(string $value): ?string
    {
        $host = strtolower(trim($value));
        if ($host === '' || strlen($host) > self::MAX_HOST_LENGTH) {
            return null;
        }
        if (filter_var($host, FILTER_VALIDATE_IP) !== false || preg_match(self::HOST_PATTERN, $host) !== 1) {
            return null;
        }
        // A last label made only of digits is not a name (an IPv4 literal in
        // another spelling).
        $labels = explode('.', $host);
        if (ctype_digit((string) end($labels))) {
            return null;
        }

        return $host;
    }

    /** @return array{platform: list<array<string, mixed>>, communities: list<array<string, mixed>>, warning_days: int} */
    public function overview(): array
    {
        $platformAddresses = CommunitySetupChecklistService::platformAddresses();

        return [
            'platform' => $this->platformRows($platformAddresses),
            'communities' => array_map(
                fn (object $t): array => $this->communityRow($t, $platformAddresses),
                $this->tenants()->all()
            ),
            'warning_days' => self::WARNING_DAYS,
        ];
    }

    public function communityExists(int $tenantId): bool
    {
        return $tenantId > 0 && DB::table('tenants')->where('id', $tenantId)->exists();
    }

    /**
     * Check one community's own addresses now (at most two) and answer with
     * its refreshed row. Addresses on the platform's own names are not checked
     * here: the platform's addresses are checked once each.
     *
     * @return array<string, mixed>|null null when there is no such community
     */
    public function checkCommunity(int $tenantId): ?array
    {
        $tenant = $this->tenants()->firstWhere('id', $tenantId);
        if ($tenant === null) {
            return null;
        }

        $platformAddresses = CommunitySetupChecklistService::platformAddresses();
        foreach ($this->ownCheckableHosts($tenant, $platformAddresses) as $host) {
            $this->check($host);
        }

        return $this->communityRow($tenant, $platformAddresses);
    }

    /** @return list<array<string, mixed>> the platform's own addresses, re-checked */
    public function checkPlatform(): array
    {
        $platformAddresses = CommunitySetupChecklistService::platformAddresses();
        foreach ($platformAddresses as $candidate) {
            $host = self::checkableHost($candidate);
            if ($host !== null) {
                $this->check($host);
            }
        }

        return $this->platformRows($platformAddresses);
    }

    /**
     * Every distinct host, checked once, one after another (the daily
     * command). Returns each host with its status.
     *
     * @return list<array{host: string, status: string}>
     */
    public function checkAll(): array
    {
        $platformAddresses = CommunitySetupChecklistService::platformAddresses();
        $hosts = [];
        foreach ($platformAddresses as $candidate) {
            $host = self::checkableHost($candidate);
            if ($host !== null) {
                $hosts[$host] = true;
            }
        }
        foreach ($this->tenants() as $tenant) {
            foreach ($this->ownCheckableHosts($tenant, $platformAddresses) as $host) {
                $hosts[$host] = true;
            }
        }

        $out = [];
        foreach (array_keys($hosts) as $host) {
            $this->check($host);
            $out[] = ['host' => $host, 'status' => $this->result($host)['status']];
        }

        return $out;
    }

    /**
     * Who asked for a check, of which community (or of the platform's own
     * addresses: entity_id NULL). Platform-wide act, so the row is written
     * here with tenant_id NULL.
     */
    public function record(int $actorId, ?int $tenantId): void
    {
        try {
            DB::table('activity_log')->insert([
                'tenant_id' => null,
                'user_id' => $actorId > 0 ? $actorId : null,
                'action' => 'platform_team_domain_check',
                'details' => $tenantId === null
                    ? 'Address check for the platform\'s own addresses'
                    : "Address check for community #{$tenantId}",
                'is_public' => 0,
                'ip_address' => ClientIp::get(),
                'action_type' => 'admin',
                'entity_type' => 'tenant',
                'entity_id' => $tenantId,
                'created_at' => now(),
            ]);
        } catch (\Throwable $e) {
            Log::error('Address check: the activity log entry could not be written', [
                'tenant_id' => $tenantId,
                'user_id' => $actorId,
                'exception' => $e::class,
            ]);
        }
    }

    /**
     * Check one host. The caller has already taken it from the tenants table
     * or the platform's list and passed it through checkableHost().
     */
    private function check(string $host): void
    {
        $resolves = false;
        $expiresAt = null;
        $errorKind = null;

        try {
            if (!$this->prober->resolves($host)) {
                $errorKind = 'does_not_resolve';
            } else {
                $resolves = true;
                $addresses = $this->prober->publicAddresses($host);
                if ($addresses === []) {
                    $errorKind = 'not_a_public_address';
                } else {
                    $expiry = $this->prober->certificateExpiry($host, (string) $addresses[0]);
                    if ($expiry === null) {
                        $errorKind = 'could_not_read_certificate';
                    } else {
                        $expiresAt = $expiry->setTimezone(new \DateTimeZone('UTC'))->format(DATE_ATOM);
                    }
                }
            }
        } catch (DomainProbeFailure $e) {
            $errorKind = in_array($e->kind, self::ERROR_KINDS, true) ? $e->kind : 'could_not_read_certificate';
        } catch (\Throwable $e) {
            // The class only: the message can hold an internal address.
            Log::warning('Address check: the check stopped unexpectedly', ['exception' => $e::class]);
            $errorKind = 'could_not_read_certificate';
        }

        Cache::put(self::cacheKey($host), [
            'resolves' => $resolves,
            'certificate_expires_at' => $expiresAt,
            'days_left' => $expiresAt === null ? null : self::daysLeft($expiresAt),
            'checked_at' => now()->toIso8601String(),
            'error_kind' => $errorKind,
        ], now()->addDays(self::KEEP_DAYS));
    }

    /**
     * The cached result for one host, with days_left and status worked out
     * now. `unknown` when it has never been checked (or the record ran out).
     *
     * @return array{status: string, resolves: ?bool, certificate_expires_at: ?string, days_left: ?int, checked_at: ?string, error_kind: ?string}
     */
    private function result(string $host): array
    {
        $cached = Cache::get(self::cacheKey($host));
        if (!is_array($cached)) {
            return [
                'status' => 'unknown',
                'resolves' => null,
                'certificate_expires_at' => null,
                'days_left' => null,
                'checked_at' => null,
                'error_kind' => null,
            ];
        }

        $errorKind = in_array($cached['error_kind'] ?? null, self::ERROR_KINDS, true) ? (string) $cached['error_kind'] : null;
        $expiresAt = is_string($cached['certificate_expires_at'] ?? null) && strtotime($cached['certificate_expires_at']) !== false
            ? $cached['certificate_expires_at']
            : null;
        if ($errorKind === null && $expiresAt === null) {
            $errorKind = 'could_not_read_certificate';
        }
        $daysLeft = $expiresAt === null ? null : self::daysLeft($expiresAt);

        $status = match (true) {
            $errorKind !== null, $daysLeft === null, $daysLeft < 0 => 'failing',
            $daysLeft <= self::WARNING_DAYS => 'warning',
            default => 'ok',
        };

        return [
            'status' => $status,
            'resolves' => (bool) ($cached['resolves'] ?? false),
            'certificate_expires_at' => $errorKind === null ? $expiresAt : null,
            'days_left' => $errorKind === null ? $daysLeft : null,
            'checked_at' => is_string($cached['checked_at'] ?? null) ? $cached['checked_at'] : null,
            'error_kind' => $errorKind,
        ];
    }

    /** Whole days left, rounded down: 0 = runs out within the day, -1 = ran out. */
    private static function daysLeft(string $expiresAt): int
    {
        $seconds = (int) strtotime($expiresAt) - now()->getTimestamp();

        return (int) floor($seconds / 86400);
    }

    /** @return \Illuminate\Support\Collection<int, object> */
    private function tenants(): \Illuminate\Support\Collection
    {
        return DB::table('tenants')
            ->select(['id', 'name', 'slug', 'is_active', 'domain', 'accessible_domain'])
            ->orderBy('id')
            ->get();
    }

    /**
     * @param list<string> $platformAddresses
     * @return list<array<string, mixed>>
     */
    private function platformRows(array $platformAddresses): array
    {
        $rows = [];
        foreach ($platformAddresses as $candidate) {
            $host = self::checkableHost($candidate);
            $rows[] = ['host' => $candidate] + ($host === null ? self::notCheckable() : $this->result($host));
        }

        return $rows;
    }

    /**
     * @param list<string> $platformAddresses
     * @return array<string, mixed>
     */
    private function communityRow(object $tenant, array $platformAddresses): array
    {
        $addresses = [];
        foreach (['main' => $tenant->domain, 'accessible' => $tenant->accessible_domain] as $kind => $raw) {
            $value = strtolower(trim((string) ($raw ?? '')));
            if ($value === '') {
                continue;
            }

            $usesPlatform = $this->usesPlatformAddress($value, $platformAddresses);
            $host = $usesPlatform ? null : self::checkableHost($value);
            $result = match (true) {
                $usesPlatform => self::notChecked(null),
                $host === null => self::notCheckable(),
                default => $this->result($host),
            };

            $addresses[] = [
                'kind' => $kind,
                'host' => $value,
                'uses_platform_address' => $usesPlatform,
            ] + $result;
        }

        return [
            'id' => (int) $tenant->id,
            'name' => (string) $tenant->name,
            'slug' => $tenant->slug !== null ? (string) $tenant->slug : null,
            'is_active' => (bool) $tenant->is_active,
            'addresses' => $addresses,
        ];
    }

    /**
     * The community's own addresses that may be checked: set, not one of the
     * platform's (CommunitySetupChecklistService's rule), a plain host name.
     *
     * @param list<string> $platformAddresses
     * @return list<string>
     */
    private function ownCheckableHosts(object $tenant, array $platformAddresses): array
    {
        $hosts = [];
        foreach ([$tenant->domain, $tenant->accessible_domain] as $raw) {
            $value = strtolower(trim((string) ($raw ?? '')));
            if ($value === '' || $this->usesPlatformAddress($value, $platformAddresses)) {
                continue;
            }
            $host = self::checkableHost($value);
            if ($host !== null) {
                $hosts[$host] = true;
            }
        }

        return array_keys($hosts);
    }

    /** @param list<string> $platformAddresses */
    private function usesPlatformAddress(string $value, array $platformAddresses): bool
    {
        $normalised = PlatformHostPolicy::normalise($value);

        return $normalised !== '' && CommunitySetupChecklistService::isPlatformAddress($normalised, $platformAddresses);
    }

    /** @return array{status: string, resolves: null, certificate_expires_at: null, days_left: null, checked_at: null, error_kind: null} */
    private static function notCheckable(): array
    {
        return self::notChecked('not_checkable');
    }

    /** @return array{status: ?string, resolves: null, certificate_expires_at: null, days_left: null, checked_at: null, error_kind: null} */
    private static function notChecked(?string $status): array
    {
        return [
            'status' => $status,
            'resolves' => null,
            'certificate_expires_at' => null,
            'days_left' => null,
            'checked_at' => null,
            'error_kind' => null,
        ];
    }
}
