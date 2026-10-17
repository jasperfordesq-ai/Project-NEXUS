<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Services\PageContentPolicy;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * PagesPublicController — Eloquent-powered public CMS page endpoint.
 *
 * Fully migrated from legacy delegation to direct DB queries.
 */
class PagesPublicController extends BaseApiController
{
    protected bool $isV2Api = true;

    /**
     * GET /api/v2/pages/{slug}
     *
     * Returns a published page's content for public display.
     * If the tenant resolves to master (1) and context_tenant query param
     * is provided, uses that tenant instead (for unauthenticated public pages).
     */
    public function show(string $slug): JsonResponse
    {
        $tenantId = $this->getTenantId();

        // If resolved to master tenant (1) and an explicit context_tenant is provided by the
        // React frontend, use it. This handles unauthenticated public page requests where
        // the X-Tenant-ID header is unavailable (no JWT), but the React app knows the tenant
        // from the URL (e.g. /hour-timebank/page/test) and passes it as a query param.
        $contextTenant = $this->queryInt('context_tenant');
        if ($tenantId === 1 && $contextTenant !== null && $contextTenant > 1) {
            $tenantId = $contextTenant;
        }

        $page = DB::table('pages')
            ->where('slug', $slug)
            ->where('tenant_id', $tenantId)
            ->where('is_published', 1)
            ->first();

        if (!$page) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.page_not_found'), null, 404);
        }

        // CMS pages are intentionally public editorial content. They must not,
        // however, become an alternate anonymous member directory. Fail closed
        // for legacy dynamic member blocks and direct account-profile links.
        if (PageContentPolicy::linksToMemberProfiles($page)) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.page_not_found'), null, 404);
        }

        return $this->respondWithData([
            'id' => (int) $page->id,
            'title' => $page->title ?? '',
            'slug' => $page->slug ?? '',
            'content' => $page->content ?? '',
            'content_format' => $page->content_format ?? 'richtext',
            'meta_description' => $page->meta_description ?? '',
            'created_at' => $page->created_at,
            'updated_at' => $page->updated_at,
        ]);
    }
}
