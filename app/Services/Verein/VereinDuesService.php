<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\Verein;

use App\Core\EmailTemplateBuilder;
use App\Core\Mailer;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Services\StripeService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * VereinDuesService — AG54 annual Verein membership fee collection.
 *
 * Lifecycle:
 *   1. Verein admin sets fee config via setFeeConfig().
 *   2. Annual generation creates one verein_member_dues row per active member
 *      (idempotent — runs on Jan 1 via scheduled command, or manually).
 *   3. Members pay via Stripe; markPaid() writes the payment ledger row and
 *      flips status to 'paid'.
 *   4. Daily commands flip pending → overdue past grace_period_days, then send
 *      reminder emails on a 7-day cadence (max 3 reminders).
 *
 * All queries are tenant-scoped. Emails are wrapped in LocaleContext::withLocale
 * so each recipient sees the email in their preferred_language.
 */
class VereinDuesService
{
    /**
     * Set or update the fee config for a Verein.
     *
     * @param  array{
     *     fee_amount_cents:int,
     *     currency?:string,
     *     billing_cycle?:string,
     *     grace_period_days?:int,
     *     late_fee_cents?:?int,
     *     is_active?:bool
     * }  $data
     *
     * @throws \InvalidArgumentException
     */
    public function setFeeConfig(int $organizationId, array $data): array
    {
        $tenantId = TenantContext::getId();
        $this->assertOrganizationIsClub($tenantId, $organizationId);

        $feeAmount = (int) ($data['fee_amount_cents'] ?? 0);
        if ($feeAmount <= 0) {
            throw new \InvalidArgumentException(__('verein_dues.errors.invalid_fee_amount'));
        }

        $currency = strtoupper((string) ($data['currency'] ?? 'CHF'));
        $cycle = (string) ($data['billing_cycle'] ?? 'annual');
        if (!in_array($cycle, ['annual', 'biennial', 'monthly'], true)) {
            throw new \InvalidArgumentException(__('verein_dues.errors.invalid_billing_cycle'));
        }

        $grace = (int) ($data['grace_period_days'] ?? 30);
        $lateFee = isset($data['late_fee_cents']) ? (int) $data['late_fee_cents'] : null;
        $isActive = (bool) ($data['is_active'] ?? true);

        $existingId = DB::table('verein_membership_fees')
            ->where('organization_id', $organizationId)
            ->where('tenant_id', $tenantId)
            ->value('id');

        $payload = [
            'organization_id' => $organizationId,
            'tenant_id' => $tenantId,
            'fee_amount_cents' => $feeAmount,
            'currency' => $currency,
            'billing_cycle' => $cycle,
            'grace_period_days' => $grace,
            'late_fee_cents' => $lateFee,
            'is_active' => $isActive,
            'updated_at' => now(),
        ];

        if ($existingId) {
            DB::table('verein_membership_fees')->where('id', $existingId)->update($payload);
            $id = (int) $existingId;
        } else {
            $payload['created_at'] = now();
            $id = (int) DB::table('verein_membership_fees')->insertGetId($payload);
        }

        return $this->getFeeConfig($organizationId) ?? ['id' => $id];
    }

    public function getFeeConfig(int $organizationId): ?array
    {
        $tenantId = TenantContext::getId();
        $row = DB::table('verein_membership_fees')
            ->where('organization_id', $organizationId)
            ->where('tenant_id', $tenantId)
            ->first();
        return $row ? (array) $row : null;
    }

    /**
     * Generate the annual dues rows for every active member of a Verein.
     * Idempotent — running twice for the same year does not duplicate rows.
     *
     * @return array{generated:int, skipped:int, year:int}
     */
    public function generateAnnualDues(int $organizationId, int $year): array
    {
        $tenantId = TenantContext::getId();
        $this->assertOrganizationIsClub($tenantId, $organizationId);

        $config = $this->getFeeConfig($organizationId);
        if (!$config || !$config['is_active']) {
            throw new \RuntimeException(__('verein_dues.errors.fee_not_configured'));
        }

        $members = DB::table('org_members')
            ->where('organization_id', $organizationId)
            ->where('org_type', 'volunteer')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->pluck('user_id')
            ->all();

        $dueDate = sprintf('%d-01-31', $year); // Jan 31 of membership year by default

        $generated = 0;
        $skipped = 0;

        foreach ($members as $userId) {
            $userId = (int) $userId;
            if ($userId <= 0) {
                continue;
            }

            $exists = DB::table('verein_member_dues')
                ->where('organization_id', $organizationId)
                ->where('user_id', $userId)
                ->where('membership_year', $year)
                ->where('tenant_id', $tenantId)
                ->exists();

            if ($exists) {
                $existingDue = DB::table('verein_member_dues')
                    ->where('organization_id', $organizationId)
                    ->where('user_id', $userId)
                    ->where('membership_year', $year)
                    ->where('tenant_id', $tenantId)
                    ->first();
                if ($existingDue && empty($existingDue->generated_email_sent_at)) {
                    $this->markGeneratedEmailAttempt($existingDue);
                }
                $skipped++;
                continue;
            }

            $duesId = (int) DB::table('verein_member_dues')->insertGetId([
                'organization_id' => $organizationId,
                'tenant_id' => $tenantId,
                'user_id' => $userId,
                'membership_year' => $year,
                'amount_cents' => (int) $config['fee_amount_cents'],
                'currency' => (string) $config['currency'],
                'status' => 'pending',
                'due_date' => $dueDate,
                'reminder_count' => 0,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $generated++;

            // Notify the member their dues are now due.
            $dues = DB::table('verein_member_dues')
                ->where('id', $duesId)
                ->where('tenant_id', $tenantId)
                ->first();
            if ($dues) {
                $this->markGeneratedEmailAttempt($dues);
            }
        }

        Log::info('VereinDues: annual generation complete', [
            'tenant_id' => $tenantId,
            'organization_id' => $organizationId,
            'year' => $year,
            'generated' => $generated,
            'skipped' => $skipped,
        ]);

        return ['generated' => $generated, 'skipped' => $skipped, 'year' => $year];
    }

    /**
     * Mark dues as paid + write payment ledger. Idempotent on stripe_payment_intent_id.
     */
    public function markPaid(
        int $duesId,
        string $stripePaymentIntentId,
        ?string $paymentMethod = null,
        ?string $receiptUrl = null,
        bool $requirePaidEmailEvidence = false
    ): array
    {
        $tenantId = TenantContext::getId();

        $result = DB::transaction(function () use ($duesId, $stripePaymentIntentId, $paymentMethod, $receiptUrl, $tenantId) {
            $dues = DB::table('verein_member_dues')
                ->where('id', $duesId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();

            if (!$dues) {
                throw new \RuntimeException(__('verein_dues.errors.dues_not_found'));
            }

            // Idempotency — if a payment row for this PI already exists, return it.
            $existing = DB::table('verein_dues_payments')
                ->where('stripe_payment_intent_id', $stripePaymentIntentId)
                ->where('tenant_id', $tenantId)
                ->first();
            if ($existing) {
                $paidEmailSent = !empty($dues->paid_email_sent_at);
                if (!$paidEmailSent) {
                    $paidEmailSent = $this->markPaidEmailAttempt($dues, $receiptUrl);
                }
                return ['dues_id' => $duesId, 'payment_id' => (int) $existing->id, 'idempotent' => true, 'paid_email_sent' => $paidEmailSent];
            }

            DB::table('verein_member_dues')
                ->where('id', $duesId)
                ->where('tenant_id', $tenantId)
                ->update([
                'status' => 'paid',
                'paid_at' => now(),
                'stripe_payment_intent_id' => $stripePaymentIntentId,
                'updated_at' => now(),
            ]);

            $paymentId = DB::table('verein_dues_payments')->insertGetId([
                'dues_id' => $duesId,
                'tenant_id' => $tenantId,
                'stripe_payment_intent_id' => $stripePaymentIntentId,
                'amount_cents' => (int) $dues->amount_cents,
                'currency' => (string) $dues->currency,
                'paid_at' => now(),
                'payment_method' => $paymentMethod,
                'receipt_url' => $receiptUrl,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            // Notify the member their payment was received.
            $dues = DB::table('verein_member_dues')
                ->where('id', $duesId)
                ->where('tenant_id', $tenantId)
                ->first();
            $paidEmailSent = false;
            if ($dues) {
                $paidEmailSent = $this->markPaidEmailAttempt($dues, $receiptUrl);
            }

            return ['dues_id' => $duesId, 'payment_id' => (int) $paymentId, 'idempotent' => false, 'paid_email_sent' => $paidEmailSent];
        });

        if ($requirePaidEmailEvidence && empty($result['paid_email_sent'])) {
            throw new \RuntimeException('Verein dues paid email failed');
        }

        unset($result['paid_email_sent']);

        return $result;
    }

    public function waive(int $duesId, int $adminId, string $reason): array
    {
        $tenantId = TenantContext::getId();

        $dues = DB::table('verein_member_dues')
            ->where('id', $duesId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$dues) {
            throw new \RuntimeException(__('verein_dues.errors.dues_not_found'));
        }

        if ($dues->status === 'paid') {
            throw new \InvalidArgumentException(__('verein_dues.errors.cannot_waive_paid'));
        }

        DB::table('verein_member_dues')
            ->where('id', $duesId)
            ->where('tenant_id', $tenantId)
            ->update([
            'status' => 'waived',
            'waived_by_admin_id' => $adminId,
            'waived_reason' => $reason,
            'updated_at' => now(),
        ]);

        Log::info('VereinDues: waived', [
            'tenant_id' => $tenantId,
            'dues_id' => $duesId,
            'admin_id' => $adminId,
            'reason' => $reason,
        ]);

        return ['dues_id' => $duesId, 'status' => 'waived'];
    }

    public function sendReminder(int $duesId): array
    {
        $tenantId = TenantContext::getId();

        $dues = DB::table('verein_member_dues')
            ->where('id', $duesId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$dues) {
            throw new \RuntimeException(__('verein_dues.errors.dues_not_found'));
        }

        if (!in_array($dues->status, ['pending', 'overdue'], true)) {
            throw new \InvalidArgumentException(__('verein_dues.errors.cannot_remind_status'));
        }

        $emailSent = $this->sendReminderEmail((int) $dues->user_id, (int) $dues->organization_id, (int) $dues->membership_year, (int) $dues->amount_cents, (string) $dues->currency, (string) $dues->due_date);

        if (!$emailSent) {
            $this->markReminderEmailFailed($duesId, $tenantId, 'Verein dues reminder email returned false');
            return ['dues_id' => $duesId, 'sent' => false];
        }

        DB::table('verein_member_dues')
            ->where('id', $duesId)
            ->where('tenant_id', $tenantId)
            ->update([
            'reminder_count' => DB::raw('reminder_count + 1'),
            'last_reminder_at' => now(),
            'reminder_email_failed_at' => null,
            'reminder_email_last_error' => null,
            'updated_at' => now(),
        ]);

        return ['dues_id' => $duesId, 'sent' => true];
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    public function getOverdueDues(int $organizationId): array
    {
        $tenantId = TenantContext::getId();
        return DB::table('verein_member_dues')
            ->where('organization_id', $organizationId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'overdue')
            ->orderBy('due_date')
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();
    }

    public function listDues(int $organizationId, ?string $status = null, ?int $year = null, int $page = 1, int $perPage = 25): array
    {
        $tenantId = TenantContext::getId();
        $year ??= (int) date('Y');

        $query = DB::table('verein_member_dues as d')
            ->leftJoin('users as u', 'u.id', '=', 'd.user_id')
            ->where('d.organization_id', $organizationId)
            ->where('d.tenant_id', $tenantId)
            ->where('d.membership_year', $year);

        if ($status !== null && $status !== '') {
            $query->where('d.status', $status);
        }

        $total = (clone $query)->count();
        $items = $query
            ->select([
                'd.id', 'd.user_id', 'd.membership_year', 'd.amount_cents', 'd.currency',
                'd.status', 'd.due_date', 'd.paid_at', 'd.reminder_count', 'd.last_reminder_at',
                'd.generated_email_sent_at', 'd.generated_email_failed_at',
                'd.paid_email_sent_at', 'd.paid_email_failed_at',
                'd.reminder_email_failed_at', 'd.reminder_email_last_error',
                'd.waived_reason', 'u.first_name', 'u.last_name', 'u.profile_type', 'u.organization_name', 'u.email',
            ])
            ->orderBy('d.due_date')
            ->offset(max(0, ($page - 1) * $perPage))
            ->limit($perPage)
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();

        return ['items' => $items, 'total' => $total, 'page' => $page, 'per_page' => $perPage, 'year' => $year];
    }

    /**
     * @return array<string,string|null>  e.g. ['2026' => 'paid', '2025' => 'overdue']
     */
    public function getMembershipStatus(int $userId, int $organizationId): array
    {
        $tenantId = TenantContext::getId();
        $rows = DB::table('verein_member_dues')
            ->where('user_id', $userId)
            ->where('organization_id', $organizationId)
            ->where('tenant_id', $tenantId)
            ->orderByDesc('membership_year')
            ->get(['membership_year', 'status', 'amount_cents', 'currency', 'due_date', 'paid_at']);

        $byYear = [];
        foreach ($rows as $row) {
            $byYear[(string) $row->membership_year] = [
                'status' => $row->status,
                'amount_cents' => (int) $row->amount_cents,
                'currency' => $row->currency,
                'due_date' => $row->due_date,
                'paid_at' => $row->paid_at,
            ];
        }
        return $byYear;
    }

    public function getMyDues(int $userId): array
    {
        $tenantId = TenantContext::getId();

        $rows = DB::table('verein_member_dues as d')
            ->leftJoin('vol_organizations as o', 'o.id', '=', 'd.organization_id')
            ->where('d.user_id', $userId)
            ->where('d.tenant_id', $tenantId)
            ->select([
                'd.id', 'd.organization_id', 'd.membership_year', 'd.amount_cents',
                'd.currency', 'd.status', 'd.due_date', 'd.paid_at', 'd.stripe_payment_intent_id',
                'o.name as organization_name',
            ])
            ->orderByDesc('d.membership_year')
            ->orderBy('d.due_date')
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();

        return ['items' => $rows, 'total' => count($rows)];
    }

    public function getDuesById(int $duesId, int $userId): ?array
    {
        $tenantId = TenantContext::getId();
        $row = DB::table('verein_member_dues as d')
            ->leftJoin('vol_organizations as o', 'o.id', '=', 'd.organization_id')
            ->where('d.id', $duesId)
            ->where('d.tenant_id', $tenantId)
            ->where('d.user_id', $userId)
            ->select(['d.*', 'o.name as organization_name'])
            ->first();
        return $row ? (array) $row : null;
    }

    /**
     * Create a Stripe PaymentIntent for a member to pay one dues row.
     *
     * @return array{client_secret:string,payment_intent_id:string}
     */
    public function createPaymentIntent(int $duesId, int $userId): array
    {
        $tenantId = TenantContext::getId();

        $dues = DB::table('verein_member_dues')
            ->where('id', $duesId)
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->first();

        if (!$dues) {
            throw new \RuntimeException(__('verein_dues.errors.dues_not_found'));
        }

        if (!in_array($dues->status, ['pending', 'overdue'], true)) {
            throw new \InvalidArgumentException(__('verein_dues.errors.cannot_pay_status'));
        }

        $client = StripeService::client();
        $idempotencyKey = "verein-dues-{$tenantId}-{$duesId}";

        try {
            $intent = $client->paymentIntents->create([
                'amount' => (int) $dues->amount_cents,
                'currency' => strtolower((string) $dues->currency),
                'metadata' => [
                    'nexus_tenant_id' => (string) $tenantId,
                    'nexus_dues_id' => (string) $duesId,
                    'nexus_user_id' => (string) $userId,
                    'nexus_organization_id' => (string) $dues->organization_id,
                    'nexus_type' => 'verein_dues',
                ],
                'description' => "Verein membership dues {$dues->membership_year}",
            ], ['idempotency_key' => $idempotencyKey]);
        } catch (\Throwable $e) {
            Log::error('VereinDues: failed to create PaymentIntent', [
                'dues_id' => $duesId,
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);
            throw new \RuntimeException(__('verein_dues.errors.payment_intent_failed'));
        }

        DB::table('verein_member_dues')
            ->where('id', $duesId)
            ->where('tenant_id', $tenantId)
            ->update([
            'stripe_payment_intent_id' => $intent->id,
            'updated_at' => now(),
        ]);

        return [
            'client_secret' => $intent->client_secret,
            'payment_intent_id' => $intent->id,
        ];
    }

    /**
     * Webhook handler — dispatched from StripeWebhookController on payment_intent.succeeded.
     */
    public static function handleWebhookEvent(string $eventType, object $eventData): void
    {
        if ($eventType !== 'payment_intent.succeeded') {
            return;
        }

        $nexusType = $eventData->metadata->nexus_type ?? null;
        if ($nexusType !== 'verein_dues') {
            return;
        }

        $piId = $eventData->id ?? null;
        $duesId = (int) ($eventData->metadata->nexus_dues_id ?? 0);
        if (!$piId || !$duesId) {
            return;
        }

        // SECURITY: resolve tenant from our own DB row (never from Stripe metadata)
        $row = DB::table('verein_member_dues')->where('id', $duesId)->first();
        if (!$row) {
            Log::warning('VereinDues webhook: no local dues record', ['payment_intent_id' => $piId]);
            return;
        }

        TenantContext::runForTenant((int) $row->tenant_id, function () use ($eventData, $duesId, $piId): void {
            $chargeId = null;
            if (!empty($eventData->latest_charge)) {
                $chargeId = is_string($eventData->latest_charge)
                    ? $eventData->latest_charge
                    : ($eventData->latest_charge->id ?? null);
            }

            $receiptUrl = null;
            if ($chargeId) {
                try {
                    $charge = StripeService::client()->charges->retrieve($chargeId);
                    $receiptUrl = $charge->receipt_url ?? null;
                } catch (\Throwable $e) {
                // Non-fatal — receipt URL is optional
                }
            }

            $paymentMethod = $eventData->payment_method_types[0] ?? 'card';

            try {
                (new self())->markPaid($duesId, (string) $piId, $paymentMethod, $receiptUrl, true);
            } catch (\Throwable $e) {
                Log::error('VereinDues webhook: markPaid failed', [
                    'dues_id' => $duesId,
                    'payment_intent_id' => $piId,
                    'error' => $e->getMessage(),
                ]);
                throw $e;
            }
        });
    }

    /**
     * Daily — flip pending → overdue past (due_date + grace_period_days).
     *
     * @return int count of rows updated
     */
    public function markOverdueDues(): int
    {
        $now = now();
        $count = 0;

        $configs = DB::table('verein_membership_fees')->where('is_active', true)->get();
        foreach ($configs as $config) {
            $cutoff = $now->copy()->subDays((int) $config->grace_period_days)->toDateString();

            $count += DB::table('verein_member_dues')
                ->where('organization_id', $config->organization_id)
                ->where('tenant_id', $config->tenant_id)
                ->where('status', 'pending')
                ->where('due_date', '<', $cutoff)
                ->update([
                    'status' => 'overdue',
                    'updated_at' => now(),
                ]);
        }

        return $count;
    }

    /**
     * Daily — send reminders for overdue dues on a 7-day cadence (max 3).
     *
     * @return int count of reminders sent
     */
    public function sendDueReminders(): int
    {
        $sevenDaysAgo = now()->subDays(7);

        $rows = DB::table('verein_member_dues')
            ->where('status', 'overdue')
            ->where('reminder_count', '<', 3)
            ->where(function ($q) use ($sevenDaysAgo): void {
                $q->whereNull('last_reminder_at')->orWhere('last_reminder_at', '<', $sevenDaysAgo);
            })
            ->get();

        $sent = 0;
        foreach ($rows as $row) {
            try {
                $emailSent = TenantContext::runForTenant((int) $row->tenant_id, function () use ($row): bool {
                    return $this->sendReminderEmail((int) $row->user_id, (int) $row->organization_id, (int) $row->membership_year, (int) $row->amount_cents, (string) $row->currency, (string) $row->due_date);
                });

                if (!$emailSent) {
                    Log::warning('VereinDues: reminder email returned false', [
                        'dues_id' => $row->id,
                        'tenant_id' => $row->tenant_id,
                    ]);
                    $this->markReminderEmailFailed((int) $row->id, (int) $row->tenant_id, 'Verein dues reminder email returned false');
                    continue;
                }

                DB::table('verein_member_dues')
                    ->where('id', $row->id)
                    ->where('tenant_id', $row->tenant_id)
                    ->update([
                    'reminder_count' => DB::raw('reminder_count + 1'),
                    'last_reminder_at' => now(),
                    'reminder_email_failed_at' => null,
                    'reminder_email_last_error' => null,
                    'updated_at' => now(),
                ]);
                $sent++;
            } catch (\Throwable $e) {
                $this->markReminderEmailFailed((int) $row->id, (int) $row->tenant_id, $e->getMessage());
                Log::warning('VereinDues: reminder send failed', [
                    'dues_id' => $row->id,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return $sent;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Email helpers (each wraps render+send in LocaleContext::withLocale)
    // ─────────────────────────────────────────────────────────────────────

    private function markGeneratedEmailAttempt(object $dues): bool
    {
        $sent = $this->sendDuesGeneratedEmail(
            (int) $dues->user_id,
            (int) $dues->organization_id,
            (int) $dues->membership_year,
            (int) $dues->amount_cents,
            (string) $dues->currency
        );

        DB::table('verein_member_dues')
            ->where('id', (int) $dues->id)
            ->where('tenant_id', (int) $dues->tenant_id)
            ->update([
                'generated_email_sent_at' => $sent ? now() : null,
                'generated_email_failed_at' => $sent ? null : now(),
                'updated_at' => now(),
            ]);

        return $sent;
    }

    private function markPaidEmailAttempt(object $dues, ?string $receiptUrl): bool
    {
        $sent = $this->sendDuesPaidEmail(
            (int) $dues->user_id,
            (int) $dues->organization_id,
            (int) $dues->membership_year,
            (int) $dues->amount_cents,
            (string) $dues->currency,
            $receiptUrl
        );

        DB::table('verein_member_dues')
            ->where('id', (int) $dues->id)
            ->where('tenant_id', (int) $dues->tenant_id)
            ->update([
                'paid_email_sent_at' => $sent ? now() : null,
                'paid_email_failed_at' => $sent ? null : now(),
                'updated_at' => now(),
            ]);

        return $sent;
    }

    private function sendDuesGeneratedEmail(int $userId, int $organizationId, int $year, int $amountCents, string $currency): bool
    {
        return $this->sendEmail(
            $userId,
            $organizationId,
            'emails.verein_dues.generated_subject',
            'emails.verein_dues.generated_title',
            'emails.verein_dues.generated_body',
            ['year' => $year, 'amount' => $this->formatAmount($amountCents, $currency)],
            '/me/verein-dues',
            'emails.verein_dues.cta_pay'
        );
    }

    private function markReminderEmailFailed(int $duesId, int $tenantId, string $error): void
    {
        DB::table('verein_member_dues')
            ->where('id', $duesId)
            ->where('tenant_id', $tenantId)
            ->update([
                'reminder_email_failed_at' => now(),
                'reminder_email_last_error' => mb_substr($error, 0, 2000),
                'updated_at' => now(),
            ]);
    }

    private function sendReminderEmail(int $userId, int $organizationId, int $year, int $amountCents, string $currency, string $dueDate): bool
    {
        return $this->sendEmail(
            $userId,
            $organizationId,
            'emails.verein_dues.reminder_subject',
            'emails.verein_dues.reminder_title',
            'emails.verein_dues.reminder_body',
            ['year' => $year, 'amount' => $this->formatAmount($amountCents, $currency), 'due_date' => $dueDate],
            '/me/verein-dues',
            'emails.verein_dues.cta_pay'
        );
    }

    private function sendDuesPaidEmail(int $userId, int $organizationId, int $year, int $amountCents, string $currency, ?string $receiptUrl): bool
    {
        return $this->sendEmail(
            $userId,
            $organizationId,
            'emails.verein_dues.paid_subject',
            'emails.verein_dues.paid_title',
            'emails.verein_dues.paid_body',
            ['year' => $year, 'amount' => $this->formatAmount($amountCents, $currency)],
            $receiptUrl ?? '/me/verein-dues',
            $receiptUrl ? 'emails.verein_dues.cta_receipt' : 'emails.verein_dues.cta_view',
            $receiptUrl !== null
        );
    }

    private function sendEmail(
        int $userId,
        int $organizationId,
        string $subjectKey,
        string $titleKey,
        string $bodyKey,
        array $params,
        string $linkOrUrl,
        string $ctaKey,
        bool $linkIsAbsolute = false
    ): bool {
        $tenantId = TenantContext::getId();

        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select(['email', 'first_name', 'name', 'preferred_language'])
            ->first();
        if (!$user || empty($user->email)) {
            return false;
        }

        $orgName = (string) (DB::table('vol_organizations')
            ->where('id', $organizationId)
            ->where('tenant_id', $tenantId)
            ->value('name') ?? '');
        $params['organization'] = $orgName;

        $url = $linkIsAbsolute
            ? $linkOrUrl
            : (TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $linkOrUrl);

        return (bool) LocaleContext::withLocale($user, function () use ($user, $subjectKey, $titleKey, $bodyKey, $params, $url, $ctaKey, $userId, $tenantId): bool {
            $firstName = $user->first_name ?? $user->name ?? __('emails.common.fallback_name');

            $html = EmailTemplateBuilder::make()
                ->title(__($titleKey, $params))
                ->greeting($firstName)
                ->paragraph(__($bodyKey, $params))
                ->button(__($ctaKey), $url)
                ->render();

            $sent = \App\Services\EmailDispatchService::sendRaw($user->email, __($subjectKey, $params), $html, null, null, null, 'verein_dues', ['tenant_id' => $tenantId]);

            if (!$sent) {
                Log::warning('VereinDues: email send failed', ['user_id' => $userId]);
            }

            return $sent;
        });
    }

    private function formatAmount(int $cents, string $currency): string
    {
        return number_format($cents / 100, 2) . ' ' . strtoupper($currency);
    }

    private function assertOrganizationIsClub(int $tenantId, int $organizationId): void
    {
        $org = DB::table('vol_organizations')
            ->where('id', $organizationId)
            ->where('tenant_id', $tenantId)
            ->first(['id', 'org_type']);

        if (!$org) {
            throw new \InvalidArgumentException(__('verein_dues.errors.organization_not_found'));
        }
        if (($org->org_type ?? 'organisation') !== 'club') {
            throw new \InvalidArgumentException(__('verein_dues.errors.organization_not_club'));
        }
    }
}
