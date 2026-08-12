<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;

/** Serve the install manifest with an identity and URLs scoped to the active tenant. */
final class PwaManifestController
{
    /** The platform/master tenant, which serves its host from the root. */
    private const MASTER_TENANT_ID = 1;

    public function show(Request $request): Response
    {
        $manifest = $this->baseManifest();
        [$tenant, $prefix] = $this->resolveTenantAndPrefix($request);
        $scope = $prefix === '' ? '/' : $prefix . '/';

        if (!empty($tenant['name'])) {
            $manifest['name'] = (string) $tenant['name'];
            $manifest['short_name'] = mb_substr((string) $tenant['name'], 0, 30);
        }

        $manifest['id'] = $scope;
        $manifest['start_url'] = $scope;
        $manifest['scope'] = $scope;

        foreach (($manifest['shortcuts'] ?? []) as $index => $shortcut) {
            if (!is_array($shortcut) || empty($shortcut['url'])) {
                continue;
            }

            $path = '/' . ltrim((string) $shortcut['url'], '/');
            $manifest['shortcuts'][$index]['url'] = $prefix . $path;
        }

        $json = json_encode(
            $manifest,
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR
        );

        return response($json, 200, [
            'Content-Type' => 'application/manifest+json; charset=UTF-8',
            'Cache-Control' => 'public, max-age=300, stale-while-revalidate=60',
            'Vary' => 'Host',
        ]);
    }

    /**
     * Base manifest shared by every tenant, before the per-tenant overlay in
     * show(). Embedded here rather than read from react-frontend/public/
     * manifest.json: the backend image does not ship the React source tree, so
     * that file is absent in production and CI — reading it threw and returned a
     * 500 on every install-manifest request. Keep in sync with
     * react-frontend/public/manifest.json if the static manifest changes.
     *
     * @return array<string, mixed>
     */
    private function baseManifest(): array
    {
        $icon192 = ['src' => '/icons/icon-192.png', 'sizes' => '192x192'];

        return [
            'name' => 'NEXUS Timebanking',
            'short_name' => 'NEXUS',
            'description' => 'Community timebanking platform — exchange skills and services using time credits.',
            'id' => '.',
            'start_url' => '.',
            'scope' => '.',
            'display' => 'standalone',
            'background_color' => '#0f0f13',
            'theme_color' => '#6366f1',
            'orientation' => 'portrait-primary',
            'categories' => ['social', 'lifestyle', 'productivity'],
            'icons' => [
                ['src' => '/icons/icon-192.png', 'sizes' => '192x192', 'type' => 'image/png', 'purpose' => 'any'],
                ['src' => '/icons/icon-192.png', 'sizes' => '192x192', 'type' => 'image/png', 'purpose' => 'maskable'],
                ['src' => '/icons/icon-512.png', 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'any'],
                ['src' => '/icons/icon-512.png', 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'maskable'],
            ],
            'screenshots' => [],
            'shortcuts' => [
                ['name' => 'Listings', 'short_name' => 'Listings', 'description' => 'Browse service listings', 'url' => 'listings', 'icons' => [$icon192]],
                ['name' => 'Messages', 'short_name' => 'Messages', 'description' => 'Open messages', 'url' => 'messages', 'icons' => [$icon192]],
                ['name' => 'Wallet', 'short_name' => 'Wallet', 'description' => 'View time credit balance', 'url' => 'wallet', 'icons' => [$icon192]],
            ],
        ];
    }

    /** @return array{0: array<string, mixed>, 1: string} */
    private function resolveTenantAndPrefix(Request $request): array
    {
        $tenant = (array) (TenantContext::get() ?? []);
        $prefix = $this->tenantPrefix($tenant);
        $requestedPath = (string) $request->query('path', '/');
        $path = (string) (parse_url($requestedPath, PHP_URL_PATH) ?: '/');
        $firstSegment = explode('/', trim($path, '/'))[0] ?? '';

        if ($firstSegment !== '') {
            $pathTenantQuery = DB::table('tenants')
                ->where('slug', $firstSegment)
                ->where('is_active', true);

            // A dedicated-domain parent deliberately has no slug prefix. On
            // that host, only a direct child slug may qualify the requested
            // path; an ordinary route such as `/listings` must never switch to
            // an unrelated tenant with the same slug. The master/shared host
            // has no such domain identity, so it may resolve any active path
            // tenant from the manifest request's explicit `path` parameter.
            $isDedicatedDomainTenant = (int) ($tenant['id'] ?? 0) > 1
                && trim((string) ($tenant['domain'] ?? '')) !== ''
                && $prefix === '';

            if ($isDedicatedDomainTenant) {
                $pathTenantQuery->where('parent_id', (int) $tenant['id']);
            }

            $pathTenant = $pathTenantQuery->first();

            // The master tenant is deliberately excluded. Its slug is a
            // platform route ('admin' in production), not a path a community
            // is served under, so matching it would scope the manifest to the
            // admin panel — see tenantPrefix() below.
            if ($pathTenant !== null && (int) $pathTenant->id !== self::MASTER_TENANT_ID) {
                $tenant = (array) $pathTenant;
                $prefix = '/' . ltrim((string) $pathTenant->slug, '/');
            }
        }

        return [$tenant, rtrim($prefix, '/')];
    }

    /**
     * The URL prefix the active tenant's pages live under.
     *
     * Deliberately NOT TenantContext::getSlugPrefix(): that returns '' only
     * for custom-domain tenants with id > 1, so the platform master tenant
     * (id 1, slug 'admin') fell through to '/admin'. Every install from
     * app.project-nexus.ie then got a manifest whose start_url was the admin
     * panel and whose scope excluded every ordinary member page, so those
     * pages opened in the browser instead of the installed app.
     *
     * @param array<string, mixed> $tenant
     */
    private function tenantPrefix(array $tenant): string
    {
        $id = (int) ($tenant['id'] ?? 0);

        // The platform host serves the whole site from the root.
        if ($id === self::MASTER_TENANT_ID) {
            return '';
        }

        // A dedicated-domain tenant is identified by its host, not by a path.
        if ($id > self::MASTER_TENANT_ID && trim((string) ($tenant['domain'] ?? '')) !== '') {
            return '';
        }

        $slug = trim((string) ($tenant['slug'] ?? ''));

        return $slug === '' ? '' : '/' . $slug;
    }
}
