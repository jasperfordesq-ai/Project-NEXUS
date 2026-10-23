<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Observers;

use App\Services\PrerenderService;
use App\Services\SitemapService;
use Illuminate\Contracts\Events\ShouldHandleEventsAfterCommit;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/*
 * Why content-save observers run at NORMAL priority, not LOW:
 *
 * The auto-recache cron (Phase 2) uses LOW to keep TTL/drift refreshes out of
 * the way of user-initiated runs. But a content-save event IS user-initiated
 * — someone hit "Publish" and expects the public page to reflect it within
 * one bot crawl. Treating that as background work would let TTL sweeps starve
 * the publish freshness, which is exactly the bug we're trying to prevent.
 */

/**
 * Generic prerender-cache invalidation observer.
 *
 * Subclasses define `routesFor()` returning the public routes that depend on
 * a given model instance. Whenever a model is saved or deleted, those routes
 * are invalidated and re-rendered at low priority.
 *
 * Why a base class and not an interface: the observer methods (saved/deleted)
 * need to be present even if a model has no per-instance public URL — the
 * base class always invalidates the index route, which is the common case.
 */
abstract class PrerenderInvalidationObserver implements ShouldHandleEventsAfterCommit
{
    public function saved(Model $model): void
    {
        $this->dispatch($model, 'saved');
    }

    public function deleted(Model $model): void
    {
        $this->dispatch($model, 'deleted');
    }

    /**
     * Return the routes that should be re-rendered when this model changes.
     * Always include the index (e.g. /blog) plus the detail page if any.
     *
     * @return array<int,string>
     */
    abstract protected function routesFor(Model $model): array;

    /**
     * Addresses this save made obsolete (a renamed slug's old address). Their
     * copies are deleted and NOT re-rendered: the old address now shows "not
     * found", and until 2026-10-23 its copy stayed on the crawler side until a
     * cleanup sweep happened to reach it.
     *
     * @return array<int,string>
     */
    protected function retiredRoutesFor(Model $model): array
    {
        return [];
    }

    protected function tenantId(Model $model): ?int
    {
        $tid = $model->tenant_id ?? null;
        return $tid !== null ? (int) $tid : null;
    }

    private function dispatch(Model $model, string $event): void
    {
        try {
            $tenantId = $this->tenantId($model);
            if ($tenantId === null || $tenantId === 0) return;
            $routes = $this->routesFor($model);
            if (empty($routes)) return;
            app(SitemapService::class)->clearCache($tenantId);
            Cache::forget('prerender:summary:inventory');
            app(PrerenderService::class)->invalidateRoutes($tenantId, $routes, true);
            $retired = array_values(array_diff($this->retiredRoutesFor($model), $routes));
            if ($retired !== []) {
                app(PrerenderService::class)->invalidateRoutes($tenantId, $retired, false);
            }
        } catch (\Throwable $e) {
            // Observer failures must NEVER block model writes. Log and move on.
            Log::warning('Prerender invalidation failed', [
                'model'  => $model::class,
                'event'  => $event,
                'id'     => $model->getKey(),
                'error'  => $e->getMessage(),
            ]);
        }
    }
}
