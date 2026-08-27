<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\Mailer;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\VolDonation;
use App\Models\VolGivingDay;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use App\Support\UserDisplayName;

/**
 * StripeDonationService — Stripe payment processing for monetary donations.
 *
 * Handles PaymentIntent creation, webhook event processing (succeeded, failed,
 * refunded), admin-initiated refunds, and donation receipt generation.
 *
 * All financial state changes use DB::transaction(). All Stripe API calls are
 * wrapped in try/catch with Log::error. Amounts are stored as decimals in DB
 * and sent as cents (smallest currency unit) to Stripe.
 */
class StripeDonationService
{
    /**
     * Stripe currencies with NO minor unit — the amount is charged as whole
     * units (e.g. ¥500 is amount=500, not 50000). Charging these ×100 overbills
     * the donor 100×. https://stripe.com/docs/currencies#zero-decimal
     */
    private const ZERO_DECIMAL_CURRENCIES = [
        'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga',
        'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
    ];

    /** Stripe currencies charged in thousandths (three decimal places). */
    private const THREE_DECIMAL_CURRENCIES = ['bhd', 'jod', 'kwd', 'omr', 'tnd'];

    /**
     * Convert a decimal amount to Stripe's smallest-unit integer for the given
     * currency, honouring zero- and three-decimal currencies.
     */
    private static function toStripeMinorUnits(float $amount, string $currency): int
    {
        $currency = strtolower($currency);

        if (in_array($currency, self::ZERO_DECIMAL_CURRENCIES, true)) {
            return (int) round($amount);
        }

        if (in_array($currency, self::THREE_DECIMAL_CURRENCIES, true)) {
            // Stripe requires three-decimal amounts to be a multiple of 10.
            return (int) (round($amount * 100) * 10);
        }

        return (int) round($amount * 100);
    }

    /**
     * Inverse of toStripeMinorUnits(): convert a Stripe smallest-unit integer
     * back to the decimal amount stored on vol_donations.amount.
     */
    private static function fromStripeMinorUnits(int $minorUnits, string $currency): float
    {
        $currency = strtolower($currency);

        if (in_array($currency, self::ZERO_DECIMAL_CURRENCIES, true)) {
            return (float) $minorUnits;
        }

        if (in_array($currency, self::THREE_DECIMAL_CURRENCIES, true)) {
            return $minorUnits / 1000;
        }

        return $minorUnits / 100;
    }

    /**
     * Create a Stripe PaymentIntent and a pending donation record.
     *
     * @param int   $userId   Authenticated user ID
     * @param int   $tenantId Current tenant ID
     * @param array $data     Keys: amount (decimal), currency (3-letter ISO),
     *                        giving_day_id?, opportunity_id?, community_project_id?,
     *                        message?, is_anonymous?, fund_code?, gift_aid?
     * @return array{client_secret: string, donation_id: int}
     *
     * @throws \RuntimeException On Stripe API failure
     * @throws \InvalidArgumentException On validation failure
     */
    public static function createPaymentIntent(int $userId, int $tenantId, array $data): array
    {
        $amount = (float) ($data['amount'] ?? 0);
        if ($amount < 0.50) {
            throw new \InvalidArgumentException('Donation amount must be at least 0.50.');
        }

        $tenantCurrency = strtolower(trim((string) TenantContext::runForTenant($tenantId, fn () => TenantContext::getCurrency())));
        $currency = strtolower(trim((string) ($data['currency'] ?? $tenantCurrency)));

        if (strlen($currency) !== 3) {
            throw new \InvalidArgumentException('Currency must be a 3-letter ISO code.');
        }
        // Donations must be in the community's configured currency. Accepting an
        // arbitrary client-supplied currency (a) enabled the zero-decimal 100×
        // mischarge and (b) let a donor inflate a giving day's single-currency
        // running total with a cheap foreign currency (raised_amount sums the
        // raw numeric amount regardless of currency).
        if ($tenantCurrency !== '' && strlen($tenantCurrency) === 3 && $currency !== $tenantCurrency) {
            throw new \InvalidArgumentException(
                __('api.vol_donation_currency_mismatch', ['currency' => strtoupper($tenantCurrency)])
            );
        }

        // Resolve the ACTING user by global id only. $userId is requireAuth()
        // (the caller themselves) and users.id is the global PK, so there is no
        // IDOR. Do NOT tenant-scope this self-lookup: a platform super-admin /
        // cross-tenant actor whose home tenant differs from the request tenant
        // would otherwise be invisible here and get a spurious 'User not found'
        // 500 on a perfectly valid donation. All donation/record writes below stay
        // tenant-scoped.
        $user = DB::table('users')
            ->where('id', $userId)
            ->first(['id', 'first_name', 'last_name', 'profile_type', 'organization_name', 'email', 'stripe_customer_id']);

        if (!$user) {
            throw new \RuntimeException('User not found.');
        }

        $client = StripeService::client();
        $tenantStripeAccountId = DonationStripeAccountService::accountIdForTenantReadyForCharges($tenantId);
        $paymentRoute = DonationStripeAccountService::routeForAccountId($tenantStripeAccountId);

        // Platform fallback can reuse the platform customer. Direct Connect
        // donations create the PaymentIntent in the tenant account, where the
        // platform customer ID would be invalid unless separately mapped.
        $stripeCustomerId = $tenantStripeAccountId ? null : $user->stripe_customer_id;

        if (! $tenantStripeAccountId && empty($stripeCustomerId)) {
            try {
                $customer = $client->customers->create([
                    'email' => $user->email,
                    'name' => UserDisplayName::resolve($user),
                    'metadata' => [
                        'nexus_user_id' => $userId,
                        'nexus_tenant_id' => $tenantId,
                    ],
                ]);
                $stripeCustomerId = $customer->id;

                // Persist against the same global actor row the SELECT resolved.
                // Tenant-scoping this UPDATE would match 0 rows for a cross-tenant
                // actor, so the new Stripe customer id would never save and every
                // donation would mint a fresh orphan customer.
                DB::table('users')
                    ->where('id', $userId)
                    ->update(['stripe_customer_id' => $stripeCustomerId]);
            } catch (\Exception $e) {
                Log::error('Stripe: failed to create customer', [
                    'user_id' => $userId,
                    'tenant_id' => $tenantId,
                    'error' => $e->getMessage(),
                ]);
                throw new \RuntimeException('Failed to create Stripe customer: ' . $e->getMessage());
            }
        }

        $tenant = DB::table('tenants')
            ->where('id', $tenantId)
            ->first(['name', 'slug']);
        $tenantName = (string) (($tenant->name ?? null) ?: 'Community');
        $tenantSlug = (string) (($tenant->slug ?? null) ?: '');

        // Create PaymentIntent
        try {
            $paymentIntentParams = [
                'amount' => self::toStripeMinorUnits($amount, $currency),
                'currency' => $currency,
                'description' => "Donation to {$tenantName}",
                'metadata' => [
                    'nexus_tenant_id' => (string) $tenantId,
                    'nexus_tenant_name' => $tenantName,
                    'nexus_tenant_slug' => $tenantSlug,
                    'nexus_user_id' => (string) $userId,
                    'nexus_donation_type' => 'monetary',
                    'nexus_payment_route' => $paymentRoute,
                    'nexus_stripe_account_id' => $tenantStripeAccountId ?: 'platform_default',
                ],
            ];

            if ($stripeCustomerId) {
                $paymentIntentParams['customer'] = $stripeCustomerId;
            }

            $stripeOptions = $tenantStripeAccountId ? ['stripe_account' => $tenantStripeAccountId] : [];
            $paymentIntent = $stripeOptions
                ? $client->paymentIntents->create($paymentIntentParams, $stripeOptions)
                : $client->paymentIntents->create($paymentIntentParams);
        } catch (\Exception $e) {
            Log::error('Stripe: failed to create PaymentIntent', [
                'user_id' => $userId,
                'tenant_id' => $tenantId,
                'stripe_account_id' => $tenantStripeAccountId,
                'amount' => $amount,
                'currency' => $currency,
                'error' => $e->getMessage(),
            ]);
            throw new \RuntimeException('Failed to create payment intent: ' . $e->getMessage());
        }

        // Create pending donation record in a transaction
        $donation = DB::transaction(function () use (
            $tenantId, $userId, $data, $amount, $currency, $paymentIntent, $user, $tenantStripeAccountId, $paymentRoute
        ) {
            $giftAid = self::normalizeGiftAidDeclaration($data, $currency);

            $attributes = [
                'tenant_id' => $tenantId,
                'user_id' => $userId,
                'opportunity_id' => isset($data['opportunity_id']) ? (int) $data['opportunity_id'] : null,
                'community_project_id' => isset($data['community_project_id']) ? (int) $data['community_project_id'] : null,
                'giving_day_id' => isset($data['giving_day_id']) ? (int) $data['giving_day_id'] : null,
                'fund_code' => self::normalizeFundCode($data['fund_code'] ?? null),
                'amount' => $amount,
                'currency' => strtoupper($currency),
                'payment_method' => 'stripe',
                'payment_reference' => '',
                'payment_route' => $paymentRoute,
                'donor_name' => UserDisplayName::resolve($user),
                'donor_email' => $user->email ?? '',
                'message' => trim($data['message'] ?? ''),
                'is_anonymous' => !empty($data['is_anonymous']) ? 1 : 0,
                'status' => 'pending',
                'gift_aid_claim_status' => $giftAid['claim_status'],
                'gift_aid_declaration_name' => $giftAid['declaration_name'],
                'gift_aid_address_line1' => $giftAid['address_line1'],
                'gift_aid_address_line2' => $giftAid['address_line2'],
                'gift_aid_town' => $giftAid['town'],
                'gift_aid_postcode' => $giftAid['postcode'],
                'gift_aid_country' => $giftAid['country'],
                'gift_aid_consented_at' => $giftAid['consented_at'],
                'stripe_payment_intent_id' => $paymentIntent->id,
                'stripe_account_id' => $tenantStripeAccountId,
                'created_at' => now(),
            ];

            return VolDonation::create(self::filterVolDonationColumns($attributes));
        });

        Log::info('Stripe: PaymentIntent created for donation', [
            'donation_id' => $donation->id,
            'payment_intent_id' => $paymentIntent->id,
            'user_id' => $userId,
            'tenant_id' => $tenantId,
            'payment_route' => $paymentRoute,
            'stripe_account_id' => $tenantStripeAccountId,
            'amount' => $amount,
            'currency' => $currency,
        ]);

        return [
            'client_secret' => $paymentIntent->client_secret,
            'donation_id' => $donation->id,
        ];
    }

    private static function normalizeFundCode(mixed $value): string
    {
        $fundCode = strtolower(trim((string) $value));
        if ($fundCode === '') {
            return 'general';
        }

        $fundCode = preg_replace('/[^a-z0-9_-]+/', '-', $fundCode) ?: 'general';

        return substr(trim($fundCode, '-_'), 0, 80) ?: 'general';
    }

    /**
     * @param array<string, mixed> $attributes
     * @return array<string, mixed>
     */
    private static function filterVolDonationColumns(array $attributes): array
    {
        static $columns = null;

        if ($columns === null) {
            $columns = array_flip(\Illuminate\Support\Facades\Schema::getColumnListing('vol_donations'));
        }

        return array_intersect_key($attributes, $columns);
    }

    /**
     * Normalise a donor's Gift Aid declaration into vol_donations columns.
     *
     * Gift Aid is a UK/HMRC scheme: only donations made in GBP can be
     * claimed, so a declaration is only marked 'ready' when the donation
     * currency is GBP in addition to the GB address requirements. Non-GBP
     * donations are recorded as 'not_eligible' regardless of address.
     *
     * @param string $currency 3-letter ISO currency code of the donation (any case)
     * @return array{claim_status:string,declaration_name:?string,address_line1:?string,address_line2:?string,town:?string,postcode:?string,country:?string,consented_at:?string}
     */
    private static function normalizeGiftAidDeclaration(array $data, string $currency): array
    {
        $giftAid = is_array($data['gift_aid'] ?? null) ? $data['gift_aid'] : [];
        $enabled = !empty($data['gift_aid_enabled']) || !empty($giftAid['enabled']);
        $country = strtoupper(trim((string) ($giftAid['country'] ?? $data['gift_aid_country'] ?? 'GB')));
        $name = trim((string) ($giftAid['declaration_name'] ?? $data['gift_aid_declaration_name'] ?? ''));
        $line1 = trim((string) ($giftAid['address_line1'] ?? $data['gift_aid_address_line1'] ?? ''));
        $line2 = trim((string) ($giftAid['address_line2'] ?? $data['gift_aid_address_line2'] ?? ''));
        $town = trim((string) ($giftAid['town'] ?? $data['gift_aid_town'] ?? ''));
        $postcode = strtoupper(trim((string) ($giftAid['postcode'] ?? $data['gift_aid_postcode'] ?? '')));
        $isGbp = strtolower(trim($currency)) === 'gbp';
        $ready = $enabled && $isGbp && $country === 'GB' && $name !== '' && $line1 !== '' && $postcode !== '';

        return [
            'claim_status' => $ready ? 'ready' : 'not_eligible',
            'declaration_name' => $ready ? $name : null,
            'address_line1' => $ready ? $line1 : null,
            'address_line2' => $ready && $line2 !== '' ? $line2 : null,
            'town' => $ready && $town !== '' ? $town : null,
            'postcode' => $ready ? $postcode : null,
            'country' => $ready ? 'GB' : null,
            'consented_at' => $ready ? now()->toDateTimeString() : null,
        ];
    }

    /**
     * Handle a payment_intent.succeeded webhook event.
     *
     * Marks the donation as completed and increments giving day totals.
     * Idempotent: skips if donation is already completed.
     *
     * @param object $paymentIntent Stripe PaymentIntent object from webhook
     */
    public static function handlePaymentSucceeded(object $paymentIntent): void
    {
        $piId = $paymentIntent->id ?? null;

        if (!$piId) {
            Log::warning('Stripe donation: payment_intent.succeeded with no ID');
            return;
        }

        // Tenant scoping: derive tenant from PaymentIntent metadata when present,
        // and cross-check against the donation record to prevent cross-tenant
        // mix-ups on lookup-by-PI (PI IDs are globally unique, but defense-in-depth).
        $metaTenantId = isset($paymentIntent->metadata->nexus_tenant_id)
            ? (int) $paymentIntent->metadata->nexus_tenant_id
            : null;

        $query = DB::table('vol_donations')->where('stripe_payment_intent_id', $piId);
        if ($metaTenantId) {
            $query->where('tenant_id', $metaTenantId);
        }
        $donation = $query->first();

        if (!$donation) {
            Log::info('Stripe donation: no matching donation for PaymentIntent', [
                'payment_intent_id' => $piId,
                'meta_tenant_id' => $metaTenantId,
            ]);
            return;
        }

        // Idempotent: skip if already completed
        if ($donation->status === 'completed') {
            Log::info('Stripe donation: already completed, skipping', [
                'donation_id' => $donation->id,
                'payment_intent_id' => $piId,
            ]);
            // Email failure must NOT fail the webhook: the money state is
            // already correct, and throwing makes Stripe retry the event for
            // days (a suppressed/bounced donor address fails permanently).
            // The failure marker (receipt_email_failed_at) is kept for ops.
            if (empty($donation->receipt_email_sent_at) && !self::sendDonationReceiptEmail($donation)) {
                Log::warning('Stripe donation: receipt email not sent (will not fail webhook)', [
                    'donation_id' => $donation->id,
                ]);
            }
            return;
        }

        $transitioned = DB::transaction(function () use ($donation) {
            // Re-read under lock. The status pre-check above runs OUTSIDE this
            // transaction, so a concurrent/late charge.refunded or a reclaimed-
            // and-replayed event could have moved the row. Only pending →
            // completed is valid; a completed/refunded/failed row must not be
            // re-completed or re-increment the giving day.
            $locked = DB::table('vol_donations')
                ->where('id', $donation->id)
                ->where('tenant_id', $donation->tenant_id)
                ->lockForUpdate()
                ->first();

            if (!$locked || $locked->status !== 'pending') {
                return false;
            }

            DB::table('vol_donations')
                ->where('id', $donation->id)
                ->where('tenant_id', $donation->tenant_id)
                ->where('status', 'pending')
                ->update(['status' => 'completed']);

            // Increment giving day raised_amount if applicable
            if (!empty($locked->giving_day_id)) {
                DB::table('vol_giving_days')
                    ->where('id', $locked->giving_day_id)
                    ->where('tenant_id', $donation->tenant_id)
                    ->increment('raised_amount', (float) $locked->amount);
            }

            return true;
        });

        if (!$transitioned) {
            // Another path (late refund, replayed event) already resolved this
            // donation — do not send a fresh receipt or admin notification.
            Log::info('Stripe donation: succeeded event skipped (not pending)', [
                'donation_id' => $donation->id,
                'payment_intent_id' => $piId,
            ]);
            return;
        }

        Log::info('Stripe donation: payment succeeded', [
            'donation_id' => $donation->id,
            'payment_intent_id' => $piId,
            'amount' => $donation->amount,
        ]);

        if (!self::sendDonationReceiptEmail($donation)) {
            Log::warning('Stripe donation: receipt email not sent (will not fail webhook)', [
                'donation_id' => $donation->id,
            ]);
        }

        // Notify tenant admins that a donation was received. Only on first
        // completion (this branch) so re-delivered webhook events don't re-notify.
        // Self-isolating, but guarded again here: a notification failure must
        // never fail the webhook or Stripe retries the event for days.
        try {
            DonationAdminNotificationService::notifyDonationReceived($donation);
        } catch (\Throwable $e) {
            Log::warning('Stripe donation: admin notification failed (will not fail webhook)', [
                'donation_id' => $donation->id,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private static function sendDonationReceiptEmail(object $donation): bool
    {
        try {
            $donorEmail = $donation->donor_email ?? null;
            $donorName  = $donation->donor_name ?? null;
            $donorLocale = null;

            // Fall back to fetching from users table if donation row lacks email,
            // and always pull preferred_language for recipient-locale rendering.
            if (!empty($donation->user_id)) {
                $userRow = DB::table('users')
                    ->where('id', $donation->user_id)
                    ->where('tenant_id', $donation->tenant_id)
                    ->select(['email', 'first_name', 'last_name', 'profile_type', 'organization_name', 'name', 'preferred_language'])
                    ->first();
                if ($userRow) {
                    $donorLocale = $userRow->preferred_language ?? null;
                    if (empty($donorEmail)) {
                        $donorEmail = $userRow->email ?? '';
                        $donorName  = $donorName ?: (UserDisplayName::resolve($userRow) ?: ($userRow->name ?? ''));
                    }
                }
            }

            if (empty($donorEmail)) {
                self::markDonationReceiptEmailAttempt($donation, false);
                return false;
            }

                // Set tenant context if running from webhook (no active context)
                $previousTenantId = TenantContext::currentId();

                try {
                    if ($donation->tenant_id) {
                        TenantContext::setById((int) $donation->tenant_id);
                    }

                    // Render the receipt in the donor's preferred_language so subject,
                    // CTA, info card labels, and body all match THEIR locale rather
                    // than the queue worker's default.
                    $sent = false;
                    LocaleContext::withLocale($donorLocale, function () use (&$sent, $donation, $donorEmail, $donorName) {
                        $tenantName    = TenantContext::getSetting('site_name', 'Project NEXUS');
                        $baseUrl       = TenantContext::getFrontendUrl();
                        $basePath      = TenantContext::getSlugPrefix();
                        $accountUrl    = $baseUrl . $basePath . '/settings';
                        $amountDisplay = number_format((float) $donation->amount, 2) . ' ' . strtoupper($donation->currency ?? 'EUR');
                        $dateDisplay   = \Carbon\Carbon::now()->locale((string) app()->getLocale())->isoFormat('LL');
                        $firstName     = explode(' ', trim($donorName ?: __('emails.common.fallback_name')))[0];

                        $infoCard = [
                            __('emails_created.donation.label_amount') => $amountDisplay,
                            __('emails_created.donation.label_date')   => $dateDisplay,
                        ];

                        $html = EmailTemplateBuilder::make()
                            ->theme('success')
                            ->title(__('emails_created.donation.title'))
                            ->previewText(__('emails_created.donation.preview', ['community' => $tenantName]))
                            ->greeting($firstName)
                            ->paragraph(__('emails_created.donation.body', ['community' => $tenantName]))
                            ->infoCard($infoCard)
                            ->button(__('emails_created.donation.cta'), $accountUrl)
                            ->render();

                        $sent = \App\Services\EmailDispatchService::sendRaw(
                            $donorEmail,
                            __('emails_created.donation.subject', ['community' => $tenantName]),
                            $html,
                            null,
                            null,
                            null,
                            'donation_receipt',
                            ['tenant_id' => (int) $donation->tenant_id]
                        );

                        if (!$sent) {
                            Log::warning('[StripeDonationService] donation receipt email returned false', [
                                'donation_id' => $donation->id ?? null,
                            ]);
                        }
                    });

                    self::markDonationReceiptEmailAttempt($donation, $sent);

                    return $sent;
                } finally {
                    if ($previousTenantId !== null) {
                        TenantContext::setById($previousTenantId);
                    } else {
                        TenantContext::reset();
                    }
                }
        } catch (\Throwable $e) {
            self::markDonationReceiptEmailAttempt($donation, false);
            Log::warning('[StripeDonationService] donation receipt email failed: ' . $e->getMessage());
        }

        return false;
    }

    private static function markDonationReceiptEmailAttempt(object $donation, bool $sent): void
    {
        DB::table('vol_donations')
            ->where('id', $donation->id)
            ->where('tenant_id', $donation->tenant_id)
            ->update([
                'receipt_email_sent_at' => $sent ? now() : null,
                'receipt_email_failed_at' => $sent ? null : now(),
            ]);
    }

    /**
     * Handle a payment_intent.payment_failed webhook event.
     *
     * Marks the donation as failed.
     *
     * @param object $paymentIntent Stripe PaymentIntent object from webhook
     */
    public static function handlePaymentFailed(object $paymentIntent): void
    {
        $piId = $paymentIntent->id ?? null;

        if (!$piId) {
            Log::warning('Stripe donation: payment_intent.payment_failed with no ID');
            return;
        }

        $metaTenantId = isset($paymentIntent->metadata->nexus_tenant_id)
            ? (int) $paymentIntent->metadata->nexus_tenant_id
            : null;

        $query = DB::table('vol_donations')->where('stripe_payment_intent_id', $piId);
        if ($metaTenantId) {
            $query->where('tenant_id', $metaTenantId);
        }
        $donation = $query->first();

        if (!$donation) {
            Log::info('Stripe donation: no matching donation for failed PaymentIntent', [
                'payment_intent_id' => $piId,
                'meta_tenant_id' => $metaTenantId,
            ]);
            return;
        }

        // Only pending → failed. Stripe does not guarantee event ordering, so a
        // late payment_failed from a first attempt must never clobber a donation
        // already completed (or refunded) by a later attempt's succeeded event.
        $affected = DB::table('vol_donations')
            ->where('id', $donation->id)
            ->where('tenant_id', $donation->tenant_id)
            ->where('status', 'pending')
            ->update(['status' => 'failed']);

        Log::warning('Stripe donation: payment failed', [
            'donation_id' => $donation->id,
            'payment_intent_id' => $piId,
            'applied' => $affected > 0,
        ]);
    }

    /**
     * Handle a charge.refunded webhook event.
     *
     * Marks the donation as refunded and decrements giving day totals.
     *
     * @param object $charge Stripe Charge object from webhook
     */
    public static function handleChargeRefunded(object $charge): void
    {
        $piId = $charge->payment_intent ?? null;

        if (!$piId) {
            Log::warning('Stripe donation: charge.refunded with no payment_intent');
            return;
        }

        // Pull tenant from charge.metadata if Stripe copied it from the PI
        $metaTenantId = isset($charge->metadata->nexus_tenant_id)
            ? (int) $charge->metadata->nexus_tenant_id
            : null;

        $query = DB::table('vol_donations')->where('stripe_payment_intent_id', $piId);
        if ($metaTenantId) {
            $query->where('tenant_id', $metaTenantId);
        }
        $donation = $query->first();

        if (!$donation) {
            Log::info('Stripe donation: no matching donation for refunded charge', [
                'payment_intent_id' => $piId,
                'meta_tenant_id' => $metaTenantId,
            ]);
            return;
        }

        if ($donation->status === 'refunded') {
            Log::info('Stripe donation: already refunded, skipping', [
                'donation_id' => $donation->id,
            ]);
            return;
        }

        // charge.refunded also fires for PARTIAL refunds. A partial refund must
        // not flip the donation to refunded (it is still partly a live gift),
        // but the refunded slice has to leave the money reporting: the giving
        // day total is decremented by the delta and the Gift Aid layer claims
        // only the retained amount (2026-07-10 audit M1 — over-claim risk).
        $amountRefunded = (int) ($charge->amount_refunded ?? 0);
        $chargeAmount = (int) ($charge->amount ?? 0);
        if ($chargeAmount <= 0 || $amountRefunded <= 0) {
            Log::warning('Stripe donation: charge.refunded with no usable amounts', [
                'donation_id' => $donation->id,
                'amount_refunded' => $amountRefunded,
                'charge_amount' => $chargeAmount,
            ]);
            return;
        }

        if ($amountRefunded < $chargeAmount) {
            $currency = strtolower((string) ($charge->currency ?? $donation->currency ?? ''));
            self::applyPartialDonationRefund(
                $donation,
                self::fromStripeMinorUnits($amountRefunded, $currency)
            );
            return;
        }

        // Shared, idempotent refund-ledger step (see applyDonationRefund): the
        // admin createRefund() path and this charge.refunded webhook may race, so
        // both converge on a single decrement under a row lock.
        self::applyDonationRefund($donation);

        Log::info('Stripe donation: charge refunded', [
            'donation_id' => $donation->id,
            'payment_intent_id' => $piId,
            'amount' => $donation->amount,
        ]);
    }

    /**
     * Idempotently mark a donation refunded and decrement its giving-day total
     * exactly once, under a row lock. Shared by the admin createRefund() path and
     * the charge.refunded webhook — the admin refund itself fires that webhook, so
     * either may run first and both must converge on a single decrement. A refund
     * racing a still-pending donation does not drive the total negative (only a
     * locked 'completed' row is decremented).
     */
    private static function applyDonationRefund(object $donation): void
    {
        DB::transaction(function () use ($donation) {
            $locked = DB::table('vol_donations')
                ->where('id', $donation->id)
                ->where('tenant_id', $donation->tenant_id)
                ->lockForUpdate()
                ->first();

            if (!$locked || $locked->status === 'refunded') {
                return;
            }

            $wasCompleted = $locked->status === 'completed';

            $update = ['status' => 'refunded'];
            if (property_exists($locked, 'amount_refunded')) {
                $update['amount_refunded'] = (float) $locked->amount;
            }
            // A declaration already submitted to HMRC needs an adjustment on the
            // next claim — flag it (keeping gift_aid_claimed_at as evidence).
            if (($locked->gift_aid_claim_status ?? null) === 'claimed') {
                $update['gift_aid_claim_status'] = 'refund_after_claim';
            }

            DB::table('vol_donations')
                ->where('id', $donation->id)
                ->where('tenant_id', $donation->tenant_id)
                ->update($update);

            if ($wasCompleted && !empty($locked->giving_day_id)) {
                // A prior PARTIAL refund already took its slice out of the
                // giving day — only the still-unaccounted remainder comes off
                // now, or the two paths together would over-decrement.
                $alreadyRefunded = (float) ($locked->amount_refunded ?? 0);
                $remainder = round((float) $locked->amount - $alreadyRefunded, 2);
                if ($remainder > 0) {
                    DB::table('vol_giving_days')
                        ->where('id', $locked->giving_day_id)
                        ->where('tenant_id', $donation->tenant_id)
                        ->decrement('raised_amount', $remainder);
                }
            }
        });
    }

    /**
     * Idempotently record a PARTIAL refund. Stripe's charge.amount_refunded is
     * cumulative across all refunds of a charge, so each webhook delivery is
     * delta-applied under a row lock: replays and repeated partial refunds
     * decrement the giving day exactly once per refunded slice. The donation
     * deliberately stays `completed` — only the refunded portion leaves the
     * reporting (Gift Aid nets amount_refunded out at the export layer).
     *
     * @param object $donation       Pre-read vol_donations row
     * @param float  $refundedTotal  Cumulative refunded amount in donation currency
     */
    private static function applyPartialDonationRefund(object $donation, float $refundedTotal): void
    {
        if (!Schema::hasColumn('vol_donations', 'amount_refunded')) {
            Log::warning('Stripe donation: partial refund received but vol_donations.amount_refunded is missing — run migrations; reporting stays overstated', [
                'donation_id' => $donation->id,
            ]);
            return;
        }

        DB::transaction(function () use ($donation, $refundedTotal) {
            $locked = DB::table('vol_donations')
                ->where('id', $donation->id)
                ->where('tenant_id', $donation->tenant_id)
                ->lockForUpdate()
                ->first();

            if (!$locked || $locked->status === 'refunded') {
                return;
            }

            $newTotal = min(round($refundedTotal, 2), (float) $locked->amount);
            $delta = round($newTotal - (float) ($locked->amount_refunded ?? 0), 2);
            if ($delta <= 0) {
                return;
            }

            $update = ['amount_refunded' => $newTotal];
            // Already submitted to HMRC → the next claim needs an adjustment,
            // exactly as for full refunds. A still-'ready' row stays ready: the
            // export claims amount − amount_refunded, so it can never over-claim.
            if (($locked->gift_aid_claim_status ?? null) === 'claimed') {
                $update['gift_aid_claim_status'] = 'refund_after_claim';
            }

            DB::table('vol_donations')
                ->where('id', $donation->id)
                ->where('tenant_id', $donation->tenant_id)
                ->update($update);

            // Only a completed donation ever incremented the giving day, so only
            // then is there anything to take back out.
            if ($locked->status === 'completed' && !empty($locked->giving_day_id)) {
                DB::table('vol_giving_days')
                    ->where('id', $locked->giving_day_id)
                    ->where('tenant_id', $donation->tenant_id)
                    ->decrement('raised_amount', $delta);
            }

            Log::info('Stripe donation: partial refund recorded', [
                'donation_id' => $donation->id,
                'amount_refunded_total' => $newTotal,
                'delta' => $delta,
            ]);
        });
    }

    /**
     * Create a refund for a completed donation (admin action).
     *
     * @param int $donationId Donation ID to refund
     * @param int $tenantId   Current tenant ID (security check)
     * @return array{success: bool, refund_id: string}
     *
     * @throws \RuntimeException On Stripe API failure or invalid state
     */
    public static function createRefund(int $donationId, int $tenantId): array
    {
        $donation = DB::table('vol_donations')
            ->where('id', $donationId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$donation) {
            throw new \RuntimeException('Donation not found.');
        }

        if ($donation->status !== 'completed') {
            throw new \RuntimeException('Only completed donations can be refunded.');
        }

        if (empty($donation->stripe_payment_intent_id)) {
            throw new \RuntimeException('Donation has no associated Stripe payment.');
        }

        $client = StripeService::client();
        $stripeAccountId = DonationStripeAccountService::normalizeAccountId($donation->stripe_account_id ?? null);

        try {
            $refundParams = [
                'payment_intent' => $donation->stripe_payment_intent_id,
            ];
            $stripeOptions = DonationStripeAccountService::stripeOptionsForAccountId($stripeAccountId);
            $refund = $stripeOptions
                ? $client->refunds->create($refundParams, $stripeOptions)
                : $client->refunds->create($refundParams);
        } catch (\Exception $e) {
            Log::error('Stripe: failed to create refund', [
                'donation_id' => $donationId,
                'payment_intent_id' => $donation->stripe_payment_intent_id,
                'stripe_account_id' => $stripeAccountId,
                'error' => $e->getMessage(),
            ]);
            throw new \RuntimeException('Failed to process refund: ' . $e->getMessage());
        }

        // Idempotent under a row lock: creating the Stripe refund above fires a
        // charge.refunded webhook that handleChargeRefunded() also processes.
        // Re-reading the locked row here (instead of trusting the stale pre-Stripe
        // read) ensures the giving day is decremented exactly once whichever path
        // commits first (VOL-BE-003).
        self::applyDonationRefund($donation);

        Log::info('Stripe donation: admin refund processed', [
            'donation_id' => $donationId,
            'refund_id' => $refund->id,
            'payment_route' => DonationStripeAccountService::routeForAccountId($stripeAccountId),
            'stripe_account_id' => $stripeAccountId,
            'amount' => $donation->amount,
        ]);

        return [
            'success' => true,
            'refund_id' => $refund->id,
        ];
    }

    /**
     * Get a formatted donation receipt.
     *
     * Accessible by the donor or by an admin of the same tenant.
     *
     * @param int $donationId Donation ID
     * @param int $userId     Requesting user ID
     * @param int $tenantId   Current tenant ID
     * @return array|null Receipt data or null if not found/not authorized
     */
    public static function getDonationReceipt(int $donationId, int $userId, int $tenantId): ?array
    {
        $donation = DB::table('vol_donations')
            ->where('id', $donationId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$donation) {
            return null;
        }

        // Check authorization: must be the donor or an admin
        $isOwner = (int) $donation->user_id === $userId;
        $isAdmin = false;

        if (!$isOwner) {
            $user = DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->first(['role', 'is_super_admin', 'is_tenant_super_admin']);

            if ($user) {
                $isAdmin = in_array($user->role ?? '', ['admin', 'tenant_admin', 'super_admin', 'god'], true)
                    || !empty($user->is_super_admin)
                    || !empty($user->is_tenant_super_admin);
            }
        }

        if (!$isOwner && !$isAdmin) {
            return null;
        }

        $tenant = TenantContext::get();
        $tenantName = $tenant['name'] ?? 'Community';

        // Build donor display name
        $donorName = $donation->donor_name ?? '';
        if ($donation->is_anonymous) {
            $donorName = __('api.vol_activity_donor_anonymous');
        }

        return [
            'donation_id' => $donation->id,
            'donor_name' => $donorName,
            'donor_email' => $donation->is_anonymous ? null : ($donation->donor_email ?? null),
            'amount' => number_format((float) $donation->amount, 2, '.', ''),
            'currency' => $donation->currency,
            'status' => $donation->status,
            'payment_method' => $donation->payment_method,
            'payment_reference' => $donation->stripe_payment_intent_id ?? $donation->payment_reference ?? '',
            'message' => $donation->message ?? '',
            'tenant_name' => $tenantName,
            'date' => $donation->created_at,
            'is_anonymous' => (bool) $donation->is_anonymous,
        ];
    }
}
