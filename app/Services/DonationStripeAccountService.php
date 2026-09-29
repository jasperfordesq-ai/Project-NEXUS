<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Resolves tenant-owned Stripe Connect accounts for donation flows.
 */
class DonationStripeAccountService
{
    public const SETTING_CONNECT_ACCOUNT_ID = 'donations.stripe_connect_account_id';
    public const ROUTE_PLATFORM_DEFAULT = 'platform_default';
    public const ROUTE_TENANT_CONNECT = 'tenant_connect';

    /**
     * Metadata written on every Connect account created by createOrResumeOnboarding().
     * Only the platform (holding the secret key) can set metadata on its connected
     * accounts, so these two values are the record that an account was onboarded
     * by this platform FOR a given community (F-263).
     */
    public const METADATA_TENANT_ID = 'nexus_tenant_id';
    public const METADATA_PURPOSE = 'nexus_account_purpose';
    public const ACCOUNT_PURPOSE_DONATIONS = 'donations';

    public static function accountIdForTenant(int $tenantId): ?string
    {
        $value = app(TenantSettingsService::class)->get($tenantId, self::SETTING_CONNECT_ACCOUNT_ID);

        return self::normalizeAccountId(is_string($value) ? $value : null);
    }

    /**
     * @return array<string, string>
     */
    public static function stripeOptionsForTenant(int $tenantId): array
    {
        $accountId = self::accountIdForTenant($tenantId);

        return $accountId ? ['stripe_account' => $accountId] : [];
    }

    /**
     * @return array<string, string>
     */
    public static function stripeOptionsForAccountId(?string $accountId): array
    {
        $accountId = self::normalizeAccountId($accountId);

        return $accountId ? ['stripe_account' => $accountId] : [];
    }

    public static function routeForTenant(int $tenantId): string
    {
        return self::routeForAccountId(self::accountIdForTenant($tenantId));
    }

    public static function routeForAccountId(?string $accountId): string
    {
        return self::normalizeAccountId($accountId) ? self::ROUTE_TENANT_CONNECT : self::ROUTE_PLATFORM_DEFAULT;
    }

    public static function normalizeAccountId(?string $value): ?string
    {
        $accountId = is_string($value) ? trim($value) : '';

        if ($accountId === '' || preg_match('/^acct_[A-Za-z0-9_]+$/', $accountId) !== 1) {
            return null;
        }

        return $accountId;
    }

    /**
     * @return array{stripe_connect_account_id:string,active_stripe_account_id:string,payment_route:string,configured_payment_route:string,account_status:array<string,mixed>,fallback_reason:?string}
     */
    public static function settingsPayloadForTenant(int $tenantId): array
    {
        $accountId = self::accountIdForTenant($tenantId);
        $accountStatus = $accountId ? self::accountStatusForTenant($tenantId) : self::notConnectedStatus();
        $activeAccountId = self::accountIdForTenantReadyForCharges($tenantId, $accountStatus);

        return [
            'stripe_connect_account_id' => $accountId ?? '',
            'active_stripe_account_id' => $activeAccountId ?? '',
            'payment_route' => self::routeForAccountId($activeAccountId),
            'configured_payment_route' => self::routeForAccountId($accountId),
            'account_status' => $accountStatus,
            'fallback_reason' => $accountId && !$activeAccountId ? 'stripe_connect_not_ready' : null,
        ];
    }

    public static function accountIdForTenantReadyForCharges(int $tenantId, ?array $knownStatus = null): ?string
    {
        $accountId = self::accountIdForTenant($tenantId);
        if (!$accountId) {
            return null;
        }

        $status = $knownStatus ?? self::accountStatusForTenant($tenantId);

        return ($status['state'] ?? null) === 'ready' ? $accountId : null;
    }

    public static function chargeRouteForTenant(int $tenantId): string
    {
        return self::routeForAccountId(self::accountIdForTenantReadyForCharges($tenantId));
    }

    /**
     * Create or resume tenant-level Stripe Connect onboarding.
     *
     * @return array{stripe_connect_account_id:string,payment_route:string,account_status:array<string,mixed>,onboarding_url:string}
     */
    public static function createOrResumeOnboarding(int $tenantId, string $returnUrl, string $refreshUrl): array
    {
        $accountId = self::accountIdForTenant($tenantId);
        $client = StripeService::client();
        $account = null;

        if (!$accountId) {
            $tenant = DB::table('tenants')
                ->where('id', $tenantId)
                ->first(['id', 'name', 'slug']);

            try {
                $account = $client->accounts->create([
                    'type' => 'express',
                    'metadata' => [
                        self::METADATA_TENANT_ID => (string) $tenantId,
                        'nexus_tenant_name' => (string) (($tenant->name ?? null) ?: 'Community'),
                        'nexus_tenant_slug' => (string) (($tenant->slug ?? null) ?: ''),
                        self::METADATA_PURPOSE => self::ACCOUNT_PURPOSE_DONATIONS,
                    ],
                    'capabilities' => [
                        'card_payments' => ['requested' => true],
                        'transfers' => ['requested' => true],
                    ],
                ]);
                $accountId = self::normalizeAccountId($account->id ?? null);
            } catch (\Throwable $e) {
                Log::error('DonationStripeAccountService: failed to create Connect account', [
                    'tenant_id' => $tenantId,
                    'error' => $e->getMessage(),
                ]);
                throw new \RuntimeException('Failed to create Stripe Connect account: ' . $e->getMessage(), 0, $e);
            }

            if (!$accountId) {
                throw new \RuntimeException('Stripe did not return a valid Connect account ID.');
            }

            app(TenantSettingsService::class)->set($tenantId, self::SETTING_CONNECT_ACCOUNT_ID, $accountId, 'string');

            Log::info('DonationStripeAccountService: Connect account created for tenant donations', [
                'tenant_id' => $tenantId,
                'stripe_account_id' => $accountId,
            ]);
        } else {
            // F-263: never issue an onboarding link for a saved account this
            // community's onboarding did not create — an account_onboarding
            // link lets the holder edit that account's details and payouts.
            try {
                $account = $client->accounts->retrieve($accountId);
            } catch (\Throwable $e) {
                Log::warning('DonationStripeAccountService: failed to retrieve saved Connect account before resuming onboarding', [
                    'tenant_id' => $tenantId,
                    'stripe_account_id' => $accountId,
                    'error' => $e->getMessage(),
                ]);
                throw new \RuntimeException('Failed to check the saved Stripe Connect account: ' . $e->getMessage(), 0, $e);
            }

            if (!self::accountWasOnboardedForTenant($account, $tenantId)) {
                Log::warning('DonationStripeAccountService: refused to resume onboarding for a Connect account not onboarded by this tenant', [
                    'tenant_id' => $tenantId,
                    'stripe_account_id' => $accountId,
                ]);
                throw new \RuntimeException('The saved Stripe Connect account was not created by this community\'s onboarding. Clear it and start onboarding again.');
            }
        }

        try {
            $accountLink = $client->accountLinks->create([
                'account' => $accountId,
                'refresh_url' => $refreshUrl,
                'return_url' => $returnUrl,
                'type' => 'account_onboarding',
            ]);
        } catch (\Throwable $e) {
            Log::error('DonationStripeAccountService: failed to create onboarding link', [
                'tenant_id' => $tenantId,
                'stripe_account_id' => $accountId,
                'error' => $e->getMessage(),
            ]);
            throw new \RuntimeException('Failed to create Stripe onboarding link: ' . $e->getMessage(), 0, $e);
        }

        $accountStatus = $account ? self::statusFromAccountObject($account) : self::accountStatusForTenant($tenantId);
        $activeAccountId = self::accountIdForTenantReadyForCharges($tenantId, $accountStatus);

        return [
            'stripe_connect_account_id' => $accountId,
            'payment_route' => self::routeForAccountId($activeAccountId),
            'account_status' => $accountStatus,
            'onboarding_url' => (string) $accountLink->url,
        ];
    }

    /**
     * @return array{state:string,charges_enabled:bool,payouts_enabled:bool,details_submitted:bool,requirements_due:array<int,string>,disabled_reason:?string,error:?string}
     */
    public static function accountStatusForTenant(int $tenantId): array
    {
        $accountId = self::accountIdForTenant($tenantId);
        if (!$accountId) {
            return self::notConnectedStatus();
        }

        try {
            $account = StripeService::client()->accounts->retrieve($accountId);
        } catch (\Throwable $e) {
            Log::warning('DonationStripeAccountService: failed to retrieve Connect account status', [
                'tenant_id' => $tenantId,
                'stripe_account_id' => $accountId,
                'error' => $e->getMessage(),
            ]);

            return [
                'state' => 'unknown',
                'charges_enabled' => false,
                'payouts_enabled' => false,
                'details_submitted' => false,
                'requirements_due' => [],
                'disabled_reason' => null,
                'error' => 'Stripe account status could not be checked.',
            ];
        }

        // F-263: an id this community's onboarding did not create (another
        // community's account, a marketplace seller's, anything saved before
        // the fix) is never 'ready', so charges fall back to the platform
        // route exactly as they do for an unfinished onboarding.
        if (!self::accountWasOnboardedForTenant($account, $tenantId)) {
            Log::warning('DonationStripeAccountService: saved Connect account was not onboarded by this tenant; not used for charges', [
                'tenant_id' => $tenantId,
                'stripe_account_id' => $accountId,
            ]);

            return self::notOnboardedForTenantStatus();
        }

        return self::statusFromAccountObject($account);
    }

    /**
     * True only when Stripe confirms $accountId is a Connect account that this
     * platform's donations onboarding created for $tenantId (F-263). Any
     * failure to confirm — unknown account, other tenant, other purpose,
     * Stripe unreachable — is false.
     */
    public static function isOnboardedAccountForTenant(int $tenantId, string $accountId): bool
    {
        $accountId = self::normalizeAccountId($accountId);
        if (!$accountId) {
            return false;
        }

        try {
            $account = StripeService::client()->accounts->retrieve($accountId);
        } catch (\Throwable $e) {
            Log::warning('DonationStripeAccountService: could not verify Connect account ownership', [
                'tenant_id' => $tenantId,
                'stripe_account_id' => $accountId,
                'error' => $e->getMessage(),
            ]);

            return false;
        }

        return self::accountWasOnboardedForTenant($account, $tenantId);
    }

    /**
     * Whether a retrieved Stripe account object carries the metadata that
     * createOrResumeOnboarding() writes for $tenantId.
     */
    public static function accountWasOnboardedForTenant(object $account, int $tenantId): bool
    {
        $metadata = $account->metadata ?? null;

        return self::metadataValue($metadata, self::METADATA_TENANT_ID) === (string) $tenantId
            && self::metadataValue($metadata, self::METADATA_PURPOSE) === self::ACCOUNT_PURPOSE_DONATIONS;
    }

    private static function metadataValue(mixed $metadata, string $key): ?string
    {
        if (is_array($metadata)) {
            $value = $metadata[$key] ?? null;
        } elseif (is_object($metadata)) {
            $value = $metadata->{$key} ?? null;
        } else {
            return null;
        }

        return is_scalar($value) ? (string) $value : null;
    }

    /**
     * @return array{state:string,charges_enabled:bool,payouts_enabled:bool,details_submitted:bool,requirements_due:array<int,string>,disabled_reason:?string,error:?string}
     */
    public static function statusFromAccountObject(object $account): array
    {
        $requirements = $account->requirements ?? null;
        $currentlyDue = $requirements && isset($requirements->currently_due) && is_array($requirements->currently_due)
            ? array_values(array_map('strval', $requirements->currently_due))
            : [];
        $disabledReason = $requirements && isset($requirements->disabled_reason)
            ? (is_string($requirements->disabled_reason) ? $requirements->disabled_reason : null)
            : null;

        $chargesEnabled = (bool) ($account->charges_enabled ?? false);
        $payoutsEnabled = (bool) ($account->payouts_enabled ?? false);
        $detailsSubmitted = (bool) ($account->details_submitted ?? false);

        if ($chargesEnabled && $payoutsEnabled) {
            $state = 'ready';
        } elseif ($disabledReason || !empty($currentlyDue)) {
            $state = 'restricted';
        } elseif ($detailsSubmitted) {
            $state = 'pending';
        } else {
            $state = 'not_connected';
        }

        return [
            'state' => $state,
            'charges_enabled' => $chargesEnabled,
            'payouts_enabled' => $payoutsEnabled,
            'details_submitted' => $detailsSubmitted,
            'requirements_due' => $currentlyDue,
            'disabled_reason' => $disabledReason,
            'error' => null,
        ];
    }

    /**
     * @return array{state:string,charges_enabled:bool,payouts_enabled:bool,details_submitted:bool,requirements_due:array<int,string>,disabled_reason:?string,error:?string}
     */
    private static function notOnboardedForTenantStatus(): array
    {
        return array_merge(self::notConnectedStatus(), [
            'error' => 'This Stripe account was not created through this community\'s Stripe Connect onboarding.',
        ]);
    }

    /**
     * @return array{state:string,charges_enabled:bool,payouts_enabled:bool,details_submitted:bool,requirements_due:array<int,string>,disabled_reason:?string,error:?string}
     */
    private static function notConnectedStatus(): array
    {
        return [
            'state' => 'not_connected',
            'charges_enabled' => false,
            'payouts_enabled' => false,
            'details_submitted' => false,
            'requirements_due' => [],
            'disabled_reason' => null,
            'error' => null,
        ];
    }
}
