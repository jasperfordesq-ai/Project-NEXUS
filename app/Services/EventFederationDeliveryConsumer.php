<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Contracts\EventFederationTransport;
use App\Core\TenantContext;
use App\Enums\EventFederationAction;
use App\Enums\EventFederationInboundDecision;
use App\Support\Events\EventFederationPayloadContract;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use JsonException;
use Throwable;

/** Claims and delivers only the independent Event federation ledger. */
final class EventFederationDeliveryConsumer
{
    private readonly FederationFeatureService $features;

    public function __construct(
        private readonly EventFederationDeliveryLedger $deliveries,
        private readonly EventFederationTransport $transport,
        ?FederationFeatureService $features = null,
    ) {
        $this->features = $features ?? app(FederationFeatureService::class);
    }

    /** @return array{claimed:int,delivered:int,retrying:int,dead_lettered:int,claim_conflicts:int,stale_claims_released:int} */
    public function processBatch(
        int $limit = 50,
        ?int $tenantId = null,
        ?int $externalPartnerId = null,
    ): array {
        $released = $this->deliveries->releaseStaleClaims($tenantId);

        // External federation kill switch. Claim nothing while Nexus-native
        // partner traffic is switched off: this consumer runs every minute, and
        // each blocked delivery would otherwise burn one of MAX_ATTEMPTS and
        // dead-letter the row within minutes — so the backlog would NOT resume
        // when the switch is turned back on. Leaving rows unclaimed keeps them
        // queued and lets them drain intact on re-enable.
        if (! $this->features->isExternalProtocolEnabled(FederationFeatureService::EXTERNAL_PROTOCOL_NEXUS)) {
            return [
                'claimed' => 0,
                'delivered' => 0,
                'retrying' => 0,
                'dead_lettered' => 0,
                'claim_conflicts' => 0,
                'stale_claims_released' => $released,
            ];
        }

        $rows = $this->claimEligible($limit, $tenantId, $externalPartnerId);
        $summary = [
            'claimed' => count($rows),
            'delivered' => 0,
            'retrying' => 0,
            'dead_lettered' => 0,
            'claim_conflicts' => 0,
            'stale_claims_released' => $released,
        ];

        foreach ($rows as $row) {
            $this->process($row, $summary);
        }

        return $summary;
    }

    /** @return list<array<string,mixed>> */
    private function claimEligible(
        int $limit,
        ?int $tenantId,
        ?int $externalPartnerId,
    ): array {
        $limit = max(1, min($limit, 100));
        $tenantIds = $tenantId !== null
            ? [$tenantId]
            : DB::table('event_federation_deliveries')
                ->whereIn('status', ['pending', 'retry'])
                ->where('attempts', '<', EventFederationDeliveryLedger::MAX_ATTEMPTS)
                ->when(
                    $externalPartnerId !== null,
                    static fn (Builder $query) => $query->where('external_partner_id', $externalPartnerId),
                )
                ->where(static function (Builder $query): void {
                    $query->whereNull('available_at')->orWhere('available_at', '<=', now());
                })
                ->where(static function (Builder $query): void {
                    $query->whereNull('next_attempt_at')->orWhere('next_attempt_at', '<=', now());
                })
                ->groupBy('tenant_id')
                ->orderByRaw('MIN(id)')
                ->limit(500)
                ->pluck('tenant_id')
                ->map(static fn (mixed $id): int => (int) $id)
                ->all();

        $rows = [];
        $previousTenantId = TenantContext::currentId();
        try {
            foreach ($tenantIds as $candidateTenantId) {
                if (count($rows) >= $limit || ! TenantContext::setById((int) $candidateTenantId)) {
                    continue;
                }
                $actions = [EventFederationAction::Tombstone];
                $operation = $this->features->isOperationAllowed('events', (int) $candidateTenantId);
                if (TenantContext::hasFeature('events') && (bool) ($operation['allowed'] ?? false)) {
                    $actions[] = EventFederationAction::Upsert;
                }
                $claimed = $this->deliveries->claimBatch(
                    $limit - count($rows),
                    (int) $candidateTenantId,
                    $externalPartnerId,
                    $actions,
                );
                array_push($rows, ...$claimed);
            }
        } finally {
            TenantContext::restoreAfterScopedListener($previousTenantId);
        }

        return $rows;
    }

    /**
     * @param array<string,mixed> $row
     * @param array{claimed:int,delivered:int,retrying:int,dead_lettered:int,claim_conflicts:int,stale_claims_released:int} $summary
     */
    private function process(array $row, array &$summary): void
    {
        $tenantId = (int) ($row['tenant_id'] ?? 0);
        $deliveryId = (int) ($row['id'] ?? 0);
        $partnerId = (int) ($row['external_partner_id'] ?? 0);
        $claimToken = (string) ($row['claim_token'] ?? '');
        $previousTenantId = TenantContext::currentId();

        try {
            $payload = $this->payload($row);
            if (! TenantContext::setById($tenantId)) {
                throw new \RuntimeException('event_federation_delivery_tenant_unavailable');
            }
            $result = $this->transport->deliver($tenantId, $partnerId, $payload);
            if (! (bool) ($result['success'] ?? false)) {
                $this->failed(
                    $tenantId,
                    $deliveryId,
                    $claimToken,
                    (string) ($result['error_code'] ?? 'DELIVERY_FAILED'),
                    (string) ($result['error'] ?? 'event_federation_delivery_failed'),
                    $summary,
                    (int) ($row['attempts'] ?? 0),
                );

                return;
            }

            $decision = EventFederationInboundDecision::tryFrom(
                (string) (($result['receipt']['decision'] ?? '')),
            );
            if (! in_array($decision, [
                EventFederationInboundDecision::Accepted,
                EventFederationInboundDecision::Replay,
                EventFederationInboundDecision::Stale,
            ], true)) {
                $this->failed(
                    $tenantId,
                    $deliveryId,
                    $claimToken,
                    $decision === EventFederationInboundDecision::Conflict
                        ? 'REMOTE_VERSION_CONFLICT'
                        : 'REMOTE_RECEIPT_INVALID',
                    'event_federation_remote_receipt_rejected',
                    $summary,
                    (int) ($row['attempts'] ?? 0),
                );

                return;
            }

            if ($this->deliveries->markDelivered($tenantId, $deliveryId, $claimToken)) {
                $summary['delivered']++;
            } else {
                $summary['claim_conflicts']++;
            }
        } catch (Throwable $exception) {
            $this->failed(
                $tenantId,
                $deliveryId,
                $claimToken,
                $exception instanceof JsonException ? 'PAYLOAD_JSON_INVALID' : 'DELIVERY_EXCEPTION',
                $exception->getMessage(),
                $summary,
                (int) ($row['attempts'] ?? 0),
            );
        } finally {
            TenantContext::restoreAfterScopedListener($previousTenantId);
        }
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    private function payload(array $row): array
    {
        $payload = json_decode((string) ($row['payload'] ?? ''), true, 64, JSON_THROW_ON_ERROR);
        if (! is_array($payload)) {
            throw new JsonException('event_federation_delivery_payload_invalid');
        }
        EventFederationPayloadContract::assertValid(
            $payload,
            (int) ($row['tenant_id'] ?? 0),
            (int) ($row['event_id'] ?? 0),
        );
        if (! hash_equals((string) ($row['payload_hash'] ?? ''), EventFederationPayloadContract::hash($payload))
            || (int) ($row['payload_schema_version'] ?? 0) !== (int) $payload['payload_schema_version']
            || (int) ($row['event_aggregate_version'] ?? 0) !== (int) $payload['event_aggregate_version']
            || (int) ($row['event_calendar_version'] ?? -1) !== (int) $payload['event_calendar_version']
            || (string) ($row['action'] ?? '') !== (string) $payload['action']) {
            throw new \RuntimeException('event_federation_delivery_payload_integrity_failed');
        }

        return $payload;
    }

    /**
     * @param array{claimed:int,delivered:int,retrying:int,dead_lettered:int,claim_conflicts:int,stale_claims_released:int} $summary
     */
    private function failed(
        int $tenantId,
        int $deliveryId,
        string $claimToken,
        string $errorCode,
        string $error,
        array &$summary,
        int $attempts,
    ): void {
        if (! $this->deliveries->markFailed(
            $tenantId,
            $deliveryId,
            $claimToken,
            $errorCode,
            $error,
        )) {
            $summary['claim_conflicts']++;

            return;
        }

        $summary[$attempts >= EventFederationDeliveryLedger::MAX_ATTEMPTS
            ? 'dead_lettered'
            : 'retrying']++;
    }
}
