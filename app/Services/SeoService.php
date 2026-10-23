<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * SeoService — Laravel DI-based service for SEO metadata management.
 *
 * Manages page-level metadata, Open Graph tags, and redirect rules.
 */
class SeoService
{
    /**
     * Get SEO metadata for a specific entity.
     */
    public function getMetadata(int $tenantId, string $entityType, ?int $entityId = null): array
    {
        $query = DB::table('seo_metadata')
            ->where('tenant_id', $tenantId)
            ->where('entity_type', $entityType);

        if ($entityId !== null) {
            $query->where('entity_id', $entityId);
        } else {
            $query->whereNull('entity_id');
        }

        $meta = $query->first();

        if (! $meta) {
            return ['meta_title' => null, 'meta_description' => null, 'og_image_url' => null, 'canonical_url' => null];
        }

        return (array) $meta;
    }

    /**
     * Update SEO metadata for a specific entity.
     */
    public function updateMetadata(int $tenantId, string $entityType, ?int $entityId, array $data): bool
    {
        $allowed = ['meta_title', 'meta_description', 'meta_keywords', 'og_image_url', 'canonical_url', 'noindex'];
        $update = array_intersect_key($data, array_flip($allowed));
        $update['updated_at'] = now();

        return DB::table('seo_metadata')
            ->updateOrInsert(
                ['tenant_id' => $tenantId, 'entity_type' => $entityType, 'entity_id' => $entityId],
                $update
            );
    }

    /**
     * Get all redirect rules for a tenant.
     */
    public function getRedirects(int $tenantId): array
    {
        return DB::table('seo_redirects')
            ->where('tenant_id', $tenantId)
            ->orderBy('source_url')
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();
    }

    /**
     * Create a redirect rule.
     */
    public function createRedirect(int $tenantId, string $from, string $to, int $statusCode = 301): ?int
    {
        if (! in_array($statusCode, [301, 302], true)) {
            $statusCode = 301;
        }
        if (!\App\Http\Middleware\SeoRedirectMiddleware::isSafeDestination($to)
            || app(SeoRedirectPublisher::class)->validateNew($tenantId, $from, $to) !== null) {
            return null;
        }

        $id = DB::table('seo_redirects')->insertGetId([
            'tenant_id'       => $tenantId,
            'source_url'      => $from,
            'destination_url' => $to,
            'created_at'      => now(),
        ]);
        app(SeoRedirectPublisher::class)->publishTenant($tenantId);

        return $id;
    }
}
