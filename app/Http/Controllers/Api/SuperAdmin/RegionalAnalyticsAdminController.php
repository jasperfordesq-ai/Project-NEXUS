<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Api\BaseApiController;
use App\Services\RegionalAnalytics\RegionalAnalyticsBilling;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * AG59 — Super-admin CRUD for paid Regional Analytics subscriptions.
 *
 * Used internally by the platform sales team to provision, suspend,
 * and trigger reports for municipality / SME partner subscribers.
 *
 * 🔴 Platform-wide data: every action calls requirePlatformSuperAdmin(), which
 * refuses a tenant super admin. It used requireSuperAdmin() (which admits one)
 * until 12 Oct 2026, leaving the route group's `super-admin` middleware as the
 * only barrier (F-594).
 */
class RegionalAnalyticsAdminController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function index(): JsonResponse
    {
        $this->requirePlatformSuperAdmin();

        $subs = DB::table('regional_analytics_subscriptions')
            ->orderBy('id', 'desc')
            ->get()
            ->map(fn ($s) => $this->serializeSubscription((array) $s))
            ->all();

        return $this->respondWithData(['subscriptions' => $subs]);
    }

    public function show(int $id): JsonResponse
    {
        $this->requirePlatformSuperAdmin();

        $sub = DB::table('regional_analytics_subscriptions')->where('id', $id)->first();
        if (! $sub) {
            return $this->respondNotFound(__('api.regional_analytics_subscription_not_found'), 'SUBSCRIPTION_NOT_FOUND');
        }

        $reports = DB::table('regional_analytics_reports')
            ->where('subscription_id', $id)
            ->orderBy('id', 'desc')
            ->limit(50)
            ->get()
            ->all();

        return $this->respondWithData([
            'subscription' => $this->serializeSubscription((array) $sub),
            'reports' => $reports,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $adminId = $this->requirePlatformSuperAdmin();

        $tenantId = (int) $request->input('tenant_id', 0);
        $partnerName = trim((string) $request->input('partner_name', ''));
        $contactEmail = trim((string) $request->input('contact_email', ''));

        if ($tenantId <= 0 || $partnerName === '' || $contactEmail === '') {
            return $this->respondWithError('invalid_request', __('api.regional_analytics_required_fields'), null, 422);
        }

        $partnerType = in_array($request->input('partner_type'), ['municipality', 'sme_partner'], true)
            ? $request->input('partner_type') : 'municipality';
        $planTier = in_array($request->input('plan_tier'), ['basic', 'pro', 'enterprise'], true)
            ? $request->input('plan_tier') : 'basic';

        $modules = $request->input('enabled_modules', ['trends', 'demand_supply', 'demographics', 'footfall']);
        if (! is_array($modules)) {
            $modules = [];
        }
        $modules = array_values(array_intersect($modules, ['trends', 'demand_supply', 'demographics', 'footfall']));

        $rawToken = Str::random(64);
        $storesHash = Schema::hasColumn('regional_analytics_subscriptions', 'subscription_token_hash');

        $insert = [
            'tenant_id' => $tenantId,
            'partner_name' => $partnerName,
            'partner_type' => $partnerType,
            'contact_email' => $contactEmail,
            'billing_email' => $request->input('billing_email'),
            'plan_tier' => $planTier,
            'status' => 'trialing',
            'stripe_subscription_id' => null,
            'subscription_token' => $storesHash ? 'token-ref-new-' . Str::random(24) : $rawToken,
            'trial_ends_at' => now()->addDays(14),
            'monthly_price_cents' => max(0, (int) $request->input('monthly_price_cents', 0)),
            'currency' => strtoupper(substr((string) $request->input('currency', 'CHF'), 0, 3)),
            'enabled_modules' => json_encode($modules),
            'created_by_admin_id' => $adminId,
            'created_at' => now(),
            'updated_at' => now(),
        ];
        if ($storesHash) {
            $insert['subscription_token_hash'] = hash('sha256', $rawToken);
        }

        $id = DB::table('regional_analytics_subscriptions')->insertGetId($insert);
        if ($storesHash) {
            DB::table('regional_analytics_subscriptions')
                ->where('id', $id)
                ->update([
                    'subscription_token' => 'token-ref-' . $id . '-' . substr(hash('sha256', $rawToken), 0, 16),
                    'updated_at' => now(),
                ]);
        }

        // Optional Stripe attach (no-op if SDK absent / no price configured).
        if ((bool) $request->input('create_stripe_subscription', false)) {
            $billing = new RegionalAnalyticsBilling();
            $stripeId = $billing->createSubscription($id, $planTier, $contactEmail);
            if ($stripeId) {
                DB::table('regional_analytics_subscriptions')
                    ->where('id', $id)
                    ->update(['stripe_subscription_id' => $stripeId, 'updated_at' => now()]);
            }
        }

        return $this->respondWithData([
            'subscription_id' => $id,
            'subscription_token' => $rawToken,
        ], null, 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $this->requirePlatformSuperAdmin();

        $sub = DB::table('regional_analytics_subscriptions')->where('id', $id)->first();
        if (! $sub) {
            return $this->respondNotFound(__('api.regional_analytics_subscription_not_found'), 'SUBSCRIPTION_NOT_FOUND');
        }

        $update = ['updated_at' => now()];
        foreach (['partner_name', 'contact_email', 'billing_email', 'plan_tier', 'status', 'partner_type'] as $f) {
            if ($request->has($f)) {
                $update[$f] = $request->input($f);
            }
        }
        if ($request->has('enabled_modules')) {
            $modules = (array) $request->input('enabled_modules', []);
            $modules = array_values(array_intersect($modules, ['trends', 'demand_supply', 'demographics', 'footfall']));
            $update['enabled_modules'] = json_encode($modules);
        }
        if ($request->has('monthly_price_cents')) {
            $update['monthly_price_cents'] = max(0, (int) $request->input('monthly_price_cents'));
        }

        DB::table('regional_analytics_subscriptions')->where('id', $id)->update($update);

        return $this->respondWithData(['subscription_id' => $id]);
    }

    public function destroy(int $id): JsonResponse
    {
        $this->requirePlatformSuperAdmin();

        $sub = DB::table('regional_analytics_subscriptions')->where('id', $id)->first();
        if (! $sub) {
            return $this->respondNotFound(__('api.regional_analytics_subscription_not_found'), 'SUBSCRIPTION_NOT_FOUND');
        }

        if (! empty($sub->stripe_subscription_id)) {
            (new RegionalAnalyticsBilling())->cancelSubscription((string) $sub->stripe_subscription_id);
        }

        DB::table('regional_analytics_subscriptions')->where('id', $id)->update([
            'status' => 'cancelled',
            'updated_at' => now(),
        ]);

        return $this->respondWithData(['subscription_id' => $id, 'status' => 'cancelled']);
    }

    public function generateReport(int $id): JsonResponse
    {
        $this->requirePlatformSuperAdmin();

        $sub = DB::table('regional_analytics_subscriptions')->where('id', $id)->first();
        if (! $sub) {
            return $this->respondNotFound(__('api.regional_analytics_subscription_not_found'), 'SUBSCRIPTION_NOT_FOUND');
        }

        Artisan::call('regional-analytics:generate-monthly', ['--subscription' => $id]);

        return $this->respondWithData([
            'subscription_id' => $id,
            'queued' => true,
        ]);
    }

    public function accessLog(Request $request): JsonResponse
    {
        $this->requirePlatformSuperAdmin();

        $page = max(1, (int) $request->query('page', 1));
        $perPage = min(200, max(1, (int) $request->query('per_page', 50)));
        $offset = ($page - 1) * $perPage;

        $rows = DB::table('regional_analytics_access_log')
            ->orderBy('id', 'desc')
            ->offset($offset)
            ->limit($perPage)
            ->get()
            ->all();
        $total = (int) DB::table('regional_analytics_access_log')->count();

        return $this->respondWithPaginatedCollection($rows, $total, $page, $perPage);
    }

    private function serializeSubscription(array $s): array
    {
        $modules = is_string($s['enabled_modules'] ?? null)
            ? (json_decode($s['enabled_modules'], true) ?: [])
            : (array) ($s['enabled_modules'] ?? []);

        return [
            'id' => (int) $s['id'],
            'tenant_id' => (int) $s['tenant_id'],
            'partner_name' => $s['partner_name'],
            'partner_type' => $s['partner_type'] ?? 'municipality',
            'contact_email' => $s['contact_email'] ?? null,
            'billing_email' => $s['billing_email'] ?? null,
            'plan_tier' => $s['plan_tier'] ?? 'basic',
            'status' => $s['status'] ?? 'trialing',
            'stripe_subscription_id' => $s['stripe_subscription_id'] ?? null,
            'trial_ends_at' => $s['trial_ends_at'] ?? null,
            'current_period_start' => $s['current_period_start'] ?? null,
            'current_period_end' => $s['current_period_end'] ?? null,
            'monthly_price_cents' => (int) ($s['monthly_price_cents'] ?? 0),
            'currency' => $s['currency'] ?? 'CHF',
            'enabled_modules' => $modules,
            'created_at' => $s['created_at'] ?? null,
            'updated_at' => $s['updated_at'] ?? null,
        ];
    }
}
