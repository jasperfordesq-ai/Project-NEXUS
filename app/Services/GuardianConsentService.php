<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\Notification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * GuardianConsentService
 *
 * Manages guardian/parental consent for minor volunteers.
 * Supports consent requests, granting, withdrawal, checking,
 * admin views, expiry, and minor detection.
 *
 * All queries are tenant-scoped via TenantContext::getId().
 */
class GuardianConsentService
{
    /** Minimum age threshold (users younger than this are minors). */
    private const MINOR_AGE_THRESHOLD = 18;

    public const AGE_MINOR = 'minor';
    public const AGE_ADULT = 'adult';
    public const AGE_UNKNOWN = 'unknown';
    public const AGE_INVALID = 'invalid';
    public const AGE_UNAVAILABLE = 'unavailable';

    /** Valid relationship types for guardians. */
    private const VALID_RELATIONSHIPS = ['parent', 'guardian', 'legal_guardian', 'carer'];

    /** Default consent expiry in days. */
    private const CONSENT_EXPIRY_DAYS = 365;

    public function __construct()
    {
    }

    /**
     * Check if a user is a minor based on date of birth.
     *
     * @param int $userId User ID
     * @return bool
     */
    public static function isMinor(int $userId): bool
    {
        return self::classifyAge($userId) === self::AGE_MINOR;
    }

    /**
     * Classify age for safeguarding without treating unknown input as adult.
     */
    public static function classifyAge(int $userId): string
    {
        try {
            $tenantId = TenantContext::getId();

            $user = DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->select('date_of_birth')
                ->first();

            if (!$user) {
                return self::AGE_UNAVAILABLE;
            }

            $dob = $user->date_of_birth ?? null;

            if (!$dob) {
                return self::AGE_UNKNOWN;
            }

            $birthDate = \DateTimeImmutable::createFromFormat('!Y-m-d', (string) $dob);
            $dateErrors = \DateTimeImmutable::getLastErrors();
            if (!$birthDate
                || ($dateErrors !== false && ($dateErrors['warning_count'] > 0 || $dateErrors['error_count'] > 0))
                || $birthDate->format('Y-m-d') !== (string) $dob) {
                return self::AGE_INVALID;
            }

            $now = new \DateTimeImmutable('today');
            if ($birthDate > $now) {
                return self::AGE_INVALID;
            }

            $age = $now->diff($birthDate)->y;

            return $age < self::MINOR_AGE_THRESHOLD ? self::AGE_MINOR : self::AGE_ADULT;
        } catch (\Throwable $e) {
            Log::warning('[GuardianConsent] age classification failed: ' . $e->getMessage());
            return self::AGE_UNAVAILABLE;
        }
    }

    /**
     * Request guardian consent for a minor.
     *
     * @param int $minorUserId Minor user ID
     * @param array $guardianData Guardian information (guardian_name, guardian_email, relationship)
     * @param int|null $opportunityId Optional opportunity ID
     * @return array Consent record with consent_token
     * @throws \InvalidArgumentException If validation fails
     */
    public static function requestConsent(int $minorUserId, array $guardianData, ?int $opportunityId = null): array
    {
        $tenantId = TenantContext::getId();

        // Validate required fields
        if (empty($guardianData['guardian_name'])) {
            throw new \InvalidArgumentException(__('api.guardian_name_required'));
        }
        if (empty($guardianData['guardian_email'])) {
            throw new \InvalidArgumentException(__('api.guardian_email_required'));
        }
        if (empty($guardianData['relationship'])) {
            throw new \InvalidArgumentException(__('api.guardian_relationship_required'));
        }

        // Validate email
        if (!filter_var($guardianData['guardian_email'], FILTER_VALIDATE_EMAIL)) {
            throw new \InvalidArgumentException(__('api.guardian_email_invalid'));
        }

        // Validate relationship type
        if (!in_array($guardianData['relationship'], self::VALID_RELATIONSHIPS, true)) {
            throw new \InvalidArgumentException(__('api.guardian_relationship_invalid', ['types' => implode(', ', self::VALID_RELATIONSHIPS)]));
        }

        // Validate user is a minor
        if (!self::isMinor($minorUserId)) {
            throw new \InvalidArgumentException(__('api.guardian_consent_not_required'));
        }

        // F-160: the guardian must be someone other than the minor themselves.
        // A minor naming their own account email would self-approve the consent.
        // The events consent path already refuses this; mirror it here. This
        // closes the own-email case; it does NOT prove the address belongs to a
        // real, distinct adult (aliases / a second mailbox remain possible) —
        // that requires a staff-verification step, which is an owner decision.
        $minorEmail = (string) DB::table('users')
            ->where('id', $minorUserId)
            ->where('tenant_id', $tenantId)
            ->value('email');
        if ($minorEmail !== ''
            && strtolower(trim($minorEmail)) === strtolower(trim((string) $guardianData['guardian_email']))
        ) {
            throw new \InvalidArgumentException(__('api.guardian_email_invalid'));
        }

        // Generate consent token
        $consentToken = bin2hex(random_bytes(32));

        // Calculate expiry
        $expiresAt = (new \DateTime())->modify('+' . self::CONSENT_EXPIRY_DAYS . ' days')->format('Y-m-d H:i:s');

        // Insert consent record
        $id = DB::table('vol_guardian_consents')->insertGetId([
            'tenant_id' => $tenantId,
            'minor_user_id' => $minorUserId,
            'guardian_name' => $guardianData['guardian_name'],
            'guardian_email' => $guardianData['guardian_email'],
            'relationship' => $guardianData['relationship'],
            'opportunity_id' => $opportunityId,
            'consent_token' => $consentToken,
            'status' => 'pending',
            'expires_at' => $expiresAt,
            'created_at' => now(),
        ]);

        // Send consent email to guardian — rendered in the minor's preferred language
        // (best available proxy since the guardian has no account / no known locale).
        $verifyUrl = TenantContext::getFrontendUrl()
            . TenantContext::getSlugPrefix()
            . '/volunteering/guardian-consent/verify/' . $consentToken;

        $minorLocale = DB::table('users')
            ->where('id', $minorUserId)
            ->where('tenant_id', $tenantId)
            ->value('preferred_language');

        try {
            LocaleContext::withLocale($minorLocale, function () use ($guardianData, $verifyUrl, $tenantId) {
                $safeName = htmlspecialchars($guardianData['guardian_name'], ENT_QUOTES, 'UTF-8');
                $safeRelationship = htmlspecialchars($guardianData['relationship'], ENT_QUOTES, 'UTF-8');

                $html = EmailTemplateBuilder::make()
                    ->theme('brand')
                    ->title(__('emails_misc.guardian.consent_title'))
                    ->previewText(__('emails_misc.guardian.consent_preview'))
                    ->greeting($safeName)
                    ->paragraph(__('emails_misc.guardian.consent_body'))
                    ->highlight(__('emails_misc.guardian.consent_highlight'), '📋')
                    ->infoCard([
                        __('emails_misc.guardian.info_card_relationship') => $safeRelationship,
                        __('emails_misc.guardian.info_card_expires')      => __('emails_misc.guardian.consent_expires_label', ['days' => self::CONSENT_EXPIRY_DAYS]),
                    ])
                    ->button(__('emails_misc.guardian.consent_cta'), $verifyUrl)
                    ->paragraph(__('emails_misc.guardian.consent_ignore'))
                    ->render();

                if (!EmailDispatchService::sendRaw($guardianData['guardian_email'], __('emails_misc.guardian.consent_subject'), $html, null, null, null, 'guardian_consent', ['tenant_id' => $tenantId])) {
                    Log::warning('GuardianConsentService consent email send returned false');
                }
            });
        } catch (\Throwable $e) {
            Log::warning('Failed to send guardian consent email: ' . $e->getMessage());
            // Don't fail the request — consent record is still created
        }

        // SECURITY: never return the consent_token to the requester. The requester
        // is the MINOR; handing them the token would let them open the public verify
        // page and grant their own guardian consent, defeating the safeguarding gate.
        // The token is delivered only in the email to the guardian's address above.
        return [
            'id' => $id,
            'minor_user_id' => $minorUserId,
            'guardian_name' => $guardianData['guardian_name'],
            'guardian_email' => $guardianData['guardian_email'],
            'relationship' => $guardianData['relationship'],
            'opportunity_id' => $opportunityId,
            'status' => 'pending',
            'expires_at' => $expiresAt,
        ];
    }

    /**
     * Look up a consent request by token WITHOUT mutating it.
     *
     * Backs the public GET verify endpoint, which must stay side-effect-free:
     * the pending → active grant happens only via POST (grantConsent), so a
     * mail scanner prefetching the emailed link can never record legal consent.
     *
     * @param string $token Consent token
     * @return array|null ['status' => string, 'valid' => bool], or null when the token is unknown
     */
    public static function getConsentStatusByToken(string $token): ?array
    {
        $tenantId = TenantContext::getId();

        try {
            $consent = DB::table('vol_guardian_consents')
                ->where('consent_token', $token)
                ->where('tenant_id', $tenantId)
                ->select(['id', 'status', 'expires_at'])
                ->first();

            if (!$consent) {
                return null;
            }

            $expired = $consent->expires_at && strtotime($consent->expires_at) < time();

            return [
                'status' => ($expired && $consent->status === 'pending') ? 'expired' : $consent->status,
                'valid' => $consent->status === 'pending' && !$expired,
            ];
        } catch (\Exception $e) {
            Log::error('GuardianConsentService::getConsentStatusByToken error: ' . $e->getMessage());
            return null;
        }
    }

    /**
     * Grant consent using a consent token.
     *
     * @param string $token Consent token
     * @param string $ip IP address of the granting party
     * @return bool
     */
    public static function grantConsent(string $token, string $ip): bool
    {
        $tenantId = TenantContext::getId();

        try {
            $consent = DB::table('vol_guardian_consents')
                ->where('consent_token', $token)
                ->where('tenant_id', $tenantId)
                ->where('status', 'pending')
                ->first();

            if (!$consent) {
                return false;
            }

            // Check if expired
            if ($consent->expires_at && strtotime($consent->expires_at) < time()) {
                return false;
            }

            DB::table('vol_guardian_consents')
                ->where('id', $consent->id)
                ->update([
                    'status' => 'active',
                    'consent_given_at' => now(),
                    'consent_ip' => $ip,
                ]);

            // Notify the minor that their guardian has granted consent
            try {
                $minorUserId = (int) $consent->minor_user_id;
                $minorLocale = DB::table('users')
                    ->where('id', $minorUserId)
                    ->where('tenant_id', $tenantId)
                    ->value('preferred_language');

                LocaleContext::withLocale($minorLocale, function () use ($tenantId, $minorUserId) {
                    Notification::create([
                        'tenant_id' => $tenantId,
                        'user_id'   => $minorUserId,
                        'type'      => 'guardian_consent',
                        'message'   => __('emails_misc.guardian.consent_granted_minor_bell'),
                        'link'      => '/volunteering',
                        'is_read'   => false,
                    ]);
                });
            } catch (\Throwable $notifErr) {
                Log::warning('GuardianConsentService::grantConsent notification failed', ['error' => $notifErr->getMessage()]);
            }

            return true;
        } catch (\Exception $e) {
            Log::error('GuardianConsentService::grantConsent error: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Withdraw an active consent.
     *
     * Authorization: only the minor themselves, or an admin, may withdraw consent.
     * The guardian email holder uses a separate revocation flow (not user-id-based).
     *
     * @param int $consentId Consent record ID
     * @param int $userId User ID performing the withdrawal
     * @return bool
     */
    public static function withdrawConsent(int $consentId, int $userId): bool
    {
        $tenantId = TenantContext::getId();

        try {
            $consent = DB::table('vol_guardian_consents')
                ->where('id', $consentId)
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->first();

            if (!$consent) {
                return false;
            }

            // Authorization check: only the minor or an admin can withdraw
            $isMinor = (int) $consent->minor_user_id === $userId;
            if (!$isMinor) {
                $user = DB::table('users')
                    ->where('id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->select('role')
                    ->first();
                $isAdmin = $user && in_array($user->role, ['admin', 'tenant_admin', 'super_admin', 'god'], true);
                if (!$isAdmin) {
                    Log::warning('GuardianConsentService::withdrawConsent unauthorized attempt', [
                        'consent_id' => $consentId,
                        'user_id' => $userId,
                        'minor_user_id' => $consent->minor_user_id,
                    ]);
                    return false;
                }
            }

            DB::table('vol_guardian_consents')
                ->where('id', $consentId)
                ->where('tenant_id', $tenantId)
                ->update([
                    'status' => 'withdrawn',
                    'consent_withdrawn_at' => now(),
                ]);

            // The table has no withdrawn_by column — keep an audit trail in the log.
            Log::info('GuardianConsentService::withdrawConsent', [
                'consent_id' => $consentId,
                'withdrawn_by_user_id' => $userId,
                'tenant_id' => $tenantId,
            ]);

            // Notify the minor that consent has been withdrawn — render bell text
            // in the minor's preferred_language since the bell is displayed to them.
            try {
                $minorUserId = (int) $consent->minor_user_id;
                if ($minorUserId) {
                    $minorLocale = DB::table('users')
                        ->where('id', $minorUserId)
                        ->where('tenant_id', $tenantId)
                        ->value('preferred_language');

                    LocaleContext::withLocale($minorLocale, function () use ($tenantId, $minorUserId, $isMinor) {
                        $bellMsg = $isMinor
                            ? __('emails_misc.guardian.consent_withdrawn_minor_bell')
                            : __('emails_misc.guardian.consent_withdrawn_admin_bell');

                        Notification::create([
                            'tenant_id' => $tenantId,
                            'user_id'   => $minorUserId,
                            'type'      => 'guardian_consent',
                            'message'   => $bellMsg,
                            'link'      => '/volunteering',
                            'is_read'   => false,
                        ]);
                    });
                }
            } catch (\Throwable $notifErr) {
                Log::warning('GuardianConsentService::withdrawConsent notification failed', ['error' => $notifErr->getMessage()]);
            }

            return true;
        } catch (\Exception $e) {
            Log::error('GuardianConsentService::withdrawConsent error: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Check if a minor has active consent.
     *
     * @param int $minorUserId Minor user ID
     * @param int|null $opportunityId Optional opportunity ID to check specific consent
     * @return bool
     */
    public static function checkConsent(int $minorUserId, ?int $opportunityId = null): bool
    {
        $tenantId = TenantContext::getId();

        try {
            $query = DB::table('vol_guardian_consents')
                ->where('minor_user_id', $minorUserId)
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->where(function ($q) {
                    $q->whereNull('expires_at')
                        ->orWhere('expires_at', '>', now());
                });

            if ($opportunityId !== null) {
                $query->where(function ($q) use ($opportunityId) {
                    $q->where('opportunity_id', $opportunityId)
                        ->orWhereNull('opportunity_id');
                });
            }

            return $query->exists();
        } catch (\Exception $e) {
            Log::error('GuardianConsentService::checkConsent error: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Get all consent records for a minor.
     *
     * @param int $minorUserId Minor user ID
     * @return array
     */
    public static function getConsentsForMinor(int $minorUserId): array
    {
        $tenantId = TenantContext::getId();

        try {
            // SECURITY: never select consent_token here. The caller is the MINOR;
            // handing them the token would let them open the public verify
            // endpoint and grant their own guardian consent, defeating the
            // safeguarding gate (same deny-list as getConsentsForAdmin below).
            return DB::table('vol_guardian_consents')
                ->where('minor_user_id', $minorUserId)
                ->where('tenant_id', $tenantId)
                ->select([
                    'id',
                    'minor_user_id',
                    'guardian_name',
                    'guardian_email',
                    'guardian_phone',
                    'relationship',
                    'opportunity_id',
                    'status',
                    'consent_given_at',
                    'consent_withdrawn_at',
                    'expires_at',
                    'created_at',
                ])
                ->orderByDesc('created_at')
                ->get()
                ->map(fn ($row) => (array) $row)
                ->toArray();
        } catch (\Exception $e) {
            Log::error('GuardianConsentService::getConsentsForMinor error: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Get consent records for admin view with pagination.
     *
     * @param array $filters Optional filters (status, limit, cursor)
     * @return array Paginated result with items, cursor, has_more
     */
    public static function getConsentsForAdmin(array $filters = []): array
    {
        $tenantId = TenantContext::getId();

        try {
            $limit = min(200, max(1, (int) ($filters['limit'] ?? 20)));
            $cursor = (int) ($filters['cursor'] ?? 0);

            $query = DB::table('vol_guardian_consents as gc')
                ->leftJoin('users as minor', 'gc.minor_user_id', '=', 'minor.id')
                ->leftJoin('vol_opportunities as opp', 'gc.opportunity_id', '=', 'opp.id')
                ->where('gc.tenant_id', $tenantId);

            if (!empty($filters['status'])) {
                $query->where('gc.status', $filters['status']);
            }

            if ($cursor > 0) {
                $query->where('gc.id', '<', $cursor);
            }

            // Never expose consent_token here: it is the secret that grants
            // consent, and an admin must not be able to grant on the
            // guardian's behalf by visiting the verify URL themselves.
            $items = $query->orderByDesc('gc.id')
                ->limit($limit + 1)
                ->select([
                    'gc.id',
                    'gc.minor_user_id',
                    'gc.guardian_name',
                    'gc.guardian_email',
                    'gc.guardian_phone',
                    'gc.relationship',
                    'gc.opportunity_id',
                    'gc.status',
                    'gc.consent_given_at',
                    'gc.consent_withdrawn_at',
                    'gc.expires_at',
                    'gc.created_at',
                    'minor.name as minor_name',
                    'minor.email as minor_email',
                    'opp.title as opportunity_title',
                ])
                ->get()
                ->map(function ($row) {
                    $item = (array) $row;
                    // Field names the admin UI table reads.
                    $item['consent_date'] = $item['consent_given_at'] ?? $item['created_at'];
                    $item['expires_date'] = $item['expires_at'];

                    return $item;
                })
                ->toArray();

            $hasMore = count($items) > $limit;
            if ($hasMore) {
                array_pop($items);
            }

            $nextCursor = !empty($items) ? $items[count($items) - 1]['id'] : null;

            return [
                'items' => $items,
                'cursor' => $nextCursor,
                'has_more' => $hasMore,
            ];
        } catch (\Exception $e) {
            Log::error('GuardianConsentService::getConsentsForAdmin error: ' . $e->getMessage());
            return [
                'items' => [],
                'cursor' => null,
                'has_more' => false,
            ];
        }
    }

    /**
     * Expire pending/active consent records that are past their expires_at.
     *
     * @return int Number of records expired
     */
    public static function expireOldConsents(): int
    {
        // Deliberately NOT tenant-scoped: this is a cron maintenance sweep
        // (CronJobRunner::volunteerExpireConsentsInternal) whose semantics are
        // absolute — any pending consent past its own expires_at is expired,
        // regardless of which tenant the cron worker context points at.
        try {
            // Covers 'active' as well as 'pending': checkConsent() already treats
            // an active consent past expires_at as invalid, so the status must
            // follow — otherwise admins see stale "active" rows and the
            // re-request workflow (status='expired') never surfaces them.
            return DB::table('vol_guardian_consents')
                ->whereIn('status', ['pending', 'active'])
                ->whereNotNull('expires_at')
                ->where('expires_at', '<', now())
                ->update([
                    'status' => 'expired',
                ]);
        } catch (\Exception $e) {
            Log::error('GuardianConsentService::expireOldConsents error: ' . $e->getMessage());
            return 0;
        }
    }
}
