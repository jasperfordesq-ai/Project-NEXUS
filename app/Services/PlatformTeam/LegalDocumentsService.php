<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Platform team panel → Legal documents (idea 24).
 *
 * Per community, for its terms and its privacy notice (always listed, with
 * `exists: false` when the community has none) and any other legal document
 * it has: whether it is published, the published version's number and date,
 * whether members must accept it, and — only when they must AND it is
 * published — how many members are asked and how many have not accepted the
 * current version. Plus `no_privacy_notice` per community.
 *
 * The rules are the existing ones, not new ones:
 *   - "published" is LegalDocumentPublication::publishedSql(), the rule the
 *     Community setup page uses, so the two pages never disagree;
 *   - "members asked" is the population of
 *     App\Services\LegalDocumentService::eligibleMemberQuery(): active
 *     accounts in the community that are not administrators of any kind (role
 *     not admin / tenant_admin / super_admin / god — a NULL role is excluded,
 *     as NOT IN excludes it there too — and none of is_admin, is_super_admin,
 *     is_tenant_super_admin, is_god). That is the population the acceptance
 *     gate asks, and the one getComplianceSummary() counts. Copied below as
 *     a grouped query, because the service method is bound to one community;
 *     LegalDocumentsTest pins the two to the same figures;
 *   - "accepted" is an acceptance of the document's CURRENT version by such a
 *     member of the document's own community (getComplianceSummary()'s rule).
 * Terms are seeded published when a community is created
 * (TenantDefaultsSeeder::seedStandardLegalDocuments); the page says so.
 *
 * 🔴 Cross-community on purpose: no `tenant_id` filter, because the question
 * is "which communities lack a published privacy notice, and how many members
 * have not accepted". Correct only because nothing below the platform team
 * can call it. Counts only: no member, no acceptance row, no document title or
 * text leaves this class.
 *
 * One grouped query per figure across every community, never one per
 * community or per document. A figure that cannot be read is null in every row
 * and named in `unavailable` (logged at error), never shown as zero or "no".
 */
final class LegalDocumentsService
{
    /** Always listed for every community, in this order. */
    public const ALWAYS_LISTED = ['terms', 'privacy'];

    /** The `document_type` enum, in the order the page shows it. */
    public const DOCUMENT_TYPES = ['terms', 'privacy', 'cookies', 'accessibility', 'community_guidelines', 'acceptable_use'];

    /** @var \Closure(): array<int, int> */
    private readonly \Closure $readMembers;

    /**
     * @param (\Closure(): array<int, int>)|null $readMembers community id => members asked.
     *        Only a test passes this, to make the figure unreadable.
     */
    public function __construct(?\Closure $readMembers = null)
    {
        $this->readMembers = $readMembers ?? fn (): array => $this->membersAsked();
    }

    /**
     * @return array{
     *   unavailable: list<string>,
     *   totals: array{communities: int, no_privacy_notice: int|null},
     *   communities: list<array<string, mixed>>
     * }
     */
    public function overview(): array
    {
        $unavailable = [];
        $figure = static function (string $name, callable $read) use (&$unavailable): ?array {
            try {
                return $read();
            } catch (\Throwable $e) {
                Log::error('Platform team legal documents: a figure could not be read', [
                    'figure' => $name,
                    'exception' => $e::class,
                    'message' => $e->getMessage(),
                ]);
                $unavailable[] = $name;

                return null;
            }
        };

        $documents = $figure('documents', fn (): array => $this->documents());
        $members = $figure('members', fn (): array => ($this->readMembers)());
        $accepted = $figure('acceptances', fn (): array => $this->acceptedByVersion($documents ?? []));

        $communities = [];
        $withoutPrivacy = 0;
        foreach (DB::table('tenants')->orderBy('name')->orderBy('id')->get(['id', 'name', 'slug', 'is_active']) as $tenant) {
            $id = (int) $tenant->id;
            $rows = [];
            $noPrivacy = null;
            if ($documents !== null) {
                $own = $documents[$id] ?? [];
                foreach (self::DOCUMENT_TYPES as $type) {
                    if (isset($own[$type])) {
                        $rows[] = self::documentRow($type, $own[$type], $id, $members, $accepted);
                    } elseif (in_array($type, self::ALWAYS_LISTED, true)) {
                        $rows[] = self::missingRow($type);
                    }
                }
                $noPrivacy = !(isset($own['privacy']) && $own['privacy']['published']);
                if ($noPrivacy) {
                    $withoutPrivacy++;
                }
            }

            $communities[] = [
                'id' => $id,
                'name' => (string) $tenant->name,
                'slug' => $tenant->slug !== null ? (string) $tenant->slug : null,
                'is_active' => !empty($tenant->is_active),
                'no_privacy_notice' => $noPrivacy,
                // Null when the documents could not be read at all.
                'documents' => $documents === null ? null : $rows,
            ];
        }

        return [
            'unavailable' => $unavailable,
            'totals' => [
                'communities' => count($communities),
                'no_privacy_notice' => $documents === null ? null : $withoutPrivacy,
            ],
            'communities' => $communities,
        ];
    }

    /**
     * @param array{published: bool, requires_acceptance: bool, version_id: int|null, version_number: string|null, published_at: string|null} $doc
     * @param array<int, int>|null $members
     * @param array<int, int>|null $accepted
     * @return array<string, mixed>
     */
    private static function documentRow(string $type, array $doc, int $communityId, ?array $members, ?array $accepted): array
    {
        $asked = null;
        $notAccepted = null;
        if ($doc['published'] && $doc['requires_acceptance'] && $doc['version_id'] !== null) {
            $asked = $members === null ? null : ($members[$communityId] ?? 0);
            $notAccepted = ($asked === null || $accepted === null)
                ? null
                : max(0, $asked - ($accepted[$doc['version_id']] ?? 0));
        }

        return [
            'type' => $type,
            'exists' => true,
            'published' => $doc['published'],
            'version_number' => $doc['published'] ? $doc['version_number'] : null,
            'published_at' => $doc['published'] ? $doc['published_at'] : null,
            'requires_acceptance' => $doc['requires_acceptance'],
            'members_asked' => $asked,
            'members_not_accepted' => $notAccepted,
        ];
    }

    /** @return array<string, mixed> */
    private static function missingRow(string $type): array
    {
        return [
            'type' => $type,
            'exists' => false,
            'published' => false,
            'version_number' => null,
            'published_at' => null,
            'requires_acceptance' => null,
            'members_asked' => null,
            'members_not_accepted' => null,
        ];
    }

    /**
     * Every legal document of every community, with its current version.
     * Never selects a title, a slug or any text.
     *
     * @return array<int, array<string, array{published: bool, requires_acceptance: bool, version_id: int|null, version_number: string|null, published_at: string|null}>>
     */
    private function documents(): array
    {
        $out = [];
        $rows = DB::table('legal_documents as ld')
            ->leftJoin('legal_document_versions as ldv', 'ldv.id', '=', 'ld.current_version_id')
            ->select([
                'ld.tenant_id', 'ld.document_type', 'ld.requires_acceptance',
                'ldv.id as version_id', 'ldv.version_number', 'ldv.published_at',
            ])
            ->selectRaw(LegalDocumentPublication::publishedSql('ld', 'ldv') . ' as is_published')
            ->get();
        foreach ($rows as $row) {
            $out[(int) $row->tenant_id][(string) $row->document_type] = [
                'published' => (int) $row->is_published === 1,
                'requires_acceptance' => (int) $row->requires_acceptance === 1,
                'version_id' => $row->version_id !== null ? (int) $row->version_id : null,
                'version_number' => $row->version_number !== null ? (string) $row->version_number : null,
                'published_at' => $row->published_at !== null ? Carbon::parse((string) $row->published_at)->toIso8601String() : null,
            ];
        }

        return $out;
    }

    /**
     * Members asked to accept, per community: LegalDocumentService::eligibleMemberQuery()'s
     * population, grouped.
     *
     * @return array<int, int>
     */
    private function membersAsked(): array
    {
        $out = [];
        $rows = self::eligible(DB::table('users as u'), 'u')
            ->whereNotNull('u.tenant_id')
            ->groupBy('u.tenant_id')
            ->get(['u.tenant_id', DB::raw('COUNT(*) as cnt')]);
        foreach ($rows as $row) {
            $out[(int) $row->tenant_id] = (int) $row->cnt;
        }

        return $out;
    }

    /**
     * Members of the document's own community, of the eligible population,
     * who accepted the document's current version — per version.
     *
     * @param array<int, array<string, array{published: bool, requires_acceptance: bool, version_id: int|null, version_number: string|null, published_at: string|null}>> $documents
     * @return array<int, int> version id => members who accepted it
     */
    private function acceptedByVersion(array $documents): array
    {
        $versionIds = [];
        foreach ($documents as $types) {
            foreach ($types as $doc) {
                if ($doc['published'] && $doc['requires_acceptance'] && $doc['version_id'] !== null) {
                    $versionIds[] = $doc['version_id'];
                }
            }
        }
        $out = [];
        if ($versionIds === []) {
            return $out;
        }
        $query = DB::table('user_legal_acceptances as ula')
            ->join('legal_documents as ld', 'ld.current_version_id', '=', 'ula.version_id')
            ->join('users as u', static function ($join): void {
                $join->on('u.id', '=', 'ula.user_id')->on('u.tenant_id', '=', 'ld.tenant_id');
            })
            ->whereIn('ula.version_id', array_values(array_unique($versionIds)));
        $rows = self::eligible($query, 'u')
            ->groupBy('ula.version_id')
            ->get(['ula.version_id', DB::raw('COUNT(DISTINCT u.id) as cnt')]);
        foreach ($rows as $row) {
            $out[(int) $row->version_id] = (int) $row->cnt;
        }

        return $out;
    }

    /**
     * LegalDocumentService::eligibleMemberQuery()'s conditions, without its
     * one-community filter. Keep the two in step (LegalDocumentsTest pins them).
     */
    private static function eligible(Builder $query, string $u): Builder
    {
        return $query
            ->where("{$u}.status", 'active')
            ->whereNotIn("{$u}.role", ['admin', 'tenant_admin', 'super_admin', 'god'])
            ->where(static function ($q) use ($u): void {
                $q->whereNull("{$u}.is_admin")->orWhere("{$u}.is_admin", 0);
            })
            ->where(static function ($q) use ($u): void {
                $q->whereNull("{$u}.is_super_admin")->orWhere("{$u}.is_super_admin", 0);
            })
            ->where(static function ($q) use ($u): void {
                $q->whereNull("{$u}.is_tenant_super_admin")->orWhere("{$u}.is_tenant_super_admin", 0);
            })
            ->where(static function ($q) use ($u): void {
                $q->whereNull("{$u}.is_god")->orWhere("{$u}.is_god", 0);
            });
    }
}
