<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use InvalidArgumentException;

/**
 * AG71 — Pilot Region Inquiry & Qualification Funnel
 *
 * Manages the full lifecycle of Gemeinde pilot inquiries:
 *   new → qualified → proposal_sent → pilot_agreed → live
 *                                                   ↘ rejected | dormant
 *
 * Fit-score algorithm (max 100 points):
 *   has_kiss_cooperative          +30  — Zeitvorsorge ecosystem alignment
 *   population (5k–20k sweet spot) +20  — optimal community size
 *   timeline (ASAP best)           +25  — urgency / commitment signal
 *   no existing digital tool       +15  — greenfield opportunity
 *   interest_modules count ≥3      +10  — platform breadth interest
 *   country = 'CH'                 +5   — Swiss market priority
 *
 * Auto-qualifies (stage='qualified') when fit_score >= 60.
 */
class PilotInquiryService
{
    private const TABLE = 'pilot_inquiries';

    private const VALID_STAGES = [
        'new',
        'qualified',
        'proposal_sent',
        'pilot_agreed',
        'live',
        'rejected',
        'dormant',
    ];

    // ─── Availability ─────────────────────────────────────────────────────────

    /**
     * Returns true when the migration has been run.
     */
    public static function isAvailable(): bool
    {
        return Schema::hasTable(self::TABLE);
    }

    // ─── Fit-Score Algorithm ──────────────────────────────────────────────────

    /**
     * Compute the fit score (0–100) for a submitted inquiry.
     *
     * @param  array<string, mixed>  $data
     * @return array{score: float, breakdown: array<string, int>}
     */
    private static function computeFitScore(array $data): array
    {
        $breakdown = [];
        $total = 0;

        // +30 — KISS cooperative present (Zeitvorsorge ecosystem alignment)
        $kissScore = !empty($data['has_kiss_cooperative']) ? 30 : 0;
        $breakdown['kiss_cooperative'] = $kissScore;
        $total += $kissScore;

        // +5 to +20 — Population sweet-spot: 5 000–20 000
        $pop = isset($data['population']) ? (int) $data['population'] : null;
        $popScore = 0;
        if ($pop !== null) {
            if ($pop >= 5000 && $pop <= 20000) {
                $popScore = 20;
            } elseif ($pop >= 2000 && $pop < 5000) {
                $popScore = 15;
            } elseif ($pop > 20000 && $pop <= 50000) {
                $popScore = 10;
            } else {
                // <2000 or >50000
                $popScore = 5;
            }
        }
        $breakdown['population'] = $popScore;
        $total += $popScore;

        // +5 to +25 — Timeline urgency
        $timeline = isset($data['timeline_months']) ? (int) $data['timeline_months'] : null;
        $timeScore = 0;
        if ($timeline !== null) {
            if ($timeline === 0) {
                $timeScore = 25; // ASAP
            } elseif ($timeline <= 6) {
                $timeScore = 20;
            } elseif ($timeline <= 12) {
                $timeScore = 15;
            } elseif ($timeline <= 24) {
                $timeScore = 10;
            } else {
                $timeScore = 5; // just exploring (99)
            }
        }
        $breakdown['timeline'] = $timeScore;
        $total += $timeScore;

        // +15 — Greenfield opportunity (no existing digital tool to migrate off)
        $greenScore = empty($data['has_existing_digital_tool']) ? 15 : 0;
        $breakdown['greenfield'] = $greenScore;
        $total += $greenScore;

        // +5 or +10 — Platform breadth: number of modules of interest
        $modules = $data['interest_modules'] ?? [];
        if (is_string($modules)) {
            $modules = json_decode($modules, true) ?? [];
        }
        $modCount = is_array($modules) ? count($modules) : 0;
        $modScore = 0;
        if ($modCount >= 3) {
            $modScore = 10;
        } elseif ($modCount >= 2) {
            $modScore = 5;
        }
        $breakdown['interest_modules'] = $modScore;
        $total += $modScore;

        // +5 — Swiss market priority
        $chScore = (($data['country'] ?? 'CH') === 'CH') ? 5 : 0;
        $breakdown['swiss_market'] = $chScore;
        $total += $chScore;

        return [
            'score'     => (float) min(100.0, $total),
            'breakdown' => $breakdown,
        ];
    }

    // ─── Public-facing write ──────────────────────────────────────────────────

    /**
     * Submit a new pilot inquiry from a Gemeinde.
     *
     * Validates required fields, computes fit score, persists, and returns
     * the full row. Auto-promotes to 'qualified' when fit_score >= 60.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     *
     * @throws InvalidArgumentException on missing required fields
     */
    public static function submitInquiry(int $tenantId, array $data): array
    {
        // Required field validation
        $required = ['municipality_name', 'contact_name', 'contact_email', 'country'];
        foreach ($required as $field) {
            if (empty($data[$field])) {
                throw new InvalidArgumentException(__('api.pilot_inquiry_missing_required_field', ['field' => $field]));
            }
        }

        // Validate e-mail format
        if (! filter_var($data['contact_email'], FILTER_VALIDATE_EMAIL)) {
            throw new InvalidArgumentException(__('api.pilot_inquiry_invalid_email'));
        }

        // Normalise interest_modules to JSON string
        $modules = $data['interest_modules'] ?? null;
        if (is_array($modules)) {
            $modules = json_encode($modules);
        }

        // Compute fit score
        ['score' => $score, 'breakdown' => $breakdown] = self::computeFitScore($data);

        $stage = $score >= 60.0 ? 'qualified' : 'new';

        $now = now();

        $row = [
            'tenant_id'                  => $tenantId,
            'municipality_name'          => trim($data['municipality_name']),
            'region'                     => isset($data['region']) ? trim($data['region']) : null,
            'country'                    => strtoupper(substr(trim($data['country']), 0, 2)),
            'population'                 => isset($data['population']) ? (int) $data['population'] : null,
            'contact_name'               => trim($data['contact_name']),
            'contact_email'              => strtolower(trim($data['contact_email'])),
            'contact_phone'              => isset($data['contact_phone']) ? trim($data['contact_phone']) : null,
            'contact_role'               => isset($data['contact_role']) ? trim($data['contact_role']) : null,
            'has_kiss_cooperative'       => empty($data['has_kiss_cooperative']) ? 0 : 1,
            'has_existing_digital_tool'  => empty($data['has_existing_digital_tool']) ? 0 : 1,
            'existing_tool_name'         => isset($data['existing_tool_name']) ? trim($data['existing_tool_name']) : null,
            'timeline_months'            => isset($data['timeline_months']) ? (int) $data['timeline_months'] : null,
            'interest_modules'           => $modules,
            'budget_indication'          => $data['budget_indication'] ?? null,
            'notes'                      => isset($data['notes']) ? trim($data['notes']) : null,
            'fit_score'                  => $score,
            'fit_breakdown'              => json_encode($breakdown),
            'stage'                      => $stage,
            'source'                     => $data['source'] ?? 'website_cta',
            'created_at'                 => $now,
            'updated_at'                 => $now,
        ];

        $id = DB::table(self::TABLE)->insertGetId($row);

        return self::getInquiry($id, $tenantId) ?? $row;
    }

    // ─── Admin reads ──────────────────────────────────────────────────────────

    /**
     * List all pilot inquiries for a tenant, ordered by fit_score DESC.
     * Optionally filter by pipeline stage.
     * Includes the display name of the assigned sales user.
     *
     * @return array<int, array<string, mixed>>
     */
    public static function listInquiries(int $tenantId, ?string $stage = null): array
    {
        $q = DB::table(self::TABLE . ' as pi')
            ->leftJoin('users as u', 'u.id', '=', 'pi.assigned_to')
            ->where('pi.tenant_id', $tenantId)
            ->select([
                'pi.*',
                DB::raw("CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,'')) AS assigned_user_name"),
                'u.email AS assigned_user_email',
            ])
            ->orderByDesc('pi.fit_score')
            ->orderByDesc('pi.created_at');

        if ($stage !== null && in_array($stage, self::VALID_STAGES, true)) {
            $q->where('pi.stage', $stage);
        }

        return $q->get()->map(fn ($row) => (array) $row)->all();
    }

    /**
     * Fetch a single inquiry by ID, scoped to tenant.
     *
     * @return array<string, mixed>|null
     */
    public static function getInquiry(int $id, int $tenantId): ?array
    {
        $row = DB::table(self::TABLE . ' as pi')
            ->leftJoin('users as u', 'u.id', '=', 'pi.assigned_to')
            ->where('pi.id', $id)
            ->where('pi.tenant_id', $tenantId)
            ->select([
                'pi.*',
                DB::raw("CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,'')) AS assigned_user_name"),
                'u.email AS assigned_user_email',
            ])
            ->first();

        return $row ? (array) $row : null;
    }

    // ─── Admin writes ─────────────────────────────────────────────────────────

    /**
     * Move an inquiry to a new pipeline stage.
     * Sets the corresponding timestamp automatically.
     *
     * @return array<string, mixed>
     *
     * @throws InvalidArgumentException for unknown stage values
     */
    public static function updateStage(
        int $id,
        int $tenantId,
        string $stage,
        ?string $rejectionReason = null
    ): array {
        if (! in_array($stage, self::VALID_STAGES, true)) {
            throw new InvalidArgumentException(__('api.pilot_inquiry_invalid_stage', ['stage' => $stage]));
        }

        $updates = [
            'stage'      => $stage,
            'updated_at' => now(),
        ];

        // Set the relevant timestamp
        match ($stage) {
            'proposal_sent' => $updates['proposal_sent_at'] = now(),
            'pilot_agreed'  => $updates['pilot_agreed_at']  = now(),
            'live'          => $updates['went_live_at']      = now(),
            default         => null,
        };

        if ($stage === 'rejected' && $rejectionReason !== null) {
            $updates['rejection_reason'] = trim($rejectionReason);
        }

        DB::table(self::TABLE)
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update($updates);

        return self::getInquiry($id, $tenantId) ?? [];
    }

    /**
     * Assign a sales contact to an inquiry.
     */
    public static function assignTo(int $id, int $tenantId, int $userId): void
    {
        DB::table(self::TABLE)
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update([
                'assigned_to' => $userId,
                'updated_at'  => now(),
            ]);
    }

    /**
     * Update the admin-only internal notes on an inquiry.
     */
    /**
     * @return bool false when the inquiry is not this tenant's, so the caller
     *              can refuse rather than report a note it did not save (F-482).
     *              An existence check rather than the affected-row count,
     *              because re-saving the same note changes no row.
     */
    public static function updateInternalNotes(int $id, int $tenantId, string $notes): bool
    {
        $exists = DB::table(self::TABLE)
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->exists();

        if (! $exists) {
            return false;
        }

        DB::table(self::TABLE)
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update([
                'internal_notes' => $notes,
                'updated_at'     => now(),
            ]);

        return true;
    }

    // ─── Pipeline analytics ───────────────────────────────────────────────────

    /**
     * Return pipeline statistics for the admin dashboard:
     *   - count per stage
     *   - avg fit_score per stage
     *   - totals by country
     *   - avg days spent in each stage (approximated from timestamps)
     *
     * @return array<string, mixed>
     */
    public static function getPipelineStats(int $tenantId): array
    {
        // Per-stage counts + avg fit score
        $stageRows = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->select([
                'stage',
                DB::raw('COUNT(*) AS count'),
                DB::raw('ROUND(AVG(fit_score), 1) AS avg_fit_score'),
            ])
            ->groupBy('stage')
            ->get()
            ->keyBy('stage')
            ->map(fn ($r) => ['count' => (int) $r->count, 'avg_fit_score' => (float) $r->avg_fit_score])
            ->all();

        // Totals by country
        $byCountry = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->select(['country', DB::raw('COUNT(*) AS count')])
            ->groupBy('country')
            ->orderByDesc('count')
            ->get()
            ->map(fn ($r) => ['country' => $r->country, 'count' => (int) $r->count])
            ->all();

        // Avg days from created_at to proposal_sent_at (for proposal_sent+ records)
        $avgDaysToProposal = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->whereNotNull('proposal_sent_at')
            ->selectRaw('ROUND(AVG(DATEDIFF(proposal_sent_at, created_at)), 1) AS avg_days')
            ->value('avg_days');

        // Avg days from proposal to agreed
        $avgDaysToAgreed = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->whereNotNull('pilot_agreed_at')
            ->whereNotNull('proposal_sent_at')
            ->selectRaw('ROUND(AVG(DATEDIFF(pilot_agreed_at, proposal_sent_at)), 1) AS avg_days')
            ->value('avg_days');

        // Avg days from agreed to live
        $avgDaysToLive = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->whereNotNull('went_live_at')
            ->whereNotNull('pilot_agreed_at')
            ->selectRaw('ROUND(AVG(DATEDIFF(went_live_at, pilot_agreed_at)), 1) AS avg_days')
            ->value('avg_days');

        // Overall totals
        $totals = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->selectRaw('COUNT(*) AS total, ROUND(AVG(fit_score), 1) AS avg_fit_score')
            ->first();

        return [
            'by_stage'              => $stageRows,
            'by_country'            => array_values($byCountry),
            'total'                 => (int) ($totals->total ?? 0),
            'avg_fit_score'         => (float) ($totals->avg_fit_score ?? 0.0),
            'avg_days_to_proposal'  => $avgDaysToProposal !== null ? (float) $avgDaysToProposal : null,
            'avg_days_to_agreed'    => $avgDaysToAgreed !== null ? (float) $avgDaysToAgreed : null,
            'avg_days_to_live'      => $avgDaysToLive !== null ? (float) $avgDaysToLive : null,
        ];
    }
}
