<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\Enterprise;

use App\Core\AudioUploader;
use App\Services\LegacyVettingEvidenceManager;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use App\Services\Enterprise\LoggerService;
use App\Services\Enterprise\MetricsService;
use ZipArchive;

/**
 * GDPR Compliance Service
 *
 * Handles all GDPR-related functionality including data export, deletion,
 * consent management, and audit logging.
 */
class GdprService
{
    private \PDO $db;
    private int $tenantId;
    private LoggerService $logger;
    private MetricsService $metrics;

    public function __construct(?int $tenantId = null)
    {
        $this->db = DB::getPdo();
        $this->tenantId = $tenantId ?? \App\Core\TenantContext::getId();
        $this->logger = LoggerService::getInstance('gdpr');
        $this->metrics = MetricsService::getInstance();
    }

    /**
     * Execute a prepared statement
     */
    private function query(string $sql, array $params = []): \PDOStatement
    {
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        // Default to associative rows. The raw Laravel PDO uses PDO::FETCH_BOTH,
        // which duplicates every column under a numeric key — that bloats the
        // GDPR JSON export and makes generateHtmlExport() choke on int keys.
        // Callers that pass an explicit mode (e.g. FETCH_COLUMN) still override.
        $stmt->setFetchMode(\PDO::FETCH_ASSOC);
        return $stmt;
    }

    /**
     * Get last insert ID
     */
    private function lastInsertId(): int
    {
        return (int) $this->db->lastInsertId();
    }

    // =========================================================================
    // DATA SUBJECT REQUESTS
    // =========================================================================

    /**
     * Create a new GDPR request
     */
    public function createRequest(int $userId, string $type, array $options = []): array
    {
        // Validate request type
        $validTypes = ['access', 'erasure', 'rectification', 'restriction', 'portability', 'objection'];
        if (!in_array($type, $validTypes)) {
            throw new \InvalidArgumentException("Invalid request type: {$type}");
        }

        // Check for existing pending request of same type
        $existing = $this->query(
            "SELECT id FROM gdpr_requests
             WHERE user_id = ? AND request_type = ? AND tenant_id = ?
             AND status IN ('pending', 'processing')",
            [$userId, $type, $this->tenantId]
        )->fetch();

        if ($existing) {
            throw new \RuntimeException("You already have a pending {$type} request.");
        }

        // Generate verification token
        $verificationToken = bin2hex(random_bytes(32));

        // Create request
        $this->query(
            "INSERT INTO gdpr_requests
             (user_id, tenant_id, request_type, status, priority, verification_token, notes, metadata)
             VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)",
            [
                $userId,
                $this->tenantId,
                $type,
                $options['priority'] ?? 'normal',
                $verificationToken,
                $options['notes'] ?? null,
                json_encode($options['metadata'] ?? []),
            ]
        );

        $requestId = (int) $this->lastInsertId();

        // Log the action
        $this->logAction($userId, "{$type}_requested", 'gdpr_request', $requestId);

        // Track metric
        $this->metrics->increment('gdpr.request.created', ['type' => $type]);

        $this->logger->info("GDPR {$type} request created", [
            'request_id' => $requestId,
            'user_id' => $userId,
            'type' => $type,
        ]);

        // Alert tenant admins (bell + push + email) that a member submitted a
        // data-rights request — best-effort: notification wiring must never fail
        // the request itself. Admin-created requests use a different code path
        // (AdminEnterpriseController) and deliberately do not reach here.
        try {
            \App\Events\GdprActionOccurred::dispatch(
                $userId,
                $this->tenantId,
                \App\Events\GdprActionOccurred::ACTION_REQUEST,
                $type,
                null,
                $requestId,
            );
        } catch (\Throwable $e) {
            $this->logger->warning('GDPR request admin-notification dispatch failed', [
                'user_id' => $userId,
                'error'   => $e->getMessage(),
            ]);
        }

        return [
            'id' => $requestId,
            'type' => $type,
            'status' => 'pending',
            'verification_token' => $verificationToken,
        ];
    }

    /**
     * Get request by ID
     */
    public function getRequest(int $requestId): ?array
    {
        return $this->query(
            "SELECT * FROM gdpr_requests WHERE id = ? AND tenant_id = ?",
            [$requestId, $this->tenantId]
        )->fetch() ?: null;
    }

    /**
     * Get pending requests for admin
     */
    public function getPendingRequests(int $limit = 50, int $offset = 0): array
    {
        // LIMIT/OFFSET must be integers in SQL, not bound as string params
        $limit = (int) $limit;
        $offset = (int) $offset;

        return $this->query(
            "SELECT r.*, u.email, u.first_name, u.last_name
             FROM gdpr_requests r
             LEFT JOIN users u ON r.user_id = u.id
             WHERE r.tenant_id = ? AND r.status IN ('pending', 'processing')
             ORDER BY
                CASE r.priority
                    WHEN 'urgent' THEN 1
                    WHEN 'high' THEN 2
                    ELSE 3
                END,
                r.requested_at ASC
             LIMIT {$limit} OFFSET {$offset}",
            [$this->tenantId]
        )->fetchAll();
    }

    /**
     * Get user's requests
     */
    public function getUserRequests(int $userId): array
    {
        return $this->query(
            "SELECT id, request_type, status, requested_at, processed_at,
                    export_file_path, export_expires_at
             FROM gdpr_requests
             WHERE user_id = ? AND tenant_id = ?
             ORDER BY requested_at DESC",
            [$userId, $this->tenantId]
        )->fetchAll();
    }

    /**
     * Process a request (admin action)
     */
    public function processRequest(int $requestId, int $adminId): bool
    {
        $request = $this->getRequest($requestId);
        if (!$request) {
            return false;
        }

        $this->query(
            "UPDATE gdpr_requests SET status = 'processing', acknowledged_at = NOW()
             WHERE id = ? AND tenant_id = ?",
            [$requestId, $this->tenantId]
        );

        $this->logAction($request['user_id'], 'request_processing_started', 'gdpr_request', $requestId, $adminId);

        return true;
    }

    // =========================================================================
    // DATA EXPORT (Article 15 - Right of Access)
    // =========================================================================

    /**
     * Generate data export for a user
     */
    public function generateDataExport(int $userId, int $requestId = null): string
    {
        $this->logger->info("Starting data export", ['user_id' => $userId]);

        // Collect all user data
        $data = $this->collectUserData($userId);

        // Create export directory
        $exportDir = self::getStoragePath("exports/gdpr/{$userId}_" . time());
        if (!is_dir($exportDir)) {
            mkdir($exportDir, 0755, true);
        }

        // Create JSON export
        $jsonPath = "{$exportDir}/data.json";
        file_put_contents($jsonPath, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

        // Create HTML export
        $htmlPath = "{$exportDir}/data.html";
        file_put_contents($htmlPath, self::generateHtmlExport($data));

        // Create README
        $readmePath = "{$exportDir}/README.txt";
        file_put_contents($readmePath, self::generateExportReadme($data));

        // Copy user uploads
        self::copyUserUploads($userId, $exportDir);

        // Create ZIP archive
        $timestamp = date('Ymd_His');
        $zipFilename = "nexus_data_export_{$userId}_{$timestamp}.zip";
        $zipPath = self::getStoragePath("exports/{$zipFilename}");

        self::createZipArchive($exportDir, $zipPath);

        // Cleanup temp directory
        self::deleteDirectory($exportDir);

        // Update request if provided
        $expiresAt = date('Y-m-d H:i:s', strtotime('+7 days'));

        if ($requestId) {
            $this->query(
                "UPDATE gdpr_requests
                 SET status = 'completed', processed_at = NOW(),
                     export_file_path = ?, export_expires_at = ?
                 WHERE id = ? AND tenant_id = ?",
                [$zipPath, $expiresAt, $requestId, $this->tenantId]
            );
        }

        // Log action
        $this->logAction($userId, 'data_exported', 'gdpr_export', null, null, null, [
            'file_size' => filesize($zipPath),
            'expires_at' => $expiresAt,
        ]);

        $this->metrics->increment('gdpr.export.completed');
        $this->metrics->histogram('gdpr.export.file_size', filesize($zipPath));

        $this->logger->info("Data export completed", [
            'user_id' => $userId,
            'file_path' => $zipPath,
            'file_size' => filesize($zipPath),
        ]);

        return $zipPath;
    }

    /**
     * Collect all user data
     *
     * Each section runs in isolation via safeSection(): a drifted/absent table
     * or column in ONE section yields a partial export (that section empty)
     * rather than aborting the entire export. The retention copy is best-effort
     * — one bad table must not lose every other section of the subject's data.
     */
    private function collectUserData(int $userId): array
    {
        return [
            'export_info' => [
                'generated_at' => date('c'),
                'user_id' => $userId,
                'platform' => 'Project NEXUS',
                'format_version' => '1.0',
                'tenant_id' => $this->tenantId,
            ],
            'profile' => $this->safeSection('profile', fn () => $this->getProfileData($userId), null),
            'listings' => $this->safeSection('listings', fn () => $this->getListingsData($userId), []),
            'messages' => $this->safeSection('messages', fn () => $this->getMessagesData($userId), []),
            'transactions' => $this->safeSection('transactions', fn () => $this->getTransactionsData($userId), []),
            'events' => $this->safeSection('events', fn () => $this->getEventsData($userId), []),
            'groups' => $this->safeSection('groups', fn () => $this->getGroupsData($userId), []),
            'volunteering' => $this->safeSection('volunteering', fn () => $this->getVolunteeringData($userId), []),
            'volunteer_detailed' => $this->safeSection('volunteer_detailed', fn () => $this->exportVolunteerData($userId), []),
            'gamification' => $this->safeSection('gamification', fn () => $this->getGamificationData($userId), []),
            'activity_log' => $this->safeSection('activity_log', fn () => $this->getActivityLogData($userId), []),
            'consents' => $this->safeSection('consents', fn () => $this->getConsentsData($userId), []),
            'notifications' => $this->safeSection('notifications', fn () => $this->getNotificationsData($userId), []),
            'connections' => $this->safeSection('connections', fn () => $this->getConnectionsData($userId), []),
            'login_history' => $this->safeSection('login_history', fn () => $this->getLoginHistoryData($userId), []),
            'messaging_restrictions' => $this->safeSection('messaging_restrictions', fn () => $this->getMessagingRestrictionsData($userId), null),
            'ai_chat_history' => $this->safeSection('ai_chat_history', fn () => $this->getAiChatData($userId), []),
            'reviews' => $this->safeSection('reviews', fn () => $this->getReviewsData($userId), []),
            'exchanges' => $this->safeSection('exchanges', fn () => $this->getExchangeData($userId), []),
            'vetting_attestations' => $this->safeSection(
                'vetting_attestations',
                fn () => $this->getVettingAttestationData($userId),
                ['attestations' => [], 'events' => [], 'review_requests' => []],
            ),
            'insurance_certificates' => $this->safeSection('insurance_certificates', fn () => $this->getInsuranceCertificatesData($userId), []),
            'identity_verification' => $this->safeSection('identity_verification', fn () => $this->getIdentityVerificationData($userId), []),
            'safeguarding_preferences' => $this->safeSection('safeguarding_preferences', fn () => $this->getSafeguardingPreferencesData($userId), []),
            'podcasts' => $this->safeSection('podcasts', fn () => $this->getPodcastsData($userId), [
                'shows_owned' => [],
                'episodes_authored' => [],
                'chapters_authored' => [],
                'listens' => [],
                'reactions' => [],
                'subscriptions' => [],
                'reports_filed' => [],
                'moderation_activity' => ['shows' => [], 'episodes' => [], 'reports_reviewed' => []],
            ]),
        ];
    }

    /**
     * Run a single export section in isolation.
     *
     * A producer that throws (drifted column, absent table, etc.) is caught
     * and logged as a breadcrumb; the section's $default is substituted so the
     * overall export still completes. This is the fault-isolation boundary that
     * keeps one schema-drifted table from aborting the whole retention export.
     *
     * @template T
     * @param string        $section Section key, for the log breadcrumb
     * @param callable():T  $fn      Producer for the section payload
     * @param T             $default Value substituted when the producer throws
     * @return T
     */
    private function safeSection(string $section, callable $fn, $default)
    {
        try {
            return $fn();
        } catch (\Throwable $e) {
            $this->logger->warning('GDPR export section skipped', [
                'section'   => $section,
                'tenant_id' => $this->tenantId,
                'error'     => $e->getMessage(),
            ]);
            return $default;
        }
    }

    private function getProfileData(int $userId): ?array
    {
        return $this->query(
            "SELECT id, email, first_name, last_name, phone, bio,
                    skills, interests, location, latitude, longitude,
                    avatar_url, tagline, timezone, preferred_language,
                    created_at, updated_at, last_login, is_verified
             FROM users WHERE id = ? AND tenant_id = ?",
            [$userId, $this->tenantId]
        )->fetch() ?: null;
    }

    private function getListingsData(int $userId): array
    {
        // `time_credits`/`views_count` do not exist in the real `listings`
        // schema — the time value lives in `hours_estimate` and the view tally
        // in `view_count`.
        return $this->query(
            "SELECT id, title, description, type, category_id, subcategory_id,
                    hours_estimate, location, latitude, longitude, status,
                    view_count, created_at, updated_at
             FROM listings WHERE user_id = ? AND tenant_id = ?",
            [$userId, $this->tenantId]
        )->fetchAll();
    }

    private function getMessagesData(int $userId): array
    {
        // The message body column is `body`, not `content`.
        return $this->query(
            "SELECT m.id, m.body AS content, m.created_at, m.read_at,
                    CASE WHEN m.sender_id = ? THEN 'sent' ELSE 'received' END as direction,
                    CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END as other_user_id
             FROM messages m
             WHERE (m.sender_id = ? OR m.receiver_id = ?) AND m.tenant_id = ?
             ORDER BY m.created_at DESC
             LIMIT 1000",
            [$userId, $userId, $userId, $userId, $this->tenantId]
        )->fetchAll();
    }

    private function getTransactionsData(int $userId): array
    {
        // The transactions table keys parties as `sender_id`/`receiver_id`,
        // not `from_user_id`/`to_user_id`.
        return $this->query(
            "SELECT t.id, t.amount, t.description, t.transaction_type,
                    t.status, t.created_at,
                    CASE WHEN t.sender_id = ? THEN 'outgoing' ELSE 'incoming' END as direction
             FROM transactions t
             WHERE (t.sender_id = ? OR t.receiver_id = ?) AND t.tenant_id = ?
             ORDER BY t.created_at DESC",
            [$userId, $userId, $userId, $this->tenantId]
        )->fetchAll();
    }

    private function getEventsData(int $userId): array
    {
        // `events` has no `end_date`; the real timing columns are `start_date`
        // (date) plus `start_time`/`end_time` (datetimes).
        return $this->query(
            "SELECT e.id, e.title, e.description, e.start_date, e.start_time, e.end_time,
                    e.location, er.status as rsvp_status, er.created_at as rsvp_date
             FROM event_rsvps er
             JOIN events e ON er.event_id = e.id
             WHERE er.user_id = ? AND e.tenant_id = ?
             ORDER BY e.start_date DESC",
            [$userId, $this->tenantId]
        )->fetchAll();
    }

    private function getGroupsData(int $userId): array
    {
        return $this->query(
            "SELECT g.id, g.name, g.description, gm.role, gm.joined_at
             FROM group_members gm
             JOIN groups g ON gm.group_id = g.id
             WHERE gm.user_id = ? AND g.tenant_id = ?",
            [$userId, $this->tenantId]
        )->fetchAll();
    }

    private function getVolunteeringData(int $userId): array
    {
        return $this->query(
            "SELECT vo.id, vo.title, va.status, va.created_at as applied_at,
                    vh.hours, CASE WHEN vh.status = 'approved' THEN 1 ELSE 0 END as verified
             FROM vol_applications va
             JOIN vol_opportunities vo ON va.opportunity_id = vo.id
             LEFT JOIN vol_logs vh ON vh.opportunity_id = va.opportunity_id AND vh.user_id = va.user_id
             WHERE va.user_id = ? AND vo.tenant_id = ?",
            [$userId, $this->tenantId]
        )->fetchAll();
    }

    /**
     * Export ALL volunteer-related data for a user (GDPR Article 15 - comprehensive)
     *
     * Queries all volunteer module tables and returns structured data grouped by category.
     * This complements getVolunteeringData() which only covers applications/logs.
     *
     * @param int $userId The user whose volunteer data to export
     * @return array Structured volunteer data grouped by category
     */
    private function exportVolunteerData(int $userId): array
    {
        $t = $this->tenantId;

        // vol_applications
        // vol_applications has no reviewed_by/reviewed_at; the org-side note is
        // stored in `org_note`.
        $applications = $this->query(
            "SELECT va.id, va.opportunity_id, va.shift_id, va.status, va.message,
                    va.org_note, va.created_at, va.updated_at,
                    opp.title as opportunity_title
             FROM vol_applications va
             LEFT JOIN vol_opportunities opp ON va.opportunity_id = opp.id
             WHERE va.user_id = ? AND va.tenant_id = ?
             ORDER BY va.created_at DESC",
            [$userId, $t]
        )->fetchAll();

        // vol_logs (hour logs)
        // vol_logs has no verified_by/verified_at columns (approval is captured
        // by `status`).
        $logs = $this->query(
            "SELECT vl.id, vl.organization_id, vl.opportunity_id, vl.hours, vl.description,
                    vl.date_logged, vl.status, vl.created_at,
                    opp.title as opportunity_title
             FROM vol_logs vl
             LEFT JOIN vol_opportunities opp ON vl.opportunity_id = opp.id
             WHERE vl.user_id = ? AND vl.tenant_id = ?
             ORDER BY vl.date_logged DESC",
            [$userId, $t]
        )->fetchAll();

        // vol_shift_signups
        $shiftSignups = $this->query(
            "SELECT vss.id, vss.shift_id, vss.status, vss.created_at,
                    vs.start_time, vs.end_time
             FROM vol_shift_signups vss
             LEFT JOIN vol_shifts vs ON vss.shift_id = vs.id
             WHERE vss.user_id = ? AND vss.tenant_id = ?
             ORDER BY vss.created_at DESC",
            [$userId, $t]
        )->fetchAll();

        // vol_shift_checkins
        $shiftCheckins = $this->query(
            "SELECT id, shift_id, qr_token, checked_in_at, checked_out_at,
                    status, created_at
             FROM vol_shift_checkins
             WHERE user_id = ? AND tenant_id = ?
             ORDER BY checked_in_at DESC",
            [$userId, $t]
        )->fetchAll();

        // vol_reviews (reviews written by or about the user)
        $reviews = $this->query(
            "SELECT id, reviewer_id, target_type, target_id, rating,
                    comment, created_at,
                    CASE WHEN reviewer_id = ? THEN 'given' ELSE 'received' END as direction
             FROM vol_reviews
             WHERE (reviewer_id = ? OR (target_type = 'user' AND target_id = ?)) AND tenant_id = ?
             ORDER BY created_at DESC",
            [$userId, $userId, $userId, $t]
        )->fetchAll();

        // vol_certificates
        $certificates = $this->query(
            "SELECT id, verification_code, total_hours, date_range_start,
                    date_range_end, organizations, generated_at, downloaded_at
             FROM vol_certificates
             WHERE user_id = ? AND tenant_id = ?
             ORDER BY generated_at DESC",
            [$userId, $t]
        )->fetchAll();

        // vol_mood_checkins
        $moodCheckins = $this->query(
            "SELECT id, mood, note, created_at
             FROM vol_mood_checkins
             WHERE user_id = ? AND tenant_id = ?
             ORDER BY created_at DESC",
            [$userId, $t]
        )->fetchAll();

        // vol_credentials
        $credentials = $this->query(
            "SELECT id, credential_type, file_url, file_name, status,
                    verified_by, verified_at, expires_at, notes, created_at, updated_at
             FROM vol_credentials
             WHERE user_id = ? AND tenant_id = ?
             ORDER BY created_at DESC",
            [$userId, $t]
        )->fetchAll();

        // vol_expenses
        // vol_expenses has no created_at column; submission time is submitted_at.
        $expenses = $this->query(
            "SELECT id, organization_id, opportunity_id, expense_type, amount, currency,
                    description, receipt_path, receipt_filename, status,
                    reviewed_by, review_notes, reviewed_at, paid_at, payment_reference, submitted_at
             FROM vol_expenses
             WHERE user_id = ? AND tenant_id = ?
             ORDER BY submitted_at DESC",
            [$userId, $t]
        )->fetchAll();

        // vol_safeguarding_training
        $safeguardingTraining = $this->query(
            "SELECT id, training_type, training_name, provider, completed_at,
                    expires_at, certificate_url, document_path, status, created_at
             FROM vol_safeguarding_training
             WHERE user_id = ? AND tenant_id = ?
             ORDER BY completed_at DESC",
            [$userId, $t]
        )->fetchAll();

        // vol_guardian_consents (as minor)
        $guardianConsents = $this->query(
            "SELECT id, opportunity_id, guardian_name, guardian_email, relationship,
                    status, consent_given_at, consent_withdrawn_at, expires_at, created_at
             FROM vol_guardian_consents
             WHERE minor_user_id = ? AND tenant_id = ?
             ORDER BY created_at DESC",
            [$userId, $t]
        )->fetchAll();

        // vol_accessibility_needs
        $accessibilityNeeds = $this->query(
            "SELECT id, need_type, description, accommodations_required,
                    emergency_contact_name, emergency_contact_phone, created_at, updated_at
             FROM vol_accessibility_needs
             WHERE user_id = ? AND tenant_id = ?
             ORDER BY created_at DESC",
            [$userId, $t]
        )->fetchAll();

        // vol_safeguarding_incidents (reported by user)
        $safeguardingIncidents = $this->query(
            "SELECT id, opportunity_id, incident_type, severity, description,
                    action_taken, status, resolution_notes, created_at
             FROM vol_safeguarding_incidents
             WHERE reported_by = ? AND tenant_id = ?
             ORDER BY created_at DESC",
            [$userId, $t]
        )->fetchAll();

        // vol_custom_field_values (custom form data submitted by user)
        $customFieldValues = $this->query(
            "SELECT cfv.id, cfv.entity_type, cfv.entity_id, cfv.field_value,
                    cf.field_key, cf.field_label, cf.field_type, cfv.created_at
             FROM vol_custom_field_values cfv
             JOIN vol_custom_fields cf ON cfv.custom_field_id = cf.id
             WHERE cfv.entity_type = 'application'
               AND cfv.entity_id IN (SELECT va.id FROM vol_applications va WHERE va.user_id = ? AND va.tenant_id = ?)
               AND cfv.tenant_id = ?
             ORDER BY cfv.created_at DESC",
            [$userId, $t, $t]
        )->fetchAll();

        // vol_donations — include the gift-aid declaration columns: the stored
        // home address and declaration name are the subject's personal data and
        // an Art. 15 response must disclose them.
        $donations = $this->query(
            "SELECT id, opportunity_id, community_project_id, giving_day_id, amount, currency,
                    payment_method, payment_reference, donor_name, donor_email,
                    message, is_anonymous, status,
                    gift_aid_claim_status, gift_aid_declaration_name,
                    gift_aid_address_line1, gift_aid_address_line2,
                    gift_aid_town, gift_aid_postcode, gift_aid_country,
                    gift_aid_consented_at, gift_aid_claimed_at, created_at
             FROM vol_donations
             WHERE user_id = ? AND tenant_id = ?
             ORDER BY created_at DESC",
            [$userId, $t]
        )->fetchAll();

        // vol_org_transactions — the user's volunteer-payment ledger history
        // (credits minted for approved hours, org-wallet deposits) is their
        // financial data and belongs in the Art. 15 response.
        try {
            $orgTransactions = $this->query(
                "SELECT vot.id, vot.vol_organization_id, vo.name AS organization_name,
                        vot.vol_log_id, vot.type, vot.amount, vot.created_at
                 FROM vol_org_transactions vot
                 LEFT JOIN vol_organizations vo ON vot.vol_organization_id = vo.id AND vo.tenant_id = vot.tenant_id
                 WHERE vot.user_id = ? AND vot.tenant_id = ?
                 ORDER BY vot.created_at DESC",
                [$userId, $t]
            )->fetchAll();
        } catch (\Throwable $e) {
            $orgTransactions = [];
        }

        // vol_safeguarding_incidents where the user is the SUBJECT or an
        // involved party — this is their personal data too. Third-party
        // detail (reporter identity, free-text narrative naming others,
        // resolution notes) is deliberately withheld per Art. 15(4); only
        // the facts about the record's existence and state are disclosed.
        try {
            $subjectIncidents = $this->query(
                "SELECT id, incident_type, category, severity, incident_date, status,
                        authority_notified, resolved_at, created_at,
                        CASE WHEN subject_user_id = ? THEN 'subject' ELSE 'involved' END AS your_role
                 FROM vol_safeguarding_incidents
                 WHERE (subject_user_id = ? OR involved_user_id = ?) AND tenant_id = ?
                 ORDER BY created_at DESC",
                [$userId, $userId, $userId, $t]
            )->fetchAll();
        } catch (\Throwable $e) {
            $subjectIncidents = [];
        }

        // vol_community_projects (proposed by user)
        $communityProjects = $this->query(
            "SELECT id, title, description, category, location, status,
                    proposed_date, created_at
             FROM vol_community_projects
             WHERE proposed_by = ? AND tenant_id = ?
             ORDER BY created_at DESC",
            [$userId, $t]
        )->fetchAll();

        // vol_community_project_supporters — the user's support pledges on
        // community project proposals (free-text message + timestamp).
        try {
            $communityProjectSupport = $this->query(
                "SELECT s.id, s.project_id, cp.title AS project_title,
                        s.message, s.supported_at
                 FROM vol_community_project_supporters s
                 LEFT JOIN vol_community_projects cp ON s.project_id = cp.id AND cp.tenant_id = s.tenant_id
                 WHERE s.user_id = ? AND s.tenant_id = ?
                 ORDER BY s.supported_at DESC",
                [$userId, $t]
            )->fetchAll();
        } catch (\Throwable $e) {
            $communityProjectSupport = [];
        }

        // vol_shift_waitlist (user's waitlist entries)
        try {
            $shiftWaitlist = $this->query(
                "SELECT sw.id, sw.shift_id, sw.position, sw.status,
                        sw.notified_at, sw.promoted_at, sw.created_at,
                        vs.start_time, vs.end_time
                 FROM vol_shift_waitlist sw
                 LEFT JOIN vol_shifts vs ON sw.shift_id = vs.id
                 WHERE sw.user_id = ? AND sw.tenant_id = ?
                 ORDER BY sw.created_at DESC",
                [$userId, $t]
            )->fetchAll();
        } catch (\Throwable $e) {
            $shiftWaitlist = [];
        }

        // vol_shift_swap_requests (user's swap requests as requester or target)
        try {
            $shiftSwapRequests = $this->query(
                "SELECT id, from_user_id, to_user_id, from_shift_id, to_shift_id,
                        status, requires_admin_approval, message, created_at, updated_at,
                        CASE WHEN from_user_id = ? THEN 'outgoing' ELSE 'incoming' END as direction
                 FROM vol_shift_swap_requests
                 WHERE (from_user_id = ? OR to_user_id = ?) AND tenant_id = ?
                 ORDER BY created_at DESC",
                [$userId, $userId, $userId, $t]
            )->fetchAll();
        } catch (\Throwable $e) {
            $shiftSwapRequests = [];
        }

        // vol_shift_group_members (user's group reservation memberships)
        try {
            $shiftGroupMemberships = $this->query(
                "SELECT gm.id, gm.reservation_id, gm.status, gm.created_at,
                        gr.shift_id, gr.group_id, gr.reserved_slots
                 FROM vol_shift_group_members gm
                 LEFT JOIN vol_shift_group_reservations gr ON gm.reservation_id = gr.id
                 WHERE gm.user_id = ? AND gm.tenant_id = ?
                 ORDER BY gm.created_at DESC",
                [$userId, $t]
            )->fetchAll();
        } catch (\Throwable $e) {
            $shiftGroupMemberships = [];
        }

        // vol_shift_group_reservations the user made as group LEADER
        // (reserved_by) — distinct from the memberships above, and carries
        // the leader's free-text notes.
        try {
            $shiftGroupReservationsLed = $this->query(
                "SELECT gr.id, gr.shift_id, gr.group_id, gr.reserved_slots,
                        gr.filled_slots, gr.status, gr.notes, gr.created_at, gr.updated_at,
                        vs.start_time, vs.end_time
                 FROM vol_shift_group_reservations gr
                 LEFT JOIN vol_shifts vs ON gr.shift_id = vs.id
                 WHERE gr.reserved_by = ? AND gr.tenant_id = ?
                 ORDER BY gr.created_at DESC",
                [$userId, $t]
            )->fetchAll();
        } catch (\Throwable $e) {
            $shiftGroupReservationsLed = [];
        }

        // vol_emergency_alert_recipients (emergency alerts sent to user)
        try {
            $emergencyAlertRecipients = $this->query(
                "SELECT ear.id, ear.alert_id, ear.notified_at, ear.response, ear.responded_at,
                        ea.priority, ea.message, ea.shift_id, ea.status as alert_status
                 FROM vol_emergency_alert_recipients ear
                 LEFT JOIN vol_emergency_alerts ea ON ear.alert_id = ea.id
                 WHERE ear.user_id = ? AND ear.tenant_id = ?
                 ORDER BY ear.notified_at DESC",
                [$userId, $t]
            )->fetchAll();
        } catch (\Throwable $e) {
            $emergencyAlertRecipients = [];
        }

        // vol_wellbeing_alerts (burnout alerts about user)
        try {
            $wellbeingAlerts = $this->query(
                "SELECT id, risk_level, risk_score, indicators, coordinator_notified,
                        coordinator_notes, status, resolved_at, created_at, updated_at
                 FROM vol_wellbeing_alerts
                 WHERE user_id = ? AND tenant_id = ?
                 ORDER BY created_at DESC",
                [$userId, $t]
            )->fetchAll();
        } catch (\Throwable $e) {
            $wellbeingAlerts = [];
        }

        return [
            'applications' => $applications,
            'hour_logs' => $logs,
            'shift_signups' => $shiftSignups,
            'shift_checkins' => $shiftCheckins,
            'shift_waitlist' => $shiftWaitlist,
            'shift_swap_requests' => $shiftSwapRequests,
            'shift_group_memberships' => $shiftGroupMemberships,
            'shift_group_reservations_led' => $shiftGroupReservationsLed,
            'reviews' => $reviews,
            'certificates' => $certificates,
            'mood_checkins' => $moodCheckins,
            'credentials' => $credentials,
            'expenses' => $expenses,
            'safeguarding_training' => $safeguardingTraining,
            'guardian_consents' => $guardianConsents,
            'accessibility_needs' => $accessibilityNeeds,
            'safeguarding_incidents' => $safeguardingIncidents,
            'safeguarding_incidents_about_you' => $subjectIncidents,
            'custom_field_values' => $customFieldValues,
            'donations' => $donations,
            'volunteer_payment_ledger' => $orgTransactions,
            'community_projects' => $communityProjects,
            'community_project_support' => $communityProjectSupport,
            'emergency_alert_recipients' => $emergencyAlertRecipients,
            'wellbeing_alerts' => $wellbeingAlerts,
        ];
    }

    private function getGamificationData(int $userId): array
    {
        $badges = $this->query(
            "SELECT b.name, b.description, ub.awarded_at
             FROM user_badges ub
             JOIN badges b ON ub.badge_key = b.badge_key AND ub.tenant_id = b.tenant_id
             WHERE ub.user_id = ? AND ub.tenant_id = ?",
            [$userId, $this->tenantId]
        )->fetchAll();

        $stats = $this->query(
            "SELECT xp AS xp_points, level, login_streak
             FROM users WHERE id = ? AND tenant_id = ?",
            [$userId, $this->tenantId]
        )->fetch();

        return [
            'stats' => $stats,
            'badges' => $badges,
        ];
    }

    private function getActivityLogData(int $userId): array
    {
        return $this->query(
            "SELECT action, entity_type, entity_id, created_at
             FROM activity_log
             WHERE user_id = ? AND tenant_id = ?
             ORDER BY created_at DESC
             LIMIT 500",
            [$userId, $this->tenantId]
        )->fetchAll();
    }

    private function getConsentsData(int $userId): array
    {
        return $this->query(
            "SELECT consent_type, consent_given, consent_version, given_at, withdrawn_at
             FROM user_consents
             WHERE user_id = ? AND tenant_id = ?",
            [$userId, $this->tenantId]
        )->fetchAll();
    }

    private function getNotificationsData(int $userId): array
    {
        return $this->query(
            "SELECT type, title, message, read_at, created_at
             FROM notifications
             WHERE user_id = ? AND tenant_id = ?
             ORDER BY created_at DESC
             LIMIT 200",
            [$userId, $this->tenantId]
        )->fetchAll();
    }

    private function getConnectionsData(int $userId): array
    {
        // Connection table uses requester_id/receiver_id columns
        return $this->query(
            "SELECT u.id, u.first_name, u.last_name, c.created_at
             FROM connections c
             JOIN users u ON (c.requester_id = u.id OR c.receiver_id = u.id) AND u.id != ?
             WHERE (c.requester_id = ? OR c.receiver_id = ?) AND c.tenant_id = ? AND c.status = 'accepted'",
            [$userId, $userId, $userId, $this->tenantId]
        )->fetchAll();
    }

    private function getLoginHistoryData(int $userId): array
    {
        return $this->query(
            "SELECT ip_address, user_agent, created_at
             FROM activity_log
             WHERE user_id = ? AND tenant_id = ? AND action = 'login'
             ORDER BY created_at DESC
             LIMIT 100",
            [$userId, $this->tenantId]
        )->fetchAll();
    }

    private function getMessagingRestrictionsData(int $userId): ?array
    {
        $row = $this->query(
            "SELECT messaging_disabled, under_monitoring, monitoring_reason,
                    monitoring_started_at, monitoring_expires_at, restricted_by, created_at, updated_at
             FROM user_messaging_restrictions
             WHERE user_id = ? AND tenant_id = ?",
            [$userId, $this->tenantId]
        )->fetch();

        return $row ?: null;
    }

    private function getAiChatData(int $userId): array
    {
        try {
            return $this->query(
                "SELECT m.id, m.role, m.content, m.model, m.created_at
                 FROM ai_messages m
                 INNER JOIN ai_conversations c ON c.id = m.conversation_id
                 WHERE c.user_id = ? AND c.tenant_id = ?
                 ORDER BY m.created_at DESC",
                [$userId, $this->tenantId]
            )->fetchAll();
        } catch (\Throwable $e) {
            return []; // Table may not exist
        }
    }

    private function getReviewsData(int $userId): array
    {
        try {
            // `reviews` links to a transaction, not a listing — there is no
            // `listing_id` column.
            return $this->query(
                "SELECT id, reviewer_id, receiver_id, transaction_id, rating, comment, created_at,
                        CASE WHEN reviewer_id = ? THEN 'given' ELSE 'received' END as direction
                 FROM reviews
                 WHERE (reviewer_id = ? OR receiver_id = ?) AND tenant_id = ?
                 ORDER BY created_at DESC",
                [$userId, $userId, $userId, $this->tenantId]
            )->fetchAll();
        } catch (\Throwable $e) {
            $this->logger->warning('getReviewData failed for user ' . $userId . ': ' . $e->getMessage());
            return [];
        }
    }

    private function getExchangeData(int $userId): array
    {
        try {
            return $this->query(
                "SELECT er.id, er.listing_id, er.requester_id, er.provider_id,
                        er.proposed_hours, er.final_hours, er.status,
                        er.requester_notes, er.requester_confirmed_hours,
                        er.provider_confirmed_hours, er.created_at, er.updated_at,
                        l.title as listing_title,
                        CASE WHEN er.requester_id = ? THEN 'requester' ELSE 'provider' END as role
                 FROM exchange_requests er
                 LEFT JOIN listings l ON er.listing_id = l.id
                 WHERE (er.requester_id = ? OR er.provider_id = ?) AND er.tenant_id = ?
                 ORDER BY er.created_at DESC",
                [$userId, $userId, $userId, $this->tenantId]
            )->fetchAll();
        } catch (\Throwable $e) {
            $this->logger->warning('getExchangeData failed for user ' . $userId . ': ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Export podcast data attributable to the data subject without including
     * other members' listening or subscription records for shows they own.
     *
     * @return array<string,mixed>
     */
    private function getPodcastsData(int $userId): array
    {
        return [
            'shows_owned' => $this->query(
                "SELECT * FROM podcast_shows
                  WHERE owner_user_id = ? AND tenant_id = ? ORDER BY created_at DESC",
                [$userId, $this->tenantId]
            )->fetchAll(),
            'episodes_authored' => $this->query(
                "SELECT * FROM podcast_episodes
                  WHERE author_user_id = ? AND tenant_id = ? ORDER BY created_at DESC",
                [$userId, $this->tenantId]
            )->fetchAll(),
            'chapters_authored' => $this->query(
                "SELECT c.* FROM podcast_episode_chapters c
                  INNER JOIN podcast_episodes e ON e.id = c.episode_id AND e.tenant_id = c.tenant_id
                  WHERE e.author_user_id = ? AND c.tenant_id = ?
                  ORDER BY c.episode_id, c.position",
                [$userId, $this->tenantId]
            )->fetchAll(),
            'listens' => $this->query(
                "SELECT * FROM podcast_episode_listens
                  WHERE user_id = ? AND tenant_id = ? ORDER BY id DESC",
                [$userId, $this->tenantId]
            )->fetchAll(),
            'reactions' => $this->query(
                "SELECT * FROM podcast_episode_reactions
                  WHERE user_id = ? AND tenant_id = ? ORDER BY id DESC",
                [$userId, $this->tenantId]
            )->fetchAll(),
            'subscriptions' => $this->query(
                "SELECT * FROM podcast_show_subscriptions
                  WHERE user_id = ? AND tenant_id = ? ORDER BY id DESC",
                [$userId, $this->tenantId]
            )->fetchAll(),
            'reports_filed' => $this->query(
                "SELECT * FROM podcast_episode_reports
                  WHERE reporter_user_id = ? AND tenant_id = ? ORDER BY id DESC",
                [$userId, $this->tenantId]
            )->fetchAll(),
            'moderation_activity' => [
                'shows' => $this->query(
                    "SELECT id, moderation_status, moderated_at FROM podcast_shows
                      WHERE moderated_by = ? AND tenant_id = ? ORDER BY moderated_at DESC",
                    [$userId, $this->tenantId]
                )->fetchAll(),
                'episodes' => $this->query(
                    "SELECT id, show_id, moderation_status, moderated_at FROM podcast_episodes
                      WHERE moderated_by = ? AND tenant_id = ? ORDER BY moderated_at DESC",
                    [$userId, $this->tenantId]
                )->fetchAll(),
                'reports_reviewed' => $this->query(
                    "SELECT id, episode_id, status, reviewed_at FROM podcast_episode_reports
                      WHERE reviewed_by = ? AND tenant_id = ? ORDER BY reviewed_at DESC",
                    [$userId, $this->tenantId]
                )->fetchAll(),
            ],
        ];
    }

    /**
     * Delete a podcast image pointer only when it is a local public upload in
     * the podcasts subtree. Absolute/external URLs are intentionally never
     * fetched; their database pointer is scrubbed by the caller.
     */
    private function deletePodcastPublicAssetPointer(?string $pointer): bool
    {
        $pointer = trim((string) $pointer);
        if ($pointer === '') {
            return true;
        }

        $parts = parse_url($pointer);
        if ($parts === false || isset($parts['scheme']) || isset($parts['host'])) {
            return true;
        }

        $path = rawurldecode((string) ($parts['path'] ?? ''));
        $path = '/' . ltrim(str_replace('\\', '/', $path), '/');
        $segments = array_values(array_filter(explode('/', $path), static fn (string $segment): bool => $segment !== ''));
        if (!str_starts_with($path, '/uploads/')
            || !in_array('podcasts', $segments, true)
            || in_array('..', $segments, true)
            || in_array('.', $segments, true)) {
            return true;
        }

        $uploadsRoot = realpath(public_path('uploads'));
        $candidate = public_path(ltrim($path, '/'));
        if (!is_file($candidate)) {
            return true;
        }

        $resolved = realpath($candidate);
        if ($uploadsRoot === false || $resolved === false
            || !str_starts_with($resolved, rtrim($uploadsRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR)) {
            return false;
        }

        return @unlink($resolved);
    }

    /**
     * Delete one canonical tenant voice recording.
     *
     * Kept behind an instance seam so deletion-failure handling can be tested
     * without depending on platform-specific filesystem permission semantics.
     */
    protected function deleteTenantVoiceRecording(string $url): bool
    {
        return AudioUploader::deleteForTenant($url, $this->tenantId);
    }

    // =========================================================================
    // ACCOUNT DELETION (Article 17 - Right to Erasure)
    // =========================================================================

    /**
     * Execute account deletion
     */
    public function executeAccountDeletion(int $userId, ?int $adminId = null, ?int $requestId = null): void
    {
        $this->logger->info("Starting account deletion", ['user_id' => $userId]);

        // Only manage our own transaction if the caller hasn't already opened
        // one. PHPUnit's DatabaseTransactions trait wraps each test in a
        // transaction on this same PDO, and a raw nested beginTransaction()
        // would throw "There is already an active transaction".
        $ownsTransaction = !$this->db->inTransaction();
        if ($ownsTransaction) {
            $this->db->beginTransaction();
        }

        try {
            // This tenant-scoped users row is the common serialization boundary
            // for account erasure and user-authored writes. Acquire it before
            // generateDataExport() or any other consistent read establishes a
            // REPEATABLE READ snapshot; otherwise an already-authenticated send
            // can commit after the erasure scan and survive a successful delete.
            $lockedUser = $this->query(
                "SELECT id FROM users WHERE id = ? AND tenant_id = ? FOR UPDATE",
                [$userId, $this->tenantId]
            )->fetch();
            if ($lockedUser === false) {
                throw new \RuntimeException('Cannot erase an unknown tenant user.');
            }

            // Tracks whether a CRITICAL PII-erasure step failed. If so we must NOT
            // report the request as completed — PII would survive an Article 17 erasure.
            $criticalErasureFailed = false;

            // 1. Generate final data export for legal retention. Best-effort:
            // a failure here must NOT block the Article 17 erasure (the legal
            // duty outweighs the retention copy), so log and continue rather
            // than aborting the whole deletion.
            try {
                $exportPath = $this->generateDataExport($userId);
            } catch (\Throwable $e) {
                $exportPath = null;
                $this->logger->warning('GDPR pre-deletion export failed; continuing with erasure', [
                    'user_id' => $userId,
                    'error'   => $e->getMessage(),
                ]);
            }

            // 1b. Capture original email BEFORE anonymisation so we can purge
            // email_suppression (platform-wide cache keyed on email address).
            try {
                $originalEmailRow = $this->query(
                    "SELECT email FROM users WHERE id = ? AND tenant_id = ?",
                    [$userId, $this->tenantId]
                )->fetchColumn();
                $originalEmail = $originalEmailRow !== false ? (string) $originalEmailRow : null;
            } catch (\Throwable $e) {
                $originalEmail = null;
            }

            // 2. Anonymize user record
            $anonymizedEmail = "deleted_{$userId}_" . bin2hex(random_bytes(8)) . "@anonymized.local";
            $this->query(
                "UPDATE users SET
                    email = ?,
                    first_name = 'Deleted',
                    last_name = 'User',
                    phone = NULL,
                    bio = NULL,
                    skills = NULL,
                    interests = NULL,
                    location = NULL,
                    latitude = NULL,
                    longitude = NULL,
                    avatar_url = NULL,
                    tagline = NULL,
                    password_hash = '',
                    password = '',
                    remember_token = NULL,
                    status = 'inactive',
                    deleted_at = NOW(),
                    anonymized_at = NOW()
                 WHERE id = ? AND tenant_id = ?",
                [$anonymizedEmail, $userId, $this->tenantId]
            );

            // 3. Delete personal content.
            // Messages: we do NOT hard-delete. Doing so orphans message
            // threads for the *other* participant — they'd see half a
            // conversation with no attribution, breaking their right to
            // retain records of communication they received. Instead we
            // anonymise the sender/receiver side belonging to the erased
            // user and scrub the body where this user authored it. The row
            // stays so the counterparty's audit trail remains intact.
            //
            // Message attachments are private user content. Delete attachments
            // authored by the erased member while preserving any physical file
            // still referenced by another sender. Failed unlinks retain their
            // database pointer so the erasure remains retryable.
            try {
                $attachmentRows = $this->query(
                    "SELECT ma.id, ma.file_path, m.sender_id
                       FROM message_attachments ma
                       JOIN messages m ON m.id = ma.message_id AND m.tenant_id = ma.tenant_id
                      WHERE ma.tenant_id = ?",
                    [$this->tenantId]
                )->fetchAll();
                $pathsInUseByOthers = [];
                foreach ($attachmentRows as $attachmentRow) {
                    if ((int) ($attachmentRow['sender_id'] ?? 0) === $userId) continue;
                    $resolved = \App\Core\MessageAttachmentUploader::resolveForTenant(
                        (string) ($attachmentRow['file_path'] ?? ''),
                        $this->tenantId,
                    );
                    if ($resolved !== null) $pathsInUseByOthers[$resolved] = true;
                }
                foreach ($attachmentRows as $attachmentRow) {
                    if ((int) ($attachmentRow['sender_id'] ?? 0) !== $userId) continue;
                    $attachmentId = (int) ($attachmentRow['id'] ?? 0);
                    $resolved = \App\Core\MessageAttachmentUploader::resolveForTenant(
                        (string) ($attachmentRow['file_path'] ?? ''),
                        $this->tenantId,
                    );
                    $deleted = $resolved === null
                        || isset($pathsInUseByOthers[$resolved])
                        || @unlink($resolved);
                    if ($deleted) {
                        $this->query(
                            'DELETE FROM message_attachments WHERE id = ? AND tenant_id = ?',
                            [$attachmentId, $this->tenantId]
                        );
                    } else {
                        $criticalErasureFailed = true;
                        $this->logger->error('GDPR CRITICAL erasure step failed (message attachment unlink)', [
                            'user_id' => $userId,
                            'attachment_id' => $attachmentId,
                        ]);
                    }
                }
            } catch (\Throwable $e) {
                $criticalErasureFailed = true;
                $this->logger->error('GDPR CRITICAL erasure step failed (message attachments)', [
                    'user_id' => $userId,
                    'error' => $e->getMessage(),
                ]);
            }

            // Voice recordings are biometric-adjacent PII stored on disk under
            // uploads/{tenant}/voice_messages (NOT the per-user uploads dir
            // that step 6 removes). Treat every database pointer as untrusted:
            // compare canonical paths across the tenant so erasing one member
            // cannot unlink a recording still referenced by another sender.
            // Only clear a canonical pointer after successful deletion; a failed
            // unlink must retain its retry linkage and keep the request open.
            try {
                $voiceRows = $this->query(
                    "SELECT id, sender_id, audio_url FROM messages
                      WHERE tenant_id = ? AND audio_url IS NOT NULL",
                    [$this->tenantId]
                )->fetchAll();

                /** @var array<string, list<array{message_id:int, sender_id:int}>> $referencesByPath */
                $referencesByPath = [];
                /** @var array<string, array{url:string, message_ids:list<int>}> $authoredFilesByPath */
                $authoredFilesByPath = [];
                /** @var list<int> $voiceMessageIdsToScrub */
                $voiceMessageIdsToScrub = [];

                foreach ($voiceRows as $voiceRow) {
                    $messageId = (int) ($voiceRow['id'] ?? 0);
                    $senderId = (int) ($voiceRow['sender_id'] ?? 0);
                    $audioUrl = (string) ($voiceRow['audio_url'] ?? '');
                    $canonicalPath = AudioUploader::resolveTenantVoiceFilePath($audioUrl, $this->tenantId);

                    // Invalid, missing, remote, traversal, and cross-tenant
                    // legacy pointers cannot identify a deletable local file.
                    // They are safe to scrub from the erased sender's row.
                    if ($canonicalPath === null) {
                        if ($senderId === $userId && $messageId > 0) {
                            $voiceMessageIdsToScrub[] = $messageId;
                        }
                        continue;
                    }

                    $referencesByPath[$canonicalPath][] = [
                        'message_id' => $messageId,
                        'sender_id' => $senderId,
                    ];

                    if ($senderId !== $userId || $messageId <= 0) {
                        continue;
                    }

                    if (!isset($authoredFilesByPath[$canonicalPath])) {
                        $authoredFilesByPath[$canonicalPath] = [
                            'url' => $audioUrl,
                            'message_ids' => [],
                        ];
                    }
                    $authoredFilesByPath[$canonicalPath]['message_ids'][] = $messageId;
                }

                foreach ($authoredFilesByPath as $canonicalPath => $authoredFile) {
                    $referencingMessageIds = [];
                    foreach ($referencesByPath[$canonicalPath] ?? [] as $reference) {
                        if ($reference['sender_id'] !== $userId) {
                            $referencingMessageIds[] = $reference['message_id'];
                        }
                    }

                    if ($referencingMessageIds !== []) {
                        // The erased sender's pointer may be poisoned or shared.
                        // Remove that pointer, but preserve both the recording and
                        // every other sender's still-valid message linkage.
                        array_push($voiceMessageIdsToScrub, ...$authoredFile['message_ids']);
                        $this->logger->warning('GDPR shared voice recording preserved', [
                            'user_id' => $userId,
                            'message_ids' => $authoredFile['message_ids'],
                            'referencing_message_ids' => $referencingMessageIds,
                        ]);
                        continue;
                    }

                    if ($this->deleteTenantVoiceRecording($authoredFile['url'])) {
                        array_push($voiceMessageIdsToScrub, ...$authoredFile['message_ids']);
                        continue;
                    }

                    $criticalErasureFailed = true;
                    $this->logger->error('GDPR CRITICAL erasure step failed (voice recording unlink)', [
                        'user_id' => $userId,
                        'message_ids' => $authoredFile['message_ids'],
                    ]);
                }

                $voiceMessageIdsToScrub = array_values(array_unique($voiceMessageIdsToScrub));
                if ($voiceMessageIdsToScrub !== []) {
                    $voicePlaceholders = implode(',', array_fill(0, count($voiceMessageIdsToScrub), '?'));
                    $this->query(
                        "UPDATE messages SET audio_url = NULL
                          WHERE sender_id = ? AND tenant_id = ? AND id IN ({$voicePlaceholders})",
                        array_merge([$userId, $this->tenantId], $voiceMessageIdsToScrub)
                    );
                }
            } catch (\Throwable $e) {
                $criticalErasureFailed = true;
                $this->logger->error('GDPR CRITICAL erasure step failed (voice recordings)', [
                    'user_id' => $userId,
                    'error' => $e->getMessage(),
                ]);
            }
            $this->query(
                "UPDATE messages
                    SET body = CASE WHEN sender_id = ? THEN '[message removed — account erased]' ELSE body END,
                        transcript = CASE WHEN sender_id = ? THEN NULL ELSE transcript END
                  WHERE (sender_id = ? OR receiver_id = ?) AND tenant_id = ?",
                [$userId, $userId, $userId, $userId, $this->tenantId]
            );
            $this->query(
                "DELETE FROM notifications WHERE user_id = ? AND tenant_id = ?",
                [$userId, $this->tenantId]
            );
            $this->query(
                "DELETE FROM user_consents WHERE user_id = ? AND tenant_id = ?",
                [$userId, $this->tenantId]
            );
            $this->query("DELETE FROM push_subscriptions WHERE user_id = ?", [$userId]);
            $this->query("DELETE FROM fcm_device_tokens WHERE user_id = ?", [$userId]);

            // 3a. Delete AI chat history (GDPR: user content sent to third-party AI)
            try {
                $convIds = $this->query(
                    "SELECT id FROM ai_conversations WHERE user_id = ? AND tenant_id = ?",
                    [$userId, $this->tenantId]
                )->fetchAll(\PDO::FETCH_COLUMN);
                if (!empty($convIds)) {
                    $placeholders = implode(',', array_fill(0, count($convIds), '?'));
                    $this->query("DELETE FROM ai_messages WHERE conversation_id IN ($placeholders)", $convIds);
                    $this->query(
                        "DELETE FROM ai_conversations WHERE user_id = ? AND tenant_id = ?",
                        [$userId, $this->tenantId]
                    );
                }
            } catch (\Throwable $e) {
                // Table may not exist on all deployments
            }

            // 3b. Delete WebAuthn credentials / passkeys
            try {
                $this->query(
                    "DELETE FROM webauthn_credentials WHERE user_id = ?",
                    [$userId]
                );
            } catch (\Throwable $e) {
                // Table may not exist
            }

            // 3b (continued). Delete the partner-venue member pass. It is a
            // STANDING BEARER CREDENTIAL — venue staff can record a visit from
            // the QR alone, no login — so like passkeys and API tokens it must
            // not survive erasure. Visit HISTORY rows stay (same posture as
            // messages: the row survives, PII resolves through the anonymised
            // users join), but the scannable credential dies here. A missing
            // table means nothing to erase; a failing DELETE on an existing
            // table is critical, exactly like refresh-token sessions.
            try {
                if (\Illuminate\Support\Facades\Schema::hasTable('partner_member_passes')) {
                    $this->query(
                        "DELETE FROM partner_member_passes WHERE user_id = ? AND tenant_id = ?",
                        [$userId, $this->tenantId]
                    );
                }
            } catch (\Throwable $e) {
                $criticalErasureFailed = true;
                $this->logger->error('GDPR CRITICAL erasure step failed (partner venue pass)', [
                    'user_id' => $userId,
                    'error' => $e->getMessage(),
                ]);
            }

            // 3c. Revoke API tokens (Sanctum personal_access_tokens)
            try {
                $this->query(
                    "DELETE FROM personal_access_tokens WHERE tokenable_type = 'App\\\\Models\\\\User' AND tokenable_id = ?",
                    [$userId]
                );
            } catch (\Throwable $e) {
                // Table may not exist
            }

            // 3c (continued). Delete rotating refresh-token families. Unlike
            // the anonymized users row, these session records must not survive
            // Article 17 erasure, and the delete must never cross tenants.
            try {
                $this->query(
                    "DELETE FROM refresh_token_sessions WHERE user_id = ? AND tenant_id = ?",
                    [$userId, $this->tenantId]
                );
            } catch (\Throwable $e) {
                $criticalErasureFailed = true;
                $this->logger->error('GDPR CRITICAL erasure step failed (refresh-token sessions)', [
                    'user_id' => $userId,
                    'error' => $e->getMessage(),
                ]);
            }

            // 3d. Delete cookie consent records
            try {
                $this->query(
                    "DELETE FROM cookie_consents WHERE user_id = ? AND tenant_id = ?",
                    [$userId, $this->tenantId]
                );
            } catch (\Throwable $e) {
                // Table may not exist
            }

            // 3d-bis. Email audit trail + suppression cache: user's email
            // address is PII and must be erased on account deletion.
            // Anonymising rather than deleting keeps tenant-level aggregate
            // metrics (delivery rate, bounce rate) intact while removing the
            // link back to this person.
            try {
                // Unique-per-user anonymized address: a single shared
                // 'deleted@anonymized.local' collapses every erased user into
                // one recipient and corrupts delivery/bounce aggregates.
                $this->query(
                    "UPDATE email_log
                        SET recipient_email = ?,
                            subject = NULL,
                            error = NULL
                      WHERE user_id = ? AND tenant_id = ?",
                    ["deleted_{$userId}@anonymized.local", $userId, $this->tenantId]
                );
            } catch (\Throwable $e) {
                // email_log table may not exist on older deployments
            }
            // Clear the platform-wide suppression cache for this address.
            // We captured the original email at step 1b before anonymisation.
            if (!empty($originalEmail) && strpos($originalEmail, '@anonymized.local') === false) {
                try {
                    $this->query(
                        "DELETE FROM email_suppression WHERE email = ?",
                        [$originalEmail]
                    );
                } catch (\Throwable $e) {
                    // Table may not exist on older deployments
                }
            }

            // 3e. Remove connections (personal relationship data)
            // Connection table uses requester_id/receiver_id columns (not user_id/connected_user_id)
            $this->query(
                "DELETE FROM connections WHERE (requester_id = ? OR receiver_id = ?) AND tenant_id = ?",
                [$userId, $userId, $this->tenantId]
            );

            // 3f. Remove group memberships
            try {
                $this->query(
                    "DELETE FROM group_members WHERE user_id = ? AND tenant_id = ?",
                    [$userId, $this->tenantId]
                );
            } catch (\Throwable $e) {
                // Fallback: group_members may not have tenant_id
                try {
                    $this->query("DELETE FROM group_members WHERE user_id = ?", [$userId]);
                } catch (\Throwable $e2) { $this->logger->warning('GDPR deletion step skipped', ['user_id' => $userId, 'error' => $e2->getMessage()]); }
            }

            // 3g. Remove event RSVPs
            try {
                $this->query(
                    "DELETE FROM event_rsvps WHERE user_id = ?",
                    [$userId]
                );
            } catch (\Throwable $e) { $this->logger->warning('GDPR deletion step skipped', ['user_id' => $userId, 'error' => $e->getMessage()]); }

            // 3h. Anonymize reviews (preserve review content but remove personal link)
            try {
                $this->query(
                    "UPDATE reviews SET reviewer_id = NULL WHERE reviewer_id = ? AND tenant_id = ?",
                    [$userId, $this->tenantId]
                );
            } catch (\Throwable $e) { $this->logger->warning('GDPR deletion step skipped', ['user_id' => $userId, 'error' => $e->getMessage()]); }

            // 3i. Delete TOTP/2FA secrets. The AES-encrypted secret lives in
            // user_totp_settings.totp_secret_encrypted (NOT on the users table), and
            // "remember this device" tokens in user_trusted_devices are PII too.
            // Failure here is CRITICAL — the 2FA secret must not survive erasure.
            try {
                $this->query(
                    "DELETE FROM user_totp_settings WHERE user_id = ? AND tenant_id = ?",
                    [$userId, $this->tenantId]
                );
                $this->query(
                    "DELETE FROM user_trusted_devices WHERE user_id = ? AND tenant_id = ?",
                    [$userId, $this->tenantId]
                );
                $this->query(
                    "UPDATE users SET totp_enabled = 0, totp_setup_required = 1 WHERE id = ? AND tenant_id = ?",
                    [$userId, $this->tenantId]
                );
            } catch (\Throwable $e) {
                $criticalErasureFailed = true;
                $this->logger->error('GDPR CRITICAL erasure step failed (TOTP/2FA secret)', ['user_id' => $userId, 'error' => $e->getMessage()]);
            }

            // 3j. Delete user notification preferences
            try {
                $this->query(
                    "DELETE FROM user_notification_preferences WHERE user_id = ?",
                    [$userId]
                );
            } catch (\Throwable $e) { $this->logger->warning('GDPR deletion step skipped', ['user_id' => $userId, 'error' => $e->getMessage()]); }

            // 3k. Anonymize exchange requests: preserve transaction history/amounts and
            // numeric ratings for audit, but remove the deleted user's free-text personal
            // content. NB: exchange_requests has NO provider_notes column — the old SET
            // list included it, so the whole statement failed and cleared nothing. Clear
            // only the columns that actually exist. Failure here is CRITICAL.
            try {
                $this->query(
                    "UPDATE exchange_requests
                     SET requester_notes = NULL, broker_notes = NULL,
                         requester_feedback = NULL, provider_feedback = NULL,
                         cancellation_reason = NULL, decline_reason = NULL
                     WHERE (requester_id = ? OR provider_id = ?) AND tenant_id = ?",
                    [$userId, $userId, $this->tenantId]
                );
            } catch (\Throwable $e) {
                $criticalErasureFailed = true;
                $this->logger->error('GDPR CRITICAL erasure step failed (exchange notes/feedback)', ['user_id' => $userId, 'error' => $e->getMessage()]);
            }

            // 3l. Delete feed activity entries (user's posts/shares in the feed)
            try {
                $this->query(
                    "DELETE FROM feed_activity WHERE user_id = ? AND tenant_id = ?",
                    [$userId, $this->tenantId]
                );
            } catch (\Throwable $e) { $this->logger->warning('GDPR deletion step skipped', ['user_id' => $userId, 'error' => $e->getMessage()]); }

            // 3m. Delete user blocks (in both directions)
            try {
                $this->query(
                    "DELETE FROM user_blocks WHERE tenant_id = ? AND (user_id = ? OR blocked_user_id = ?)",
                    [$this->tenantId, $userId, $userId]
                );
            } catch (\Throwable $e) { $this->logger->warning('GDPR deletion step skipped', ['user_id' => $userId, 'error' => $e->getMessage()]); }

            // 3n. Anonymize transactions (preserve amounts for audit, remove personal link text)
            // Note: transactions are financial records — we keep them but with anonymized sender/receiver names
            try {
                $this->query(
                    "UPDATE transactions SET deleted_for_sender = 1 WHERE sender_id = ? AND tenant_id = ?",
                    [$userId, $this->tenantId]
                );
                $this->query(
                    "UPDATE transactions SET deleted_for_receiver = 1 WHERE receiver_id = ? AND tenant_id = ?",
                    [$userId, $this->tenantId]
                );
            } catch (\Throwable $e) { $this->logger->warning('GDPR deletion step skipped', ['user_id' => $userId, 'error' => $e->getMessage()]); }

            // 3o. Volunteering — delete sensitive personal records outright
            // (credentials/vetting docs, wellbeing data, accessibility needs incl.
            // emergency contacts, guardian PII, training certs, achievement
            // certificates, future-facing queue entries, reviews authored).
            try {
                // Delete uploaded credential documents (vetting/Garda-disclosure
                // scans, ID PDFs/images) from the 'local' disk BEFORE removing the
                // rows — mirroring the job-CV cleanup in 3q below. file_url is stored
                // as 'private:<path>' by VolunteerCertificateController::uploadCredential;
                // without this, identity-bearing PII files survive erasure (Art. 17).
                $credentials = $this->query(
                    "SELECT id, file_url FROM vol_credentials WHERE user_id = ? AND tenant_id = ?",
                    [$userId, $this->tenantId]
                )->fetchAll();
                $evidenceManager = app(LegacyVettingEvidenceManager::class);
                foreach ($credentials as $credential) {
                    $credentialId = (int) $credential->id;
                    $storedPath = (string) ($credential->file_url ?? '');
                    $deleteStatus = 'missing';
                    try {
                        $deleteStatus = $evidenceManager->deletePrivateCredentialPointer(
                            $storedPath,
                            $this->tenantId,
                        );
                    } catch (\Throwable $e) {
                        $deleteStatus = 'failed';
                    }

                    if (in_array($deleteStatus, ['deleted', 'missing'], true)) {
                        $this->query(
                            "DELETE FROM vol_credentials WHERE id = ? AND user_id = ? AND tenant_id = ?",
                            [$credentialId, $userId, $this->tenantId]
                        );
                        continue;
                    }

                    // Never destroy the only pointer to a file that failed the
                    // narrow, content-blind deletion check. Redact all ordinary
                    // metadata and retain a discoverable tombstone for the DPO
                    // cleanup command instead of creating an orphaned document.
                    $this->query(
                        "UPDATE vol_credentials
                         SET file_name = NULL, status = 'rejected', verified_by = NULL,
                             verified_at = NULL, expires_at = NULL, notes = ?, updated_at = NOW()
                         WHERE id = ? AND user_id = ? AND tenant_id = ?",
                        [LegacyVettingEvidenceManager::GDPR_CLEANUP_PENDING_MARKER, $credentialId, $userId, $this->tenantId]
                    );
                    $this->logger->error('GDPR credential file deletion requires DPO follow-up', [
                        'user_id' => $userId,
                        'credential_id' => $credentialId,
                        'delete_status' => $deleteStatus,
                    ]);
                }
                $this->query("DELETE FROM vol_mood_checkins WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
                $this->query("DELETE FROM vol_wellbeing_alerts WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
                $this->query("DELETE FROM vol_accessibility_needs WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
                $this->query("DELETE FROM vol_guardian_consents WHERE minor_user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
                $this->query("DELETE FROM vol_safeguarding_training WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
                $this->query("DELETE FROM vol_certificates WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
                $this->query("DELETE FROM vol_shift_waitlist WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
                $this->query("DELETE FROM vol_emergency_alert_recipients WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
                // Shift check-in presence PII (place + checked_in/out timestamps).
                // The users-row ON DELETE CASCADE never fires because erasure
                // anonymises the users row in place rather than deleting it, so
                // these rows must be removed explicitly.
                $this->query("DELETE FROM vol_shift_checkins WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
                $this->query("DELETE FROM vol_reviews WHERE reviewer_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
                // Custom form answers attached to the user's applications. The
                // entity_type filter is ESSENTIAL: without it the delete matched
                // ANY custom-field-value row whose entity_id merely collided with
                // one of the user's application ids (opportunity/shift/profile
                // rows share the entity_id space), destroying unrelated data.
                $this->query(
                    "DELETE FROM vol_custom_field_values
                     WHERE tenant_id = ?
                       AND entity_type = 'application'
                       AND entity_id IN (SELECT va.id FROM vol_applications va WHERE va.user_id = ? AND va.tenant_id = ?)",
                    [$this->tenantId, $userId, $this->tenantId]
                );
                // Profile-scoped custom answers key entity_id directly to the user.
                $this->query(
                    "DELETE FROM vol_custom_field_values WHERE tenant_id = ? AND entity_type = 'profile' AND entity_id = ?",
                    [$this->tenantId, $userId]
                );
                // The user's own volunteer-org memberships — the anonymise-in-place
                // users row means the FK cascade never fires.
                $this->query("DELETE FROM org_members WHERE user_id = ? AND tenant_id = ? AND org_type = 'volunteer'", [$userId, $this->tenantId]);
            } catch (\Throwable $e) { $this->logger->warning('GDPR volunteering deletion step skipped', ['user_id' => $userId, 'error' => $e->getMessage()]); }

            // 3p. Volunteering — anonymize records kept for org accounting/audit.
            // Hours and donation amounts stay (they back org wallet ledgers and
            // giving-day totals — same rationale as 3n transactions); free-text
            // content and copied PII are wiped. Identity linkage is broken by
            // the users-row anonymization above.
            try {
                // Donor identity + free-text message are always scrubbed.
                $this->query("UPDATE vol_donations SET donor_name = NULL, donor_email = NULL, message = NULL WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
                // Gift-aid declaration fields (declared name + home address) —
                // LEGAL-BASIS CARVE-OUT (GDPR Art. 17(3)(b), legal obligation):
                // once a Gift Aid claim has been submitted to HMRC the charity
                // must retain the declaration for ~6 years as claim evidence,
                // so declaration fields are RETAINED on claimed rows. That
                // covers claim_status 'claimed' and 'refund_after_claim'
                // (claimed then refunded — the HMRC claim still happened; see
                // StripeDonationService/DonationOperationsService for the
                // status lifecycle: not_eligible → ready → claimed →
                // refund_after_claim). Unclaimed declarations ('not_eligible',
                // 'ready') are scrubbed with the rest of the PII.
                $this->query(
                    "UPDATE vol_donations
                     SET gift_aid_declaration_name = NULL, gift_aid_address_line1 = NULL,
                         gift_aid_address_line2 = NULL, gift_aid_town = NULL, gift_aid_postcode = NULL,
                         gift_aid_country = NULL
                     WHERE user_id = ? AND tenant_id = ?
                       AND gift_aid_claim_status NOT IN ('claimed', 'refund_after_claim')",
                    [$userId, $this->tenantId]
                );
                $this->query("UPDATE vol_applications SET message = NULL, org_note = NULL WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
                $this->query("UPDATE vol_logs SET description = NULL, feedback = NULL WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);

                // Community-project supporter rows are KEPT (deleting them
                // would corrupt vol_community_projects.supporter_count) but the
                // free-text message is scrubbed — the module's documented
                // anonymize-in-place strategy; identity linkage is broken by
                // the users-row anonymization.
                $this->query("UPDATE vol_community_project_supporters SET message = NULL WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);

                // Group shift reservations the user made as group LEADER are
                // group-capacity records (reserved/filled slots for the whole
                // group), not personal records — keep them, scrub the leader's
                // free-text notes.
                $this->query("UPDATE vol_shift_group_reservations SET notes = NULL WHERE reserved_by = ? AND tenant_id = ?", [$userId, $this->tenantId]);

                // Shift swap requests are TWO-PARTY records (same rationale as
                // 3n transactions / 3s marketplace offers): deleting rows where
                // the erased user is only one party would destroy the
                // counterparty's swap history, so rows are retained in both
                // directions and only the requester's free-text message is
                // scrubbed when the erased user authored it (from_user_id).
                // Identity linkage is broken by the users-row anonymization.
                $this->query("UPDATE vol_shift_swap_requests SET message = NULL WHERE from_user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);

                // Expense receipt images carry the volunteer's name, home address
                // and card fragments — delete the files from the 'local' disk
                // before nulling the path columns (mirrors the credential cleanup
                // in 3o). Previously only `description` was wiped, so the files
                // and their paths survived erasure.
                $receiptPaths = $this->query(
                    "SELECT receipt_path FROM vol_expenses WHERE user_id = ? AND tenant_id = ? AND receipt_path IS NOT NULL",
                    [$userId, $this->tenantId]
                )->fetchAll(\PDO::FETCH_COLUMN);
                foreach ($receiptPaths as $storedPath) {
                    $path = preg_replace('/^private:/', '', (string) $storedPath);
                    if ($path === '') { continue; }
                    try {
                        \Illuminate\Support\Facades\Storage::disk('local')->delete($path);
                    } catch (\Throwable $e) {
                        // best-effort file cleanup
                    }
                }
                $this->query("UPDATE vol_expenses SET description = NULL, receipt_path = NULL, receipt_filename = NULL WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);

                // An organisation whose PUBLIC contact email is the erased user's
                // personal email must have it scrubbed — org admins can set a new
                // contact. Only exact-match the pre-anonymisation email.
                if (!empty($originalEmail) && strpos($originalEmail, '@anonymized.local') === false) {
                    $this->query("UPDATE vol_organizations SET contact_email = NULL WHERE tenant_id = ? AND contact_email = ?", [$this->tenantId, $originalEmail]);
                }
            } catch (\Throwable $e) { $this->logger->warning('GDPR volunteering anonymization step skipped', ['user_id' => $userId, 'error' => $e->getMessage()]); }

            // 3q. Job applications — CVs and cover letters are pure applicant
            // PII (career history, contact details). Delete the files from the
            // 'local' storage disk first, then the rows. Covers BOTH historic
            // tables (job_applications.resume_path and the canonical
            // job_vacancy_applications.cv_path — stored under
            // job-applications/{tenant}, NOT the per-user uploads dir).
            try {
                $cvPaths = $this->query(
                    "SELECT cv_path FROM job_vacancy_applications WHERE user_id = ? AND tenant_id = ? AND cv_path IS NOT NULL",
                    [$userId, $this->tenantId]
                )->fetchAll(\PDO::FETCH_COLUMN);
                $resumePaths = $this->query(
                    "SELECT resume_path FROM job_applications WHERE user_id = ? AND tenant_id = ? AND resume_path IS NOT NULL",
                    [$userId, $this->tenantId]
                )->fetchAll(\PDO::FETCH_COLUMN);
                foreach (array_merge($cvPaths, $resumePaths) as $storedPath) {
                    try {
                        \Illuminate\Support\Facades\Storage::disk('local')->delete((string) $storedPath);
                    } catch (\Throwable $e) {
                        // best-effort file cleanup
                    }
                }
                $this->query("DELETE FROM job_vacancy_applications WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
                $this->query("DELETE FROM job_applications WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
            } catch (\Throwable $e) { $this->logger->warning('GDPR job-applications deletion step skipped', ['user_id' => $userId, 'error' => $e->getMessage()]); }

            // 3r. Stories — user-authored ephemeral content (text + media) has
            // no CASCADE FK and survived erasure. Reactions go with them.
            try {
                $this->query(
                    "DELETE FROM story_reactions
                      WHERE tenant_id = ?
                        AND (user_id = ? OR story_id IN (SELECT id FROM stories WHERE user_id = ? AND tenant_id = ?))",
                    [$this->tenantId, $userId, $userId, $this->tenantId]
                );
            } catch (\Throwable $e) { $this->logger->warning('GDPR story-reactions deletion step skipped', ['user_id' => $userId, 'error' => $e->getMessage()]); }
            try {
                $this->query("DELETE FROM stories WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
            } catch (\Throwable $e) { $this->logger->warning('GDPR stories deletion step skipped', ['user_id' => $userId, 'error' => $e->getMessage()]); }

            // 3s. Marketplace — the seller profile holds business identity
            // (name, address JSON, VAT number, Stripe account id): delete it.
            // Orders/offers are two-party transaction records (same rationale
            // as 3n) — keep the rows, scrub this user's free-text and address.
            try {
                $this->query("DELETE FROM marketplace_seller_profiles WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
                $this->query(
                    "UPDATE marketplace_orders SET delivery_notes = NULL, delivery_address = NULL
                      WHERE buyer_id = ? AND tenant_id = ?",
                    [$userId, $this->tenantId]
                );
                $this->query(
                    "UPDATE marketplace_offers SET message = NULL, counter_message = NULL
                      WHERE (buyer_id = ? OR seller_id = ?) AND tenant_id = ?",
                    [$userId, $userId, $this->tenantId]
                );
            } catch (\Throwable $e) { $this->logger->warning('GDPR marketplace scrub step skipped', ['user_id' => $userId, 'error' => $e->getMessage()]); }

            // 3t. Poll votes — opinions linked to the user; no CASCADE FK.
            try {
                $this->query("DELETE FROM poll_votes WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
                $this->query("DELETE FROM poll_rankings WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
            } catch (\Throwable $e) { $this->logger->warning('GDPR poll-votes deletion step skipped', ['user_id' => $userId, 'error' => $e->getMessage()]); }

            // 3u. Goals — personal aspirations + free-text check-in notes.
            try {
                $this->query(
                    "DELETE FROM goal_progress_log
                      WHERE tenant_id = ?
                        AND (created_by = ? OR goal_id IN (SELECT id FROM goals WHERE user_id = ? AND tenant_id = ?))",
                    [$this->tenantId, $userId, $userId, $this->tenantId]
                );
            } catch (\Throwable $e) { /* table optional */ }
            try {
                $this->query("DELETE FROM goal_checkins WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
                $this->query("DELETE FROM goals WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
            } catch (\Throwable $e) { $this->logger->warning('GDPR goals deletion step skipped', ['user_id' => $userId, 'error' => $e->getMessage()]); }

            // 3v. Feed comments — no CASCADE FK (feed_activity is covered in 3l).
            try {
                $this->query("DELETE FROM feed_comments WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
            } catch (\Throwable $e) { $this->logger->warning('GDPR feed-comments deletion step skipped', ['user_id' => $userId, 'error' => $e->getMessage()]); }

            // 3w. Courses — learning history (defensive: schema has no CASCADE
            // FK on these tables; quiz answers can contain free text).
            try {
                $this->query("DELETE FROM course_quiz_attempts WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
                $this->query("DELETE FROM course_reviews WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
                $this->query("DELETE FROM course_enrollments WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
            } catch (\Throwable $e) { $this->logger->warning('GDPR courses deletion step skipped', ['user_id' => $userId, 'error' => $e->getMessage()]); }

            // 3x. Podcasts â€” shows/episodes are creator-owned personal
            // content, while listens, reactions, subscriptions and reports are
            // behavioural data. Remove both the rows and hosted audio. If a
            // storage object cannot be removed, retain a private, archived
            // tombstone containing only its storage pointer so the DPO can
            // retry cleanup; never orphan the only pointer to surviving media.
            if (\Illuminate\Support\Facades\Schema::hasTable('podcast_shows')) {
                try {
                    $showRows = $this->query(
                        "SELECT id, artwork_url FROM podcast_shows WHERE owner_user_id = ? AND tenant_id = ?",
                        [$userId, $this->tenantId]
                    )->fetchAll();
                    $showIds = array_map(static fn (array $row): int => (int) $row['id'], $showRows);
                    $episodeRows = $this->query(
                        "SELECT id, show_id, audio_storage_path, audio_storage_disk, cover_image_url
                           FROM podcast_episodes
                          WHERE tenant_id = ?
                            AND (author_user_id = ? OR show_id IN
                                (SELECT id FROM podcast_shows WHERE owner_user_id = ? AND tenant_id = ?))",
                        [$this->tenantId, $userId, $userId, $this->tenantId]
                    )->fetchAll();
                    $episodeIds = array_map(static fn ($row): int => (int) $row['id'], $episodeRows);
                    $affectedShowIds = array_values(array_unique(array_map(
                        static fn ($row): int => (int) $row['show_id'],
                        $episodeRows
                    )));

                    $mediaDeletionFailed = false;
                    $failedArtworkPointers = [];
                    $failedCoverPointers = [];
                    foreach ($showRows as $showRow) {
                        $artworkPointer = (string) ($showRow['artwork_url'] ?? '');
                        if (!$this->deletePodcastPublicAssetPointer($artworkPointer)) {
                            $mediaDeletionFailed = true;
                            $failedArtworkPointers[(int) $showRow['id']] = $artworkPointer;
                            $this->logger->error('GDPR podcast artwork deletion requires DPO follow-up', [
                                'user_id' => $userId,
                                'show_id' => (int) $showRow['id'],
                            ]);
                        }
                    }
                    foreach ($episodeRows as $episodeRow) {
                        $coverPointer = (string) ($episodeRow['cover_image_url'] ?? '');
                        if (!$this->deletePodcastPublicAssetPointer($coverPointer)) {
                            $mediaDeletionFailed = true;
                            $failedCoverPointers[(int) $episodeRow['id']] = $coverPointer;
                            $this->logger->error('GDPR podcast cover deletion requires DPO follow-up', [
                                'user_id' => $userId,
                                'episode_id' => (int) $episodeRow['id'],
                            ]);
                        }

                        $path = trim((string) ($episodeRow['audio_storage_path'] ?? ''));
                        if ($path === '') {
                            continue;
                        }
                        $disk = trim((string) ($episodeRow['audio_storage_disk'] ?? '')) ?: 'local';
                        try {
                            $storage = \Illuminate\Support\Facades\Storage::disk($disk);
                            if ($storage->exists($path) && !$storage->delete($path)) {
                                $mediaDeletionFailed = true;
                            }
                        } catch (\Throwable $e) {
                            $mediaDeletionFailed = true;
                            $this->logger->error('GDPR podcast media deletion requires DPO follow-up', [
                                'user_id' => $userId,
                                'episode_id' => (int) $episodeRow['id'],
                                'disk' => $disk,
                                'error' => $e->getMessage(),
                            ]);
                        }
                    }

                    // Behavioural and moderation identity links are removed
                    // regardless of the creator-content cleanup outcome.
                    $this->query("DELETE FROM podcast_episode_listens WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
                    $this->query("DELETE FROM podcast_episode_reactions WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
                    $this->query("DELETE FROM podcast_show_subscriptions WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
                    $this->query("DELETE FROM podcast_episode_reports WHERE reporter_user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
                    $this->query("UPDATE podcast_episode_reports SET reviewed_by = NULL WHERE reviewed_by = ? AND tenant_id = ?", [$userId, $this->tenantId]);
                    $this->query("UPDATE podcast_shows SET moderated_by = NULL WHERE moderated_by = ? AND tenant_id = ?", [$userId, $this->tenantId]);
                    $this->query("UPDATE podcast_episodes SET moderated_by = NULL WHERE moderated_by = ? AND tenant_id = ?", [$userId, $this->tenantId]);

                    if ($mediaDeletionFailed) {
                        $criticalErasureFailed = true;
                        $this->query(
                            "UPDATE podcast_shows
                                SET title = CONCAT('erased-podcast-', id), slug = CONCAT('erased-podcast-', id),
                                    summary = NULL, description = NULL, artwork_url = NULL,
                                    author_name = NULL, owner_email = NULL, copyright = NULL, funding_url = NULL,
                                    visibility = 'private', status = 'archived', moderation_status = 'rejected',
                                    moderation_notes = NULL, moderated_by = NULL, moderated_at = NULL,
                                    updated_at = NOW()
                              WHERE owner_user_id = ? AND tenant_id = ?",
                            [$userId, $this->tenantId]
                        );
                        $this->query(
                            "UPDATE podcast_episodes
                                SET title = CONCAT('erased-episode-', id), slug = CONCAT('erased-episode-', id),
                                    summary = NULL, description = NULL, audio_url = CONCAT('podcast-erasure-pending://', id),
                                    transcript = NULL, transcript_language = NULL, cover_image_url = NULL,
                                    visibility = 'private', status = 'archived', moderation_status = 'rejected',
                                    moderation_notes = NULL, moderated_by = NULL, moderated_at = NULL,
                                    updated_at = NOW()
                              WHERE tenant_id = ?
                                AND (author_user_id = ? OR show_id IN
                                    (SELECT id FROM podcast_shows WHERE owner_user_id = ? AND tenant_id = ?))",
                            [$this->tenantId, $userId, $userId, $this->tenantId]
                        );
                        foreach ($failedArtworkPointers as $failedShowId => $failedPointer) {
                            $this->query(
                                "UPDATE podcast_shows SET artwork_url = ? WHERE id = ? AND tenant_id = ?",
                                [$failedPointer, $failedShowId, $this->tenantId]
                            );
                        }
                        foreach ($failedCoverPointers as $failedEpisodeId => $failedPointer) {
                            $this->query(
                                "UPDATE podcast_episodes SET cover_image_url = ? WHERE id = ? AND tenant_id = ?",
                                [$failedPointer, $failedEpisodeId, $this->tenantId]
                            );
                        }
                    } else {
                        if ($episodeIds !== []) {
                            $episodePlaceholders = implode(',', array_fill(0, count($episodeIds), '?'));
                            $episodeParams = array_merge([$this->tenantId], $episodeIds);
                            foreach (['podcast_episode_chapters', 'podcast_episode_listens', 'podcast_episode_reactions', 'podcast_episode_reports'] as $table) {
                                $this->query(
                                    "DELETE FROM {$table} WHERE tenant_id = ? AND episode_id IN ({$episodePlaceholders})",
                                    $episodeParams
                                );
                            }
                            $this->query(
                                "DELETE FROM podcast_episodes WHERE tenant_id = ? AND id IN ({$episodePlaceholders})",
                                $episodeParams
                            );
                        }
                        if ($showIds !== []) {
                            $showPlaceholders = implode(',', array_fill(0, count($showIds), '?'));
                            $showParams = array_merge([$this->tenantId], $showIds);
                            $this->query(
                                "DELETE FROM podcast_show_subscriptions WHERE tenant_id = ? AND show_id IN ({$showPlaceholders})",
                                $showParams
                            );
                            $this->query(
                                "DELETE FROM podcast_shows WHERE tenant_id = ? AND id IN ({$showPlaceholders})",
                                $showParams
                            );
                        }
                        if ($affectedShowIds !== []) {
                            $affectedPlaceholders = implode(',', array_fill(0, count($affectedShowIds), '?'));
                            $this->query(
                                "UPDATE podcast_shows s
                                    SET episode_count = (SELECT COUNT(*) FROM podcast_episodes e
                                                          WHERE e.tenant_id = s.tenant_id AND e.show_id = s.id)
                                  WHERE s.tenant_id = ? AND s.id IN ({$affectedPlaceholders})",
                                array_merge([$this->tenantId], $affectedShowIds)
                            );
                        }
                    }
                } catch (\Throwable $e) {
                    $criticalErasureFailed = true;
                    $this->logger->error('GDPR CRITICAL erasure step failed (podcasts)', [
                        'user_id' => $userId,
                        'error' => $e->getMessage(),
                    ]);
                }
            }

            // 3y. Identity and compliance records. Safeguarding reports remain
            // governed by their separate legal-hold workflow.
            // Metadata-only safeguarding records do not contain certificate
            // evidence, but the anonymized users row means FK cascades do not
            // run. Delete the subject's workflow and decision history directly.
            try {
                $this->query("DELETE FROM safeguarding_vetting_review_requests WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
            } catch (\Throwable $e) { $this->logger->warning('GDPR vetting-review deletion step skipped', ['user_id' => $userId, 'error' => $e->getMessage()]); }
            try {
                $this->query("DELETE FROM member_vetting_attestation_events WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
            } catch (\Throwable $e) { $this->logger->warning('GDPR vetting-event deletion step skipped', ['user_id' => $userId, 'error' => $e->getMessage()]); }
            try {
                $this->query("DELETE FROM member_vetting_attestations WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
            } catch (\Throwable $e) { $this->logger->warning('GDPR vetting-attestation deletion step skipped', ['user_id' => $userId, 'error' => $e->getMessage()]); }

            // Rows without an evidence pointer can be erased immediately.
            // Pointer-bearing rows must remain as minimised cleanup tombstones
            // until the DPO-authorised CLI has removed the local/external object;
            // deleting the pointer first would orphan the most sensitive copy.
            try {
                $this->query(
                    "DELETE FROM vetting_records
                     WHERE user_id = ? AND tenant_id = ?
                       AND (document_url IS NULL OR document_url = '')",
                    [$userId, $this->tenantId]
                );
                $this->query(
                    "UPDATE vetting_records
                     SET reference_number = NULL, issue_date = NULL, expiry_date = NULL,
                         notes = NULL, rejection_reason = NULL, verified_by = NULL,
                         verified_at = NULL, rejected_by = NULL, rejected_at = NULL,
                         works_with_children = 0, works_with_vulnerable_adults = 0,
                         requires_enhanced_check = 0, status = 'revoked', updated_at = NOW()
                     WHERE user_id = ? AND tenant_id = ?
                       AND document_url IS NOT NULL AND document_url <> ''",
                    [$userId, $this->tenantId]
                );
            } catch (\Throwable $e) { $this->logger->warning('GDPR legacy-vetting deletion step skipped', ['user_id' => $userId, 'error' => $e->getMessage()]); }

            try {
                $docRoot = function_exists('public_path') ? rtrim(public_path(), '/\\') : '';

                // Insurance certificates live in a per-user directory.
                $insuranceDir = $docRoot . "/uploads/insurance/{$this->tenantId}/{$userId}";
                if ($docRoot !== '' && is_dir($insuranceDir)) {
                    self::deleteDirectory($insuranceDir);
                }
                $this->query("DELETE FROM insurance_certificates WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);

                $this->query("DELETE FROM identity_verification_sessions WHERE user_id = ? AND tenant_id = ?", [$userId, $this->tenantId]);
            } catch (\Throwable $e) { $this->logger->warning('GDPR compliance-records deletion step skipped', ['user_id' => $userId, 'error' => $e->getMessage()]); }

            // 4. Soft delete listings
            $this->query(
                "UPDATE listings SET status = 'deleted', description = '[DELETED]', deleted_at = NOW()
                 WHERE user_id = ? AND tenant_id = ?",
                [$userId, $this->tenantId]
            );

            // 5. Anonymize activity logs
            $this->query(
                "UPDATE activity_log SET ip_address = NULL, user_agent = NULL
                 WHERE user_id = ? AND tenant_id = ?",
                [$userId, $this->tenantId]
            );

            // 6. Delete uploaded files
            self::deleteUserUploads($userId);

            // 7. Invalidate all sessions
            $this->query("DELETE FROM sessions WHERE user_id = ?", [$userId]);

            // 8. Update request if provided. Guard: never report the erasure request as
            // "completed" if a critical PII step failed — leave it "processing" so an
            // admin sees it needs a retry rather than a false success.
            if ($requestId) {
                if ($criticalErasureFailed) {
                    $this->query(
                        "UPDATE gdpr_requests SET status = 'processing', updated_at = NOW()
                         WHERE id = ? AND tenant_id = ?",
                        [$requestId, $this->tenantId]
                    );
                    $this->logger->error('GDPR erasure finished with a critical failure; request left as processing for retry', [
                        'user_id' => $userId, 'request_id' => $requestId,
                    ]);
                } else {
                    $this->query(
                        "UPDATE gdpr_requests
                         SET status = 'completed', processed_at = NOW(), processed_by = ?
                         WHERE id = ? AND tenant_id = ?",
                        [$adminId, $requestId, $this->tenantId]
                    );
                }
            }

            if ($ownsTransaction) {
                $this->db->commit();
            }

            // 9. GDPR: retract federated profile from all partner networks (queued, non-blocking)
            try {
                \App\Events\UserFederatedOptOut::dispatch($userId, $this->tenantId, 'account_deleted');
            } catch (\Throwable $e) {
                $this->logger->warning('GDPR federation retraction dispatch failed', [
                    'user_id' => $userId,
                    'error'   => $e->getMessage(),
                ]);
            }

            // Original step 9 follows (renumbered). Remove from Meilisearch index (outside transaction — external service)
            try {
                $meiliClient = new \Meilisearch\Client(
                    env('MEILISEARCH_HOST', 'http://meilisearch:7700'),
                    env('MEILISEARCH_KEY') ?: null,
                );
                $meiliClient->index('users')->deleteDocument($userId);

                // Also remove user's listings from the search index
                $listingIds = $this->query(
                    "SELECT id FROM listings WHERE user_id = ? AND tenant_id = ?",
                    [$userId, $this->tenantId]
                )->fetchAll(\PDO::FETCH_COLUMN);

                foreach ($listingIds as $listingId) {
                    try {
                        $meiliClient->index('listings')->deleteDocument($listingId);
                    } catch (\Throwable $e) { $this->logger->warning('GDPR Meilisearch listing deletion skipped', ['listing_id' => $listingId, 'error' => $e->getMessage()]); }
                }
            } catch (\Throwable $e) {
                $this->logger->warning("Meilisearch cleanup failed during account deletion", [
                    'user_id' => $userId,
                    'error' => $e->getMessage(),
                ]);
            }

            // 10. Purge Redis cache for this user
            try {
                $redis = \Illuminate\Support\Facades\Cache::getStore();
                if (method_exists($redis, 'forget')) {
                    \Illuminate\Support\Facades\Cache::forget("user:{$userId}");
                    \Illuminate\Support\Facades\Cache::forget("user_profile:{$userId}");
                    \Illuminate\Support\Facades\Cache::forget("user_presence:{$userId}");
                }
            } catch (\Throwable $e) {
                // Cache purge is best-effort
            }

            // Log action
            $this->logAction($userId, 'account_deleted', null, null, $adminId, null, [
                'export_path' => $exportPath,
            ]);

            $this->metrics->increment('gdpr.deletion.completed');

            $this->logger->info("Account deletion completed", ['user_id' => $userId]);
        } catch (\Exception $e) {
            if ($ownsTransaction && $this->db->inTransaction()) {
                $this->db->rollBack();
            }
            $this->logger->error("Account deletion failed", [
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
            throw $e;
        }
    }

    // =========================================================================
    // EXPIRED EXPORT CLEANUP (Data Minimization)
    // =========================================================================

    /**
     * Delete expired GDPR export files from disk.
     *
     * Exports are set to expire after 7 days (see generateDataExport).
     * This method should be called periodically (e.g. daily cron) to enforce
     * data minimization — GDPR Article 5(1)(e) storage limitation.
     *
     * @return int Number of expired exports cleaned up
     */
    public function cleanupExpiredExports(): int
    {
        $expired = $this->query(
            "SELECT id, export_file_path FROM gdpr_requests
             WHERE export_file_path IS NOT NULL
             AND export_expires_at IS NOT NULL
             AND export_expires_at < NOW()
             AND status = 'completed'"
        )->fetchAll();

        $cleaned = 0;
        foreach ($expired as $row) {
            $path = $row['export_file_path'];
            if ($path && file_exists($path)) {
                @unlink($path);
                $cleaned++;
            }

            // Clear the file path in the DB so we don't re-process
            $this->query(
                "UPDATE gdpr_requests SET export_file_path = NULL WHERE id = ?",
                [$row['id']]
            );
        }

        if ($cleaned > 0) {
            $this->logger->info("Cleaned up {$cleaned} expired GDPR export files");
        }

        return $cleaned;
    }

    // =========================================================================
    // CONSENT MANAGEMENT
    // =========================================================================

    /**
     * Record user consent
     */
    public function recordConsent(int $userId, string $consentType, bool $consented, string $consentText, string $version): array
    {
        $consentHash = hash('sha256', $consentText);

        $this->query(
            "INSERT INTO user_consents
             (user_id, tenant_id, consent_type, consent_given, consent_text, consent_version,
              consent_hash, ip_address, user_agent, source, given_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'web', ?)
             ON DUPLICATE KEY UPDATE
                consent_given = VALUES(consent_given),
                consent_text = VALUES(consent_text),
                consent_version = VALUES(consent_version),
                consent_hash = VALUES(consent_hash),
                ip_address = VALUES(ip_address),
                user_agent = VALUES(user_agent),
                given_at = IF(VALUES(consent_given), VALUES(given_at), given_at),
                withdrawn_at = IF(VALUES(consent_given), NULL, NOW()),
                updated_at = NOW()",
            [
                $userId,
                $this->tenantId,
                $consentType,
                $consented ? 1 : 0,
                $consentText,
                $version,
                $consentHash,
                \App\Core\ClientIp::get(),
                $_SERVER['HTTP_USER_AGENT'] ?? null,
                $consented ? date('Y-m-d H:i:s') : null,
            ]
        );

        $action = $consented ? 'consent_given' : 'consent_withdrawn';
        $this->logAction($userId, $action, 'consent', null, null, null, [
            'consent_type' => $consentType,
            'version' => $version,
        ]);

        $this->metrics->increment("gdpr.consent.{$action}", ['type' => $consentType]);

        return [
            'consent_type' => $consentType,
            'consent_given' => $consented,
            'version' => $version,
        ];
    }

    /**
     * Withdraw consent
     */
    public function withdrawConsent(int $userId, string $consentType): bool
    {
        $result = $this->query(
            "UPDATE user_consents
             SET consent_given = FALSE, withdrawn_at = NOW()
             WHERE user_id = ? AND consent_type = ? AND tenant_id = ? AND consent_given = TRUE",
            [$userId, $consentType, $this->tenantId]
        );

        if ($result->rowCount() > 0) {
            $this->logAction($userId, 'consent_withdrawn', 'consent', null, null, null, [
                'consent_type' => $consentType,
            ]);
            return true;
        }

        return false;
    }

    /**
     * Get user's consents
     */
    public function getUserConsents(int $userId): array
    {
        return $this->query(
            "SELECT uc.consent_type as consent_type_slug, uc.consent_given, uc.consent_version, uc.given_at, uc.withdrawn_at,
                    ct.name, ct.description, ct.category, ct.is_required
             FROM user_consents uc
             LEFT JOIN consent_types ct ON uc.consent_type = ct.slug
             WHERE uc.user_id = ? AND uc.tenant_id = ?",
            [$userId, $this->tenantId]
        )->fetchAll();
    }

    /**
     * Check if user has given specific consent
     */
    public function hasConsent(int $userId, string $consentType): bool
    {
        $result = $this->query(
            "SELECT consent_given FROM user_consents
             WHERE user_id = ? AND consent_type = ? AND tenant_id = ?
             ORDER BY created_at DESC LIMIT 1",
            [$userId, $consentType, $this->tenantId]
        )->fetch();

        return $result && $result['consent_given'];
    }

    /**
     * Check if user has accepted the current version of a specific consent
     * Checks tenant-specific version override first
     *
     * @param int $userId
     * @param string $consentType
     * @return bool
     */
    public function hasCurrentVersionConsent(int $userId, string $consentType): bool
    {
        // Get user's consent version and the required version (tenant override or global)
        $result = $this->query(
            "SELECT uc.consent_version,
                    COALESCE(tco.current_version, ct.current_version) AS current_version
             FROM user_consents uc
             JOIN consent_types ct ON uc.consent_type = ct.slug
             LEFT JOIN tenant_consent_overrides tco
                    ON ct.slug = tco.consent_type_slug
                   AND tco.tenant_id = ?
                   AND tco.is_active = 1
             WHERE uc.user_id = ? AND uc.consent_type = ? AND uc.tenant_id = ?
               AND uc.consent_given = 1
             ORDER BY uc.created_at DESC LIMIT 1",
            [$this->tenantId, $userId, $consentType, $this->tenantId]
        )->fetch();

        if (!$result) {
            return false;
        }

        return version_compare($result['consent_version'], $result['current_version'], '>=');
    }

    /**
     * Get all required consents that user has not accepted at current version
     * Checks for tenant-specific version overrides first
     *
     * @param int $userId
     * @return array Array of consent types needing re-acceptance
     */
    public function getOutdatedRequiredConsents(int $userId): array
    {
        // Get all required consent types with tenant override if exists
        // COALESCE picks tenant override version/text if available, otherwise global
        $requiredTypes = $this->query(
            "SELECT ct.slug, ct.name, ct.description,
                    COALESCE(tco.current_version, ct.current_version) AS current_version,
                    COALESCE(tco.current_text, ct.current_text) AS current_text,
                    ct.category,
                    tco.id AS has_tenant_override
             FROM consent_types ct
             LEFT JOIN tenant_consent_overrides tco
                    ON ct.slug = tco.consent_type_slug
                   AND tco.tenant_id = ?
                   AND tco.is_active = 1
             WHERE ct.is_required = TRUE AND ct.is_active = TRUE",
            [$this->tenantId]
        )->fetchAll();

        $outdated = [];

        foreach ($requiredTypes as $type) {
            // Check user's consent for this type
            $userConsent = $this->query(
                "SELECT consent_version, consent_given
                 FROM user_consents
                 WHERE user_id = ? AND consent_type = ? AND tenant_id = ?
                   AND consent_given = 1
                 ORDER BY created_at DESC LIMIT 1",
                [$userId, $type['slug'], $this->tenantId]
            )->fetch();

            // If no consent or version mismatch, add to outdated list
            if (!$userConsent) {
                $type['reason'] = 'never_accepted';
                $outdated[] = $type;
            } elseif (version_compare($userConsent['consent_version'], $type['current_version'], '<')) {
                $type['reason'] = 'version_outdated';
                $type['user_version'] = $userConsent['consent_version'];
                $outdated[] = $type;
            }
        }

        return $outdated;
    }

    /**
     * Check if user needs to re-accept any required consents
     *
     * @param int $userId
     * @return bool
     */
    public function needsReConsent(int $userId): bool
    {
        return !empty($this->getOutdatedRequiredConsents($userId));
    }

    /**
     * Accept multiple consents at once (for re-consent page)
     *
     * @param int $userId
     * @param array $consentSlugs Array of consent type slugs
     * @return array Results for each consent
     */
    public function acceptMultipleConsents(int $userId, array $consentSlugs): array
    {
        $results = [];

        foreach ($consentSlugs as $slug) {
            try {
                $results[$slug] = self::updateUserConsent($userId, $slug, true);
            } catch (\Exception $e) {
                $results[$slug] = ['error' => $e->getMessage()];
            }
        }

        return $results;
    }

    /**
     * Backfill consent records for existing users
     * Creates consent records with consent_given=0 for users who don't have records
     * These users will be prompted to accept on next login
     *
     * @param string $consentType
     * @param string $version
     * @param string $consentText
     * @return int Number of users backfilled
     */
    public function backfillConsentsForExistingUsers(string $consentType, string $version, string $consentText): int
    {
        // Find users without this consent type
        $usersWithoutConsent = $this->query(
            "SELECT u.id
             FROM users u
             LEFT JOIN user_consents uc ON u.id = uc.user_id
               AND uc.consent_type = ? AND uc.tenant_id = ?
             WHERE u.tenant_id = ? AND uc.id IS NULL
               AND u.deleted_at IS NULL",
            [$consentType, $this->tenantId, $this->tenantId]
        )->fetchAll();

        $count = 0;
        $consentHash = hash('sha256', $consentText);

        foreach ($usersWithoutConsent as $user) {
            // Create a consent record with consent_given=0 (needs to accept)
            $this->query(
                "INSERT INTO user_consents
                 (user_id, tenant_id, consent_type, consent_given, consent_text,
                  consent_version, consent_hash, source, created_at)
                 VALUES (?, ?, ?, 0, ?, ?, ?, 'backfill', NOW())",
                [
                    $user['id'],
                    $this->tenantId,
                    $consentType,
                    $consentText,
                    $version,
                    $consentHash
                ]
            );
            $count++;
        }

        $this->logger->info("Backfilled consent records", [
            'consent_type' => $consentType,
            'users_count' => $count,
            'tenant_id' => $this->tenantId
        ]);

        return $count;
    }

    /**
     * Get effective consent version for this tenant
     * Returns tenant override if exists, otherwise global version
     *
     * @param string $consentSlug
     * @return array|null
     */
    public function getEffectiveConsentVersion(string $consentSlug): ?array
    {
        return $this->query(
            "SELECT ct.slug, ct.name, ct.description, ct.is_required,
                    COALESCE(tco.current_version, ct.current_version) AS current_version,
                    COALESCE(tco.current_text, ct.current_text) AS current_text,
                    tco.id AS tenant_override_id
             FROM consent_types ct
             LEFT JOIN tenant_consent_overrides tco
                    ON ct.slug = tco.consent_type_slug
                   AND tco.tenant_id = ?
                   AND tco.is_active = 1
             WHERE ct.slug = ? AND ct.is_active = TRUE",
            [$this->tenantId, $consentSlug]
        )->fetch() ?: null;
    }

    /**
     * Set or update tenant-specific consent version
     * This allows a tenant to update their terms independently of other tenants
     *
     * @param string $consentSlug
     * @param string $version
     * @param string|null $text Optional override text (null = use global text)
     * @return bool
     */
    public function setTenantConsentVersion(string $consentSlug, string $version, ?string $text = null): bool
    {
        // Verify consent type exists
        $exists = $this->query(
            "SELECT 1 FROM consent_types WHERE slug = ? AND is_active = TRUE",
            [$consentSlug]
        )->fetch();

        if (!$exists) {
            throw new \InvalidArgumentException("Invalid consent type: {$consentSlug}");
        }

        // Upsert tenant override
        $this->query(
            "INSERT INTO tenant_consent_overrides
             (tenant_id, consent_type_slug, current_version, current_text, is_active)
             VALUES (?, ?, ?, ?, 1)
             ON DUPLICATE KEY UPDATE
                current_version = VALUES(current_version),
                current_text = VALUES(current_text),
                is_active = 1,
                updated_at = NOW()",
            [$this->tenantId, $consentSlug, $version, $text]
        );

        $this->logger->info("Tenant consent version updated", [
            'tenant_id' => $this->tenantId,
            'consent_type' => $consentSlug,
            'version' => $version,
            'has_custom_text' => $text !== null
        ]);

        return true;
    }

    /**
     * Remove tenant-specific consent override (revert to global version)
     *
     * @param string $consentSlug
     * @return bool
     */
    public function removeTenantConsentOverride(string $consentSlug): bool
    {
        $this->query(
            "UPDATE tenant_consent_overrides
             SET is_active = 0, updated_at = NOW()
             WHERE tenant_id = ? AND consent_type_slug = ?",
            [$this->tenantId, $consentSlug]
        );

        $this->logger->info("Tenant consent override removed", [
            'tenant_id' => $this->tenantId,
            'consent_type' => $consentSlug
        ]);

        return true;
    }

    /**
     * Get all tenant consent overrides for this tenant
     *
     * @return array
     */
    public function getTenantConsentOverrides(): array
    {
        return $this->query(
            "SELECT tco.*, ct.name, ct.current_version AS global_version
             FROM tenant_consent_overrides tco
             JOIN consent_types ct ON tco.consent_type_slug = ct.slug
             WHERE tco.tenant_id = ? AND tco.is_active = 1",
            [$this->tenantId]
        )->fetchAll();
    }

    /**
     * Get all consent types
     */
    public function getConsentTypes(): array
    {
        return $this->query(
            "SELECT slug, name, description, category, is_required, current_version, current_text
             FROM consent_types
             WHERE is_active = TRUE
             ORDER BY display_order, name"
        )->fetchAll();
    }

    /**
     * Get active consent types for user-facing view
     */
    public function getActiveConsentTypes(): array
    {
        return $this->query(
            "SELECT slug, name, description, category, is_required, current_version
             FROM consent_types
             WHERE is_active = TRUE
             ORDER BY display_order, name"
        )->fetchAll();
    }

    /**
     * Update user consent by slug (user-initiated)
     * Uses tenant-specific version if available
     */
    public function updateUserConsent(int $userId, string $slug, bool $given): array
    {
        // Get effective consent type details (with tenant override if exists)
        $consentType = $this->getEffectiveConsentVersion($slug);

        if (!$consentType) {
            throw new \InvalidArgumentException("Invalid consent type: {$slug}");
        }

        // Cannot withdraw required consents
        if (!$given && $consentType['is_required']) {
            throw new \RuntimeException("Cannot withdraw required consent: {$consentType['name']}");
        }

        // Record consent with effective version
        $result = $this->recordConsent(
            $userId,
            $slug,
            $given,
            $consentType['current_text'] ?? '',
            $consentType['current_version'] ?? '1.0'
        );

        // Alert tenant admins that a member changed a consent preference.
        // Best-effort — dispatched from the explicit settings-change entry
        // point (updateUserConsent), NOT recordConsent, so bulk registration /
        // onboarding consent capture does not fan out to admins.
        try {
            \App\Events\GdprActionOccurred::dispatch(
                $userId,
                $this->tenantId,
                \App\Events\GdprActionOccurred::ACTION_CONSENT,
                $slug,
                $given,
            );
        } catch (\Throwable $e) {
            $this->logger->warning('GDPR consent admin-notification dispatch failed', [
                'user_id' => $userId,
                'error'   => $e->getMessage(),
            ]);
        }

        return $result;
    }

    // =========================================================================
    // DATA BREACH MANAGEMENT
    // =========================================================================

    /**
     * Report a data breach
     */
    public function reportBreach(array $data, int $reportedBy): int
    {
        $breachId = 'BREACH-' . date('Ymd') . '-' . strtoupper(bin2hex(random_bytes(4)));

        $this->query(
            "INSERT INTO data_breach_log
             (tenant_id, breach_id, breach_type, severity, description,
              data_categories_affected, number_of_records_affected, number_of_users_affected,
              detected_at, occurred_at, created_by, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'detected')",
            [
                $this->tenantId,
                $breachId,
                $data['breach_type'],
                $data['severity'] ?? 'medium',
                $data['description'],
                json_encode($data['data_categories']),
                $data['records_affected'] ?? null,
                $data['users_affected'] ?? null,
                $data['detected_at'] ?? date('Y-m-d H:i:s'),
                $data['occurred_at'] ?? null,
                $reportedBy,
            ]
        );

        $id = (int) $this->lastInsertId();

        $this->logger->critical("DATA BREACH REPORTED", [
            'breach_id' => $breachId,
            'type' => $data['breach_type'],
            'severity' => $data['severity'] ?? 'medium',
        ]);

        $this->metrics->increment('gdpr.breach.reported', ['severity' => $data['severity'] ?? 'medium']);

        return $id;
    }

    /**
     * Get breach notification deadline (72 hours from detection)
     */
    public function getBreachDeadline(int $breachLogId): \DateTime
    {
        $breach = $this->query(
            "SELECT detected_at FROM data_breach_log WHERE id = ?",
            [$breachLogId]
        )->fetch();

        $detected = new \DateTime($breach['detected_at']);
        return $detected->modify('+72 hours');
    }

    // =========================================================================
    // AUDIT LOGGING
    // =========================================================================

    /**
     * Log a GDPR action
     */
    public function logAction(
        int $userId,
        string $action,
        ?string $entityType = null,
        ?int $entityId = null,
        ?int $adminId = null,
        $oldValue = null,
        $newValue = null
    ): void {
        $this->query(
            "INSERT INTO gdpr_audit_log
             (user_id, admin_id, tenant_id, action, entity_type, entity_id,
              old_value, new_value, ip_address, user_agent, request_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                $userId,
                $adminId,
                $this->tenantId,
                $action,
                $entityType,
                $entityId,
                $oldValue ? json_encode($oldValue) : null,
                $newValue ? json_encode($newValue) : null,
                \App\Core\ClientIp::get(),
                $_SERVER['HTTP_USER_AGENT'] ?? null,
                $_SERVER['HTTP_X_REQUEST_ID'] ?? null,
            ]
        );
    }

    /**
     * Get audit log for user
     */
    public function getAuditLog(int $userId, int $limit = 100): array
    {
        $limit = (int) $limit;

        return $this->query(
            "SELECT action, entity_type, entity_id, created_at, ip_address
             FROM gdpr_audit_log
             WHERE user_id = ? AND tenant_id = ?
             ORDER BY created_at DESC
             LIMIT {$limit}",
            [$userId, $this->tenantId]
        )->fetchAll();
    }

    // =========================================================================
    // STATISTICS
    // =========================================================================

    /**
     * Get GDPR statistics for admin dashboard
     */
    public function getStatistics(): array
    {
        $stats = [];

        // Request counts by status
        $stats['requests'] = $this->query(
            "SELECT request_type, status, COUNT(*) as count
             FROM gdpr_requests
             WHERE tenant_id = ?
             GROUP BY request_type, status",
            [$this->tenantId]
        )->fetchAll();

        // Pending requests count
        $stats['pending_count'] = $this->query(
            "SELECT COUNT(*) as count FROM gdpr_requests
             WHERE tenant_id = ? AND status IN ('pending', 'processing')",
            [$this->tenantId]
        )->fetch()['count'];

        // Average processing time
        $stats['avg_processing_time'] = $this->query(
            "SELECT AVG(TIMESTAMPDIFF(HOUR, requested_at, processed_at)) as avg_hours
             FROM gdpr_requests
             WHERE tenant_id = ? AND status = 'completed' AND processed_at IS NOT NULL",
            [$this->tenantId]
        )->fetch()['avg_hours'];

        // Consent statistics
        $stats['consents'] = $this->query(
            "SELECT consent_type, SUM(consent_given) as given, COUNT(*) - SUM(consent_given) as withdrawn
             FROM user_consents
             WHERE tenant_id = ?
             GROUP BY consent_type",
            [$this->tenantId]
        )->fetchAll();

        // Active breaches
        $stats['active_breaches'] = $this->query(
            "SELECT COUNT(*) as count FROM data_breach_log
             WHERE tenant_id = ? AND status NOT IN ('resolved', 'closed')",
            [$this->tenantId]
        )->fetch()['count'];

        // Overdue requests (pending for more than 30 days - GDPR requires response within 30 days)
        $stats['overdue_count'] = $this->query(
            "SELECT COUNT(*) as count FROM gdpr_requests
             WHERE tenant_id = ? AND status IN ('pending', 'processing')
             AND requested_at < DATE_SUB(NOW(), INTERVAL 30 DAY)",
            [$this->tenantId]
        )->fetch()['count'];

        return $stats;
    }

    // =========================================================================
    // HELPER METHODS
    // =========================================================================

    private static function getStoragePath(string $path): string
    {
        $basePath = getenv('STORAGE_PATH') ?: __DIR__ . '/../../../storage';
        return rtrim($basePath, '/') . '/' . ltrim($path, '/');
    }

    private static function generateHtmlExport(array $data): string
    {
        $platform = $data['export_info']['platform'] ?? config('app.name', 'NEXUS');
        $title       = __('emails_misc.gdpr_export.html_title', ['platform' => $platform]);
        $heading     = __('emails_misc.gdpr_export.html_heading');
        $genLabel    = __('emails_misc.gdpr_export.generated_label');
        $noData      = __('emails_misc.gdpr_export.no_data');

        $html = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
        $html .= '<title>' . htmlspecialchars($title) . '</title>';
        $html .= '<style>body{font-family:Arial,sans-serif;max-width:1200px;margin:0 auto;padding:20px}';
        $html .= 'h1,h2,h3{color:#333}table{width:100%;border-collapse:collapse;margin:20px 0}';
        $html .= 'th,td{border:1px solid #ddd;padding:10px;text-align:left}th{background:#f5f5f5}</style>';
        $html .= '</head><body>';
        $html .= '<h1>' . htmlspecialchars($heading) . '</h1>';
        $html .= '<p>' . htmlspecialchars($genLabel) . ' ' . htmlspecialchars($data['export_info']['generated_at']) . '</p>';

        foreach ($data as $section => $content) {
            if ($section === 'export_info') continue;

            $html .= '<h2>' . htmlspecialchars(ucfirst(str_replace('_', ' ', $section))) . '</h2>';

            if (is_array($content) && !empty($content)) {
                if (isset($content[0]) && is_array($content[0])) {
                    $html .= '<table><tr>';
                    foreach (array_keys($content[0]) as $key) {
                        $html .= '<th>' . htmlspecialchars($key) . '</th>';
                    }
                    $html .= '</tr>';
                    foreach ($content as $row) {
                        $html .= '<tr>';
                        foreach ($row as $value) {
                            $html .= '<td>' . htmlspecialchars(is_array($value) ? json_encode($value) : (string)$value) . '</td>';
                        }
                        $html .= '</tr>';
                    }
                    $html .= '</table>';
                } else {
                    $html .= '<table>';
                    foreach ($content as $key => $value) {
                        $html .= '<tr><th>' . htmlspecialchars($key) . '</th>';
                        $html .= '<td>' . htmlspecialchars(is_array($value) ? json_encode($value) : (string)$value) . '</td></tr>';
                    }
                    $html .= '</table>';
                }
            } else {
                $html .= '<p>' . htmlspecialchars($noData) . '</p>';
            }
        }

        $html .= '</body></html>';
        return $html;
    }

    private static function generateExportReadme(array $data): string
    {
        $platform = $data['export_info']['platform'] ?? config('app.name', 'NEXUS');
        $header   = $platform . ' ' . __('emails_misc.gdpr_export.readme_header');
        $sep      = str_repeat('=', mb_strlen($header));
        return $header . "\n" . $sep . "\n\n"
            . __('emails_misc.gdpr_export.generated_label') . ' ' . $data['export_info']['generated_at'] . "\n"
            . __('emails_misc.gdpr_export.readme_user_id') . ' ' . $data['export_info']['user_id'] . "\n"
            . __('emails_misc.gdpr_export.readme_platform') . ' ' . $platform . "\n\n"
            . __('emails_misc.gdpr_export.readme_intro') . "\n\n"
            . __('emails_misc.gdpr_export.readme_files_heading') . "\n"
            . '- ' . __('emails_misc.gdpr_export.readme_file_json') . "\n"
            . '- ' . __('emails_misc.gdpr_export.readme_file_html') . "\n"
            . '- ' . __('emails_misc.gdpr_export.readme_file_uploads') . "\n\n"
            . __('emails_misc.gdpr_export.readme_support') . "\n\n"
            . __('emails_misc.gdpr_export.readme_expiry') . "\n";
    }

    private static function copyUserUploads(int $userId, string $destDir): void
    {
        $uploadsDir = self::getStoragePath("uploads/users/{$userId}");

        if (is_dir($uploadsDir)) {
            $destUploads = "{$destDir}/uploads";
            mkdir($destUploads, 0755, true);

            $iterator = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($uploadsDir, \RecursiveDirectoryIterator::SKIP_DOTS),
                \RecursiveIteratorIterator::SELF_FIRST
            );

            foreach ($iterator as $item) {
                $dest = $destUploads . '/' . $iterator->getSubPathName();
                if ($item->isDir()) {
                    mkdir($dest, 0755, true);
                } else {
                    copy($item, $dest);
                }
            }
        }
    }

    // =========================================================================
    // PII data export methods for identity, vetting, insurance, safeguarding
    // =========================================================================

    /**
     * Get safeguarding attestations for a user (GDPR Article 15).
     *
     * Certificate evidence remains excluded. Operational certification codes,
     * scope, private notes and renewal dates are personal data and are included.
     *
     * @return array{attestations: array<int, array<string, mixed>>, events: array<int, array<string, mixed>>, review_requests: array<int, array<string, mixed>>}
     */
    private function getVettingAttestationData(int $userId): array
    {
        $data = ['attestations' => [], 'events' => [], 'review_requests' => []];

        try {
            $data['attestations'] = $this->query(
                "SELECT id, scheme_code, attestation_code, certification_codes,
                        purpose_code, scope_type, scope_identifier,
                        scope_summary_encrypted, private_notes_encrypted,
                        review_due_at, authority_expires_at, decision, confirmed_by, confirmed_at,
                        revoked_by, revoked_at, revocation_reason_code, policy_version,
                        created_at, updated_at
                 FROM member_vetting_attestations
                 WHERE user_id = ? AND tenant_id = ?
                 ORDER BY created_at DESC",
                [$userId, $this->tenantId]
            )->fetchAll();
            foreach ($data['attestations'] as &$attestation) {
                $codes = json_decode((string) ($attestation['certification_codes'] ?? ''), true);
                $attestation['certification_codes'] = is_array($codes)
                    ? array_values(array_filter($codes, 'is_string'))
                    : [];
                $attestation['scope_summary'] = $this->decryptVettingText($attestation['scope_summary_encrypted'] ?? null);
                $attestation['private_notes'] = $this->decryptVettingText($attestation['private_notes_encrypted'] ?? null);
                unset($attestation['scope_summary_encrypted'], $attestation['private_notes_encrypted']);
            }
            unset($attestation);
        } catch (\Throwable $e) {
            $this->logger->warning('getVettingAttestationData attestations failed', [
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
        }

        try {
            $data['events'] = $this->query(
                "SELECT id, attestation_id, scheme_code, attestation_code, purpose_code,
                        scope_type, scope_identifier, event_type, decision_before,
                        decision_after, reason_code, actor_user_id, policy_version, created_at
                 FROM member_vetting_attestation_events
                 WHERE user_id = ? AND tenant_id = ?
                 ORDER BY created_at DESC",
                [$userId, $this->tenantId]
            )->fetchAll();
        } catch (\Throwable $e) {
            $this->logger->warning('getVettingAttestationData events failed', [
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
        }

        try {
            $data['review_requests'] = $this->query(
                "SELECT id, jurisdiction, scheme_code, attestation_code, purpose_code,
                        scope_type, scope_identifier, policy_version, status, request_source,
                        requested_by, requested_at, handled_by, handled_at, resolution_code,
                        created_at, updated_at
                 FROM safeguarding_vetting_review_requests
                 WHERE user_id = ? AND tenant_id = ?
                 ORDER BY created_at DESC",
                [$userId, $this->tenantId]
            )->fetchAll();
        } catch (\Throwable $e) {
            $this->logger->warning('getVettingAttestationData review requests failed', [
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
        }

        return $data;
    }

    private function decryptVettingText(mixed $value): ?string
    {
        if (! is_string($value) || $value === '') {
            return null;
        }

        try {
            return Crypt::decryptString($value);
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Get insurance certificate records for a user (GDPR Article 15).
     */
    private function getInsuranceCertificatesData(int $userId): array
    {
        try {
            return $this->query(
                "SELECT id, insurance_type, provider_name, policy_number, coverage_amount,
                        start_date, expiry_date, status, notes, created_at, updated_at
                 FROM insurance_certificates
                 WHERE user_id = ? AND tenant_id = ?
                 ORDER BY created_at DESC",
                [$userId, $this->tenantId]
            )->fetchAll();
        } catch (\Throwable $e) {
            $this->logger->warning('getInsuranceCertificatesData failed for user ' . $userId . ': ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Get identity verification session records for a user (GDPR Article 15).
     * Excludes raw provider data/tokens — only includes status and metadata.
     */
    private function getIdentityVerificationData(int $userId): array
    {
        try {
            return $this->query(
                "SELECT id, provider_slug, verification_level, status,
                        failure_reason, created_at, completed_at
                 FROM identity_verification_sessions
                 WHERE user_id = ? AND tenant_id = ?
                 ORDER BY created_at DESC",
                [$userId, $this->tenantId]
            )->fetchAll();
        } catch (\Throwable $e) {
            $this->logger->warning('getIdentityVerificationData failed for user ' . $userId . ': ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Get safeguarding preference selections for a user (GDPR Article 15).
     */
    private function getSafeguardingPreferencesData(int $userId): array
    {
        try {
            $rows = $this->query(
                "SELECT usp.id, tso.option_key, tso.preset_source, tso.label as option_label,
                        usp.selected_value, usp.notes, usp.consent_given_at, usp.revoked_at, usp.created_at
                 FROM user_safeguarding_preferences usp
                 LEFT JOIN tenant_safeguarding_options tso ON tso.id = usp.option_id
                 WHERE usp.user_id = ? AND usp.tenant_id = ?
                 ORDER BY usp.created_at DESC",
                [$userId, $this->tenantId]
            )->fetchAll();

            return array_map(static function (array $row): array {
                $row['option_label'] = \App\Models\TenantSafeguardingOption::localizeOptionText(
                    isset($row['preset_source']) ? (string) $row['preset_source'] : null,
                    isset($row['option_key']) ? (string) $row['option_key'] : null,
                    'label',
                    isset($row['option_label']) ? (string) $row['option_label'] : null,
                );

                return $row;
            }, $rows);
        } catch (\Throwable $e) {
            $this->logger->warning('getSafeguardingPreferencesData failed for user ' . $userId . ': ' . $e->getMessage());
            return [];
        }
    }

    private static function deleteUserUploads(int $userId): void
    {
        $uploadsDir = self::getStoragePath("uploads/users/{$userId}");
        if (is_dir($uploadsDir)) {
            self::deleteDirectory($uploadsDir);
        }
    }

    private static function createZipArchive(string $sourceDir, string $zipPath): void
    {
        $zip = new ZipArchive();
        if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            throw new \RuntimeException("Cannot create zip archive: {$zipPath}");
        }

        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($sourceDir, \RecursiveDirectoryIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::LEAVES_ONLY
        );

        foreach ($iterator as $file) {
            if (!$file->isDir()) {
                $filePath = $file->getRealPath();
                $relativePath = substr($filePath, strlen($sourceDir) + 1);
                $zip->addFile($filePath, $relativePath);
            }
        }

        $zip->close();
    }

    private static function deleteDirectory(string $dir): void
    {
        if (!is_dir($dir)) return;

        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($dir, \RecursiveDirectoryIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::CHILD_FIRST
        );

        foreach ($iterator as $item) {
            if ($item->isDir()) {
                rmdir($item->getRealPath());
            } else {
                unlink($item->getRealPath());
            }
        }

        rmdir($dir);
    }
}
