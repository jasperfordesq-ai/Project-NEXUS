<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Exceptions\EventAnalyticsException;
use App\Http\Resources\EventAnalyticsResource;
use App\I18n\LocaleContext;
use App\Models\User;
use App\Services\EventAnalyticsQueryService;
use App\Support\Events\EventAnalyticsCsv;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

/** Identity-free organizer analytics derived from canonical Event ledgers. */
final class EventAnalyticsController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly EventAnalyticsQueryService $analytics,
    ) {}

    public function show(int $id): JsonResponse
    {
        try {
            $summary = $this->analytics->summary($id, $this->actor());
        } catch (EventAnalyticsException $exception) {
            return $this->analyticsError($exception);
        }

        return $this->privateResponse($this->respondWithData(
            EventAnalyticsResource::fromSummary($summary),
        ));
    }

    public function export(int $id): JsonResponse|StreamedResponse
    {
        try {
            $actor = $this->actor();
            $summary = EventAnalyticsResource::fromSummary(
                $this->analytics->summary($id, $actor, 'csv_export'),
            );
        } catch (EventAnalyticsException $exception) {
            return $this->analyticsError($exception);
        }

        $headers = LocaleContext::withLocale($actor, static fn (): array => [
            __('event_analytics.csv.metric'),
            __('event_analytics.csv.value'),
            __('event_analytics.csv.suppressed'),
        ]);
        $rows = EventAnalyticsCsv::rows($summary);
        $response = response()->streamDownload(
            static function () use ($headers, $rows): void {
                $stream = fopen('php://output', 'wb');
                if ($stream === false) {
                    return;
                }
                fwrite($stream, "\xEF\xBB\xBF");
                \App\Support\CsvExportSanitizer::put($stream, $headers);
                foreach ($rows as $row) {
                    \App\Support\CsvExportSanitizer::put($stream, $row);
                }
                fclose($stream);
            },
            "event-{$id}-analytics.csv",
            [
                'Content-Type' => 'text/csv; charset=UTF-8',
                'Cache-Control' => 'private, no-store',
                'Pragma' => 'no-cache',
                'X-Content-Type-Options' => 'nosniff',
            ],
        );
        $response->setVary(['Authorization', 'Cookie', 'X-Tenant-ID'], false);

        return $response;
    }

    private function actor(): User
    {
        $tenantId = TenantContext::currentId();
        $actor = $tenantId === null
            ? null
            : User::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->whereNull('deleted_at')
                ->find($this->requireUserId());
        if (! $actor instanceof User) {
            throw new EventAnalyticsException('event_analytics_actor_invalid');
        }

        return $actor;
    }

    private function privateResponse(JsonResponse $response): JsonResponse
    {
        $response->headers->set('Cache-Control', 'private, no-store');
        $response->headers->set('Pragma', 'no-cache');
        $response->setVary(['Authorization', 'Cookie', 'X-Tenant-ID'], false);

        return $response;
    }

    private function analyticsError(EventAnalyticsException $exception): JsonResponse
    {
        return match ($exception->reasonCode) {
            'event_analytics_event_not_found', 'event_analytics_actor_invalid' =>
                $this->respondWithError(
                    'EVENT_ANALYTICS_NOT_FOUND',
                    __('api.event_not_found'),
                    null,
                    404,
                ),
            'event_analytics_schema_unavailable',
            'event_analytics_feature_disabled',
            'event_analytics_tenant_context_missing' => $this->respondWithError(
                'EVENT_ANALYTICS_UNAVAILABLE',
                __('api.service_unavailable'),
                null,
                503,
            ),
            default => $this->respondWithError(
                'EVENT_ANALYTICS_INVALID',
                __('api.invalid_input'),
                null,
                422,
            ),
        };
    }
}
