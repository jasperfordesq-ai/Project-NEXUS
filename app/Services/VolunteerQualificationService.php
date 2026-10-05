<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Exceptions\VolunteerQualificationException;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Models\VolQualification;
use App\Support\UserDisplayName;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Volunteer qualifications register.
 *
 * A register entry (type, issuer, reference, dates), never a document. The
 * volunteer records it; an organisation owner/admin the volunteer is linked
 * to, or a community staff member, confirms it after seeing the original,
 * checking an online register, or hearing from the issuer. Police checks are
 * refused here — they belong to the safeguarding vetting workflow.
 *
 * Every query carries `tenant_id`. History goes to `vol_qualification_events`,
 * which the application only ever appends to.
 *
 * Spec: .local-docs-archive/volunteering-credentials/QUALIFICATIONS-BUILD-SPEC-2026-10-05.md
 */
class VolunteerQualificationService
{
    /** Member tab link (tab key stays `credentials` so old links keep working). */
    public const MEMBER_LINK = '/volunteering?tab=credentials';

    public const DEFAULT_REMINDER_WINDOW_DAYS = 30;

    public const NOTIFICATION_TYPE = 'qualification_expiry';

    /** @var list<string> */
    public const COMMON_TYPES = [
        'first_aid',
        'safeguarding_training',
        'manual_handling',
        'food_hygiene',
        'driving_licence',
        'professional_registration',
        'other',
    ];

    /** @var list<string> */
    public const IE_TYPES = ['children_first', 'first_aid_response'];

    /** @var list<string> */
    public const UK_TYPES = ['safeguarding_adults', 'efaw', 'faw'];

    /**
     * Display order: related items sit together (first aid variants, then
     * safeguarding variants), "other" last.
     *
     * @var list<string>
     */
    private const TYPE_ORDER = [
        'first_aid',
        'first_aid_response',
        'efaw',
        'faw',
        'safeguarding_training',
        'children_first',
        'safeguarding_adults',
        'manual_handling',
        'food_hygiene',
        'driving_licence',
        'professional_registration',
        'other',
    ];

    /**
     * Shown as help text under the type picker; never enforced.
     *
     * @var array<string, int|null>
     */
    public const EXPIRY_HINT_YEARS = [
        'first_aid' => 3,
        'first_aid_response' => 2,
        'efaw' => 3,
        'faw' => 3,
        'safeguarding_training' => 3,
        'children_first' => 3,
        'safeguarding_adults' => 3,
        'manual_handling' => 3,
        'food_hygiene' => 3,
        'driving_licence' => null,
        'professional_registration' => 1,
        'other' => null,
    ];

    /** @var list<string> */
    private const ACTIVE_STATUSES = [VolQualification::STATUS_RECORDED, VolQualification::STATUS_CONFIRMED];

    private const MAX_TITLE = 160;
    private const MAX_ISSUER = 160;
    private const MAX_REFERENCE = 100;
    private const MAX_NOTES = 500;

    public function __construct(
        private readonly SafeguardingJurisdictionService $jurisdictions,
    ) {
    }

    // =====================================================================
    // Types
    // =====================================================================

    /**
     * The qualification types a community offers, by its safeguarding
     * jurisdiction: Ireland adds the Tusla/PHECC items, the UK nations add the
     * HSE first-aid levels and adult safeguarding; an unconfigured or custom
     * jurisdiction gets the union.
     *
     * @return list<array{code: string, label_key: string, expiry_hint_years: int|null}>
     */
    public function typesForTenant(int $tenantId): array
    {
        $codes = $this->typeCodesForTenant($tenantId);

        return array_values(array_map(static fn (string $code): array => [
            'code' => $code,
            'label_key' => 'qualifications.types.' . $code,
            'expiry_hint_years' => self::EXPIRY_HINT_YEARS[$code] ?? null,
        ], $codes));
    }

    /** @return list<string> */
    public function typeCodesForTenant(int $tenantId): array
    {
        $region = $this->regionForTenant($tenantId);

        $allowed = self::COMMON_TYPES;
        if ($region === 'ie' || $region === 'all') {
            $allowed = array_merge($allowed, self::IE_TYPES);
        }
        if ($region === 'uk' || $region === 'all') {
            $allowed = array_merge($allowed, self::UK_TYPES);
        }

        return array_values(array_filter(self::TYPE_ORDER, static fn (string $code): bool => in_array($code, $allowed, true)));
    }

    /**
     * 'ie' | 'uk' | 'all' from the tenant's safeguarding policy. The policy
     * also names the vetting scheme, which is checked as a fallback in case a
     * future preset carries a scheme without one of the known jurisdictions.
     */
    private function regionForTenant(int $tenantId): string
    {
        try {
            $policy = $this->jurisdictions->getPolicy($tenantId);
        } catch (\Throwable $e) {
            Log::warning('VolunteerQualificationService: jurisdiction lookup failed; offering every type', [
                'tenant_id' => $tenantId,
                'exception_class' => $e::class,
            ]);

            return 'all';
        }

        $jurisdiction = (string) ($policy['jurisdiction'] ?? SafeguardingJurisdictionService::UNCONFIGURED);
        $scheme = (string) ($policy['scheme_code'] ?? '');

        if ($jurisdiction === 'ireland' || $scheme === 'garda_vetting') {
            return 'ie';
        }
        if (in_array($jurisdiction, ['united_kingdom', 'england_wales', 'scotland', 'northern_ireland'], true)
            || in_array($scheme, ['dbs_england_wales', 'pvg_scotland', 'access_ni', 'uk_national_safeguarding'], true)) {
            return 'uk';
        }

        return 'all';
    }

    /**
     * Police checks are never qualifications. Reuses the credential policy's
     * alias list and adds the family prefixes the spec names (`dbs*`, `pvg*`).
     */
    public static function isVettingType(string $type): bool
    {
        $normalised = VolunteerCredentialPolicy::normaliseType($type);
        if ($normalised === '') {
            return false;
        }
        if (VolunteerCredentialPolicy::isProhibitedVetting($normalised)) {
            return true;
        }

        foreach (['dbs', 'pvg', 'accessni', 'access_ni', 'garda', 'police', 'criminal', 'background_check'] as $prefix) {
            if (str_starts_with($normalised, $prefix)) {
                return true;
            }
        }

        return false;
    }

    // =====================================================================
    // Reminder window
    // =====================================================================

    /**
     * The tenant's "credential expiry" reminder setting, reused for the
     * register so the existing admin toggle keeps working. Default window 30
     * days for this feature. Push/SMS flags are deliberately not read: those
     * channels are not implemented.
     *
     * @return array{enabled: bool, email_enabled: bool, days: int}
     */
    public function reminderSetting(int $tenantId): array
    {
        $row = DB::table('vol_reminder_settings')
            ->where('tenant_id', $tenantId)
            ->where('reminder_type', 'credential_expiry')
            ->first(['enabled', 'email_enabled', 'days_before_expiry']);

        if ($row === null) {
            return ['enabled' => true, 'email_enabled' => true, 'days' => self::DEFAULT_REMINDER_WINDOW_DAYS];
        }

        $days = (int) ($row->days_before_expiry ?? 0);
        if ($days < 1) {
            $days = self::DEFAULT_REMINDER_WINDOW_DAYS;
        }

        return [
            'enabled' => (bool) $row->enabled,
            'email_enabled' => (bool) $row->email_enabled,
            'days' => min($days, 365),
        ];
    }

    public function reminderWindowDays(int $tenantId): int
    {
        return $this->reminderSetting($tenantId)['days'];
    }

    // =====================================================================
    // Member
    // =====================================================================

    /**
     * @return array{items: list<array<string, mixed>>, counts: array{confirmed: int, recorded: int, expiring: int, expired: int}, reminder_window_days: int, types: list<array{code: string, label_key: string, expiry_hint_years: int|null}>}
     */
    public function listForUser(int $tenantId, int $userId): array
    {
        $today = CarbonImmutable::today();
        $window = $this->reminderWindowDays($tenantId);

        $rows = DB::table('vol_qualifications')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->orderByRaw("FIELD(status, 'expired', 'recorded', 'confirmed', 'withdrawn')")
            ->orderByRaw('expires_at IS NULL')
            ->orderBy('expires_at')
            ->orderBy('id')
            ->get()
            ->all();

        $items = $this->serializeMany($tenantId, $rows, $window, $today);

        return [
            'items' => $items,
            'counts' => $this->countsFromItems($items),
            'reminder_window_days' => $window,
            'types' => $this->typesForTenant($tenantId),
        ];
    }

    /**
     * @param array<string, mixed> $input
     * @return array<string, mixed> the serialized qualification
     */
    public function create(int $tenantId, int $userId, array $input): array
    {
        $attributes = $this->validate($tenantId, $input, null);

        $now = now();
        $id = (int) DB::table('vol_qualifications')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'qualification_type' => $attributes['qualification_type'],
            'title' => $attributes['title'],
            'issuer' => $attributes['issuer'],
            'reference_number' => $attributes['reference_number'],
            'obtained_at' => $attributes['obtained_at'],
            'expires_at' => $attributes['expires_at'],
            'status' => VolQualification::STATUS_RECORDED,
            'notes' => $attributes['notes'],
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $this->appendEvent($tenantId, $id, $userId, 'recorded', null, [
            'qualification_type' => $attributes['qualification_type'],
            'expires_at' => $attributes['expires_at'],
        ]);

        return $this->serializeOne($tenantId, $id);
    }

    /**
     * Owner-only edit. A confirmed record loses its confirmation (the
     * confirmer saw the old values); an expired record whose expiry moves into
     * the future returns to `recorded`; a changed expiry clears both reminder
     * stamps so the nightly job speaks again.
     *
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public function update(int $tenantId, int $userId, int $id, array $input): array
    {
        $existing = DB::table('vol_qualifications')
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->where('user_id', $userId)
            ->first();
        if ($existing === null) {
            throw new VolunteerQualificationException('NOT_FOUND', __('api.volunteer_qualification_not_found'), 404);
        }
        if ($existing->status === VolQualification::STATUS_WITHDRAWN) {
            throw new VolunteerQualificationException('WITHDRAWN', __('api.volunteer_qualification_withdrawn'), 409);
        }

        $attributes = $this->validate($tenantId, $input, $existing);

        $changed = [];
        foreach (['qualification_type', 'title', 'issuer', 'reference_number', 'obtained_at', 'expires_at', 'notes'] as $field) {
            $before = $existing->{$field} ?? null;
            $after = $attributes[$field];
            if ((string) ($before ?? '') !== (string) ($after ?? '')) {
                $changed[$field] = ['from' => $before, 'to' => $after];
            }
        }

        if ($changed === []) {
            return $this->serializeOne($tenantId, $id);
        }

        $update = $attributes;
        $update['updated_at'] = now();
        $details = ['changed' => $changed];

        if ($existing->status === VolQualification::STATUS_CONFIRMED) {
            $update['status'] = VolQualification::STATUS_RECORDED;
            $update['confirmed_by'] = null;
            $update['confirmed_at'] = null;
            $update['confirmation_method'] = null;
            $update['confirmed_for_organization_id'] = null;
            $details['confirmation_cleared'] = true;
        }

        if (array_key_exists('expires_at', $changed)) {
            $update['expiry_reminder_sent_at'] = null;
            $update['expired_notice_sent_at'] = null;

            $today = CarbonImmutable::today()->toDateString();
            if ($existing->status === VolQualification::STATUS_EXPIRED
                && ($attributes['expires_at'] === null || $attributes['expires_at'] >= $today)) {
                $update['status'] = VolQualification::STATUS_RECORDED;
                $details['reinstated'] = true;
            }
        }

        DB::table('vol_qualifications')
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->where('user_id', $userId)
            ->update($update);

        $this->appendEvent($tenantId, $id, $userId, 'updated', null, $details);

        return $this->serializeOne($tenantId, $id);
    }

    /**
     * Withdraw a record. The caller has already decided the actor is allowed
     * to (owner, organisation confirmer for that volunteer, or staff).
     *
     * @return array<string, mixed>
     */
    public function withdraw(int $tenantId, int $actorId, int $id, string $reason, ?int $organizationId = null): array
    {
        if (! in_array($reason, VolQualification::WITHDRAWAL_REASONS, true)) {
            throw new VolunteerQualificationException('VALIDATION_ERROR', __('api.volunteer_qualification_invalid_reason'), 422, 'reason', [
                ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_qualification_invalid_reason'), 'field' => 'reason'],
            ]);
        }

        $existing = $this->find($tenantId, $id);
        if ($existing === null) {
            throw new VolunteerQualificationException('NOT_FOUND', __('api.volunteer_qualification_not_found'), 404);
        }
        if ($existing->status === VolQualification::STATUS_WITHDRAWN) {
            throw new VolunteerQualificationException('WITHDRAWN', __('api.volunteer_qualification_withdrawn'), 409);
        }

        DB::table('vol_qualifications')
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->update([
                'status' => VolQualification::STATUS_WITHDRAWN,
                'withdrawn_by' => $actorId,
                'withdrawn_at' => now(),
                'withdrawal_reason' => $reason,
                'updated_at' => now(),
            ]);

        $this->appendEvent($tenantId, $id, $actorId, 'withdrawn', $organizationId, [
            'reason' => $reason,
            'previous_status' => $existing->status,
            'by_owner' => (int) $existing->user_id === $actorId,
        ]);

        return $this->serializeOne($tenantId, $id);
    }

    /**
     * Confirm (or re-check) a record. Authorisation — who may confirm, and
     * that the organisation is one the actor manages and the volunteer is
     * linked to — is the controller's job; this enforces the record rules.
     *
     * @return array<string, mixed>
     */
    public function confirm(int $tenantId, int $actorId, int $id, string $method, ?int $organizationId): array
    {
        if (! in_array($method, VolQualification::CONFIRMATION_METHODS, true)) {
            throw new VolunteerQualificationException('VALIDATION_ERROR', __('api.volunteer_qualification_invalid_method'), 422, 'method', [
                ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_qualification_invalid_method'), 'field' => 'method'],
            ]);
        }

        $existing = $this->find($tenantId, $id);
        if ($existing === null) {
            throw new VolunteerQualificationException('NOT_FOUND', __('api.volunteer_qualification_not_found'), 404);
        }
        if ((int) $existing->user_id === $actorId) {
            throw new VolunteerQualificationException('SELF_CONFIRMATION', __('api.volunteer_qualification_self_confirmation'), 403);
        }
        if ($existing->status === VolQualification::STATUS_WITHDRAWN) {
            throw new VolunteerQualificationException('WITHDRAWN', __('api.volunteer_qualification_withdrawn'), 409);
        }
        if ($existing->status === VolQualification::STATUS_EXPIRED) {
            throw new VolunteerQualificationException('EXPIRED', __('api.volunteer_qualification_expired_cannot_confirm'), 409);
        }

        DB::table('vol_qualifications')
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->update([
                'status' => VolQualification::STATUS_CONFIRMED,
                'confirmed_by' => $actorId,
                'confirmed_at' => now(),
                'confirmation_method' => $method,
                'confirmed_for_organization_id' => $organizationId,
                'updated_at' => now(),
            ]);

        $this->appendEvent($tenantId, $id, $actorId, 'confirmed', $organizationId, [
            'method' => $method,
            'recheck' => $existing->status === VolQualification::STATUS_CONFIRMED,
        ]);

        return $this->serializeOne($tenantId, $id);
    }

    public function find(int $tenantId, int $id): ?object
    {
        return DB::table('vol_qualifications')
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->first();
    }

    // =====================================================================
    // Organisation / staff access helpers
    // =====================================================================

    /**
     * Owner (`vol_organizations.user_id`) or an active owner/admin member of
     * the volunteering organisation. Same rule as
     * VolunteerController::ensureOrgAccess minus its admin-tier bypass, which
     * the controller applies itself.
     */
    public function canManageOrganization(int $tenantId, int $userId, int $orgId): bool
    {
        $org = DB::table('vol_organizations')
            ->where('tenant_id', $tenantId)
            ->where('id', $orgId)
            ->first(['id', 'user_id']);
        if ($org === null) {
            return false;
        }
        if ((int) $org->user_id === $userId) {
            return true;
        }

        return DB::table('org_members')
            ->where('tenant_id', $tenantId)
            ->where('organization_id', $orgId)
            ->where('org_type', 'volunteer')
            ->where('user_id', $userId)
            ->where('status', 'active')
            ->whereIn('role', ['owner', 'admin'])
            ->exists();
    }

    public function organizationExists(int $tenantId, int $orgId): bool
    {
        return DB::table('vol_organizations')
            ->where('tenant_id', $tenantId)
            ->where('id', $orgId)
            ->exists();
    }

    /** @return list<int> organisation ids the user owns or is an owner/admin member of */
    public function organizationsManagedBy(int $tenantId, int $userId): array
    {
        $owned = DB::table('vol_organizations')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->pluck('id');

        $member = DB::table('org_members')
            ->where('tenant_id', $tenantId)
            ->where('org_type', 'volunteer')
            ->where('user_id', $userId)
            ->where('status', 'active')
            ->whereIn('role', ['owner', 'admin'])
            ->pluck('organization_id');

        return array_values(array_unique(array_map('intval', $owned->merge($member)->all())));
    }

    /**
     * Linked = an approved application on one of the organisation's
     * opportunities (the `orgVolunteers` join).
     */
    public function isVolunteerLinkedToOrganization(int $tenantId, int $userId, int $orgId): bool
    {
        return in_array($orgId, $this->organizationsLinkedToVolunteer($tenantId, $userId), true);
    }

    /** @return list<int> */
    public function organizationsLinkedToVolunteer(int $tenantId, int $userId): array
    {
        $ids = DB::table('vol_applications as va')
            ->join('vol_opportunities as vo', function ($join): void {
                $join->on('vo.id', '=', 'va.opportunity_id')
                    ->on('vo.tenant_id', '=', 'va.tenant_id');
            })
            ->where('va.tenant_id', $tenantId)
            ->where('va.user_id', $userId)
            ->where('va.status', 'approved')
            ->whereNotNull('vo.organization_id')
            ->distinct()
            ->pluck('vo.organization_id');

        return array_values(array_map('intval', $ids->all()));
    }

    /**
     * The people who confirm for an organisation: its owner plus active
     * owner/admin members. Each row carries what a notification needs.
     *
     * @return list<object{id: int, email: string|null, preferred_language: string|null}>
     */
    public function organizationConfirmers(int $tenantId, int $orgId): array
    {
        $ownerId = DB::table('vol_organizations')
            ->where('tenant_id', $tenantId)
            ->where('id', $orgId)
            ->value('user_id');

        $memberIds = DB::table('org_members')
            ->where('tenant_id', $tenantId)
            ->where('organization_id', $orgId)
            ->where('org_type', 'volunteer')
            ->where('status', 'active')
            ->whereIn('role', ['owner', 'admin'])
            ->pluck('user_id')
            ->all();

        $ids = array_values(array_unique(array_filter(array_map('intval', array_merge([$ownerId], $memberIds)))));
        if ($ids === []) {
            return [];
        }

        return DB::table('users')
            ->where('tenant_id', $tenantId)
            ->whereIn('id', $ids)
            ->where('status', 'active')
            ->get(['id', 'email', 'preferred_language'])
            ->all();
    }

    // =====================================================================
    // Organisation / staff lists
    // =====================================================================

    /**
     * Qualifications of volunteers linked to the organisation.
     *
     * Ordered: expiring soonest first, then awaiting confirmation, then the
     * rest by expiry date. Cursor is an offset into that ordering.
     *
     * @param array{status?: string|null, q?: string|null, expiring?: bool, cursor?: string|null, per_page?: int} $filters
     * @return array{items: list<array<string, mixed>>, counts: array{expiring: int, recorded: int, confirmed: int, expired: int}, next_cursor: string|null}
     */
    public function listForOrganization(int $tenantId, int $orgId, array $filters): array
    {
        $today = CarbonImmutable::today();
        $window = $this->reminderWindowDays($tenantId);
        $perPage = max(1, min(50, (int) ($filters['per_page'] ?? 20)));
        $offset = max(0, (int) ($filters['cursor'] ?? 0));

        $scope = $this->baseListQuery($tenantId, $today, $window)
            ->whereExists(function ($query) use ($tenantId, $orgId): void {
                $query->selectRaw('1')
                    ->from('vol_applications as va')
                    ->join('vol_opportunities as vo', function ($join): void {
                        $join->on('vo.id', '=', 'va.opportunity_id')
                            ->on('vo.tenant_id', '=', 'va.tenant_id');
                    })
                    ->whereColumn('va.user_id', 'q.user_id')
                    ->where('va.tenant_id', $tenantId)
                    ->where('va.status', 'approved')
                    ->where('vo.organization_id', $orgId);
            });

        $counts = $this->countsForQuery(clone $scope, $today, $window);

        $this->applyListFilters($scope, $filters, $today, $window);
        $this->applyListOrdering($scope, $today, $window);
        $this->applyListSelect($scope);

        $rows = $scope->offset($offset)->limit($perPage + 1)->get()->all();
        $hasMore = count($rows) > $perPage;
        if ($hasMore) {
            array_pop($rows);
        }

        return [
            'items' => $this->serializeMany($tenantId, $rows, $window, $today, true),
            'counts' => $counts,
            'next_cursor' => $hasMore ? (string) ($offset + $perPage) : null,
        ];
    }

    /**
     * Every record in the community, for staff. Page-based.
     *
     * @param array{status?: string|null, q?: string|null, expiring?: bool, type?: string|null, page?: int, per_page?: int} $filters
     * @return array{items: list<array<string, mixed>>, total: int, counts: array{expiring: int, recorded: int, confirmed: int, expired: int}}
     */
    public function listForStaff(int $tenantId, array $filters): array
    {
        $today = CarbonImmutable::today();
        $window = $this->reminderWindowDays($tenantId);
        $perPage = max(1, min(100, (int) ($filters['per_page'] ?? 25)));
        $page = max(1, (int) ($filters['page'] ?? 1));

        $scope = $this->baseListQuery($tenantId, $today, $window);
        $counts = $this->countsForQuery(clone $scope, $today, $window);

        $this->applyListFilters($scope, $filters, $today, $window);
        $total = (int) (clone $scope)->count();

        $this->applyListOrdering($scope, $today, $window);
        $this->applyListSelect($scope);
        $rows = $scope->offset(($page - 1) * $perPage)->limit($perPage)->get()->all();

        return [
            'items' => $this->serializeMany($tenantId, $rows, $window, $today, true),
            'total' => $total,
            'counts' => $counts,
        ];
    }

    /** Scope only — no select list, so a clone can carry an aggregate select for counts. */
    private function baseListQuery(int $tenantId, CarbonImmutable $today, int $window): Builder
    {
        return DB::table('vol_qualifications as q')
            ->join('users as u', function ($join): void {
                $join->on('u.id', '=', 'q.user_id')
                    ->on('u.tenant_id', '=', 'q.tenant_id');
            })
            ->where('q.tenant_id', $tenantId);
    }

    private function applyListSelect(Builder $query): void
    {
        $query->select([
            'q.*',
            'u.name as volunteer_name',
            'u.first_name as volunteer_first_name',
            'u.last_name as volunteer_last_name',
            'u.profile_type as volunteer_profile_type',
            'u.organization_name as volunteer_organization_name',
            'u.avatar_url as volunteer_avatar_url',
        ]);
    }

    /** @param array{status?: string|null, q?: string|null, expiring?: bool, type?: string|null} $filters */
    private function applyListFilters(Builder $query, array $filters, CarbonImmutable $today, int $window): void
    {
        $status = isset($filters['status']) ? trim((string) $filters['status']) : '';
        $expiring = (bool) ($filters['expiring'] ?? false);

        if ($status === 'attention') {
            // Needs attention: awaiting confirmation OR expiring soon.
            $query->where(function (Builder $inner) use ($today, $window): void {
                $inner->where('q.status', VolQualification::STATUS_RECORDED)
                    ->orWhere(function (Builder $exp) use ($today, $window): void {
                        $this->whereExpiring($exp, $today, $window);
                    });
            });
        } elseif ($status !== '' && in_array($status, VolQualification::STATUSES, true)) {
            $query->where('q.status', $status);
        }

        if ($expiring) {
            $this->whereExpiring($query, $today, $window);
        }

        $search = isset($filters['q']) ? trim((string) $filters['q']) : '';
        if ($search !== '') {
            $like = '%' . str_replace(['%', '_'], ['\\%', '\\_'], $search) . '%';
            $query->where(function (Builder $inner) use ($like): void {
                $inner->where('u.name', 'like', $like)
                    ->orWhereRaw("CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) LIKE ?", [$like])
                    ->orWhere('u.organization_name', 'like', $like);
            });
        }

        $type = isset($filters['type']) ? VolunteerCredentialPolicy::normaliseType((string) $filters['type']) : '';
        if ($type !== '') {
            $query->where('q.qualification_type', $type);
        }
    }

    private function whereExpiring(Builder $query, CarbonImmutable $today, int $window): void
    {
        $query->whereIn('q.status', self::ACTIVE_STATUSES)
            ->whereNotNull('q.expires_at')
            ->whereBetween('q.expires_at', [$today->toDateString(), $today->addDays($window)->toDateString()]);
    }

    private function applyListOrdering(Builder $query, CarbonImmutable $today, int $window): void
    {
        $query->orderByRaw(
            "CASE WHEN q.status IN ('recorded', 'confirmed') AND q.expires_at IS NOT NULL AND q.expires_at BETWEEN ? AND ? THEN 0
                  WHEN q.status = 'recorded' THEN 1
                  ELSE 2 END",
            [$today->toDateString(), $today->addDays($window)->toDateString()]
        )
            ->orderByRaw('q.expires_at IS NULL')
            ->orderBy('q.expires_at')
            ->orderBy('q.id');
    }

    /** @return array{expiring: int, recorded: int, confirmed: int, expired: int} */
    private function countsForQuery(Builder $scope, CarbonImmutable $today, int $window): array
    {
        $row = $scope
            ->selectRaw(
                "SUM(CASE WHEN q.status IN ('recorded', 'confirmed') AND q.expires_at IS NOT NULL AND q.expires_at BETWEEN ? AND ? THEN 1 ELSE 0 END) as expiring,
                 SUM(CASE WHEN q.status = 'recorded' THEN 1 ELSE 0 END) as recorded,
                 SUM(CASE WHEN q.status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
                 SUM(CASE WHEN q.status = 'expired' THEN 1 ELSE 0 END) as expired",
                [$today->toDateString(), $today->addDays($window)->toDateString()]
            )
            ->first();

        return [
            'expiring' => (int) ($row->expiring ?? 0),
            'recorded' => (int) ($row->recorded ?? 0),
            'confirmed' => (int) ($row->confirmed ?? 0),
            'expired' => (int) ($row->expired ?? 0),
        ];
    }

    // =====================================================================
    // Serialization
    // =====================================================================

    /** @return array<string, mixed> */
    public function serializeOne(int $tenantId, int $id): array
    {
        $row = $this->find($tenantId, $id);
        if ($row === null) {
            throw new VolunteerQualificationException('NOT_FOUND', __('api.volunteer_qualification_not_found'), 404);
        }

        $items = $this->serializeMany($tenantId, [$row], $this->reminderWindowDays($tenantId), CarbonImmutable::today());

        return $items[0];
    }

    /**
     * @param list<object> $rows
     * @return list<array<string, mixed>>
     */
    public function serializeMany(int $tenantId, array $rows, int $window, CarbonImmutable $today, bool $withVolunteer = false): array
    {
        if ($rows === []) {
            return [];
        }

        $userIds = [];
        $orgIds = [];
        foreach ($rows as $row) {
            if (! empty($row->confirmed_by)) {
                $userIds[] = (int) $row->confirmed_by;
            }
            if (! empty($row->confirmed_for_organization_id)) {
                $orgIds[] = (int) $row->confirmed_for_organization_id;
            }
        }

        $confirmers = [];
        if ($userIds !== []) {
            $confirmers = DB::table('users')
                ->where('tenant_id', $tenantId)
                ->whereIn('id', array_values(array_unique($userIds)))
                ->get(['id', 'name', 'first_name', 'last_name', 'profile_type', 'organization_name'])
                ->keyBy('id')
                ->all();
        }

        $orgs = [];
        if ($orgIds !== []) {
            $orgs = DB::table('vol_organizations')
                ->where('tenant_id', $tenantId)
                ->whereIn('id', array_values(array_unique($orgIds)))
                ->pluck('name', 'id')
                ->all();
        }

        $items = [];
        foreach ($rows as $row) {
            $expiresAt = $this->dateString($row->expires_at ?? null);
            $days = null;
            if ($expiresAt !== null) {
                $days = (int) $today->diffInDays(CarbonImmutable::parse($expiresAt), false);
            }
            $isExpiring = in_array($row->status, self::ACTIVE_STATUSES, true)
                && $days !== null && $days >= 0 && $days <= $window;

            $confirmer = isset($row->confirmed_by) && isset($confirmers[(int) $row->confirmed_by])
                ? $confirmers[(int) $row->confirmed_by]
                : null;
            $orgId = isset($row->confirmed_for_organization_id) ? (int) $row->confirmed_for_organization_id : 0;

            $item = [
                'id' => (int) $row->id,
                'user_id' => (int) $row->user_id,
                'qualification_type' => (string) $row->qualification_type,
                'type_label_key' => 'qualifications.types.' . $row->qualification_type,
                'title' => $row->title ?? null,
                'issuer' => $row->issuer ?? null,
                'reference_number' => $row->reference_number ?? null,
                'obtained_at' => $this->dateString($row->obtained_at ?? null),
                'expires_at' => $expiresAt,
                'status' => (string) $row->status,
                'is_expiring' => $isExpiring,
                'days_until_expiry' => $days,
                'confirmed_by' => $confirmer !== null
                    ? ['id' => (int) $confirmer->id, 'name' => UserDisplayName::resolve($confirmer)]
                    : null,
                'confirmed_at' => $this->dateTimeString($row->confirmed_at ?? null),
                'confirmation_method' => $row->confirmation_method ?? null,
                'confirmed_for_organization' => $orgId > 0 && isset($orgs[$orgId])
                    ? ['id' => $orgId, 'name' => (string) $orgs[$orgId]]
                    : null,
                'withdrawn_at' => $this->dateTimeString($row->withdrawn_at ?? null),
                'withdrawal_reason' => $row->withdrawal_reason ?? null,
                'notes' => $row->notes ?? null,
                'created_at' => $this->dateTimeString($row->created_at ?? null),
                'updated_at' => $this->dateTimeString($row->updated_at ?? null),
            ];

            if ($withVolunteer) {
                $item['volunteer'] = [
                    'id' => (int) $row->user_id,
                    'name' => UserDisplayName::resolvePrefixed($row, 'volunteer_'),
                    'avatar_url' => $row->volunteer_avatar_url ?? null,
                ];
            }

            $items[] = $item;
        }

        return $items;
    }

    /**
     * @param list<array<string, mixed>> $items
     * @return array{confirmed: int, recorded: int, expiring: int, expired: int}
     */
    private function countsFromItems(array $items): array
    {
        $counts = ['confirmed' => 0, 'recorded' => 0, 'expiring' => 0, 'expired' => 0];
        foreach ($items as $item) {
            $status = (string) $item['status'];
            if (isset($counts[$status])) {
                $counts[$status]++;
            }
            if (! empty($item['is_expiring'])) {
                $counts['expiring']++;
            }
        }

        return $counts;
    }

    private function dateString(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        return substr((string) $value, 0, 10);
    }

    private function dateTimeString(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        return CarbonImmutable::parse((string) $value)->toIso8601String();
    }

    // =====================================================================
    // Validation
    // =====================================================================

    /**
     * @param array<string, mixed> $input
     * @return array{qualification_type: string, title: string|null, issuer: string|null, reference_number: string|null, obtained_at: string|null, expires_at: string|null, notes: string|null}
     */
    private function validate(int $tenantId, array $input, ?object $existing): array
    {
        $errors = [];

        $typeInput = array_key_exists('qualification_type', $input) ? $input['qualification_type'] : null;
        if ($typeInput === null && $existing !== null) {
            $type = (string) $existing->qualification_type;
        } else {
            $type = is_scalar($typeInput) ? VolunteerCredentialPolicy::normaliseType((string) $typeInput) : '';
            if ($type === '') {
                $errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_qualification_type_required'), 'field' => 'qualification_type'];
            } elseif (self::isVettingType($type)) {
                throw new VolunteerQualificationException('VETTING_NOT_A_QUALIFICATION', __('api.volunteer_qualification_vetting_refused'), 422, 'qualification_type');
            } elseif (! in_array($type, $this->typeCodesForTenant($tenantId), true)) {
                throw new VolunteerQualificationException('UNSUPPORTED_QUALIFICATION_TYPE', __('api.volunteer_qualification_type_unsupported'), 422, 'qualification_type');
            }
        }

        $strings = [
            'title' => self::MAX_TITLE,
            'issuer' => self::MAX_ISSUER,
            'reference_number' => self::MAX_REFERENCE,
            'notes' => self::MAX_NOTES,
        ];
        $values = [];
        foreach ($strings as $field => $max) {
            if (array_key_exists($field, $input)) {
                $raw = $input[$field];
                if ($raw !== null && ! is_scalar($raw)) {
                    $errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_qualification_invalid_text', ['field' => $field]), 'field' => $field];
                    $values[$field] = null;
                    continue;
                }
                $value = $raw === null ? '' : trim((string) $raw);
                if (mb_strlen($value) > $max) {
                    $errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_qualification_too_long', ['field' => $field, 'max' => $max]), 'field' => $field];
                }
                $values[$field] = $value === '' ? null : $value;
            } else {
                $values[$field] = $existing !== null ? ($existing->{$field} ?? null) : null;
            }
        }

        $dates = [];
        foreach (['obtained_at', 'expires_at'] as $field) {
            if (array_key_exists($field, $input)) {
                $raw = $input[$field];
                if ($raw === null || (is_string($raw) && trim($raw) === '')) {
                    $dates[$field] = null;
                    continue;
                }
                $parsed = is_scalar($raw) ? $this->parseDate((string) $raw) : null;
                if ($parsed === null) {
                    $errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.volunteer_qualification_invalid_date', ['field' => $field]), 'field' => $field];
                }
                $dates[$field] = $parsed;
            } else {
                $dates[$field] = $existing !== null ? $this->dateString($existing->{$field} ?? null) : null;
            }
        }

        if ($errors !== []) {
            throw new VolunteerQualificationException('VALIDATION_ERROR', __('api.volunteer_qualification_validation_failed'), 422, $errors[0]['field'] ?? null, $errors);
        }

        if ($type === 'other' && ($values['title'] === null || $values['title'] === '')) {
            throw new VolunteerQualificationException('TITLE_REQUIRED_FOR_OTHER', __('api.volunteer_qualification_title_required'), 422, 'title');
        }

        if ($dates['obtained_at'] !== null && $dates['expires_at'] !== null && $dates['expires_at'] < $dates['obtained_at']) {
            throw new VolunteerQualificationException('EXPIRY_BEFORE_OBTAINED', __('api.volunteer_qualification_expiry_before_obtained'), 422, 'expires_at');
        }

        return [
            'qualification_type' => $type,
            'title' => $values['title'],
            'issuer' => $values['issuer'],
            'reference_number' => $values['reference_number'],
            'obtained_at' => $dates['obtained_at'],
            'expires_at' => $dates['expires_at'],
            'notes' => $values['notes'],
        ];
    }

    /** Accepts `YYYY-MM-DD` (an ISO datetime's date part is tolerated). */
    private function parseDate(string $value): ?string
    {
        $value = trim($value);
        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/', $value, $m) !== 1) {
            return null;
        }
        if (! checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
            return null;
        }

        return sprintf('%04d-%02d-%02d', (int) $m[1], (int) $m[2], (int) $m[3]);
    }

    // =====================================================================
    // History
    // =====================================================================

    /** @param array<string, mixed>|null $details */
    private function appendEvent(int $tenantId, int $qualificationId, ?int $actorId, string $event, ?int $organizationId, ?array $details): void
    {
        DB::table('vol_qualification_events')->insert([
            'tenant_id' => $tenantId,
            'qualification_id' => $qualificationId,
            'actor_user_id' => $actorId,
            'event' => $event,
            'organization_id' => $organizationId,
            'details' => $details === null ? null : json_encode($details, JSON_UNESCAPED_UNICODE),
            'created_at' => now(),
        ]);
    }

    // =====================================================================
    // Nightly job
    // =====================================================================

    /**
     * Expire what is past its date, then remind once before and once after.
     * Assumes TenantContext is set to `$tenantId` (links and notifications
     * need it). Dry run counts and writes nothing.
     *
     * @return array{expired: int, expired_notices: int, reminders: int, org_digests: int, notifications_enabled: bool}
     */
    public function runExpiry(int $tenantId, bool $dryRun = false, ?CarbonImmutable $today = null): array
    {
        $today ??= CarbonImmutable::today();
        $setting = $this->reminderSetting($tenantId);
        $window = $setting['days'];
        $result = ['expired' => 0, 'expired_notices' => 0, 'reminders' => 0, 'org_digests' => 0, 'notifications_enabled' => $setting['enabled']];

        // 1. Expire.
        $toExpire = DB::table('vol_qualifications')
            ->where('tenant_id', $tenantId)
            ->whereIn('status', self::ACTIVE_STATUSES)
            ->whereNotNull('expires_at')
            ->where('expires_at', '<', $today->toDateString())
            ->get(['id'])
            ->all();
        $result['expired'] = count($toExpire);

        if (! $dryRun && $toExpire !== []) {
            foreach ($toExpire as $row) {
                DB::table('vol_qualifications')
                    ->where('tenant_id', $tenantId)
                    ->where('id', (int) $row->id)
                    ->whereIn('status', self::ACTIVE_STATUSES)
                    ->update(['status' => VolQualification::STATUS_EXPIRED, 'updated_at' => now()]);
                $this->appendEvent($tenantId, (int) $row->id, null, 'expired', null, ['expired_on' => $today->toDateString()]);
            }
        }

        if (! $setting['enabled']) {
            return $result;
        }

        /** @var array<int, array{expired: list<object>, expiring: list<object>}> $byVolunteer */
        $byVolunteer = [];

        // 2. Expired notices (any expired record not yet told about).
        $expiredRows = DB::table('vol_qualifications')
            ->where('tenant_id', $tenantId)
            ->where('status', VolQualification::STATUS_EXPIRED)
            ->whereNull('expired_notice_sent_at')
            ->whereNotNull('expires_at')
            ->orderBy('id')
            ->get()
            ->all();
        if ($dryRun) {
            // Rows that would have been expired above count too.
            $expiredIds = array_map(static fn (object $r): int => (int) $r->id, $toExpire);
            $pending = DB::table('vol_qualifications')
                ->where('tenant_id', $tenantId)
                ->whereIn('id', $expiredIds)
                ->whereNull('expired_notice_sent_at')
                ->get()
                ->all();
            $expiredRows = array_merge($expiredRows, $pending);
        }
        $result['expired_notices'] = count($expiredRows);
        foreach ($expiredRows as $row) {
            $byVolunteer[(int) $row->user_id]['expired'][] = $row;
            $byVolunteer[(int) $row->user_id]['expiring'] ??= [];
        }

        // 3. Expiring soon, not yet reminded.
        $expiringRows = DB::table('vol_qualifications')
            ->where('tenant_id', $tenantId)
            ->whereIn('status', self::ACTIVE_STATUSES)
            ->whereNull('expiry_reminder_sent_at')
            ->whereNotNull('expires_at')
            ->whereBetween('expires_at', [$today->toDateString(), $today->addDays($window)->toDateString()])
            ->orderBy('expires_at')
            ->orderBy('id')
            ->get()
            ->all();
        $result['reminders'] = count($expiringRows);
        foreach ($expiringRows as $row) {
            $byVolunteer[(int) $row->user_id]['expiring'][] = $row;
            $byVolunteer[(int) $row->user_id]['expired'] ??= [];
        }

        if ($byVolunteer === []) {
            return $result;
        }

        /** @var array<int, array{expired: list<array{row: object, volunteer: object}>, expiring: list<array{row: object, volunteer: object}>}> $byOrg */
        $byOrg = [];

        foreach ($byVolunteer as $userId => $groups) {
            $volunteer = DB::table('users')
                ->where('tenant_id', $tenantId)
                ->where('id', $userId)
                ->first(['id', 'email', 'preferred_language', 'name', 'first_name', 'last_name', 'profile_type', 'organization_name', 'status']);
            if ($volunteer === null) {
                continue;
            }
            $volunteerActive = ! in_array((string) ($volunteer->status ?? ''), ['deleted', 'deactivated', 'banned'], true);

            foreach ($groups['expired'] as $row) {
                if (! $dryRun) {
                    $emailSent = $volunteerActive && $this->notifyVolunteer($tenantId, $volunteer, $row, 'expired', $setting['email_enabled']);
                    DB::table('vol_qualifications')
                        ->where('tenant_id', $tenantId)
                        ->where('id', (int) $row->id)
                        ->update(['expired_notice_sent_at' => now(), 'updated_at' => now()]);
                    $this->appendEvent($tenantId, (int) $row->id, null, 'expired_notice_sent', null, [
                        'email' => $this->emailOutcome($setting['email_enabled'], $volunteer, $emailSent),
                    ]);
                }
            }
            foreach ($groups['expiring'] as $row) {
                if (! $dryRun) {
                    $emailSent = $volunteerActive && $this->notifyVolunteer($tenantId, $volunteer, $row, 'expiring', $setting['email_enabled']);
                    DB::table('vol_qualifications')
                        ->where('tenant_id', $tenantId)
                        ->where('id', (int) $row->id)
                        ->update(['expiry_reminder_sent_at' => now(), 'updated_at' => now()]);
                    $this->appendEvent($tenantId, (int) $row->id, null, 'reminder_sent', null, [
                        'email' => $this->emailOutcome($setting['email_enabled'], $volunteer, $emailSent),
                        'days_until_expiry' => (int) $today->diffInDays(CarbonImmutable::parse($this->dateString($row->expires_at) ?? $today->toDateString()), false),
                    ]);
                }
            }

            foreach ($this->organizationsLinkedToVolunteer($tenantId, $userId) as $orgId) {
                foreach ($groups['expired'] as $row) {
                    $byOrg[$orgId]['expired'][] = ['row' => $row, 'volunteer' => $volunteer];
                    $byOrg[$orgId]['expiring'] ??= [];
                }
                foreach ($groups['expiring'] as $row) {
                    $byOrg[$orgId]['expiring'][] = ['row' => $row, 'volunteer' => $volunteer];
                    $byOrg[$orgId]['expired'] ??= [];
                }
            }
        }

        // 4. One digest per confirmer per organisation.
        foreach ($byOrg as $orgId => $groups) {
            $org = DB::table('vol_organizations')
                ->where('tenant_id', $tenantId)
                ->where('id', $orgId)
                ->first(['id', 'name']);
            if ($org === null) {
                continue;
            }
            $confirmers = $this->organizationConfirmers($tenantId, $orgId);
            foreach ($confirmers as $confirmer) {
                $result['org_digests']++;
                if ($dryRun) {
                    continue;
                }
                $this->notifyOrganizationConfirmer($tenantId, $confirmer, $org, $groups, $setting['email_enabled']);
            }
        }

        return $result;
    }

    private function emailOutcome(bool $emailEnabled, object $recipient, bool $sent): string
    {
        if (! $emailEnabled) {
            return 'disabled';
        }
        if (! is_string($recipient->email ?? null) || $recipient->email === '') {
            return 'no_address';
        }

        return $sent ? 'sent' : 'failed';
    }

    /**
     * Bell + (optionally) email to the volunteer, in their own language.
     *
     * @param 'expiring'|'expired' $kind
     * @return bool whether an email was accepted for delivery
     */
    private function notifyVolunteer(int $tenantId, object $volunteer, object $row, string $kind, bool $emailEnabled): bool
    {
        $sent = false;
        LocaleContext::withLocale($volunteer, function () use ($tenantId, $volunteer, $row, $kind, $emailEnabled, &$sent): void {
            $typeLabel = $this->typeLabel($row);
            $date = $this->humanDate($this->dateString($row->expires_at));
            $params = ['type' => $typeLabel, 'date' => $date];

            try {
                Notification::create([
                    'tenant_id' => $tenantId,
                    'user_id' => (int) $volunteer->id,
                    'type' => self::NOTIFICATION_TYPE,
                    'message' => __('emails_volunteer.qualification_bell.' . $kind, $params),
                    'link' => self::MEMBER_LINK,
                    'is_read' => false,
                ]);
            } catch (\Throwable $e) {
                Log::warning('VolunteerQualificationService: bell failed', [
                    'tenant_id' => $tenantId,
                    'user_id' => (int) $volunteer->id,
                    'exception_class' => $e::class,
                ]);
            }

            if (! $emailEnabled || ! is_string($volunteer->email ?? null) || $volunteer->email === '') {
                return;
            }

            $ns = 'emails_volunteer.qualification_' . $kind;
            $safeParams = ['type' => $this->escape($typeLabel), 'date' => $this->escape($date)];
            $html = EmailTemplateBuilder::make()
                ->theme($kind === 'expired' ? 'warning' : 'info')
                ->title(__($ns . '.title'))
                ->previewText(__($ns . '.preview'))
                ->paragraph(__($ns . '.body', $safeParams))
                ->infoCard([
                    __($ns . '.label_type') => $safeParams['type'],
                    __($ns . '.label_expires') => $safeParams['date'],
                ])
                ->button(__($ns . '.cta'), EmailTemplateBuilder::tenantUrl(self::MEMBER_LINK))
                ->render();

            $sent = EmailDispatchService::sendRaw(
                (string) $volunteer->email,
                __($ns . '.subject', $params),
                $html,
                null,
                null,
                null,
                'volunteering',
                ['tenant_id' => $tenantId]
            );
        });

        return $sent;
    }

    /**
     * @param array{expired: list<array{row: object, volunteer: object}>, expiring: list<array{row: object, volunteer: object}>} $groups
     */
    private function notifyOrganizationConfirmer(int $tenantId, object $confirmer, object $org, array $groups, bool $emailEnabled): void
    {
        $orgId = (int) $org->id;
        $orgName = (string) $org->name;
        $link = '/volunteering/org/' . $orgId . '/dashboard?tab=qualifications';
        $number = count($groups['expired']) + count($groups['expiring']);

        LocaleContext::withLocale($confirmer, function () use ($tenantId, $confirmer, $orgName, $link, $number, $groups, $emailEnabled): void {
            try {
                Notification::create([
                    'tenant_id' => $tenantId,
                    'user_id' => (int) $confirmer->id,
                    'type' => self::NOTIFICATION_TYPE,
                    'message' => __('emails_volunteer.qualification_bell.org_attention', ['number' => $number, 'org' => $orgName]),
                    'link' => $link,
                    'is_read' => false,
                ]);
            } catch (\Throwable $e) {
                Log::warning('VolunteerQualificationService: org bell failed', [
                    'tenant_id' => $tenantId,
                    'user_id' => (int) $confirmer->id,
                    'exception_class' => $e::class,
                ]);
            }

            if (! $emailEnabled || ! is_string($confirmer->email ?? null) || $confirmer->email === '') {
                return;
            }

            $ns = 'emails_volunteer.qualification_org_digest';
            $safeOrg = $this->escape($orgName);
            $builder = EmailTemplateBuilder::make()
                ->theme(count($groups['expired']) > 0 ? 'warning' : 'info')
                ->title(__($ns . '.title'))
                ->previewText(__($ns . '.preview'))
                ->paragraph(__($ns . '.intro', ['org' => $safeOrg]));

            foreach (['expired', 'expiring'] as $kind) {
                if ($groups[$kind] === []) {
                    continue;
                }
                $lines = [];
                foreach ($groups[$kind] as $entry) {
                    $lines[] = __($ns . '.row', [
                        'volunteer' => $this->escape(UserDisplayName::resolve($entry['volunteer'])),
                        'type' => $this->escape($this->typeLabel($entry['row'])),
                        'date' => $this->escape($this->humanDate($this->dateString($entry['row']->expires_at))),
                    ]);
                }
                $builder->bulletList($lines, __($ns . '.' . $kind . '_heading'));
            }

            $html = $builder
                ->button(__($ns . '.cta'), EmailTemplateBuilder::tenantUrl($link))
                ->render();

            EmailDispatchService::sendRaw(
                (string) $confirmer->email,
                __($ns . '.subject', ['org' => $orgName]),
                $html,
                null,
                null,
                null,
                'volunteering',
                ['tenant_id' => $tenantId]
            );
        });
    }

    /** Translated type label for emails and bells; "other" uses the volunteer's own title. */
    private function typeLabel(object $row): string
    {
        $code = (string) ($row->qualification_type ?? '');
        $title = trim((string) ($row->title ?? ''));
        if ($code === 'other' && $title !== '') {
            return $title;
        }

        $key = 'emails_volunteer.qualification_types.' . $code;
        $label = __($key);
        if ($label === $key || $label === '') {
            $label = $title !== '' ? $title : ucwords(str_replace('_', ' ', $code));
        }

        return $label;
    }

    private function humanDate(?string $date): string
    {
        if ($date === null) {
            return '';
        }

        try {
            return CarbonImmutable::parse($date)->locale((string) app()->getLocale())->translatedFormat('j F Y');
        } catch (\Throwable) {
            return $date;
        }
    }

    private function escape(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
