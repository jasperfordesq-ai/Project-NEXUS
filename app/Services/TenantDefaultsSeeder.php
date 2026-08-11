<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Support\Legal\StandardTermsContent;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * TenantDefaultsSeeder — canonical "day-one" defaults shared by every
 * tenant-creation path.
 *
 * Both TenantHierarchyService::createTenant() (the admin/hierarchy path) and
 * TenantProvisioning\TenantProvisioningService::approveAndProvision() (the
 * self-service AG44 approval path) seed the SAME default categories, member
 * attributes, and navigation menus through this single source of truth, so the
 * two paths can never drift again. Previously the seeders lived only on the
 * hierarchy path, so tenants provisioned through approval launched with an
 * empty attribute filter list and no navigation menus.
 *
 * Every method is idempotent and safe to call more than once on a tenant.
 *
 * Categories / attribute names / menu labels are admin-editable content (not UI
 * chrome), so they are stored as plain strings rather than translation keys —
 * consistent with how the platform has always seeded default categories.
 */
class TenantDefaultsSeeder
{
    /**
     * Seed the universal default category set for any timebank.
     *
     * Idempotent via the (tenant_id, slug) unique key.
     */
    public static function seedCategories(int $tenantId): void
    {
        $categories = [
            'Home & Garden',
            'Technology',
            'Education & Tutoring',
            'Health & Wellness',
            'Transport',
            'Creative & Arts',
            'Professional Services',
            'Community',
        ];

        foreach ($categories as $sort => $categoryName) {
            DB::table('categories')->insertOrIgnore([
                'tenant_id'  => $tenantId,
                'name'       => $categoryName,
                'slug'       => strtolower(preg_replace('/[^a-z0-9]+/', '-', strtolower(trim($categoryName)))),
                'sort_order' => $sort,
                'is_active'  => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    /**
     * Seed the canonical member-attribute set (offer/request filters).
     *
     * Vetting/police-check attributes are deliberately absent: member-selected
     * listing attributes must never imply a broker-confirmed safeguarding state.
     *
     * Idempotent via the (tenant_id, name, target_type) unique key.
     */
    public static function seedAttributes(int $tenantId): void
    {
        // [name, target_type] — all checkbox, all active.
        $attributes = [
            // Offer-side capability signals
            ['Tools Provided', 'offer'],
            ['Materials Provided', 'offer'],
            ['References Available', 'offer'],
            // Request-side requirements
            ['Tools Required', 'request'],
            ['Materials Required', 'request'],
            // Applies to either side
            ['Wheelchair Accessible', 'any'],
            ['Pet Friendly', 'any'],
            ['Online Only', 'any'],
        ];

        $now = now();
        foreach ($attributes as [$name, $targetType]) {
            DB::table('attributes')->insertOrIgnore([
                'tenant_id'   => $tenantId,
                'name'        => $name,
                'target_type' => $targetType,
                'input_type'  => 'checkbox',
                'is_active'   => 1,
                'created_at'  => $now,
                'updated_at'  => $now,
            ]);
        }
    }

    /**
     * Seed the default navigation menus (Main Navigation + Footer Navigation).
     *
     * Reproduces the canonical structure from the legacy menu seeder
     * (`migrations/create_menu_and_pay_plans.sql`): a header menu with a nested
     * "Community" dropdown plus a footer menu.
     *
     * Visibility rules use the platform's canonical vocabulary
     * (`requires_auth` / `requires_feature` / `min_role` / `exclude_roles`) —
     * the same keys the React renderer (MenuNavItems), the React admin editor
     * (VisibilityRulesEditor) and MenuManager::filterVisibleItems() all read, so
     * feature/auth gating is applied consistently on both the client and the
     * PHP-rendered (mobile / prerender) paths.
     *
     * Idempotent + atomic: each menu (and its items) is seeded only when no menu
     * with the same (tenant_id, slug) already exists, and the menu row plus all
     * of its items are written inside a single transaction. A mid-insert failure
     * therefore rolls the whole menu back rather than committing a menu row with
     * partial items (which the slug-existence guard could never repair).
     */
    public static function seedMenus(int $tenantId): void
    {
        $now = now();

        // ── Main Navigation (header-main) ────────────────────────────────────
        if (! DB::table('menus')->where('tenant_id', $tenantId)->where('slug', 'main-nav')->exists()) {
            DB::transaction(function () use ($tenantId, $now) {
                $mainMenuId = (int) DB::table('menus')->insertGetId([
                    'tenant_id'     => $tenantId,
                    'name'          => 'Main Navigation',
                    'slug'          => 'main-nav',
                    'description'   => 'Primary navigation menu',
                    'location'      => 'header-main',
                    'layout'        => null,
                    'min_plan_tier' => 0,
                    'is_active'     => 1,
                    'created_at'    => $now,
                    'updated_at'    => $now,
                ]);

                DB::table('menu_items')->insert([
                    'menu_id'    => $mainMenuId,
                    'type'       => 'link',
                    'label'      => 'Home',
                    'url'        => '/',
                    'sort_order' => 10,
                    'is_active'  => 1,
                    'created_at' => $now,
                ]);
                DB::table('menu_items')->insert([
                    'menu_id'          => $mainMenuId,
                    'type'             => 'link',
                    'label'            => 'Explore',
                    'url'              => '/listings',
                    'sort_order'       => 20,
                    'visibility_rules' => json_encode(['requires_auth' => false]),
                    'is_active'        => 1,
                    'created_at'       => $now,
                ]);

                // "Community" dropdown + its children
                $communityId = (int) DB::table('menu_items')->insertGetId([
                    'menu_id'    => $mainMenuId,
                    'type'       => 'dropdown',
                    'label'      => 'Community',
                    'url'        => null,
                    'sort_order' => 30,
                    'is_active'  => 1,
                    'created_at' => $now,
                ]);
                DB::table('menu_items')->insert([
                    'menu_id'          => $mainMenuId,
                    'parent_id'        => $communityId,
                    'type'             => 'link',
                    'label'            => 'Groups',
                    'url'              => '/groups',
                    'sort_order'       => 10,
                    'visibility_rules' => json_encode(['requires_feature' => 'groups']),
                    'is_active'        => 1,
                    'created_at'       => $now,
                ]);
                DB::table('menu_items')->insert([
                    'menu_id'          => $mainMenuId,
                    'parent_id'        => $communityId,
                    'type'             => 'link',
                    'label'            => 'Members',
                    'url'              => '/members',
                    'sort_order'       => 20,
                    'visibility_rules' => json_encode(['requires_auth' => true]),
                    'is_active'        => 1,
                    'created_at'       => $now,
                ]);
                DB::table('menu_items')->insert([
                    'menu_id'    => $mainMenuId,
                    'parent_id'  => $communityId,
                    'type'       => 'link',
                    'label'      => 'Events',
                    'url'        => '/events',
                    'sort_order' => 30,
                    'is_active'  => 1,
                    'created_at' => $now,
                ]);

                DB::table('menu_items')->insert([
                    'menu_id'    => $mainMenuId,
                    'type'       => 'link',
                    'label'      => 'About',
                    'url'        => '/about',
                    'sort_order' => 40,
                    'is_active'  => 1,
                    'created_at' => $now,
                ]);
                DB::table('menu_items')->insert([
                    'menu_id'          => $mainMenuId,
                    'type'             => 'link',
                    'label'            => 'Dashboard',
                    'url'              => '/dashboard',
                    'sort_order'       => 50,
                    // Authenticated-only. `requires_auth` is the correct, role-agnostic
                    // gate here; a `min_role` of 'user' would mis-gate the default
                    // 'member' role (which is not in the min_role hierarchy) in the
                    // React renderer, wrongly hiding the dashboard from ordinary members.
                    'visibility_rules' => json_encode(['requires_auth' => true]),
                    'is_active'        => 1,
                    'created_at'       => $now,
                ]);
            });
        }

        // ── Footer Navigation (footer) ───────────────────────────────────────
        if (! DB::table('menus')->where('tenant_id', $tenantId)->where('slug', 'footer-nav')->exists()) {
            DB::transaction(function () use ($tenantId, $now) {
                $footerMenuId = (int) DB::table('menus')->insertGetId([
                    'tenant_id'     => $tenantId,
                    'name'          => 'Footer Navigation',
                    'slug'          => 'footer-nav',
                    'description'   => 'Footer links',
                    'location'      => 'footer',
                    'layout'        => null,
                    'min_plan_tier' => 0,
                    'is_active'     => 1,
                    'created_at'    => $now,
                    'updated_at'    => $now,
                ]);

                $footerItems = [
                    ['Privacy Policy', '/privacy', 10],
                    ['Terms of Service', '/terms', 20],
                    ['Contact', '/contact', 30],
                    ['Help', '/help', 40],
                ];
                foreach ($footerItems as [$label, $url, $sort]) {
                    DB::table('menu_items')->insert([
                        'menu_id'    => $footerMenuId,
                        'type'       => 'link',
                        'label'      => $label,
                        'url'        => $url,
                        'sort_order' => $sort,
                        'is_active'  => 1,
                        'created_at' => $now,
                    ]);
                }
            });
        }
    }
    /**
     * Seed the standard shipped Terms of Service as an acceptable document.
     *
     * 🔴 Why this is day-one and not optional. Acceptance enforcement
     * (App\Http\Middleware\EnsureLegalAcceptance, enforced by default since
     * 2026-08-11) only ever blocks on a row in legal_documents. Before this method
     * existed, the shipped terms lived only as display copy on the terms page, so a
     * brand-new community had NOTHING for a member to accept and the legal
     * obligation was silently unmet no matter how the gate was configured.
     *
     * 🔴 NEVER overwrites. If the community already has a terms document — its own
     * wording, or this one from a previous run — the method returns untouched. A
     * community's published terms are a legal record, and members have accepted a
     * specific version id; replacing that content under them would invalidate every
     * acceptance already on file while leaving the acceptance rows looking valid.
     * Idempotent via the (tenant_id, document_type) unique key AND an explicit
     * check, because the unique key alone would raise rather than skip.
     *
     * The document is published immediately (is_draft = 0, is_current = 1) and
     * requires acceptance at login. A draft would satisfy nothing.
     */
    public static function seedStandardLegalDocuments(int $tenantId): void
    {
        if (! Schema::hasTable('legal_documents') || ! Schema::hasTable('legal_document_versions')) {
            return;
        }

        $existing = DB::table('legal_documents')
            ->where('tenant_id', $tenantId)
            ->where('document_type', 'terms')
            ->exists();

        if ($existing) {
            return;
        }

        $tenantName = (string) (DB::table('tenants')->where('id', $tenantId)->value('name') ?? '');
        $content     = StandardTermsContent::html($tenantName);
        $plain       = StandardTermsContent::plainText($tenantName);

        // created_by is NOT NULL on both tables and carries no foreign key, so a
        // real admin id is used when one exists and 0 means "seeded by the
        // platform" — a fresh community has no users yet, and the seed must not
        // depend on one.
        $createdBy = (int) (DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where(function ($q) {
                $q->where('is_admin', 1)->orWhere('is_super_admin', 1)->orWhere('role', 'admin');
            })
            ->orderBy('id')
            ->value('id') ?? 0);

        $now = now();

        DB::transaction(function () use ($tenantId, $content, $plain, $createdBy, $now) {
            $documentId = (int) DB::table('legal_documents')->insertGetId([
                'tenant_id'               => $tenantId,
                'document_type'           => 'terms',
                'title'                   => StandardTermsContent::title(),
                'slug'                    => 'terms',
                'requires_acceptance'     => 1,
                // 'login' rather than 'registration': registration-time acceptance
                // would leave every EXISTING member of an established community
                // un-gated for ever, which is the hole this is closing.
                'acceptance_required_for' => 'login',
                'notify_on_update'        => 1,
                'is_active'               => 1,
                'created_by'              => $createdBy,
                'created_at'              => $now,
                'updated_at'              => $now,
            ]);

            $versionId = (int) DB::table('legal_document_versions')->insertGetId([
                'document_id'        => $documentId,
                'version_number'     => StandardTermsContent::VERSION,
                'version_label'      => 'Standard terms',
                'content'            => $content,
                'content_plain'      => $plain,
                'summary_of_changes' => 'The standard terms supplied with the platform.',
                'effective_date'     => $now->toDateString(),
                'is_draft'           => 0,
                'is_current'         => 1,
                'published_at'       => $now,
                'published_by'       => $createdBy ?: null,
                'created_by'         => $createdBy,
                'created_at'         => $now,
                'updated_at'         => $now,
            ]);

            DB::table('legal_documents')
                ->where('id', $documentId)
                ->update(['current_version_id' => $versionId]);
        });

        // The gate caches a per-user verdict keyed on the tenant's legal revision;
        // without this bump nobody is asked to accept the document that has just
        // appeared until their cached verdict expires.
        LegalEnforcementService::bumpRevision($tenantId);
    }
}
