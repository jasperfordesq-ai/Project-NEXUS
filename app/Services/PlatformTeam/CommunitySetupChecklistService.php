<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

use App\Services\CommunitySetupService;
use App\Support\Tenancy\PlatformHostPolicy;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Platform team panel → Community setup (idea 11).
 *
 * For each community, which of the first steps of setting one up are done:
 *   - make_it_yours: the community admin's own "Make it yours" count
 *     (CommunitySetupService::status($id, false); `false` so no logo file is
 *     opened on disk);
 *   - own_address: `tenants.domain` is set and is not one of the platform's
 *     own addresses (see isPlatformAddress());
 *   - accessible_address: `tenants.accessible_domain` is set;
 *   - privacy_notice_published / terms_published: an active legal document of
 *     that type whose current version is not a draft (the rule
 *     LegalDocumentService uses to show one). Terms are seeded published when
 *     a community is created (TenantDefaultsSeeder::seedStandardLegalDocuments),
 *     so that tick means less than the others; the page says so;
 *   - first_admin_signed_in: an administrator of that community (role admin,
 *     legacy is_admin, or tenant super admin) has signed in at least once;
 *   - email_sender: `own` when App\Core\Mailer::loadTenantConfig() would send
 *     this community's mail through its own account, else `platform`.
 *
 * "Email sending verified" is not recorded anywhere, so it is not reported.
 *
 * 🔴 Cross-community on purpose: no `tenant_id` filter, because the question
 * is "how far has each community got". Correct only because nothing below the
 * platform team can call it. Yes/no facts only: no name, no address of a
 * person and no email setting value leaves this class (the email settings are
 * tested for "is set" inside the database; their values are never selected).
 *
 * Newest communities first, at most MAX_COMMUNITIES of them (`truncated` says
 * when there are more). One grouped query per step across those communities,
 * except "Make it yours", which is the admin page's own per-community count.
 * A step that cannot be read is null in every row and named in `unavailable`
 * (logged at error), never shown as "not done".
 */
final class CommunitySetupChecklistService
{
    public const MAX_COMMUNITIES = 200;

    /** Mailer providers that send through the community's own account, and the settings each needs. */
    private const OWN_SENDERS = [
        'gmail_api' => ['gmail_client_id', 'gmail_client_secret', 'gmail_refresh_token'],
        'smtp' => ['smtp_host'],
    ];

    /** @var \Closure(int): array{done: int, total: int} */
    private readonly \Closure $readMakeItYours;

    /**
     * @param (\Closure(int): array{done: int, total: int})|null $readMakeItYours
     *        Only a test passes this (CommunitySetupService is final).
     */
    public function __construct(
        CommunitySetupService $setup,
        private readonly int $maxCommunities = self::MAX_COMMUNITIES,
        ?\Closure $readMakeItYours = null,
    ) {
        $this->readMakeItYours = $readMakeItYours ?? static function (int $communityId) use ($setup): array {
            $status = $setup->status($communityId, false);

            return ['done' => (int) $status['done'], 'total' => (int) $status['total']];
        };
    }

    /**
     * @return array{
     *   max_communities: int,
     *   total_communities: int,
     *   truncated: bool,
     *   unavailable: list<string>,
     *   communities: list<array<string, mixed>>
     * }
     */
    public function overview(): array
    {
        $total = DB::table('tenants')->count();
        $tenants = DB::table('tenants')
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->limit($this->maxCommunities)
            ->get(['id', 'name', 'slug', 'is_active', 'created_at', 'domain', 'accessible_domain']);
        $ids = $tenants->map(static fn (object $t): int => (int) $t->id)->all();

        $unavailable = [];
        $step = static function (string $name, callable $read) use (&$unavailable): ?array {
            try {
                return $read();
            } catch (\Throwable $e) {
                Log::error('Platform team community setup: a step could not be read', [
                    'step' => $name,
                    'exception' => $e::class,
                    'message' => $e->getMessage(),
                ]);
                $unavailable[] = $name;

                return null;
            }
        };

        $makeItYours = $step('make_it_yours', function () use ($ids): array {
            $out = [];
            foreach ($ids as $id) {
                $out[$id] = ($this->readMakeItYours)($id);
            }

            return $out;
        });
        $legal = $step('legal_documents', fn (): array => $this->publishedLegalDocuments($ids));
        $adminSignedIn = $step('first_admin_signed_in', fn (): array => $this->adminSignedIn($ids));
        $ownSender = $step('email_sender', fn (): array => $this->ownSender($ids));
        $platformAddresses = $this->platformAddresses();

        $communities = [];
        foreach ($tenants as $tenant) {
            $id = (int) $tenant->id;
            $domain = PlatformHostPolicy::normalise((string) ($tenant->domain ?? ''));
            $createdAt = $tenant->created_at !== null ? Carbon::parse((string) $tenant->created_at)->toIso8601String() : null;

            $communities[] = [
                'id' => $id,
                'name' => (string) $tenant->name,
                'slug' => $tenant->slug !== null ? (string) $tenant->slug : null,
                'is_active' => !empty($tenant->is_active),
                'created_at' => $createdAt,
                'make_it_yours' => $makeItYours === null ? null : ($makeItYours[$id] ?? null),
                'own_address' => $domain !== '' && !self::isPlatformAddress($domain, $platformAddresses),
                'accessible_address' => trim((string) ($tenant->accessible_domain ?? '')) !== '',
                'privacy_notice_published' => $legal === null ? null : isset($legal[$id]['privacy']),
                'terms_published' => $legal === null ? null : isset($legal[$id]['terms']),
                'first_admin_signed_in' => $adminSignedIn === null ? null : isset($adminSignedIn[$id]),
                'email_sender' => $ownSender === null ? null : (isset($ownSender[$id]) ? 'own' : 'platform'),
            ];
        }

        return [
            'max_communities' => $this->maxCommunities,
            'total_communities' => $total,
            'truncated' => $total > count($communities),
            'unavailable' => $unavailable,
            'communities' => $communities,
        ];
    }

    /**
     * The platform's own addresses, from configuration (never written out
     * here): config('tenancy.platform_hosts'), which holds the bare platform
     * domain whose subdomains TenantProvisioningService hands out, plus the
     * shared app and accessible hosts. Not PlatformHostPolicy::platformHosts():
     * that also takes every CORS origin, and those include communities' own
     * domains.
     *
     * @return list<string>
     */
    private function platformAddresses(): array
    {
        $hosts = [];
        foreach (['tenancy.platform_hosts', 'tenancy.platform_app_hosts', 'tenancy.platform_accessible_hosts'] as $key) {
            foreach ((array) config($key, []) as $candidate) {
                $host = PlatformHostPolicy::normalise((string) $candidate);
                if ($host !== '') {
                    $hosts[$host] = true;
                }
            }
        }

        return array_keys($hosts);
    }

    /**
     * The address is one of the platform's, or a name below one (a
     * provisioned community's `<name>.<platform domain>`).
     *
     * @param list<string> $platformAddresses
     */
    private static function isPlatformAddress(string $host, array $platformAddresses): bool
    {
        foreach ($platformAddresses as $platform) {
            if ($host === $platform || str_ends_with($host, '.' . $platform)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param list<int> $ids
     * @return array<int, array<string, true>> community id => document types published
     */
    private function publishedLegalDocuments(array $ids): array
    {
        $out = [];
        if ($ids === []) {
            return $out;
        }
        $rows = DB::table('legal_documents as ld')
            ->join('legal_document_versions as ldv', 'ldv.id', '=', 'ld.current_version_id')
            ->whereIn('ld.tenant_id', $ids)
            ->whereIn('ld.document_type', ['privacy', 'terms'])
            ->where('ld.is_active', 1)
            ->where('ldv.is_draft', 0)
            ->distinct()
            ->get(['ld.tenant_id', 'ld.document_type']);
        foreach ($rows as $row) {
            $out[(int) $row->tenant_id][(string) $row->document_type] = true;
        }

        return $out;
    }

    /**
     * An administrator of the community, as AdminTier counts one at community
     * level (role admin, legacy is_admin, or tenant super admin), who has
     * signed in. Not a manager's stand-in (it never signs in), not a deleted
     * or erased account, and not a global super admin or platform team
     * account that happens to live in the community: those are not its admin.
     *
     * @param list<int> $ids
     * @return array<int, true>
     */
    private function adminSignedIn(array $ids): array
    {
        $out = [];
        if ($ids === []) {
            return $out;
        }
        $rows = DB::table('users')
            ->whereIn('tenant_id', $ids)
            ->whereNotNull('last_login_at')
            ->whereNull('deleted_at')
            ->whereNull('anonymized_at')
            ->where(static function ($q): void {
                $q->whereNull('status')->orWhere('status', '!=', 'delegate');
            })
            ->where(static function ($q): void {
                $q->where('role', 'admin')->orWhere('is_admin', 1)->orWhere('is_tenant_super_admin', 1);
            })
            ->where(static function ($q): void {
                $q->whereNull('is_super_admin')->orWhere('is_super_admin', 0);
            })
            ->where('is_god', 0)
            ->distinct()
            ->pluck('tenant_id');
        foreach ($rows as $tenantId) {
            $out[(int) $tenantId] = true;
        }

        return $out;
    }

    /**
     * Communities whose mail App\Core\Mailer::loadTenantConfig() would send
     * through their own account: the provider is one it acts on AND the
     * settings it needs for it are filled in. Otherwise the Mailer silently
     * uses the platform's sender, so the page says "platform". An empty value
     * is stored unencrypted (EmailSettings::set), so "not empty" is tested in
     * the database and no value is ever read into PHP.
     *
     * @param list<int> $ids
     * @return array<int, true>
     */
    private function ownSender(array $ids): array
    {
        $out = [];
        if ($ids === []) {
            return $out;
        }
        $providers = DB::table('email_settings')
            ->whereIn('tenant_id', $ids)
            ->where('setting_key', 'email_provider')
            ->whereIn('setting_value', array_keys(self::OWN_SENDERS))
            ->pluck('setting_value', 'tenant_id');
        if ($providers->isEmpty()) {
            return $out;
        }

        $needed = array_values(array_unique(array_merge(...array_values(self::OWN_SENDERS))));
        $filled = [];
        $rows = DB::table('email_settings')
            ->whereIn('tenant_id', $providers->keys()->map(static fn ($id): int => (int) $id)->all())
            ->whereIn('setting_key', $needed)
            ->whereNotNull('setting_value')
            ->where('setting_value', '!=', '')
            ->get(['tenant_id', 'setting_key']);
        foreach ($rows as $row) {
            $filled[(int) $row->tenant_id][(string) $row->setting_key] = true;
        }

        foreach ($providers as $tenantId => $provider) {
            $tenantId = (int) $tenantId;
            $complete = true;
            foreach (self::OWN_SENDERS[(string) $provider] as $key) {
                if (!isset($filled[$tenantId][$key])) {
                    $complete = false;
                }
            }
            if ($complete) {
                $out[$tenantId] = true;
            }
        }

        return $out;
    }
}
