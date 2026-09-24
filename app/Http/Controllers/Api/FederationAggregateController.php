<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Services\CaringCommunity\FederationAggregateService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * FederationAggregateController — public, throttled endpoint that returns a
 * signed JSON aggregate report for a tenant *that has opted in*.
 *
 * Privacy contract:
 *  - Returns 404 (silent) when the tenant has not opted in. This means we
 *    never reveal whether a slug is valid but disabled vs nonexistent.
 *  - All queries are logged for 12 months for audit.
 *  - Response is signed with the tenant's HMAC-SHA256 secret so consumers
 *    can detect tampering.
 *
 * Architecture document: docs/CARING_COMMUNITY_ARCHITECTURE.md
 *   sections "Cross-Node Aggregate Reporting Policy" and
 *   "Isolated-Node Deployment Option".
 */
class FederationAggregateController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly FederationAggregateService $service,
    ) {
    }

    /**
     * GET /v2/federation/aggregates?tenant_slug=...&period_from=...&period_to=...
     *
     * Public, no auth — but throttled. Returns 404 if the tenant has not
     * opted in.
     */
    public function show(Request $request): JsonResponse
    {
        $slug = trim((string) $request->query('tenant_slug', ''));
        if ($slug === '') {
            return $this->silent404();
        }

        // Resolve tenant by slug
        $tenant = DB::table('tenants')->where('slug', $slug)->first(['id', 'slug', 'name']);
        if (!$tenant) {
            return $this->silent404();
        }

        // The report describes the requested tenant, which may differ from the
        // tenant resolved from the HTTP host. Honour that tenant's master switch.
        if (!TenantContext::runForTenant((int) $tenant->id, static fn (): bool => TenantContext::hasFeature('caring_community'))) {
            return $this->silent404();
        }

        $consent = $this->service->getConsentInternal((int) $tenant->id);
        if (!$consent || !((bool) $consent->enabled) || empty($consent->signing_secret)) {
            return $this->silent404();
        }

        // Set tenant context so the service can scope queries correctly.
        $previousTenantId = TenantContext::currentId();
        TenantContext::setById((int) $tenant->id);

        try {
            [$from, $to] = $this->resolvePeriod($request);
            $payload = $this->service->compute($from, $to);
            $signature = $this->service->signPayload($payload, (string) $consent->signing_secret);

            $fieldsReturned = [
                'period', 'tenant', 'hours.total_approved', 'hours.by_month',
                'hours.by_category', 'members.bracket', 'partner_orgs.count',
            ];

            $this->service->logQuery(
                (int) $tenant->id,
                $this->resolveRequesterOrigin($request),
                $from,
                $to,
                $fieldsReturned,
                $signature
            );
        } finally {
            // Restore previous tenant context for subsequent middleware/logging.
            if ($previousTenantId !== null) {
                try {
                    TenantContext::setById((int) $previousTenantId);
                } catch (\Throwable $e) {
                    // Best-effort restore.
                }
            } else {
                TenantContext::reset();
            }
        }

        return response()->json([
            'success'   => true,
            'data'      => [
                'payload'   => $payload,
                'signature' => $signature,
                'algorithm' => FederationAggregateService::ALGORITHM,
            ],
        ], 200, [
            'Cache-Control' => 'no-store',
            'API-Version'   => '2.0',
        ]);
    }

    /**
     * Silent 404 — same shape whether tenant doesn't exist or hasn't opted in.
     */
    private function silent404(): JsonResponse
    {
        return response()->json([
            'success' => false,
            'errors'  => [
                ['code' => 'not_found', 'message' => __('api.aggregates_not_available')],
            ],
        ], 404, ['API-Version' => '2.0']);
    }

    /**
     * @return array{0: string, 1: string}
     */
    private function resolvePeriod(Request $request): array
    {
        $from = (string) $request->query('period_from', '');
        $to   = (string) $request->query('period_to', '');

        $isValid = static fn (string $d): bool =>
            $d !== '' && (bool) preg_match('/^\d{4}-\d{2}-\d{2}$/', $d);

        if (!$isValid($to)) {
            $to = date('Y-m-d');
        }
        if (!$isValid($from)) {
            $from = date('Y-m-d', strtotime('-30 days', strtotime($to)));
        }

        // Guard rail: never accept >12-month windows
        $fromTs = strtotime($from);
        $toTs   = strtotime($to);
        if ($fromTs && $toTs && ($toTs - $fromTs) > 366 * 86400) {
            $from = date('Y-m-d', $toTs - (365 * 86400));
        }
        // Guard rail: from must be <= to
        if ($fromTs && $toTs && $fromTs > $toTs) {
            $from = $to;
        }

        return [$from, $to];
    }

    private function resolveRequesterOrigin(Request $request): string
    {
        $origin = (string) $request->headers->get('Origin', '');
        if ($origin !== '') {
            return $origin;
        }
        $forwarded = (string) $request->headers->get('X-Forwarded-For', '');
        if ($forwarded !== '') {
            $first = trim(explode(',', $forwarded)[0] ?? '');
            if ($first !== '') {
                return $first;
            }
        }
        return (string) ($request->ip() ?? 'unknown');
    }
}
