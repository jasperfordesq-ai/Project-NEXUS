<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\GovukAlpha\Concerns;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\Services\BrokerControlConfigService;
use App\Services\Enterprise\GdprService;
use App\Services\GuardianArrangementService;
use App\Services\InsuranceCertificateService;
use App\Services\SubAccountService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * Profile settings, auth, onboarding & notifications — accessible (GOV.UK) frontend parity methods.
 *
 * Composed into AlphaController. Trait methods may call the controller's
 * private helpers ($this->view, $this->currentUserId, $this->assertTenantSlug,
 * $this->allowed, self::asStr). New method names MUST be module-prefixed and
 * unique across AlphaController and every sibling trait. Resolve services via
 * app(SomeService::class) rather than the constructor.
 *
 * Scope of this trait (the two member-facing React settings tabs the audit
 * flagged as genuinely missing from the accessible frontend):
 *   1. Linked / sub-account management — React LinkedAccountsTab (SubAccountsManager).
 *      Backed by the SAME App\Services\SubAccountService the React API controller
 *      (SubAccountController) calls: request a link by email, approve incoming
 *      requests, change permissions, and revoke. Parent (children you manage) and
 *      child (accounts that manage you) relationships are both shown.
 *   2. Appearance / theme — React AppearanceSettings. Persists users.preferred_theme
 *      (enum light|dark|system) exactly as UsersController::updateTheme does.
 *   3. GDPR data-subject requests beyond export+delete — React PrivacyTab GDPR
 *      section: portability, rectification, restriction and objection requests.
 *      Backed by the SAME App\Services\Enterprise\GdprService::createRequest the
 *      React API (UsersController::createGdprRequest) calls; the four request
 *      types are the ones createGdprRequest accepts other than the export/erasure
 *      flows already present on the core profile-settings page.
 *   4. Insurance metadata record + list — React PrivacyTab insurance section.
 *      Backed by the SAME App\Services\InsuranceCertificateService the React API
 *      (UserInsuranceController) calls, gated on the tenant compliance toggle
 *      (BrokerControlConfigService::isInsuranceEnabled). Raw documents and
 *      sensitive policy data are prohibited.
 *
 * The other audited "gaps" were verified already-present on the core
 * profile-settings page (safeguarding revoke, GDPR export + account deletion,
 * skills add/remove, translation preference, digest frequency, read-only
 * sessions) or are out of scope (OAuth connected-accounts is popup-JS only with
 * no backing linked-providers service; per-session revoke does not exist in
 * React either; trust-device 2FA needs the shared two-factor flow which lives in
 * AlphaController).
 */
trait SettingsAuthParity
{
    /** The theme values UsersController::updateTheme accepts. */
    private const SETTINGS_THEMES = ['light', 'dark', 'system'];

    /** The relationship types SubAccountService::RELATIONSHIP_TYPES accepts. */
    private const SETTINGS_LINK_TYPES = ['family', 'guardian', 'carer', 'organization'];

    /**
     * The sub-account permissions actually OFFERED — i.e. the ones the backend
     * enforces (SubAccountService::hasPermission is consulted for each).
     *
     * 🔴 `can_view_messages` is deliberately absent. It was rendered here as a
     * fourth checkbox labelled "View their messages" and nothing in the backend
     * ever checked it, so a family could tick it, see it save, and reasonably
     * believe a carer could read a dependent's conversations. In a safeguarding
     * feature that is worse than the capability being absent. The
     * `account_relationships.permissions` column comment lists only three keys,
     * which is corroboration it was never designed — it reached both UIs and
     * never the schema.
     *
     * It is not merely unbuilt: letting a carer read a dependent's messages
     * exposes the OTHER party, who never agreed. The platform's established
     * answer is to notify (see BrokerMessageVisibilityService's
     * `review_notice_required`). Until that notice exists for carers, do not
     * re-add this key.
     */
    private const SETTINGS_LINK_PERMISSIONS = [
        'can_view_activity',
        'can_manage_listings',
        'can_transact',
    ];

    /**
     * GDPR data-subject request types offered here. These are the types
     * UsersController::createGdprRequest / GdprService::createRequest accept,
     * minus the export ('access'/'portability'-as-download) and erasure flows
     * that the core profile-settings page already covers via dedicated routes.
     */
    private const SETTINGS_GDPR_TYPES = ['portability', 'rectification', 'restriction', 'objection'];

    /** Insurance certificate types (InsuranceCertificateService / UserInsuranceController). */
    private const SETTINGS_INSURANCE_TYPES = [
        'public_liability',
        'professional_indemnity',
        'employers_liability',
        'product_liability',
        'personal_accident',
        'other',
    ];

    // =====================================================================
    //  Linked / sub-account management (React LinkedAccountsTab)
    // =====================================================================

    /**
     * Linked-accounts settings page: the children this member manages and the
     * accounts (parents) that manage this member. Mirrors the React
     * SubAccountsManager which loads /v2/users/me/sub-accounts +
     * /v2/users/me/parent-accounts.
     */
    public function settingsLinkedAccounts(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $service = app(SubAccountService::class);

        try {
            $children = $this->settingsNormaliseRelationships($service->getChildAccounts($userId));
            $parents = $this->settingsNormaliseRelationships($service->getParentAccounts($userId));
        } catch (\Throwable $e) {
            report($e);
            $children = [];
            $parents = [];
        }

        return $this->view('accessible-frontend::settings-linked-accounts', [
            'title' => __('govuk_alpha_settings.linked.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'account',
            'children' => $children,
            'parents' => $parents,
            'linkTypes' => self::SETTINGS_LINK_TYPES,
            'permissionKeys' => self::SETTINGS_LINK_PERMISSIONS,
            'maxChildren' => SubAccountService::MAX_CHILDREN,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /**
     * Guardian arrangements — the accessible frontend's equivalent of the React
     * safeguarding tab's "Guardian arrangements" section.
     *
     * 🔴 Why this page has to exist. Coordinators record that someone is
     * responsible for supporting a member; that member is the subject of the
     * arrangement and is the only person who can answer it. Until 2026-08-05 the
     * React app had no screen for it either, and when one was built this frontend
     * was left without one — meaning a member using the accessible site could not
     * see the arrangement, agree to it, refuse it, or withdraw. That is the wrong
     * way round: the people most likely to be under a guardian arrangement are
     * exactly the people most likely to be using this frontend.
     *
     * Everything here goes through GuardianArrangementService, the same code the
     * React app uses, so the transition rules, the append-only audit write and
     * the staff notification cannot differ between the two frontends.
     */
    public function settingsGuardians(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $service = app(GuardianArrangementService::class);
        $tenantId = TenantContext::getId();

        try {
            $guardians = $service->forWard($userId, $tenantId);
            $wards = $service->forGuardian($userId, $tenantId);
        } catch (\Throwable $e) {
            report($e);
            $guardians = [];
            $wards = [];
        }

        return $this->view('accessible-frontend::settings-guardians', [
            'title' => __('govuk_alpha_settings.guardians.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'account',
            'guardians' => $guardians,
            'wards' => $wards,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /**
     * Record the member's own answer: agree, refuse, or withdraw.
     *
     * One handler for all three, matching the service's single entry point. The
     * action arrives as a form field rather than three routes so the page can use
     * plain submit buttons with no JavaScript — this frontend is HTML-first.
     */
    public function settingsRespondToGuardian(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $assignmentId = (int) $request->input('assignment_id');
        $action = self::asStr($request->input('action'));
        $reason = self::asStr($request->input('reason')) ?: null;

        if ($assignmentId <= 0 || ! in_array($action, GuardianArrangementService::WARD_ACTIONS, true)) {
            return $this->settingsGuardianRedirect($tenantSlug, 'guardian-failed');
        }

        try {
            $result = app(GuardianArrangementService::class)->respond(
                $userId,
                TenantContext::getId(),
                $assignmentId,
                $action,
                $reason,
                $request->ip(),
                $request->userAgent(),
            );
            // A refused transition and a missing arrangement are reported
            // distinctly, because "you cannot do that from here" and "that is not
            // yours" need different wording for the member.
            $status = $result['ok']
                ? 'guardian-' . $action
                : ($result['code'] === 'NOT_FOUND' ? 'guardian-not-found' : 'guardian-not-allowed');
        } catch (\Throwable $e) {
            report($e);
            $status = 'guardian-failed';
        }

        return $this->settingsGuardianRedirect($tenantSlug, $status);
    }

    private function settingsGuardianRedirect(string $tenantSlug, string $status): RedirectResponse
    {
        return redirect()->route('govuk-alpha.settings.guardians', [
            'tenantSlug' => $tenantSlug,
            'status' => $status,
        ]);
    }

    /**
     * Coerce one set of relationship rows into a flat, view-safe shape with a
     * decoded permissions map. The service returns DB rows (permissions is a
     * JSON string) so we normalise exactly like SubAccountController does.
     *
     * @param  array<int, array<string, mixed>>  $rows
     * @return array<int, array<string, mixed>>
     */
    private function settingsNormaliseRelationships(array $rows): array
    {
        $out = [];
        foreach ($rows as $row) {
            $perms = $row['permissions'] ?? [];
            if (is_string($perms)) {
                $decoded = json_decode($perms, true);
                $perms = is_array($decoded) ? $decoded : [];
            } elseif (! is_array($perms)) {
                $perms = [];
            }

            $first = trim((string) ($row['first_name'] ?? ''));
            $last = trim((string) ($row['last_name'] ?? ''));
            $name = trim($first . ' ' . $last);

            $permissionsFlags = [];
            foreach (self::SETTINGS_LINK_PERMISSIONS as $key) {
                $permissionsFlags[$key] = (bool) ($perms[$key] ?? false);
            }

            $out[] = [
                'relationship_id' => (int) ($row['relationship_id'] ?? 0),
                'user_id' => (int) ($row['user_id'] ?? 0),
                'name' => $name !== '' ? $name : (string) ($row['email'] ?? ''),
                'email' => (string) ($row['email'] ?? ''),
                'avatar_url' => (string) ($row['avatar_url'] ?? ''),
                'relationship_type' => (string) ($row['relationship_type'] ?? 'family'),
                'status' => (string) ($row['status'] ?? 'pending'),
                'permissions' => $permissionsFlags,
            ];
        }

        return $out;
    }

    /** Request a new linked (child) account by email. Mirrors SubAccountController::requestRelationship. */
    public function settingsRequestLinkedAccount(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $email = trim(self::asStr($request->input('email')));
        if ($email === '' || ! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return redirect()
                ->route('govuk-alpha.settings.linked-accounts', ['tenantSlug' => $tenantSlug, 'status' => 'link-email-invalid'])
                ->withFragment('request');
        }

        $type = $this->allowed($request->input('relationship_type'), self::SETTINGS_LINK_TYPES, 'family');

        // Checkboxes that are unticked do not post, so read every known key as a
        // boolean to honour the parent's full intent. The service intersects
        // against its DEFAULT_PERMISSIONS, so unknown keys are dropped safely.
        $permissions = [];
        foreach (self::SETTINGS_LINK_PERMISSIONS as $key) {
            $permissions[$key] = $request->boolean('perm_' . $key);
        }

        try {
            // Resolve the child by email within this tenant (same lookup the API
            // controller does before calling the service).
            $childUserId = (int) (DB::table('users')
                ->where('tenant_id', TenantContext::getId())
                ->where('email', $email)
                ->value('id') ?? 0);

            if ($childUserId <= 0) {
                return redirect()
                    ->route('govuk-alpha.settings.linked-accounts', ['tenantSlug' => $tenantSlug, 'status' => 'link-user-not-found'])
                    ->withFragment('request');
            }

            $service = app(SubAccountService::class);
            $relationshipId = $service->requestRelationship($userId, $childUserId, $type, $permissions);
            if ($relationshipId === null) {
                $code = strtoupper((string) ($service->getErrors()[0]['code'] ?? ''));
                $status = match (true) {
                    str_contains($code, 'SELF') => 'link-self',
                    str_contains($code, 'EXIST') => 'link-exists',
                    str_contains($code, 'MAX') || str_contains($code, 'LIMIT') => 'link-max',
                    default => 'link-failed',
                };

                return redirect()
                    ->route('govuk-alpha.settings.linked-accounts', ['tenantSlug' => $tenantSlug, 'status' => $status])
                    ->withFragment('request');
            }
        } catch (SafeguardingPolicyException $e) {
            return redirect()
                ->route('govuk-alpha.settings.linked-accounts', [
                    'tenantSlug' => $tenantSlug,
                    'status' => $this->settingsLinkedAccountSafeguardingStatus($e),
                ])
                ->with('linked_account_safeguarding_error', $e->getMessage())
                ->withFragment('request');
        } catch (\Throwable $e) {
            report($e);

            return redirect()
                ->route('govuk-alpha.settings.linked-accounts', ['tenantSlug' => $tenantSlug, 'status' => 'link-failed'])
                ->withFragment('request');
        }

        return redirect()
            ->route('govuk-alpha.settings.linked-accounts', ['tenantSlug' => $tenantSlug, 'status' => 'link-requested'])
            ->withFragment('children');
    }

    /** Approve an incoming link request (this member is the child). Mirrors SubAccountController::approveRelationship. */
    public function settingsApproveLinkedAccount(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $relationshipId = (int) $request->input('relationship_id');
        try {
            $ok = $relationshipId > 0 && app(SubAccountService::class)->approveRelationship($userId, $relationshipId);
            $status = $ok ? 'link-approved' : 'link-failed';
        } catch (SafeguardingPolicyException $e) {
            return redirect()
                ->route('govuk-alpha.settings.linked-accounts', [
                    'tenantSlug' => $tenantSlug,
                    'status' => $this->settingsLinkedAccountSafeguardingStatus($e),
                ])
                ->with('linked_account_safeguarding_error', $e->getMessage())
                ->withFragment('parents');
        } catch (\Throwable $e) {
            report($e);
            $status = 'link-failed';
        }

        return redirect()
            ->route('govuk-alpha.settings.linked-accounts', ['tenantSlug' => $tenantSlug, 'status' => $status])
            ->withFragment('parents');
    }

    /** Update the permissions on a linked (child) account. Mirrors SubAccountController::updatePermissions. */
    public function settingsUpdateLinkedPermissions(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $relationshipId = (int) $request->input('relationship_id');
        if ($relationshipId <= 0) {
            return redirect()
                ->route('govuk-alpha.settings.linked-accounts', ['tenantSlug' => $tenantSlug, 'status' => 'link-failed'])
                ->withFragment('children');
        }

        $permissions = [];
        foreach (self::SETTINGS_LINK_PERMISSIONS as $key) {
            $permissions[$key] = $request->boolean('perm_' . $key);
        }

        try {
            $ok = app(SubAccountService::class)->updatePermissions($userId, $relationshipId, $permissions);
            $status = $ok ? 'link-permissions-saved' : 'link-failed';
        } catch (SafeguardingPolicyException $e) {
            return redirect()
                ->route('govuk-alpha.settings.linked-accounts', [
                    'tenantSlug' => $tenantSlug,
                    'status' => $this->settingsLinkedAccountSafeguardingStatus($e),
                ])
                ->with('linked_account_safeguarding_error', $e->getMessage())
                ->withFragment('children');
        } catch (\Throwable $e) {
            report($e);
            $status = 'link-failed';
        }

        return redirect()
            ->route('govuk-alpha.settings.linked-accounts', ['tenantSlug' => $tenantSlug, 'status' => $status])
            ->withFragment('children');
    }

    /** Revoke (remove) a linked relationship — works for both parent and child rows. Mirrors SubAccountController::revokeRelationship. */
    public function settingsRevokeLinkedAccount(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $relationshipId = (int) $request->input('relationship_id');
        try {
            $ok = $relationshipId > 0 && app(SubAccountService::class)->revokeRelationship($userId, $relationshipId);
            $status = $ok ? 'link-revoked' : 'link-failed';
        } catch (\Throwable $e) {
            report($e);
            $status = 'link-failed';
        }

        return redirect()
            ->route('govuk-alpha.settings.linked-accounts', ['tenantSlug' => $tenantSlug, 'status' => $status])
            ->withFragment('children');
    }

    private function settingsLinkedAccountSafeguardingStatus(SafeguardingPolicyException $exception): string
    {
        return match ($exception->reasonCode) {
            'SAFEGUARDING_POLICY_UNAVAILABLE' => 'link-safeguarding-unavailable',
            'VETTING_REQUIRED' => 'link-vetting-required',
            default => 'link-contact-restricted',
        };
    }

    // =====================================================================
    //  Appearance / theme (React AppearanceSettings)
    // =====================================================================

    /** Appearance settings page: choose light / dark / system theme. */
    public function settingsAppearance(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $current = (string) (DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', TenantContext::getId())
            ->value('preferred_theme') ?? 'system');
        if (! in_array($current, self::SETTINGS_THEMES, true)) {
            $current = 'system';
        }

        return $this->view('accessible-frontend::settings-appearance', [
            'title' => __('govuk_alpha_settings.appearance.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'account',
            'currentTheme' => $current,
            'themes' => self::SETTINGS_THEMES,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /** Persist the chosen theme to users.preferred_theme (mirrors UsersController::updateTheme). */
    public function settingsUpdateAppearance(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $theme = $this->allowed($request->input('theme'), self::SETTINGS_THEMES, null);
        if ($theme === null) {
            return redirect()->route('govuk-alpha.settings.appearance', ['tenantSlug' => $tenantSlug, 'status' => 'appearance-invalid']);
        }

        try {
            DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', TenantContext::getId())
                ->update(['preferred_theme' => $theme, 'updated_at' => now()]);
            $status = 'appearance-saved';
        } catch (\Throwable $e) {
            report($e);
            $status = 'appearance-failed';
        }

        return redirect()->route('govuk-alpha.settings.appearance', ['tenantSlug' => $tenantSlug, 'status' => $status]);
    }

    // =====================================================================
    //  GDPR data-subject requests (React PrivacyTab — portability /
    //  rectification / restriction / objection)
    // =====================================================================

    /**
     * Data-rights page: raise a GDPR data-subject request (portability,
     * rectification, restriction or objection) and see requests already raised.
     * Export and account deletion are handled by the core profile-settings page.
     */
    public function settingsDataRights(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $requests = [];
        try {
            $rows = app(GdprService::class)->getUserRequests($userId);
            foreach ($rows as $row) {
                $type = (string) ($row['request_type'] ?? '');
                // Only surface the four self-service request types this page raises.
                if (! in_array($type, self::SETTINGS_GDPR_TYPES, true)) {
                    continue;
                }
                $requests[] = [
                    'type' => $type,
                    'status' => (string) ($row['status'] ?? 'pending'),
                    'requested_at' => (string) ($row['requested_at'] ?? ''),
                ];
            }
        } catch (\Throwable $e) {
            report($e);
            $requests = [];
        }

        return $this->view('accessible-frontend::settings-data-rights', [
            'title' => __('govuk_alpha_settings.gdpr.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'account',
            'requestTypes' => self::SETTINGS_GDPR_TYPES,
            'requests' => $requests,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /**
     * Raise one GDPR data-subject request. Mirrors UsersController::createGdprRequest
     * (same GdprService::createRequest call, same valid type set, same duplicate
     * handling for an already-pending request of the same type).
     */
    public function settingsRequestDataRights(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $type = $this->allowed($request->input('request_type'), self::SETTINGS_GDPR_TYPES, null);
        if ($type === null) {
            return redirect()
                ->route('govuk-alpha.settings.data-rights', ['tenantSlug' => $tenantSlug, 'status' => 'gdpr-invalid'])
                ->withFragment('request');
        }

        $notes = trim(self::asStr($request->input('notes')));

        try {
            app(GdprService::class)->createRequest($userId, $type, [
                'notes' => $notes !== '' ? $notes : null,
                'metadata' => [
                    'source' => 'accessible_settings',
                    'user_agent' => self::asStr($request->header('User-Agent')),
                    'requested_via' => 'accessible',
                ],
            ]);
        } catch (\RuntimeException $e) {
            // Already a pending request of this type (GdprService throws RuntimeException).
            return redirect()
                ->route('govuk-alpha.settings.data-rights', ['tenantSlug' => $tenantSlug, 'status' => 'gdpr-duplicate'])
                ->withFragment('request');
        } catch (\Throwable $e) {
            report($e);

            return redirect()
                ->route('govuk-alpha.settings.data-rights', ['tenantSlug' => $tenantSlug, 'status' => 'gdpr-failed'])
                ->withFragment('request');
        }

        return redirect()
            ->route('govuk-alpha.settings.data-rights', ['tenantSlug' => $tenantSlug, 'status' => 'gdpr-requested'])
            ->withFragment('your-requests');
    }

    // =====================================================================
    //  Insurance certificates (React PrivacyTab insurance section)
    // =====================================================================

    /**
     * Insurance records page: list this member's metadata and add a
     * new record. Gated on the tenant compliance toggle exactly like the React
     * PrivacyTab (which only renders the section when insurance_enabled is set).
     */
    public function settingsInsurance(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }
        abort_unless(BrokerControlConfigService::isInsuranceEnabled(), 404);

        $certificates = [];
        try {
            $certificates = app(InsuranceCertificateService::class)->getUserCertificates($userId);
        } catch (\Throwable $e) {
            report($e);
            $certificates = [];
        }

        return $this->view('accessible-frontend::settings-insurance', [
            'title' => __('govuk_alpha_settings.insurance.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'account',
            'certificates' => $certificates,
            'insuranceTypes' => self::SETTINGS_INSURANCE_TYPES,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /** Store metadata only; insurance documents are prohibited. */
    public function settingsUploadInsurance(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }
        abort_unless(BrokerControlConfigService::isInsuranceEnabled(), 404);

        $insuranceType = $this->allowed($request->input('insurance_type'), self::SETTINGS_INSURANCE_TYPES, null);
        if ($insuranceType === null) {
            return redirect()
                ->route('govuk-alpha.settings.insurance', ['tenantSlug' => $tenantSlug, 'status' => 'insurance-type-invalid'])
                ->withFragment('upload');
        }

        if ($request->hasFile('certificate_file') || $request->has('certificate_file')) {
            return redirect()
                ->route('govuk-alpha.settings.insurance', ['tenantSlug' => $tenantSlug, 'status' => 'insurance-file-forbidden'])
                ->withFragment('upload');
        }

        $expiry = trim(self::asStr($request->input('expiry_date')));
        $parsedExpiry = \DateTimeImmutable::createFromFormat('!Y-m-d', $expiry);
        if ($parsedExpiry === false || $parsedExpiry->format('Y-m-d') !== $expiry) {
            return redirect()
                ->route('govuk-alpha.settings.insurance', ['tenantSlug' => $tenantSlug, 'status' => 'insurance-expiry-required'])
                ->withFragment('upload');
        }

        try {
            $provider = trim(self::asStr($request->input('provider_name')));

            app(InsuranceCertificateService::class)->create([
                'user_id' => $userId,
                'insurance_type' => $insuranceType,
                'provider_name' => $provider !== '' ? $provider : null,
                'expiry_date' => $expiry,
                'status' => 'submitted',
            ]);
        } catch (\Throwable $e) {
            report($e);

            return redirect()
                ->route('govuk-alpha.settings.insurance', ['tenantSlug' => $tenantSlug, 'status' => 'insurance-failed'])
                ->withFragment('upload');
        }

        return redirect()
            ->route('govuk-alpha.settings.insurance', ['tenantSlug' => $tenantSlug, 'status' => 'insurance-recorded'])
            ->withFragment('certificates');
    }
}
