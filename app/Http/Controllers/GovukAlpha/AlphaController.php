<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\GovukAlpha;

use App\Core\ImageUploader;
use App\Core\TenantContext;
use App\Core\Validator;
use App\Enums\EventNotificationDeliveryMode;
use App\Exceptions\EventAttendanceException;
use App\Exceptions\EventParticipationException;
use App\Exceptions\EventRegistrationException;
use App\Exceptions\EventWaitlistException;
use App\Exceptions\SafeguardingPolicyException;
use App\Http\Controllers\Api\CoreController;
use App\Http\Controllers\GovukAlpha\Support\AccessibleIdentityResolver;
use App\Http\Controllers\GovukAlpha\Support\AccessibleSessionCookies;
use App\Models\Category;
use App\Models\Event;
use App\Models\ListingImage;
use App\Models\User;
use App\Models\UserSafeguardingPreference;
use App\Policies\EventPolicy;
use App\Services\BrokerControlConfigService;
use App\Services\Auth\AuthenticationMethodGuard;
use App\Services\CommentService;
use App\Services\ConnectionService;
use App\Services\EventAttendanceService;
use App\Services\EventNotificationDeliveryModeResolver;
use App\Services\EventPublicationWorkflowService;
use App\Services\EventRecurrenceCapabilityService;
use App\Services\EventRegistrationService;
use App\Services\EventService;
use App\Services\EventWaitlistService;
use App\Services\ExchangeService;
use App\Services\ExchangeWorkflowService;
use App\Services\FeedService;
use App\Services\LegalDocumentService;
use App\Services\ListingConfigurationService;
use App\Services\ListingService;
use App\Services\MessageService;
use App\Services\OnboardingConfigService;
use App\Services\RegistrationService;
use App\Services\SearchService;
use App\Services\SocialNotificationService;
use App\Services\TenantSettingsService;
use App\Services\UserService;
use App\Services\VolunteerService;
use App\Support\FeedItemTables;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;

class AlphaController extends Controller
{
    // ===== ACCESSIBLE PARITY PHASE — per-module Concerns traits =====
    // Each parity module's NEW methods live in a dedicated trait under
    // Concerns/ so parallel module work never edits this shared file. Trait
    // methods are composed into this class and may call its private helpers
    // ($this->view, $this->currentUserId, $this->assertTenantSlug, self::asStr,
    // $this->allowed). Method names are module-prefixed and unique.
    use Concerns\FeedParity;
    use Concerns\PartnerVenuesParity;
    use Concerns\PublicEventsParity;
    use Concerns\ListingsParity;
    use Concerns\MessagesParity;
    use Concerns\EventsParity;
    use Concerns\EventModerationParity;
    use Concerns\EventLifecycleHistoryParity;
    use Concerns\EventAgendaParity;
    use Concerns\EventRemindersParity;
    use Concerns\EventSafetyParity;
    use Concerns\EventTemplatesParity;
    use Concerns\EventTicketsParity;
    use Concerns\EventAnalyticsParity;
    use Concerns\EventCommunicationsParity;
    use Concerns\EventOfflineCheckinParity;
    use Concerns\EventRegistrationParity;
    use Concerns\GroupsParity;
    use Concerns\MembersParity;
    use Concerns\ConnectionsMatchesParity;
    use Concerns\WalletParity;
    use Concerns\VolunteeringParity;
    use Concerns\OrganisationsParity;
    use Concerns\FederationParity;
    use Concerns\JobsParity;
    use Concerns\IdeationParity;
    use Concerns\ResourcesParity;
    use Concerns\SavedCollectionsParity;
    use Concerns\ActivityParity;
    use Concerns\SearchParity;
    use Concerns\GamificationParity;
    use Concerns\CommerceParity;
    use Concerns\BlogReviewsParity;
    use Concerns\GoalsParity;
    use Concerns\SettingsAuthParity;
    use Concerns\SettingsAvailabilityParity;
    use Concerns\AiChatParity;
    use Concerns\CookieSupportParity;

    private const VALID_FEED_LIKE_TARGETS = [
        'post', 'listing', 'event', 'poll', 'goal',
        'resource', 'volunteer', 'volunteering', 'review', 'challenge', 'comment',
        'job', 'blog', 'discussion',
    ];

    /** Accessibility-need categories — mirrors the vol_accessibility_needs ENUM. */
    private const ACCESSIBILITY_NEED_TYPES = [
        'mobility', 'visual', 'hearing', 'cognitive', 'dietary', 'language', 'other',
    ];

    /** The platform's 11 supported locales (matches the React LanguageSwitcher). */
    private const ALPHA_LOCALES = [
        'en', 'ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar',
    ];

    public function __construct(
        private readonly FeedService $feedService,
        private readonly ListingService $listingService,
        private readonly RegistrationService $registrationService,
        private readonly EventRegistrationService $eventRegistrationService,
        private readonly EventWaitlistService $eventWaitlistService,
        private readonly EventAttendanceService $eventAttendanceService,
    ) {}

    private function accessibleEventActor(int $userId): User
    {
        $actor = User::withoutGlobalScopes()
            ->where('tenant_id', (int) TenantContext::getId())
            ->whereKey($userId)
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->first();
        if ($actor === null) {
            throw new EventRegistrationException('event_registration_actor_invalid');
        }

        return $actor;
    }

    private function accessibleEventMutationKey(Request $request): ?string
    {
        $header = $request->header('Idempotency-Key');
        $body = $request->input('idempotency_key');
        $header = is_string($header) ? trim($header) : null;
        $body = is_string($body) ? trim($body) : null;
        if ($header !== null && $body !== null && $header !== $body) {
            throw new EventRegistrationException('event_registration_idempotency_key_invalid');
        }
        $key = $header ?? $body;
        if ($key === null || $key === '') {
            // Canonical compatibility methods derive a stable identity from the
            // locked monotonic version/state when an older form sends no key.
            return null;
        }
        if (mb_strlen($key) > 191) {
            throw new EventRegistrationException('event_registration_idempotency_key_invalid');
        }

        return $key;
    }

    /**
     * Safely coerce a request value to a string, returning the default when
     * the value is an array or non-scalar (e.g. attacker passes `?q[]=foo`).
     * Avoids PHP "Array to string conversion" warnings reported via Sentry.
     */
    private static function asStr(mixed $value, string $default = ''): string
    {
        if (is_string($value)) {
            return $value;
        }
        if (is_int($value) || is_float($value) || is_bool($value)) {
            return (string) $value;
        }
        return $default;
    }

    public function tenantChooser(Request $request): Response|RedirectResponse
    {
        $tenant = TenantContext::get();
        if (TenantContext::isAccessibleDomain() && !empty($tenant['slug'])) {
            // On a custom accessible domain the host identifies the tenant, so
            // serve the accessible home at the clean root — its links are made
            // slug-less by StripTenantSlugOnAccessibleDomain. (Redirecting to
            // /{slug}/alpha would be rewritten back to "/" and loop.)
            return $this->home($request, $tenant['slug']);
        }

        $tenants = DB::table('tenants')
            ->select('id', 'name', 'slug', 'tagline')
            ->where('is_active', 1)
            ->where('id', '>', 1)
            ->orderBy('name')
            ->get()
            ->map(fn (object $tenant): array => (array) $tenant)
            ->all();

        return $this->view('accessible-frontend::tenant-chooser', [
            'title' => __('govuk_alpha.tenant_chooser.title'),
            'tenantSlug' => '',
            'activeNav' => 'tenant-chooser',
            'tenants' => $tenants,
        ]);
    }

    public function home(Request $request, string $tenantSlug): Response
    {
        $this->assertTenantSlug($tenantSlug);

        return $this->view('accessible-frontend::home', [
            'title' => __('govuk_alpha.home.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'home',
            'isAuthenticated' => $this->currentUserId() !== null,
            'status' => self::asStr($request->query('status')) ?: null,
            // Live community stats (members / hours / listings / communities),
            // the same tenant-scoped, cached figures the about page already shows.
            'stats' => $this->platformStats(),
            'modules' => [
                'feed' => TenantContext::hasModule('feed'),
                'listings' => TenantContext::hasModule('listings'),
                'members' => TenantContext::hasFeature('connections'),
            ],
        ]);
    }

    public function login(Request $request, string $tenantSlug): Response
    {
        $this->assertTenantSlug($tenantSlug);

        return $this->view('accessible-frontend::login', [
            'title' => __('govuk_alpha.auth.login_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'login',
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    public function storeLogin(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);

        $previousStatelessHeader = $_SERVER['HTTP_X_STATELESS_AUTH'] ?? null;
        $_SERVER['HTTP_X_STATELESS_AUTH'] = '1';

        try {
            $response = app(\App\Http\Controllers\Api\AuthController::class)->login();
            $payload = $response->getData(true);
        } catch (\Throwable $e) {
            report($e);
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'login-failed']);
        } finally {
            if ($previousStatelessHeader === null) {
                unset($_SERVER['HTTP_X_STATELESS_AUTH']);
            } else {
                $_SERVER['HTTP_X_STATELESS_AUTH'] = $previousStatelessHeader;
            }
        }

        if (($payload['success'] ?? false) === true) {
            $token = (string) ($payload['access_token'] ?? $payload['token'] ?? $payload['sanctum_token'] ?? '');
            $refreshToken = (string) ($payload['refresh_token'] ?? '');
            $refreshExpiresIn = (int) ($payload['refresh_expires_in'] ?? 0);
            if ($token === '' || $refreshToken === '' || $refreshExpiresIn <= 0) {
                return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'login-failed']);
            }

            $redirect = redirect()
                ->intended(route('govuk-alpha.dashboard', ['tenantSlug' => $tenantSlug]));

            return app(AccessibleSessionCookies::class)->attachTo(
                $redirect,
                $request,
                $token,
                $refreshToken,
                $refreshExpiresIn,
            );
        }

        if (($payload['requires_2fa'] ?? false) === true) {
            // Carry the short-lived (5-min, single-use) challenge token to the 2FA
            // code page via the session — never in the URL. Email+password are not
            // re-sent; the token identifies the pending challenge.
            $twoFactorToken = (string) ($payload['two_factor_token'] ?? '');
            if ($twoFactorToken === '' || !$request->hasSession()) {
                return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'two-factor-required']);
            }
            $request->session()->put('alpha_2fa_token', $twoFactorToken);

            return redirect()->route('govuk-alpha.login.twofactor', ['tenantSlug' => $tenantSlug]);
        }

        // Surface the specific failure reason so the Blade page can show a
        // useful message instead of a generic "login failed" for every code
        // path (rate limit, suspended, unverified, etc.).
        $errors = $payload['errors'] ?? [];
        $code = (string) ($errors[0]['code'] ?? '');
        $status = match (true) {
            $code === 'RATE_LIMIT_EXCEEDED',
            $code === 'RATE_LIMITED'                  => 'rate-limited',
            $code === 'AUTH_EMAIL_NOT_VERIFIED'       => 'email-not-verified',
            $code === 'AUTH_PENDING_VERIFICATION'     => 'pending-verification',
            $code === 'AUTH_ACCOUNT_SUSPENDED'        => 'account-suspended',
            default                                    => 'login-failed',
        };

        return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => $status])
            ->withInput($request->only('email'));
    }

    /**
     * Resend an email-verification link. Delegates to the v2 endpoint, which
     * always returns a generic success (anti-enumeration), so the alpha shows
     * the same confirmation regardless of whether the address exists.
     */
    public function resendVerification(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);

        try {
            app(\App\Http\Controllers\Api\EmailVerificationController::class)->resendVerificationByEmail();
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'verification-resent']);
    }

    /**
     * Email-verification landing reached from the verification email link.
     * Public (the visitor is signed out). Delegates to the shared API verifier
     * — the exact logic the React app posts to — then renders a GOV.UK result.
     */
    public function verifyEmail(Request $request, string $tenantSlug): Response
    {
        $this->assertTenantSlug($tenantSlug);

        $token = trim(self::asStr($request->query('token')));
        $state = 'missing'; // missing | success | invalid

        if ($token !== '') {
            $request->merge(['token' => $token]);
            try {
                $response = app(\App\Http\Controllers\Api\EmailVerificationController::class)->verifyEmail();
                $payload = $response->getData(true);
                $verified = (bool) ($payload['data']['verified'] ?? $payload['verified'] ?? false);
                $state = ($response->getStatusCode() < 300 && $verified) ? 'success' : 'invalid';
            } catch (\Throwable $e) {
                report($e);
                $state = 'invalid';
            }
        }

        return $this->view('accessible-frontend::email-verify', [
            'title' => __('govuk_alpha.auth.verify_email_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'login',
            'state' => $state,
        ]);
    }

    /**
     * Newsletter unsubscribe landing reached from an email footer link.
     * Public. Delegates to the shared API unsubscribe handler, then renders
     * a GOV.UK confirmation page.
     */
    public function newsletterUnsubscribe(Request $request, string $tenantSlug): Response
    {
        $this->assertTenantSlug($tenantSlug);

        $token = trim(self::asStr($request->query('token')));
        $state = 'missing'; // missing | success | invalid

        if ($token !== '') {
            $request->merge(['token' => $token]);
            try {
                $response = app(\App\Http\Controllers\Api\NewsletterController::class)->unsubscribe();
                $state = $response->getStatusCode() < 300 ? 'success' : 'invalid';
            } catch (\Throwable $e) {
                report($e);
                $state = 'invalid';
            }
        }

        return $this->view('accessible-frontend::newsletter-unsubscribe', [
            'title' => __('govuk_alpha.auth.unsubscribe_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => null,
            'state' => $state,
        ]);
    }

    public function twoFactor(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);

        $token = $request->hasSession() ? (string) $request->session()->get('alpha_2fa_token', '') : '';
        if ($token === '') {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'two-factor-expired']);
        }

        return $this->view('accessible-frontend::two-factor', [
            'title' => __('govuk_alpha.auth.two_factor_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'login',
            'status' => self::asStr($request->query('status')) ?: null,
            'allowTrustedDevice' => (bool) (
                \App\Services\AuthenticationConfigurationService::get(
                    \App\Services\AuthenticationConfigurationService::CONFIG_TWO_FACTOR_ALLOW_TRUSTED_DEVICES
                )
            ),
            'trustedDeviceDays' => (int) (
                \App\Services\AuthenticationConfigurationService::get(
                    \App\Services\AuthenticationConfigurationService::CONFIG_TWO_FACTOR_TRUSTED_DEVICE_DAYS
                )
            ),
        ]);
    }

    public function storeTwoFactor(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);

        $token = $request->hasSession() ? (string) $request->session()->get('alpha_2fa_token', '') : '';
        if ($token === '') {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'two-factor-expired']);
        }

        $code = trim(self::asStr($request->input('code')));
        if ($code === '') {
            return redirect()->route('govuk-alpha.login.twofactor', ['tenantSlug' => $tenantSlug, 'status' => 'two-factor-code-required']);
        }

        // Delegate to the same v2 contract the React verify2FA() uses.
        $previousStatelessHeader = $_SERVER['HTTP_X_STATELESS_AUTH'] ?? null;
        $_SERVER['HTTP_X_STATELESS_AUTH'] = '1';
        $request->merge([
            'two_factor_token' => $token,
            'code' => $code,
            'use_backup_code' => $request->boolean('use_backup_code'),
            'trust_device' => $request->boolean('trust_device'),
        ]);

        try {
            $response = app(\App\Http\Controllers\Api\TotpController::class)->verify();
            $payload = $response->getData(true);
        } catch (\Throwable $e) {
            report($e);

            return redirect()->route('govuk-alpha.login.twofactor', ['tenantSlug' => $tenantSlug, 'status' => 'two-factor-failed']);
        } finally {
            if ($previousStatelessHeader === null) {
                unset($_SERVER['HTTP_X_STATELESS_AUTH']);
            } else {
                $_SERVER['HTTP_X_STATELESS_AUTH'] = $previousStatelessHeader;
            }
        }

        if (($payload['success'] ?? false) === true) {
            $accessToken = (string) ($payload['access_token'] ?? $payload['token'] ?? $payload['sanctum_token'] ?? '');
            $refreshToken = (string) ($payload['refresh_token'] ?? '');
            $refreshExpiresIn = (int) ($payload['refresh_expires_in'] ?? 0);
            if ($accessToken === '' || $refreshToken === '' || $refreshExpiresIn <= 0) {
                return redirect()->route('govuk-alpha.login.twofactor', ['tenantSlug' => $tenantSlug, 'status' => 'two-factor-failed']);
            }

            if ($request->hasSession()) {
                $request->session()->forget('alpha_2fa_token');
            }

            $redirect = redirect()
                ->intended(route('govuk-alpha.dashboard', ['tenantSlug' => $tenantSlug]));

            return app(AccessibleSessionCookies::class)->attachTo(
                $redirect,
                $request,
                $accessToken,
                $refreshToken,
                $refreshExpiresIn,
            );
        }

        // The challenge is single-use with a 5-minute TTL and a 5-attempt cap — when
        // it is spent, send the member back to sign in rather than loop the code page.
        $errorCode = strtoupper((string) ($payload['errors'][0]['code'] ?? $payload['code'] ?? ''));
        if (str_contains($errorCode, 'EXPIRED') || str_contains($errorCode, 'CHALLENGE') || str_contains($errorCode, 'ATTEMPT')) {
            if ($request->hasSession()) {
                $request->session()->forget('alpha_2fa_token');
            }

            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'two-factor-expired']);
        }

        return redirect()->route('govuk-alpha.login.twofactor', ['tenantSlug' => $tenantSlug, 'status' => 'two-factor-invalid']);
    }

    public function forgotPassword(Request $request, string $tenantSlug): Response
    {
        $this->assertTenantSlug($tenantSlug);

        return $this->view('accessible-frontend::forgot-password', [
            'title' => __('govuk_alpha.auth.forgot_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'login',
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    public function sendPasswordReset(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);

        $email = trim(self::asStr($request->input('email')));
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return redirect()
                ->route('govuk-alpha.login.forgot', ['tenantSlug' => $tenantSlug, 'status' => 'forgot-invalid'])
                ->withInput();
        }

        // Delegate to the same v2 contract the React ForgotPasswordPage uses. It is
        // deliberately anti-enumerating (always 200 "if an account exists…"), so we
        // surface a single generic confirmation regardless of whether the email exists.
        $request->merge(['email' => $email]);
        $statusKey = 'forgot-sent';
        try {
            $response = app(\App\Http\Controllers\Api\PasswordResetController::class)->forgotPassword();
            if ($response->getStatusCode() === 429) {
                $statusKey = 'forgot-rate-limited';
            }
        } catch (HttpResponseException $e) {
            $statusKey = $e->getResponse()->getStatusCode() === 429 ? 'forgot-rate-limited' : 'forgot-sent';
        } catch (\Throwable $e) {
            report($e);
            // Never reveal a failure that could leak account existence.
        }

        return redirect()->route('govuk-alpha.login.forgot', ['tenantSlug' => $tenantSlug, 'status' => $statusKey]);
    }

    public function showResetPassword(Request $request, string $tenantSlug): Response
    {
        $this->assertTenantSlug($tenantSlug);

        return $this->view('accessible-frontend::reset-password', [
            'title' => __('govuk_alpha.auth.reset_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'login',
            'token' => self::asStr($request->query('token')),
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    public function storeResetPassword(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);

        $token = trim(self::asStr($request->input('token')));
        $password = self::asStr($request->input('password'));
        $confirm = self::asStr($request->input('password_confirmation'));

        // Friendly client-side-style pre-checks before hitting the v2 contract.
        $preStatus = match (true) {
            $token === '' => 'reset-token-missing',
            $password === '' => 'reset-weak',
            mb_strlen($password) < 12 => 'reset-weak',
            $password !== $confirm => 'reset-mismatch',
            default => null,
        };
        if ($preStatus !== null) {
            return redirect()->route('govuk-alpha.password.reset', ['tenantSlug' => $tenantSlug, 'token' => $token, 'status' => $preStatus]);
        }

        $request->merge(['token' => $token, 'password' => $password, 'password_confirmation' => $confirm]);

        try {
            $response = app(\App\Http\Controllers\Api\PasswordResetController::class)->resetPassword();
            $payload = $response->getData(true);

            if ($response->getStatusCode() >= 200 && $response->getStatusCode() < 300 && ($payload['success'] ?? false) === true) {
                return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'password-reset']);
            }

            $code = strtoupper((string) ($payload['errors'][0]['code'] ?? $payload['code'] ?? ''));
            $status = match (true) {
                str_contains($code, 'PWNED')   => 'reset-pwned',
                str_contains($code, 'REUSED')  => 'reset-reused',
                str_contains($code, 'WEAK')    => 'reset-weak',
                str_contains($code, 'TOKEN'),
                $response->getStatusCode() === 400,
                $response->getStatusCode() === 404 => 'reset-token-invalid',
                default                         => 'reset-failed',
            };
        } catch (HttpResponseException $e) {
            $status = $e->getResponse()->getStatusCode() === 429 ? 'reset-rate-limited' : 'reset-failed';
        } catch (\Throwable $e) {
            report($e);
            $status = 'reset-failed';
        }

        return redirect()->route('govuk-alpha.password.reset', ['tenantSlug' => $tenantSlug, 'token' => $token, 'status' => $status]);
    }

    public function logout(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);

        // Cookie expiry alone does not invalidate a copied refresh credential.
        // Possession of a valid signed refresh token is sufficient authority to
        // revoke its own family, even when the short access cookie has expired.
        $refreshToken = $request->cookie(AccessibleSessionCookies::REFRESH_COOKIE);
        if (is_string($refreshToken) && $refreshToken !== '') {
            app(\App\Services\TokenService::class)->revokeToken($refreshToken);
        }

        if (session_status() === PHP_SESSION_ACTIVE) {
            unset($_SESSION['user_id']);
        }

        if ($request->hasSession()) {
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        $redirect = redirect()
            ->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'signed-out']);

        return app(AccessibleSessionCookies::class)->expireOn($redirect);
    }

    public function register(Request $request, string $tenantSlug): Response
    {
        $this->assertTenantSlug($tenantSlug);

        $tenantId = TenantContext::getId();
        $policy = \App\Services\Identity\RegistrationPolicyService::getEffectivePolicy($tenantId);
        $registrationMode = (string) ($policy['registration_mode'] ?? 'open');
        $registrationClosed = $registrationMode === 'closed';
        $requiresInviteCode = $registrationMode === 'invite_only';

        // Resolve maps config to drive the Google Places autocomplete on the
        // location field. Mirrors MapsConfigController's gating: no API key
        // unless maps feature is on AND provider is google.
        $mapsEnabled = TenantContext::hasFeature('maps');
        $mapProvider = $this->resolveTenantSetting($tenantId, 'general.map_provider', 'google');
        $geocodingProvider = $this->resolveTenantSetting($tenantId, 'general.geocoding_provider', 'google');
        $tenantGoogleKey = $this->resolveTenantSetting($tenantId, 'general.google_maps_api_key', '');
        $envGoogleKey = (string) (getenv('GOOGLE_MAPS_API_KEY') ?: '');
        $googleApiKey = ($mapsEnabled && $geocodingProvider === 'google')
            ? ($tenantGoogleKey !== '' ? $tenantGoogleKey : $envGoogleKey)
            : '';

        return $this->view('accessible-frontend::register', [
            'title' => $registrationClosed
                ? __('govuk_alpha.auth.registration_closed_title')
                : __('govuk_alpha.auth.register_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'register',
            'status' => self::asStr($request->query('status')) ?: null,
            'registrationClosed' => $registrationClosed,
            'requiresInviteCode' => $requiresInviteCode,
            'googleMapsApiKey' => $googleApiKey,
            'geocodingProvider' => $geocodingProvider,
            // Server timestamp (ms) used by the min-form-time bot gate. Sent
            // back as a hidden field so we don't need a session round-trip.
            'formStartedAt' => (int) (microtime(true) * 1000),
        ]);
    }

    private function resolveTenantSetting(int $tenantId, string $key, string $default): string
    {
        if ($tenantId <= 0) {
            return $default;
        }
        try {
            $value = DB::table('tenant_settings')
                ->where('tenant_id', $tenantId)
                ->where('setting_key', $key)
                ->value('setting_value');
            return is_string($value) && $value !== '' ? $value : $default;
        } catch (\Throwable) {
            return $default;
        }
    }

    public function storeRegister(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);

        $result = $this->registrationService->register([
            'first_name' => $request->input('first_name'),
            'last_name' => $request->input('last_name'),
            'email' => $request->input('email'),
            'phone' => $request->input('phone'),
            'location' => $request->input('location'),
            'latitude' => $request->input('latitude'),
            'longitude' => $request->input('longitude'),
            'password' => $request->input('password'),
            'password_confirmation' => $request->input('password_confirmation'),
            'profile_type' => $request->input('profile_type', 'individual'),
            'organization_name' => $request->input('organization_name'),
            'invite_code' => $request->input('invite_code'),
            'terms_accepted' => $request->boolean('terms_accepted'),
            'newsletter_opt_in' => $request->boolean('newsletter_opt_in'),
            'form_started_at' => $request->input('form_started_at'),
            // Bot honeypot — hidden input in the Blade form. Real users
            // never see or fill it; bots auto-fill everything.
            'honeypot' => $request->input('website'),
        ], TenantContext::getId());

        if (isset($result['error'])) {
            // Map service-level error codes to specific Blade statuses so the
            // user sees a useful message ("you already have an account" vs a
            // password breach hit) instead of a single generic prompt.
            $code = (string) ($result['code'] ?? '');
            $status = match (true) {
                $code === 'VALIDATION_DUPLICATE'  => 'register-duplicate',
                $code === 'PASSWORD_PWNED'        => 'register-password-pwned',
                $code === 'PASSWORD_MISMATCH'     => 'register-password-mismatch',
                $code === 'TERMS_REQUIRED'        => 'register-terms-required',
                $code === 'INVITE_REQUIRED'       => 'register-invite-required',
                $code === 'INVITE_INVALID'        => 'register-invite-invalid',
                $code === 'LOCATION_NOT_VERIFIED' => 'register-location-unverified',
                $code === 'EMAIL_DISPOSABLE'      => 'register-email-disposable',
                $code === 'EMAIL_DOMAIN_INVALID'  => 'register-email-domain-invalid',
                $code === 'REGISTRATION_DAILY_LIMIT' => 'register-daily-limit',
                $code === 'REGISTRATION_TENANT_PAUSED' => 'register-tenant-paused',
                $code === 'REGISTRATION_CLOSED'    => 'register-closed',
                $code === 'VALIDATION_ERROR'      => 'register-validation',
                default                            => 'register-failed',
            };
            return redirect()->route('govuk-alpha.register', ['tenantSlug' => $tenantSlug, 'status' => $status])
                ->withInput();
        }

        return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'register-created']);
    }

    public function dashboard(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        // Parity with React, which wraps /dashboard in <FeatureGate module="dashboard">
        // (App.tsx) — when an admin switches the module off, the page is unreachable.
        abort_unless(TenantContext::hasModule('dashboard'), 403);
        $userId = $this->currentUserId();

        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $profile = $this->profileForViewer($userId, $userId);
        abort_if($profile === null, 404);

        $feedItems = [];
        $listings = [];

        try {
            $feed = $this->feedService->getFeed($userId, [
                'limit' => 5,
                'type' => 'all',
                'mode' => 'chronological',
            ]);
            $feedItems = $feed['items'] ?? [];
        } catch (\Throwable $e) {
            report($e);
        }

        if (TenantContext::hasModule('listings')) {
            try {
                $result = $this->listingService->getAll(['limit' => 5]);
                $listings = $this->withResolvedImageKey($result['items'] ?? [], 'image_url');
            } catch (\Throwable $e) {
                report($e);
            }
        }

        // Core time-credit metric + gamification + upcoming events — the React
        // dashboard surfaces all of these; the accessible one previously showed none.
        $tenantId = TenantContext::getId();
        $wallet = null;
        try {
            $wallet = app(\App\Services\WalletService::class)->getBalance($userId);
        } catch (\Throwable $e) {
            report($e);
        }

        $gamification = null;
        $badges = [];
        try {
            $gamification = \App\Services\GamificationService::getProfile($userId, $tenantId);
            $badges = \App\Services\GamificationService::getBadges($userId, $tenantId);
        } catch (\Throwable $e) {
            report($e);
        }

        $upcomingEvents = [];
        if (TenantContext::hasFeature('events')) {
            try {
                $upcomingEvents = EventService::getAll(['when' => 'upcoming', 'limit' => 3])['items'] ?? [];
            } catch (\Throwable $e) {
                report($e);
            }
        }

        // Personalised dashboard extras the React dashboard surfaces: a pending
        // review prompt, endorsements received, and the onboarding state.
        $onboardingCompleted = (bool) DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', TenantContext::getId())
            ->value('onboarding_completed');

        // Exchanges genuinely waiting on this member to act (accept a request,
        // confirm completion, or review a completed exchange) — drives the
        // dashboard banner. Driven by the exchange workflow (exchange_requests),
        // NOT raw wallet transactions, so it stays silent when nothing is pending.
        $exchangeAttentionCount = 0;
        if (TenantContext::hasModule('listings')) {
            try {
                $exchangeAttentionCount = app(ExchangeService::class)->countNeedingAttention($userId);
            } catch (\Throwable $e) {
                report($e);
            }
        }

        $endorsements = [];
        try {
            $endorsements = \App\Services\EndorsementService::getEndorsementsForUser($userId);
        } catch (\Throwable $e) {
            report($e);
        }

        $firstName = trim((string) ($profile['first_name'] ?? '')) ?: $this->profileDisplayName($profile);

        return $this->view('accessible-frontend::dashboard', [
            'title' => __('govuk_alpha.dashboard.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'dashboard',
            'profile' => $profile,
            'displayName' => $this->profileDisplayName($profile),
            'profileStats' => $this->profileStats($profile),
            'feedItems' => $feedItems,
            'listings' => $listings,
            'wallet' => $wallet,
            'gamification' => $gamification,
            'badges' => $badges,
            'upcomingEvents' => $upcomingEvents,
            'onboardingCompleted' => $onboardingCompleted,
            'exchangeAttentionCount' => $exchangeAttentionCount,
            'endorsements' => $endorsements,
            'firstName' => $firstName,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    public function contact(Request $request, string $tenantSlug): Response
    {
        $this->assertTenantSlug($tenantSlug);

        $user = null;
        $userId = $this->currentUserId();
        if ($userId !== null) {
            $user = DB::table('users')
                ->select('name', 'first_name', 'last_name', 'email')
                ->where('id', $userId)
                ->where('tenant_id', TenantContext::getId())
                ->first();
        }

        // When a signed-out visitor uses "Report a problem with this page", they are
        // routed here with the page they were on so the contact form is pre-filled.
        $problemUrl = self::asStr($request->query('problem_url'));
        $problemUrl = ($problemUrl !== '' && str_starts_with($problemUrl, '/') && ! str_starts_with($problemUrl, '//'))
            ? $problemUrl
            : null;

        return $this->view('accessible-frontend::contact', [
            'title' => __('govuk_alpha.contact.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'contact',
            'status' => self::asStr($request->query('status')) ?: null,
            'contactUser' => $user ? (array) $user : null,
            'turnstileSiteKey' => (string) env('TURNSTILE_SITE_KEY', ''),
            'problemUrl' => $problemUrl,
        ]);
    }

    public function storeContact(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);

        // Cloudflare Turnstile gate on contact form submissions.
        $turnstileToken = $request->input('cf-turnstile-response');
        if (! app(\App\Services\TurnstileService::class)->verify($turnstileToken, $request->ip())) {
            return redirect()
                ->route('govuk-alpha.contact', ['tenantSlug' => $tenantSlug, 'status' => 'contact-turnstile-failed'])
                ->withErrors(['turnstile' => __('api.turnstile_failed')])
                ->withInput();
        }

        $name = trim(self::asStr($request->input('name')));
        $email = trim(self::asStr($request->input('email')));
        $message = trim(self::asStr($request->input('message')));

        $errors = [];
        if ($name === '') {
            $errors['name'] = __('govuk_alpha.contact.errors.name_required');
        }
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors['email'] = __('govuk_alpha.contact.errors.email_required');
        }
        if ($message === '') {
            $errors['message'] = __('govuk_alpha.contact.errors.message_required');
        }

        if ($errors !== []) {
            return redirect()
                ->route('govuk-alpha.contact', ['tenantSlug' => $tenantSlug, 'status' => 'contact-validation'])
                ->withErrors($errors)
                ->withInput();
        }

        $request->merge([
            'name' => $name,
            'email' => $email,
            'subject' => trim(self::asStr($request->input('subject'))) ?: __('govuk_alpha.contact.form.subjects.general'),
            'message' => $message,
        ]);

        try {
            $response = app(CoreController::class)->apiSubmit();
        } catch (HttpResponseException $e) {
            $status = $e->getResponse()->getStatusCode() === 429 ? 'contact-rate-limited' : 'contact-failed';

            return redirect()
                ->route('govuk-alpha.contact', ['tenantSlug' => $tenantSlug, 'status' => $status])
                ->withInput();
        } catch (\Throwable $e) {
            report($e);

            return redirect()
                ->route('govuk-alpha.contact', ['tenantSlug' => $tenantSlug, 'status' => 'contact-failed'])
                ->withInput();
        }

        if ($response->getStatusCode() >= 200 && $response->getStatusCode() < 300) {
            return redirect()->route('govuk-alpha.contact', ['tenantSlug' => $tenantSlug, 'status' => 'contact-sent']);
        }

        return redirect()
            ->route('govuk-alpha.contact', ['tenantSlug' => $tenantSlug, 'status' => 'contact-failed'])
            ->withInput();
    }

    public function about(Request $request, string $tenantSlug): Response
    {
        $this->assertTenantSlug($tenantSlug);
        $communityName = (string) (TenantContext::get()['name'] ?? $tenantSlug);

        return $this->view('accessible-frontend::about', [
            'title' => __('govuk_alpha.about.title', ['name' => $communityName]),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'about',
            'stats' => $this->platformStats(),
            'contributors' => $this->aboutContributors(),
        ]);
    }

    public function trustSafety(Request $request, string $tenantSlug): Response
    {
        $this->assertTenantSlug($tenantSlug);

        return $this->view('accessible-frontend::trust-safety', [
            'title' => __('govuk_alpha.trust_safety.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'trust-safety',
        ]);
    }

    public function accessibility(Request $request, string $tenantSlug): Response
    {
        $this->assertTenantSlug($tenantSlug);

        return $this->view('accessible-frontend::accessibility', [
            'title' => __('govuk_alpha.accessibility.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'accessibility',
        ]);
    }

    public function legalHub(Request $request, string $tenantSlug): Response
    {
        $this->assertTenantSlug($tenantSlug);

        return $this->view('accessible-frontend::legal-hub', [
            'title' => __('govuk_alpha.legal.hub_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'legal',
        ]);
    }

    public function legalDocument(Request $request, string $tenantSlug): Response
    {
        $this->assertTenantSlug($tenantSlug);

        // The document type is supplied via route defaults (see routes/govuk-alpha.php).
        $type = self::asStr($request->route('type'));
        $allowed = ['terms', 'privacy', 'cookies', 'community_guidelines', 'acceptable_use'];
        abort_unless(in_array($type, $allowed, true), 404);

        return $this->view('accessible-frontend::legal-document', [
            'title' => __('govuk_alpha.legal.documents.' . $type . '.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'legal',
            'docType' => $type,
            // Tenant-managed document (admin-editable, same source as the React app),
            // or null when none is published — the view renders a GOV.UK fallback.
            'document' => LegalDocumentService::getDocument($type),
        ]);
    }

    public function help(Request $request, string $tenantSlug): Response
    {
        $this->assertTenantSlug($tenantSlug);

        $search = trim(self::asStr($request->query('q')));
        $groups = app(\App\Services\HelpService::class)
            ->getFaqs(TenantContext::getId(), null, $search !== '' ? $search : null);

        return $this->view('accessible-frontend::help', [
            'title' => __('govuk_alpha.help.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'help',
            'faqGroups' => $groups,
            'searchQuery' => $search,
        ]);
    }

    public function kb(Request $request, string $tenantSlug): Response
    {
        $this->assertTenantSlug($tenantSlug);

        $search = trim(self::asStr($request->query('q')));
        $cursor = self::asStr($request->query('cursor')) ?: null;
        $service = app(\App\Services\KnowledgeBaseService::class);

        if ($search !== '') {
            $result = ['items' => $service->search($search, 20), 'cursor' => null, 'has_more' => false];
        } else {
            $result = $service->getAll([
                'limit' => 12,
                'cursor' => $cursor,
                'published_only' => true,
            ]);
        }

        return $this->view('accessible-frontend::kb-index', [
            'title' => __('govuk_alpha.kb.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'kb',
            'articles' => $result['items'] ?? [],
            'hasMore' => (bool) ($result['has_more'] ?? false),
            'nextCursor' => $result['cursor'] ?? null,
            'searchQuery' => $search,
        ]);
    }

    public function kbArticle(Request $request, string $tenantSlug, int $id): Response
    {
        $this->assertTenantSlug($tenantSlug);

        $article = app(\App\Services\KnowledgeBaseService::class)->getById($id, true);
        abort_if($article === null, 404);

        return $this->view('accessible-frontend::kb-article', [
            'title' => (string) ($article['title'] ?? __('govuk_alpha.kb.title')),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'kb',
            'article' => $article,
        ]);
    }

    // === Onboarding wizard (welcome → profile → interests → skills → safeguarding → confirm) ===

    /** Entry point: redirect to the first active step, or to the dashboard if already complete. */
    public function onboarding(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }
        if (\App\Services\OnboardingService::isOnboardingComplete($userId)) {
            return redirect()->route('govuk-alpha.dashboard', ['tenantSlug' => $tenantSlug]);
        }
        $steps = \App\Services\OnboardingConfigService::getActiveSteps(TenantContext::getId());
        $first = $steps[0]['slug'] ?? 'confirm';

        return redirect()->route('govuk-alpha.onboarding.step', ['tenantSlug' => $tenantSlug, 'step' => $first]);
    }

    /** Render one wizard step. */
    public function onboardingStep(Request $request, string $tenantSlug, string $step): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }
        if (\App\Services\OnboardingService::isOnboardingComplete($userId)) {
            return redirect()->route('govuk-alpha.dashboard', ['tenantSlug' => $tenantSlug]);
        }

        $tenantId = TenantContext::getId();
        $steps = \App\Services\OnboardingConfigService::getActiveSteps($tenantId);
        $slugs = array_column($steps, 'slug');
        if (!in_array($step, $slugs, true)) {
            return redirect()->route('govuk-alpha.onboarding', ['tenantSlug' => $tenantSlug]);
        }

        $bag = (array) $request->session()->get('alpha_onboarding', []);
        $config = \App\Services\OnboardingConfigService::getConfig($tenantId);

        $categories = [];
        $safeguardingOptions = [];
        $user = null;
        if (in_array($step, ['interests', 'skills'], true)) {
            $categories = \Illuminate\Support\Facades\DB::select('SELECT id, name FROM categories WHERE tenant_id = ? ORDER BY name', [$tenantId]);
            $categories = array_map(static fn ($c) => (array) $c, $categories);
        }
        if ($step === 'safeguarding') {
            try {
                $safeguardingOptions = \App\Services\SafeguardingPreferenceService::getOptionsForTenant($tenantId);
            } catch (\Throwable $e) {
                report($e);
            }
        }
        if (in_array($step, ['profile', 'confirm'], true)) {
            $user = \Illuminate\Support\Facades\DB::table('users')->where('id', $userId)->select(['avatar_url', 'bio'])->first();
        }

        $idx = array_search($step, $slugs, true);

        return $this->view('accessible-frontend::onboarding', [
            'title' => __('govuk_alpha.onboarding.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'dashboard',
            'step' => $step,
            'steps' => $steps,
            'stepIndex' => $idx === false ? 0 : (int) $idx,
            'config' => $config,
            'bag' => $bag,
            'categories' => $categories,
            'safeguardingOptions' => $safeguardingOptions,
            'onboardingUser' => $user,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /** Save a step and advance (switches on the step). */
    public function onboardingStepPost(Request $request, string $tenantSlug, string $step): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }
        if (\App\Services\OnboardingService::isOnboardingComplete($userId)) {
            return redirect()->route('govuk-alpha.dashboard', ['tenantSlug' => $tenantSlug]);
        }

        $tenantId = TenantContext::getId();
        $steps = \App\Services\OnboardingConfigService::getActiveSteps($tenantId);
        $slugs = array_column($steps, 'slug');
        if (!in_array($step, $slugs, true)) {
            return redirect()->route('govuk-alpha.onboarding', ['tenantSlug' => $tenantSlug]);
        }

        $bag = (array) $request->session()->get('alpha_onboarding', []);

        switch ($step) {
            case 'profile':
                $config = \App\Services\OnboardingConfigService::getConfig($tenantId);
                $bio = trim(self::asStr($request->input('bio')));
                $min = (int) ($config['bio_min_length'] ?? 10);
                $current = \Illuminate\Support\Facades\DB::table('users')->where('id', $userId)->select(['avatar_url'])->first();
                if (!empty($config['bio_required']) && mb_strlen($bio) < $min) {
                    return redirect()->route('govuk-alpha.onboarding.step', ['tenantSlug' => $tenantSlug, 'step' => 'profile', 'status' => 'bio-too-short']);
                }
                if (!empty($config['avatar_required']) && empty($current->avatar_url ?? null)) {
                    return redirect()->route('govuk-alpha.onboarding.step', ['tenantSlug' => $tenantSlug, 'step' => 'profile', 'status' => 'avatar-required']);
                }
                \Illuminate\Support\Facades\DB::table('users')->where('id', $userId)->update(['bio' => mb_substr($bio, 0, 2000)]);
                break;

            case 'interests':
                $bag['interests'] = $this->onboardingCategoryIds($request->input('interests', []), $tenantId);
                $request->session()->put('alpha_onboarding', $bag);
                break;

            case 'skills':
                $bag['offers'] = $this->onboardingCategoryIds($request->input('offers', []), $tenantId);
                $bag['needs'] = $this->onboardingCategoryIds($request->input('needs', []), $tenantId);
                $request->session()->put('alpha_onboarding', $bag);
                break;

            case 'safeguarding':
                // Opt-in: choosing nothing is valid ("none apply"). Only save when
                // the member actually selected options.
                $raw = $request->input('safeguarding', []);
                $preferences = [];
                if (is_array($raw)) {
                    foreach ($raw as $optionId => $value) {
                        $value = is_array($value) ? '' : trim((string) $value);
                        if ((int) $optionId > 0 && $value !== '') {
                            $preferences[] = ['option_id' => (int) $optionId, 'value' => $value];
                        }
                    }
                }
                if (!empty($preferences)) {
                    try {
                        \App\Services\SafeguardingPreferenceService::saveUserPreferences($userId, $preferences, $request->ip());
                    } catch (\Throwable $e) {
                        report($e);
                        return redirect()->route('govuk-alpha.onboarding.step', ['tenantSlug' => $tenantSlug, 'step' => 'safeguarding', 'status' => 'safeguarding-failed']);
                    }
                }
                break;

            case 'confirm':
                return $this->onboardingComplete($request, $tenantSlug);

            case 'welcome':
            default:
                break;
        }

        $next = $this->onboardingNextStep($slugs, $step);
        if ($next === null) {
            return $this->onboardingComplete($request, $tenantSlug);
        }

        return redirect()->route('govuk-alpha.onboarding.step', ['tenantSlug' => $tenantSlug, 'step' => $next]);
    }

    /** HTML-first avatar upload during onboarding (multipart POST → PRG back to the profile step). */
    public function onboardingAvatar(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }
        $status = 'avatar-failed';
        try {
            if ($this->storeUploadedAvatar($request, $userId) !== false) {
                $status = 'avatar-saved';
            }
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.onboarding.step', ['tenantSlug' => $tenantSlug, 'step' => 'profile', 'status' => $status]);
    }

    /** Atomic completion: save interests/skills, auto-create listings, mark complete. */
    private function onboardingComplete(Request $request, string $tenantSlug): RedirectResponse
    {
        $userId = (int) $this->currentUserId();
        $bag = (array) $request->session()->get('alpha_onboarding', []);
        $interests = array_values(array_filter(array_map('intval', (array) ($bag['interests'] ?? [])), fn ($v) => $v > 0));
        $offers = array_values(array_filter(array_map('intval', (array) ($bag['offers'] ?? [])), fn ($v) => $v > 0));
        $needs = array_values(array_filter(array_map('intval', (array) ($bag['needs'] ?? [])), fn ($v) => $v > 0));

        $config = \App\Services\OnboardingConfigService::getConfig(TenantContext::getId());
        $svc = app(\App\Services\OnboardingService::class);

        try {
            \Illuminate\Support\Facades\DB::beginTransaction();
            $user = \Illuminate\Support\Facades\DB::selectOne('SELECT avatar_url, bio, onboarding_completed FROM users WHERE id = ? FOR UPDATE', [$userId]);
            if (!empty($user->onboarding_completed)) {
                \Illuminate\Support\Facades\DB::rollBack();
                return redirect()->route('govuk-alpha.dashboard', ['tenantSlug' => $tenantSlug]);
            }
            if (!empty($config['avatar_required']) && empty($user->avatar_url)) {
                \Illuminate\Support\Facades\DB::rollBack();
                return redirect()->route('govuk-alpha.onboarding.step', ['tenantSlug' => $tenantSlug, 'step' => 'profile', 'status' => 'avatar-required']);
            }
            if (!empty($config['bio_required']) && trim((string) ($user->bio ?? '')) === '') {
                \Illuminate\Support\Facades\DB::rollBack();
                return redirect()->route('govuk-alpha.onboarding.step', ['tenantSlug' => $tenantSlug, 'step' => 'profile', 'status' => 'bio-too-short']);
            }
            $svc->saveInterests($userId, $interests);
            $svc->saveSkills($userId, $offers, $needs);
            $svc->autoCreateListings($userId, $offers, $needs);
            $svc->completeOnboarding($userId);
            \Illuminate\Support\Facades\DB::commit();
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\DB::rollBack();
            report($e);
            return redirect()->route('govuk-alpha.onboarding.step', ['tenantSlug' => $tenantSlug, 'step' => 'confirm', 'status' => 'complete-failed']);
        }

        $request->session()->forget('alpha_onboarding');

        return redirect()->route('govuk-alpha.dashboard', ['tenantSlug' => $tenantSlug, 'status' => 'onboarding-complete']);
    }

    /** Sanitise + tenant-validate an array of category ids from a form. @return array<int,int> */
    private function onboardingCategoryIds(mixed $raw, int $tenantId): array
    {
        if (!is_array($raw)) {
            return [];
        }
        $ids = array_values(array_unique(array_filter(array_map('intval', $raw), fn ($v) => $v > 0)));
        if (empty($ids)) {
            return [];
        }
        return \Illuminate\Support\Facades\DB::table('categories')
            ->where('tenant_id', $tenantId)
            ->whereIn('id', $ids)
            ->pluck('id')
            ->map(fn ($v) => (int) $v)
            ->all();
    }

    /** @param array<int,string> $slugs */
    private function onboardingNextStep(array $slugs, string $current): ?string
    {
        $i = array_search($current, $slugs, true);
        if ($i === false) {
            return null;
        }
        return $slugs[$i + 1] ?? null;
    }

    public function blog(Request $request, string $tenantSlug): Response
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('blog'), 403);

        $search = trim(self::asStr($request->query('q')));
        $cursor = self::asStr($request->query('cursor')) ?: null;
        $categoryRaw = self::asStr($request->query('category'));
        $categoryId = ctype_digit($categoryRaw) ? (int) $categoryRaw : null;

        $service = app(\App\Services\BlogService::class);
        $result = $service->getAll([
            'limit' => 12,
            'cursor' => $cursor,
            'search' => $search !== '' ? $search : null,
            'category_id' => $categoryId,
        ]);

        return $this->view('accessible-frontend::blog-index', [
            'title' => __('govuk_alpha.blog.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'blog',
            'posts' => $result['items'] ?? [],
            'categories' => $service->getCategories(),
            'hasMore' => (bool) ($result['has_more'] ?? false),
            'nextCursor' => $result['cursor'] ?? null,
            'searchQuery' => $search,
            'categoryId' => $categoryId,
        ]);
    }

    /**
     * Public RSS 2.0 feed of the community's recent published blog posts. The
     * route is registered before /blog/{slug}, so "feed.xml" is never captured
     * as a post slug. Items use the author-free public BlogService projection.
     */
    public function blogFeed(Request $request, string $tenantSlug): Response
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('blog'), 403);

        $tenant = TenantContext::get();
        $tenantName = self::asStr($tenant['name'] ?? '') ?: $tenantSlug;
        $channelTitle = __('govuk_alpha.blog.title') . ' — ' . $tenantName;
        $channelLink = route('govuk-alpha.blog.index', ['tenantSlug' => $tenantSlug]);

        $posts = app(\App\Services\BlogService::class)->getAll(['limit' => 20])['items'] ?? [];

        $esc = static fn ($value): string => htmlspecialchars((string) $value, ENT_XML1 | ENT_QUOTES, 'UTF-8');

        $items = '';
        foreach ($posts as $post) {
            $slug = self::asStr($post['slug'] ?? '');
            if ($slug === '') {
                continue;
            }
            $url = route('govuk-alpha.blog.show', ['tenantSlug' => $tenantSlug, 'slug' => $slug]);
            $pubDate = '';
            try {
                $pubDate = \Illuminate\Support\Carbon::parse(self::asStr($post['published_at'] ?? $post['created_at'] ?? ''))->toRfc822String();
            } catch (\Throwable $e) {
                $pubDate = '';
            }
            $items .= '<item>'
                . '<title>' . $esc($post['title'] ?? '') . '</title>'
                . '<link>' . $esc($url) . '</link>'
                . '<guid isPermaLink="true">' . $esc($url) . '</guid>'
                . ($pubDate !== '' ? '<pubDate>' . $esc($pubDate) . '</pubDate>' : '')
                . '<description>' . $esc($post['excerpt'] ?? '') . '</description>'
                . '</item>';
        }

        $xml = '<?xml version="1.0" encoding="UTF-8"?>'
            . '<rss version="2.0"><channel>'
            . '<title>' . $esc($channelTitle) . '</title>'
            . '<link>' . $esc($channelLink) . '</link>'
            . '<description>' . $esc($channelTitle) . '</description>'
            . '<language>' . $esc(app()->getLocale()) . '</language>'
            . $items
            . '</channel></rss>';

        return response($xml, 200)->header('Content-Type', 'application/rss+xml; charset=UTF-8');
    }

    public function blogPost(Request $request, string $tenantSlug, string $slug): Response
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('blog'), 403);

        $post = app(\App\Services\BlogService::class)->getBySlug($slug);
        abort_if($post === null, 404);

        // Comments are visible to signed-in members (matches the React social
        // panel which requires auth to load the thread).
        $userId = $this->currentUserId();
        $comments = [];
        if ($userId !== null) {
            try {
                $comments = \App\Services\CommentService::getForEntity('blog', (int) ($post['id'] ?? 0), $userId);
            } catch (\Throwable $e) {
                report($e);
            }
        }

        $postId = (int) ($post['id'] ?? 0);

        return $this->view('accessible-frontend::blog-post', [
            'title' => (string) ($post['title'] ?? __('govuk_alpha.blog.title')),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'blog',
            'post' => $post,
            'comments' => $comments,
            'commentsCount' => \App\Services\CommentService::countAll($comments),
            'isAuthenticated' => $userId !== null,
            'likeCount' => $postId > 0 ? $this->alphaLikeCount('blog', $postId) : 0,
            'hasLiked' => $userId !== null && $postId > 0 && $this->alphaUserLiked('blog', $postId, $userId),
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /** Toggle a like on a blog post from the accessible blog post page. */
    public function blogTogglePostLike(Request $request, string $tenantSlug, string $slug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('blog'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $post = app(\App\Services\BlogService::class)->getBySlug($slug);
        abort_if($post === null, 404);
        $postId = (int) ($post['id'] ?? 0);

        $action = 'like-failed';
        try {
            $action = $this->alphaToggleLike('blog', $postId, $userId) === 'liked' ? 'liked' : 'unliked';
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.blog.show', ['tenantSlug' => $tenantSlug, 'slug' => $slug, 'status' => $action])
            ->withFragment('reactions');
    }

    public function storeBlogComment(Request $request, string $tenantSlug, string $slug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('blog'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $post = app(\App\Services\BlogService::class)->getBySlug($slug);
        abort_if($post === null, 404);

        $body = trim(self::asStr($request->input('body')));
        if ($body === '') {
            return redirect()->route('govuk-alpha.blog.show', ['tenantSlug' => $tenantSlug, 'slug' => $slug, 'status' => 'comment-invalid'])->withFragment('comments');
        }

        $status = 'comment-failed';
        try {
            $result = \App\Services\CommentService::addComment(
                $userId,
                TenantContext::getId(),
                'blog',
                (int) ($post['id'] ?? 0),
                mb_substr($body, 0, 5000)
            );
            if (!empty($result['comment']) || !empty($result['success'])) {
                $status = 'comment-added';
            }
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.blog.show', ['tenantSlug' => $tenantSlug, 'slug' => $slug, 'status' => $status])->withFragment('comments');
    }

    public function events(Request $request, string $tenantSlug): Response
    {
        $this->assertTenantSlug($tenantSlug);
        if (!TenantContext::hasFeature('events')) {
            return $this->view('accessible-frontend::events', [
                'title' => __('govuk_alpha.events.title'),
                'tenantSlug' => $tenantSlug,
                'activeNav' => 'events',
                'items' => [],
                'categories' => [],
                'filters' => $this->eventFilters($request),
                'meta' => ['has_more' => false, 'cursor' => null],
                'moduleDisabled' => true,
                'error' => null,
                'canModerateEvents' => false,
            ], 403);
        }

        $filters = $this->eventFilters($request);
        $viewerId = $this->currentUserId();
        $query = [
            'limit' => 12,
            'when' => $filters['when'],
        ];
        if ($viewerId !== null) {
            $query['viewer_id'] = $viewerId;
        }

        foreach (['category_id', 'search', 'step_free', 'cursor', 'near_lat', 'near_lng', 'radius_km'] as $key) {
            if (($filters[$key] ?? null) !== null && $filters[$key] !== '') {
                $query[$key] = $filters[$key];
            }
        }

        $items = [];
        $meta = ['has_more' => false, 'cursor' => null];
        $error = null;

        try {
            $result = EventService::getAll($query);
            $legacyItems = $this->withResolvedImageKey($result['items'] ?? [], 'cover_image');
            $items = $this->eventsCanonicalViewModels($legacyItems, $viewerId);
            $meta = [
                'has_more' => (bool) ($result['has_more'] ?? false),
                'cursor' => $result['cursor'] ?? null,
            ];
        } catch (\Throwable $e) {
            report($e);
            $error = __('govuk_alpha.states.error_title');
        }

        return $this->view('accessible-frontend::events', [
            'title' => __('govuk_alpha.events.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'events',
            'items' => $items,
            'categories' => $this->categoriesForTypes(['events', 'event']),
            'filters' => $filters,
            'meta' => $meta,
            'moduleDisabled' => false,
            'error' => $error,
            'status' => self::asStr($request->query('status')) ?: null,
            'canModerateEvents' => $this->eventsModerationLinkVisible(),
        ]);
    }

    public function event(string $tenantSlug, int $id): Response
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('events'), 403);

        $viewerId = $this->currentUserId();
        $legacyEvent = EventService::getById($id, $viewerId);
        abort_if($legacyEvent === null, 404);

        $legacyEvent['cover_image'] = $this->resolveAsset(
            $legacyEvent['cover_image'] ?? $legacyEvent['image_url'] ?? null
        );
        $event = $this->eventsCanonicalViewModel($legacyEvent, $viewerId);

        // Attendee roster (going + interested). EventService::getAttendees
        // self-enforces roster privacy, returning an empty list when the viewer
        // may not see it.
        $attendees = [];
        $attendeesLoadFailed = false;
        $attendeesMeta = ['cursor' => null, 'has_more' => false];
        $attendeesCursor = self::asStr(request()->query('attendees_cursor')) ?: null;
        try {
            $attendeeResult = EventService::getAttendees(
                $id,
                ['status' => 'all', 'limit' => 50, 'cursor' => $attendeesCursor],
                $viewerId
            );
            $attendees = $this->eventsCanonicalRoster($attendeeResult['items'] ?? []);
            $attendeesMeta = [
                'cursor' => $attendeeResult['cursor'] ?? null,
                'has_more' => (bool) ($attendeeResult['has_more'] ?? false),
            ];
        } catch (\Throwable $e) {
            report($e);
            $attendeesLoadFailed = true;
        }

        // Polls attached to this event (event_id scope). PollService::getById
        // applies ballot secrecy internally: per-option counts are null while a
        // poll is open for anyone but the creator — the blade renders results
        // only when results_visible is true, exactly like the /alpha/polls page.
        $polls = [];
        try {
            $list = \App\Services\PollService::getAll(['event_id' => $id, 'limit' => 20])['items'] ?? [];
            foreach ($list as $p) {
                $full = \App\Services\PollService::getById((int) ($p['id'] ?? 0), $viewerId);
                if ($full !== null) {
                    $polls[] = $full;
                }
            }
        } catch (\Throwable $e) {
            report($e);
        }

        // Sibling occurrences of a recurring series. getSeriesEvents is the
        // tenant-scoped reader (the API's showSeries uses it too); it returns a
        // light {id,title,start_time,status,...} shape ordered by start time.
        $seriesEvents = [];
        $seriesId = isset($event['series_id']) ? (int) $event['series_id'] : 0;
        if ($seriesId > 0) {
            try {
                $seriesEvents = EventService::getSeriesEvents($seriesId, $viewerId);
            } catch (\Throwable $e) {
                report($e);
            }
        }

        $eventOperations = [
            'people' => false,
            'attendance' => false,
            'broadcast' => false,
            'recurrence_definitions' => false,
        ];
        if ($viewerId !== null) {
            try {
                $actor = $this->accessibleEventActor($viewerId);
                $policyEvent = Event::withoutGlobalScopes()
                    ->where('tenant_id', TenantContext::currentId())
                    ->whereKey($id)
                    ->first();
                if ($policyEvent instanceof Event) {
                    $policy = app(EventPolicy::class);
                    $eventOperations = [
                        'people' => $policy->manageRegistration($actor, $policyEvent)
                            && $policy->viewRoster($actor, $policyEvent)
                            && $policy->viewWaitlist($actor, $policyEvent),
                        'attendance' => $policy->manageAttendance($actor, $policyEvent)
                            && $policy->viewRoster($actor, $policyEvent),
                        'broadcast' => $policy->broadcast($actor, $policyEvent),
                        'recurrence_definitions' => $this->eventsRecurrenceDefinitionEligible(
                            $event,
                        ),
                    ];
                }
            } catch (\Throwable $exception) {
                report($exception);
            }
        }

        return $this->view('accessible-frontend::event-detail', [
            'title' => $event['title'] ?? __('govuk_alpha.events.detail_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'events',
            'event' => $event,
            'requiresAuth' => $viewerId === null,
            'isOwner' => $viewerId !== null && (int) ($event['organizer']['id'] ?? 0) === $viewerId,
            'attendees' => $attendees,
            'attendeesLoadFailed' => $attendeesLoadFailed,
            'attendeesMeta' => $attendeesMeta,
            'polls' => $polls,
            'seriesEvents' => $seriesEvents,
            'eventOperations' => $eventOperations,
            'status' => self::asStr(request()->query('status')) ?: null,
            'ogImage' => $this->absoluteAssetUrl($event['cover_image'] ?? null),
            'ogImageAlt' => $event['cover_image'] ? ($event['title'] ?? null) : null,
        ]);
    }

    public function createEvent(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('events'), 403);

        if ($this->currentUserId() === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        return $this->view('accessible-frontend::event-create', [
            'title' => __('govuk_alpha.events.create_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'events',
            'categories' => $this->categoriesForTypes(['events', 'event']),
            'eventTimezone' => $this->accessibleEventDefaultTimezone(),
            'recurrenceCapabilities' => app(EventRecurrenceCapabilityService::class)->capabilities(),
            'status' => $request->query('status') ?: session('status'),
        ]);
    }

    public function storeEvent(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('events'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $uploadedCoverImage = null;
        $eventCreated = false;

        try {
            $isRecurring = $request->boolean('is_recurring');
            $inputData = $this->eventInput($request);

            if ($isRecurring) {
                $capabilities = app(EventRecurrenceCapabilityService::class)->capabilities();
                $supportedFrequencies = $capabilities['supported_frequencies'];
                $frequencySelection = trim(self::asStr($request->input('recurrence_frequency')));
                $serverFrequency = $frequencySelection === 'biweekly' ? 'weekly' : $frequencySelection;
                if (!in_array($serverFrequency, $supportedFrequencies, true)) {
                    throw ValidationException::withMessages([
                        'recurrence_frequency' => __('govuk_alpha.events.polish_events.recurrence_option_unavailable'),
                    ]);
                }
                $endsType = trim(self::asStr($request->input('recurrence_ends_type')));
                if (!in_array($endsType, $capabilities['supported_end_types'], true)
                    || ($endsType === 'never' && !$capabilities['supports_rolling_never'])
                    || ($endsType === 'after_count' && $capabilities['max_occurrences'] < 2)) {
                    throw ValidationException::withMessages([
                        'recurrence_ends_type' => __('govuk_alpha.events.polish_events.recurrence_option_unavailable'),
                    ]);
                }
                $rawCount = trim(self::asStr($request->input('recurrence_ends_after_count')));
                $count = filter_var($rawCount, FILTER_VALIDATE_INT);
                if ($endsType === 'after_count'
                    && ($count === false || $count < 2 || $count > $capabilities['max_occurrences'])) {
                    throw ValidationException::withMessages([
                        'recurrence_ends_after_count' => __('govuk_alpha.events.polish_events.recurrence_count_error', [
                            'max' => $capabilities['max_occurrences'],
                        ]),
                    ]);
                }
                $uploadedCoverImage = $this->uploadEventCoverImage($request);
                if ($uploadedCoverImage !== null) {
                    $inputData['cover_image'] = $uploadedCoverImage;
                }
                // Merge recurrence fields and call the recurring path.
                $recurrenceData = array_merge($inputData, [
                    'recurrence_frequency' => $frequencySelection === 'biweekly' ? 'weekly' : $frequencySelection,
                    'recurrence_interval' => $frequencySelection === 'biweekly' ? 2 : 1,
                    'recurrence_ends_type' => $endsType,
                    'recurrence_ends_after_count' => $count === false ? 10 : $count,
                    'recurrence_ends_on_date' => self::asStr($request->input('recurrence_ends_on_date')) ?: null,
                ]);
                $recurResult = EventService::createRecurring($userId, $recurrenceData);
                $eventId = (int) ($recurResult['template_id'] ?? 0);
                // Retrieve the created template event for XP/feed recording.
                $event = EventService::getById($eventId, $userId);
            } else {
                $uploadedCoverImage = $this->uploadEventCoverImage($request);
                if ($uploadedCoverImage !== null) {
                    $inputData['cover_image'] = $uploadedCoverImage;
                }
                $event = EventService::create($userId, $inputData);
                $eventId = (int) $event->id;
            }
            $eventCreated = true;

            try {
                \App\Services\GamificationService::awardXP(
                    $userId,
                    \App\Services\GamificationService::XP_VALUES['create_event'],
                    'create_event',
                    __('govuk_alpha.events.gamification_reason'),
                    'event:' . $eventId
                );
            } catch (\Throwable $e) {
                Log::warning('Accessible event XP award failed', ['user_id' => $userId, 'error' => $e->getMessage()]);
            }

            try {
                app(\App\Services\FeedActivityService::class)->recordActivity(
                    TenantContext::getId(),
                    $userId,
                    'event',
                    $eventId,
                    [
                        'title' => is_array($event) ? ($event['title'] ?? '') : ($event->title ?? ''),
                        'content' => is_array($event) ? ($event['description'] ?? '') : ($event->description ?? ''),
                        'image_url' => is_array($event) ? ($event['image_url'] ?? null) : ($event->image_url ?? null),
                        'group_id' => is_array($event) ? ($event['group_id'] ?? null) : ($event->group_id ?? null),
                    ]
                );
            } catch (\Throwable $e) {
                Log::warning('Accessible event feed activity failed', ['event_id' => $eventId, 'error' => $e->getMessage()]);
            }
        } catch (ValidationException $e) {
            if (!$eventCreated && $uploadedCoverImage !== null) {
                ImageUploader::deleteTenantUpload($uploadedCoverImage, 'events');
            }
            // Forward the per-field error bag so the create form can render an
            // anchored govuk-error-summary + inline govuk-error-message per field.
            return redirect()
                ->route('govuk-alpha.events.create', ['tenantSlug' => $tenantSlug])
                ->withErrors($e->errors())
                ->withInput();
        } catch (\Throwable $e) {
            if (!$eventCreated && $uploadedCoverImage !== null) {
                ImageUploader::deleteTenantUpload($uploadedCoverImage, 'events');
            }
            report($e);

            return redirect()
                ->route('govuk-alpha.events.create', ['tenantSlug' => $tenantSlug, 'status' => 'event-create-failed'])
                ->withInput();
        }

        if ($isRecurring) {
            return redirect()->route('govuk-alpha.events.index', [
                'tenantSlug' => $tenantSlug,
                'status' => 'event-created',
            ]);
        }

        return redirect()->route('govuk-alpha.events.show', ['tenantSlug' => $tenantSlug, 'id' => $eventId, 'status' => 'event-created']);
    }

    /**
     * Resolve an event the current user owns, or null (with the right HTTP abort)
     * for the organiser-only edit/cancel/delete flows.
     */
    private function ownedEventOrAbort(string $tenantSlug, int $id): array
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('events'), 403);
        $userId = $this->currentUserId();
        abort_if($userId === null, 401);

        $event = EventService::getById($id, $userId);
        abort_if($event === null, 404);
        abort_unless((int) ($event['user_id'] ?? 0) === $userId, 403);

        return [$event, $userId];
    }

    public function editEvent(Request $request, string $tenantSlug, int $id): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('events'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }
        $event = EventService::getById($id, $userId);
        abort_if($event === null, 404);
        abort_unless((int) ($event['user_id'] ?? 0) === $userId, 403);

        return $this->view('accessible-frontend::event-edit', [
            'title' => __('govuk_alpha.events.edit_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'events',
            'event' => $event,
            'categories' => $this->categoriesForTypes(['events', 'event']),
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    public function updateEvent(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        [, $userId] = $this->ownedEventOrAbort($tenantSlug, $id);

        try {
            $ok = EventService::update($id, $userId, $this->eventInput($request));
        } catch (ValidationException $e) {
            return redirect()
                ->route('govuk-alpha.events.edit', ['tenantSlug' => $tenantSlug, 'id' => $id])
                ->withErrors($e->errors())
                ->withInput();
        } catch (\Throwable $e) {
            report($e);
            $ok = false;
        }

        $contentChanges = $ok ? EventService::getLastMeaningfulUpdateChanges() : [];
        if ($ok) {
            // Handle image removal before attaching a new one.
            if ($request->boolean('remove_cover_image')) {
                try {
                    EventService::updateImage($id, $userId, '');
                } catch (\Throwable $e) {
                    report($e);
                }
            }
            // Attach a newly uploaded cover image (no-op if no file was sent).
            $this->attachEventCoverImage($request, $id, $userId);

            // Notify everyone who RSVP'd of meaningful changes (parity with
            // EventsController::update). EventService tracks the changes internally.
            try {
                if (!empty($contentChanges)
                    && EventNotificationDeliveryModeResolver::resolve(
                        (int) TenantContext::getId(),
                    ) !== EventNotificationDeliveryMode::OutboxAuthoritative) {
                    app(\App\Services\EventNotificationService::class)->notifyEventUpdated($id, $contentChanges);
                }
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::warning('Alpha event update notification failed', ['error' => $e->getMessage()]);
            }
        }

        return redirect()->route('govuk-alpha.events.show', [
            'tenantSlug' => $tenantSlug,
            'id' => $id,
            'status' => $ok ? 'event-updated' : 'event-update-failed',
        ]);
    }

    public function cancelEvent(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        [, $userId] = $this->ownedEventOrAbort($tenantSlug, $id);

        $reason = trim(self::asStr($request->input('reason')));
        $idempotencyKey = trim((string) ($request->header('Idempotency-Key')
            ?? $request->input('idempotency_key', '')));
        $ok = false;
        try {
            $ok = EventService::cancelEvent(
                $id,
                $userId,
                $reason,
                $idempotencyKey !== '' ? $idempotencyKey : null,
            );
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.events.show', [
            'tenantSlug' => $tenantSlug,
            'id' => $id,
            'status' => $ok ? 'event-cancelled' : 'event-cancel-failed',
        ]);
    }

    public function submitEventForReview(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        return $this->transitionAccessibleEventPublication($tenantSlug, $id, 'submit_for_review');
    }

    public function publishEvent(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        return $this->transitionAccessibleEventPublication($tenantSlug, $id, 'publish');
    }

    private function transitionAccessibleEventPublication(
        string $tenantSlug,
        int $id,
        string $action,
    ): RedirectResponse {
        $actor = $this->manageableEventActorOrAbort($tenantSlug, $id);
        $ok = false;
        try {
            $workflow = app(EventPublicationWorkflowService::class);
            if ($action === 'submit_for_review') {
                $workflow->submit($id, $actor);
            } else {
                $workflow->publish($id, $actor);
            }
            $ok = true;
        } catch (\Throwable $exception) {
            report($exception);
        }

        return redirect()->route('govuk-alpha.events.show', [
            'tenantSlug' => $tenantSlug,
            'id' => $id,
            'status' => $ok
                ? ($action === 'submit_for_review' ? 'event-submitted' : 'event-published')
                : 'event-publication-failed',
        ]);
    }

    private function manageableEventActorOrAbort(string $tenantSlug, int $id): User
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('events'), 403);
        $userId = $this->currentUserId();
        abort_if($userId === null, 401);

        $actor = $this->accessibleEventActor($userId);
        $event = Event::withoutGlobalScopes()
            ->where('tenant_id', TenantContext::currentId())
            ->whereKey($id)
            ->first();
        abort_if(! $event instanceof Event, 404);
        abort_unless(app(EventPolicy::class)->manage($actor, $event), 403);

        return $actor;
    }

    public function deleteEvent(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        [, $userId] = $this->ownedEventOrAbort($tenantSlug, $id);

        $reason = trim(self::asStr($request->input('reason')));
        $idempotencyKey = trim((string) ($request->header('Idempotency-Key')
            ?? $request->input('idempotency_key', '')));
        $ok = false;
        try {
            $ok = EventService::delete(
                $id,
                $userId,
                $reason !== '' ? $reason : null,
                $idempotencyKey !== '' ? $idempotencyKey : null,
            );
        } catch (\Throwable $e) {
            report($e);
        }

        // Archive-first lifecycle keeps the event and its audit evidence while
        // removing it from normal discovery, so return to the visible list.
        return redirect()->route('govuk-alpha.events.index', [
            'tenantSlug' => $tenantSlug,
            'status' => $ok ? 'event-archived' : 'event-archive-failed',
        ]);
    }

    public function storeEventRsvp(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('events'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $status = $this->allowed(
            $request->input('status', 'going'),
            ['going', 'interested', 'not_going'],
            'going',
        );
        $changed = false;
        try {
            $actor = $this->accessibleEventActor($userId);
            $requestKey = $this->accessibleEventMutationKey($request);
            if ($status === 'going') {
                try {
                    $registration = DB::transaction(function () use (
                        $id,
                        $userId,
                        $actor,
                        $requestKey,
                    ) {
                        $result = $this->eventRegistrationService->confirmCompatibility(
                            $id,
                            $userId,
                            $actor,
                            $requestKey,
                        );
                        $this->eventWaitlistService->withdrawCompatibility(
                            $id,
                            $userId,
                            $actor,
                            $requestKey,
                        );

                        return $result;
                    }, 5);
                    $changed = $registration->changed;
                } catch (EventRegistrationException $exception) {
                    if ($exception->reasonCode !== 'event_registration_capacity_full') {
                        throw $exception;
                    }
                    $this->eventWaitlistService->joinCompatibility(
                        $id,
                        $userId,
                        $actor,
                        $requestKey,
                    );

                    return redirect()->route('govuk-alpha.events.show', [
                        'tenantSlug' => $tenantSlug,
                        'id' => $id,
                        'status' => 'waitlist-joined',
                    ]);
                }
            } else {
                DB::transaction(function () use (
                    $id,
                    $userId,
                    $status,
                    $actor,
                    $requestKey,
                ): void {
                    $this->eventRegistrationService->withdrawCompatibility(
                        $id,
                        $userId,
                        $actor,
                        $requestKey,
                    );
                    $this->eventWaitlistService->withdrawCompatibility(
                        $id,
                        $userId,
                        $actor,
                        $requestKey,
                    );
                    if (! EventService::rsvp($id, $userId, $status)) {
                        throw new \RuntimeException('accessible_event_rsvp_failed');
                    }
                }, 5);
                $changed = EventService::wasLastRsvpChanged();
            }
        } catch (SafeguardingPolicyException $e) {
            return redirect()->route('govuk-alpha.events.show', [
                'tenantSlug' => $tenantSlug,
                'id' => $id,
                'status' => $e->reasonCode === 'SAFEGUARDING_POLICY_UNAVAILABLE'
                    ? 'rsvp-policy-unavailable'
                    : 'rsvp-vetting-required',
            ]);
        } catch (EventParticipationException|EventRegistrationException|EventWaitlistException $e) {
            return redirect()->route('govuk-alpha.events.show', [
                'tenantSlug' => $tenantSlug,
                'id' => $id,
                'status' => 'rsvp-failed',
            ]);
        } catch (\Throwable $e) {
            report($e);
            return redirect()->route('govuk-alpha.events.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'rsvp-failed']);
        }

        // Notify the organiser only for a state change. The XP call below uses a
        // stable database-backed event reference, so retries can safely recover
        // without status cycling or RSVP recreation awarding twice.
        try {
            if ($changed && EventNotificationDeliveryModeResolver::resolve(
                (int) TenantContext::getId(),
            ) === EventNotificationDeliveryMode::Direct) {
                app(\App\Services\EventNotificationService::class)->notifyRsvp($id, $userId, $status);
            }
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('Alpha RSVP notification failed', ['error' => $e->getMessage()]);
        }
        if ($status === 'going') {
            try {
                // Via EngagementService so attend_event challenges progress on
                // the accessible frontend exactly as they do on the React one.
                \App\Services\EngagementService::record(
                    $userId,
                    'attend_event',
                    'event:' . $id,
                    __('govuk_alpha.profile.activity_types.event_rsvp'),
                );
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::warning('Alpha RSVP XP award failed', ['error' => $e->getMessage()]);
            }
        }

        return redirect()->route('govuk-alpha.events.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'rsvp-updated']);
    }

    /**
     * Join the waitlist for a full event.
     *
     * Mirrors POST /v2/events/{id}/waitlist. The member is added to the queue;
     * the detail page then shows their position via EventService::getUserWaitlistPosition.
     */
    public function joinEventWaitlist(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('events'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        // Confirm the event exists in this tenant before mutating the waitlist.
        $event = EventService::getById($id, $userId);
        abort_if($event === null, 404);

        try {
            $this->eventWaitlistService->joinCompatibility(
                $id,
                $userId,
                $this->accessibleEventActor($userId),
                $this->accessibleEventMutationKey($request),
            );
        } catch (SafeguardingPolicyException $e) {
            return redirect()->route('govuk-alpha.events.show', [
                'tenantSlug' => $tenantSlug,
                'id' => $id,
                'status' => $e->reasonCode === 'SAFEGUARDING_POLICY_UNAVAILABLE'
                    ? 'waitlist-policy-unavailable'
                    : 'waitlist-vetting-required',
            ]);
        } catch (EventParticipationException|EventRegistrationException|EventWaitlistException $e) {
            return redirect()->route('govuk-alpha.events.show', [
                'tenantSlug' => $tenantSlug,
                'id' => $id,
                'status' => 'waitlist-failed',
            ]);
        } catch (\Throwable $e) {
            report($e);
            return redirect()->route('govuk-alpha.events.show', [
                'tenantSlug' => $tenantSlug,
                'id' => $id,
                'status' => 'waitlist-failed',
            ]);
        }

        return redirect()->route('govuk-alpha.events.show', [
            'tenantSlug' => $tenantSlug,
            'id' => $id,
            'status' => 'waitlist-joined',
        ]);
    }

    /**
     * Leave the waitlist for an event.
     *
     * Mirrors DELETE /v2/events/{id}/waitlist. removeFromWaitlist is idempotent
     * (it only cancels a 'waiting' row) so we always report success.
     */
    public function leaveEventWaitlist(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('events'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $event = EventService::getById($id, $userId);
        abort_if($event === null, 404);

        try {
            $this->eventWaitlistService->withdrawCompatibility(
                $id,
                $userId,
                $this->accessibleEventActor($userId),
                $this->accessibleEventMutationKey($request),
            );
        } catch (EventRegistrationException|EventWaitlistException $e) {
            // Leaving is historically idempotent. Missing/inactive queue facts
            // still redirect to the same confirmation and never cross tenants.
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.events.show', [
            'tenantSlug' => $tenantSlug,
            'id' => $id,
            'status' => 'waitlist-left',
        ]);
    }

    /**
     * Cast a vote on a poll attached to an event.
     *
     * Mirrors POST /v2/polls/{id}/vote, scoped to the event so the poll must
     * actually belong to this event (no cross-event vote stuffing). Ballot
     * secrecy is enforced by PollService::getById on the way back out.
     */
    public function storeEventPollVote(Request $request, string $tenantSlug, int $id, int $pollId): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('events'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        // The event must exist in this tenant, and the poll must be attached to it.
        $event = EventService::getById($id, $userId);
        abort_if($event === null, 404);

        $poll = \App\Services\PollService::getById($pollId, $userId);
        abort_if($poll === null, 404);
        abort_unless((int) ($poll['event_id'] ?? 0) === $id, 404);

        $optionId = (int) $request->input('option_id');
        $ok = false;
        if ($optionId > 0) {
            try {
                // PollService::vote validates the option belongs to the poll.
                $ok = \App\Services\PollService::vote($pollId, $optionId, $userId);
            } catch (\Throwable $e) {
                report($e);
            }
        }

        return redirect()->route('govuk-alpha.events.show', [
            'tenantSlug' => $tenantSlug,
            'id' => $id,
            'status' => $ok ? 'poll-voted' : 'poll-vote-failed',
        ])->withFragment('poll-' . $pollId);
    }

    public function volunteering(Request $request, string $tenantSlug): Response
    {
        $this->assertTenantSlug($tenantSlug);
        if (!TenantContext::hasFeature('volunteering')) {
            return $this->view('accessible-frontend::volunteering', [
                'title' => __('govuk_alpha.volunteering.title'),
                'tenantSlug' => $tenantSlug,
                'activeNav' => 'volunteering',
                'items' => [],
                'categories' => [],
                'filters' => $this->volunteeringFilters($request),
                'meta' => ['has_more' => false, 'cursor' => null],
                'moduleDisabled' => true,
                'error' => null,
                'requiresAuth' => $this->currentUserId() === null,
                'hoursSummary' => null,
                'applications' => [],
                'organizations' => [],
                'selectedTab' => 'opportunities',
            ], 403);
        }

        $filters = $this->volunteeringFilters($request);
        // The standalone "organisations" tab was replaced by the two-hats org
        // door at the top of the gateway, so it's no longer an accepted tab value.
        $selectedTab = $this->allowed($request->query('tab', 'opportunities'), ['opportunities', 'applications', 'recommended', 'community_projects'], 'opportunities');
        $query = ['limit' => 12];
        foreach (['category_id', 'search', 'cursor', 'is_remote'] as $key) {
            if ($filters[$key] !== null && $filters[$key] !== '') {
                $query[$key] = $filters[$key];
            }
        }

        $items = [];
        $meta = ['has_more' => false, 'cursor' => null];
        $error = null;
        $userId = $this->currentUserId();

        try {
            $result = VolunteerService::getOpportunities($query);
            $items = $result['items'] ?? [];
            $meta = [
                'has_more' => (bool) ($result['has_more'] ?? false),
                'cursor' => $result['cursor'] ?? null,
            ];
        } catch (\Throwable $e) {
            report($e);
            $error = __('govuk_alpha.states.error_title');
        }

        // Applications tab: status filter + cursor pagination (was a fixed top-5).
        $applicationsStatus = $this->allowed($request->query('app_status'), ['pending', 'approved', 'declined', 'withdrawn'], null);
        $applications = ['items' => [], 'cursor' => null, 'has_more' => false];
        if ($userId !== null) {
            $applicationsQuery = ['limit' => 10];
            if ($applicationsStatus !== null) {
                $applicationsQuery['status'] = $applicationsStatus;
            }
            $applicationsCursor = self::asStr($request->query('app_cursor'));
            if ($applicationsCursor !== '') {
                $applicationsQuery['cursor'] = $applicationsCursor;
            }
            $applications = VolunteerService::getMyApplications($userId, $applicationsQuery);
        }

        // Recommended (skills-based) shifts — read-only "For you" tab.
        $recommendedShifts = [];
        if ($userId !== null && $selectedTab === 'recommended') {
            try {
                $recommendedShifts = app(\App\Services\VolunteerMatchingService::class)->getRecommendedShifts($userId, ['limit' => 10]);
            } catch (\Throwable $e) {
                report($e);
            }
        }

        // Community projects — approved member-proposed projects (read-only list,
        // mirrors React). public => true restricts to approved/active/completed.
        $communityProjects = [];
        if ($selectedTab === 'community_projects') {
            try {
                $communityProjects = app(\App\Services\CommunityProjectService::class)
                    ->getProposals(['public' => true, 'limit' => 12])['items'] ?? [];
            } catch (\Throwable $e) {
                report($e);
            }
        }

        return $this->view('accessible-frontend::volunteering', [
            'title' => __('govuk_alpha.volunteering.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'volunteering',
            'items' => $items,
            'categories' => $this->categoriesForTypes(['volunteering', 'volunteer']),
            'filters' => $filters,
            'meta' => $meta,
            'moduleDisabled' => false,
            'error' => $error,
            'requiresAuth' => $userId === null,
            'hoursSummary' => $userId ? VolunteerService::getHoursSummary($userId) : null,
            'applications' => $applications['items'] ?? [],
            'applicationsMeta' => ['has_more' => (bool) ($applications['has_more'] ?? false), 'cursor' => $applications['cursor'] ?? null],
            'applicationsStatus' => $applicationsStatus,
            'organizations' => $userId ? (VolunteerService::getMyOrganizations($userId, ['limit' => 5])['items'] ?? []) : [],
            'recommendedShifts' => $recommendedShifts,
            'communityProjects' => is_array($communityProjects) ? $communityProjects : [],
            'selectedTab' => $selectedTab,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    public function volunteerOpportunity(Request $request, string $tenantSlug, int $id): Response
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('volunteering'), 403);

        $opportunity = VolunteerService::getOpportunityById($id, $this->currentUserId());
        abort_if($opportunity === null, 404);

        // There is no opportunity-level image in the payload; the organisation logo
        // is the only image React shows here too. Resolve it to a same-origin URL.
        $orgLogo = $this->resolveAsset($opportunity['organization']['logo_url'] ?? null);
        $opportunity['organization']['logo_url'] = $orgLogo;

        return $this->view('accessible-frontend::volunteer-opportunity', [
            'title' => $opportunity['title'] ?? __('govuk_alpha.volunteering.detail_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'volunteering',
            'opportunity' => $opportunity,
            'requiresAuth' => $this->currentUserId() === null,
            'status' => self::asStr($request->query('status')) ?: null,
            'ogImage' => $this->absoluteAssetUrl($orgLogo),
            'ogImageAlt' => $orgLogo ? ($opportunity['organization']['name'] ?? null) : null,
        ]);
    }

    public function applyVolunteerOpportunity(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('volunteering'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        try {
            VolunteerService::apply($id, $userId, [
                'message' => trim(self::asStr($request->input('message'))),
                'shift_id' => $request->input('shift_id') ? (int) $request->input('shift_id') : null,
            ]);
        } catch (\App\Exceptions\SafeguardingPolicyException $e) {
            return redirect()->route('govuk-alpha.volunteering.show', [
                'tenantSlug' => $tenantSlug,
                'id' => $id,
                'status' => $e->reasonCode === 'SAFEGUARDING_POLICY_UNAVAILABLE'
                    ? 'apply-safeguarding-unavailable'
                    : 'apply-safeguarding-restricted',
            ]);
        } catch (\Throwable $e) {
            report($e);
            return redirect()->route('govuk-alpha.volunteering.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'apply-failed']);
        }

        // Notify the opportunity organiser of the new application (parity with
        // VolunteerController::apply). Best-effort, in the organiser's language.
        try {
            $opportunity = \App\Models\VolOpportunity::where('tenant_id', TenantContext::getId())->find($id);
            if ($opportunity && $opportunity->created_by && (int) $opportunity->created_by !== $userId) {
                $volunteer = \App\Models\User::find($userId);
                $organizer = \App\Models\User::find((int) $opportunity->created_by);
                \App\I18n\LocaleContext::withLocale($organizer, function () use ($volunteer, $opportunity) {
                    $volunteerName = $volunteer->name ?? __('emails.common.fallback_someone');
                    $notifContent = __('notifications.vol_application_received_body', ['name' => $volunteerName, 'title' => $opportunity->title]);
                    $orgId = $opportunity->organization_id;
                    $notifLink = "/volunteering/org/{$orgId}/dashboard?tab=applications";
                    $htmlContent = \App\Services\NotificationDispatcher::buildVolApplicationReceivedEmail($volunteerName, $opportunity->title, (int) $orgId);
                    \App\Services\NotificationDispatcher::dispatch((int) $opportunity->created_by, 'global', 0, 'vol_application_received', $notifContent, $notifLink, $htmlContent);
                });
            }
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('Alpha volunteer application notification failed', ['error' => $e->getMessage()]);
        }

        return redirect()->route('govuk-alpha.volunteering.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'apply-created']);
    }

    public function signUpForVolunteerShift(Request $request, string $tenantSlug, int $id, int $shiftId): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('volunteering'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $ok = false;
        try {
            $ok = VolunteerService::signUpForShift($shiftId, $userId);
        } catch (\App\Exceptions\SafeguardingPolicyException $e) {
            return redirect()->route('govuk-alpha.volunteering.show', [
                'tenantSlug' => $tenantSlug,
                'id' => $id,
                'status' => $e->reasonCode === 'SAFEGUARDING_POLICY_UNAVAILABLE'
                    ? 'shift-safeguarding-unavailable'
                    : 'shift-safeguarding-restricted',
            ]);
        } catch (\Throwable $e) {
            report($e);
        }

        // Notify the opportunity organiser of the shift sign-up (parity with
        // VolunteerController::signUpForShift), in the organiser's language.
        if ($ok) {
            try {
                $shift = \App\Models\VolShift::with('opportunity')->find($shiftId);
                if ($shift && (int) $shift->tenant_id === TenantContext::getId()
                    && $shift->opportunity && $shift->opportunity->created_by
                    && (int) $shift->opportunity->created_by !== $userId) {
                    $volunteer = \App\Models\User::find($userId);
                    $organizer = \App\Models\User::find((int) $shift->opportunity->created_by);
                    \App\I18n\LocaleContext::withLocale($organizer, function () use ($volunteer, $shift) {
                        $volunteerName = $volunteer->name ?? __('emails.common.fallback_someone');
                        $msg = __('notifications.vol_shift_signup_body', ['name' => $volunteerName]);
                        $link = "/volunteering/opportunities/{$shift->opportunity_id}";
                        \App\Models\Notification::createNotification((int) $shift->opportunity->created_by, $msg, $link, 'volunteering');
                        \App\Services\NotificationDispatcher::fanOutPush((int) $shift->opportunity->created_by, 'volunteering', $msg, $link);
                    });
                }
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::warning('Alpha volunteer shift signup notification failed', ['error' => $e->getMessage()]);
            }
        }

        return redirect()->route('govuk-alpha.volunteering.show', [
            'tenantSlug' => $tenantSlug,
            'id' => $id,
            'status' => $ok ? 'shift-signed-up' : 'shift-signup-failed',
        ]);
    }

    public function cancelVolunteerShift(Request $request, string $tenantSlug, int $id, int $shiftId): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('volunteering'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $ok = false;
        try {
            $ok = VolunteerService::cancelShiftSignup($shiftId, $userId);
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.volunteering.show', [
            'tenantSlug' => $tenantSlug,
            'id' => $id,
            'status' => $ok ? 'shift-cancelled' : 'shift-cancel-failed',
        ]);
    }

    // ===== WAVE V-ORG: organisation-admin dashboard (the "two hats" admin side) =====

    /**
     * Guard for the organisation-admin screens: feature on + signed in + the
     * current user owns or admins the (tenant-scoped) volunteer organisation.
     * Returns the org's display name on success, or a RedirectResponse / aborts
     * exactly the way the group-management guard does (404 for a non-existent or
     * cross-tenant org, 403 when the user is not an owner/admin).
     *
     * @return array{0:int,1:string}|RedirectResponse  [userId, orgName] on success.
     */
    private function volunteerOrgGuard(string $tenantSlug, int $orgId): array|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('volunteering'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $tenantId = TenantContext::getId();
        $org = \Illuminate\Support\Facades\DB::selectOne(
            'SELECT id, name, user_id, status FROM vol_organizations WHERE id = ? AND tenant_id = ?',
            [$orgId, $tenantId]
        );
        abort_if($org === null, 404);

        // Owner of the org row, OR an active owner/admin org member, may manage it.
        // Mirrors VolunteerController::ensureOrgAccess (minus the site-admin branch,
        // which the accessible member UI does not surface).
        $canManage = (int) $org->user_id === $userId;
        if (!$canManage) {
            $membership = \Illuminate\Support\Facades\DB::selectOne(
                "SELECT role FROM org_members WHERE tenant_id = ? AND organization_id = ? AND org_type = 'volunteer' AND user_id = ? AND status = 'active'",
                [$tenantId, $orgId, $userId]
            );
            $canManage = $membership !== null && in_array($membership->role, ['owner', 'admin'], true);
        }
        abort_unless($canManage, 403);

        return [$userId, (string) ($org->name ?? '')];
    }

    public function manageVolunteerOrg(Request $request, string $tenantSlug, int $id): Response|RedirectResponse
    {
        $guard = $this->volunteerOrgGuard($tenantSlug, $id);
        if ($guard instanceof RedirectResponse) {
            return $guard;
        }
        [, $orgName] = $guard;

        // Pending applications awaiting an org decision, and pending hours awaiting
        // approval — both fetched via the same SQL the React org dashboard uses
        // (VolunteerController::orgApplications / orgHoursPending).
        $applications = [];
        $hours = [];
        try {
            $applications = $this->volunteerOrgPendingApplications($id);
        } catch (\Throwable $e) {
            report($e);
        }
        try {
            $hours = $this->volunteerOrgPendingHours($id);
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::volunteer-org-manage', [
            'title' => __('govuk_alpha.vol_org.manage_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'volunteering',
            'orgId' => $id,
            'orgName' => $orgName,
            'applications' => $applications,
            'hours' => $hours,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    public function handleVolunteerOrgApplication(Request $request, string $tenantSlug, int $id, int $appId): RedirectResponse
    {
        $guard = $this->volunteerOrgGuard($tenantSlug, $id);
        if ($guard instanceof RedirectResponse) {
            return $guard;
        }
        [$userId] = $guard;

        $action = self::asStr($request->input('action')) === 'decline' ? 'decline' : 'approve';

        // Confirm the application belongs to THIS organisation before acting — the
        // service-layer ownership check is org-membership-based, so this scopes the
        // mutation to the org whose dashboard the admin is on.
        $belongs = \Illuminate\Support\Facades\DB::selectOne(
            'SELECT va.id FROM vol_applications va
             INNER JOIN vol_opportunities vo ON va.opportunity_id = vo.id AND vo.tenant_id = va.tenant_id
             WHERE va.id = ? AND va.tenant_id = ? AND vo.organization_id = ?',
            [$appId, TenantContext::getId(), $id]
        );

        $ok = false;
        if ($belongs !== null) {
            try {
                $ok = VolunteerService::handleApplication($appId, $userId, $action, trim(self::asStr($request->input('org_note'))));
            } catch (\App\Exceptions\SafeguardingPolicyException $e) {
                $safeguardingStatus = $e->reasonCode === 'SAFEGUARDING_POLICY_UNAVAILABLE'
                    ? 'application-safeguarding-unavailable'
                    : 'application-safeguarding-restricted';
            } catch (\Throwable $e) {
                report($e);
            }
        }

        // Notify the applicant of the decision — parity with the React API path
        // (VolunteerController::handleApplication). Previously the accessible
        // approve/decline flow updated the record but never told the volunteer.
        if ($ok) {
            try {
                $tenantId = TenantContext::getId();
                $application = \App\Models\VolApplication::where('tenant_id', $tenantId)->find($appId);
                if ($application && $application->user_id) {
                    $opportunityId = (int) $application->opportunity_id;
                    $opportunity = \App\Models\VolOpportunity::where('tenant_id', $tenantId)->find($opportunityId);
                    $applicant = \App\Models\User::find((int) $application->user_id);
                    \App\I18n\LocaleContext::withLocale($applicant, function () use ($application, $opportunity, $opportunityId, $action) {
                        $oppTitle = $opportunity->title ?? __('notifications.vol_application_fallback_opportunity');
                        if ($action === 'approve') {
                            $message = __('notifications.vol_application_approved_body', ['title' => $oppTitle]);
                            $notifType = 'vol_application_approved';
                            $htmlContent = \App\Services\NotificationDispatcher::buildVolApplicationApprovedEmail($oppTitle, $opportunityId);
                        } else {
                            $message = __('notifications.vol_application_declined_body', ['title' => $oppTitle]);
                            $notifType = 'vol_application_declined';
                            $htmlContent = \App\Services\NotificationDispatcher::buildVolApplicationDeclinedEmail($oppTitle);
                        }
                        \App\Services\NotificationDispatcher::dispatch(
                            (int) $application->user_id,
                            'global',
                            0,
                            $notifType,
                            $message,
                            "/volunteering/opportunities/{$opportunityId}",
                            $htmlContent
                        );
                    });
                }
            } catch (\Throwable $e) {
                report($e);
            }
        }

        $status = $ok
            ? ($action === 'approve' ? 'application-approved' : 'application-declined')
            : ($safeguardingStatus ?? 'application-failed');

        return redirect()->route('govuk-alpha.volunteering.org.manage', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => $status]);
    }

    public function verifyVolunteerOrgHours(Request $request, string $tenantSlug, int $id, int $logId): RedirectResponse
    {
        $guard = $this->volunteerOrgGuard($tenantSlug, $id);
        if ($guard instanceof RedirectResponse) {
            return $guard;
        }
        [$userId] = $guard;

        $action = self::asStr($request->input('action')) === 'decline' ? 'decline' : 'approve';

        // Confirm the log belongs to THIS organisation before acting. verifyHours()
        // also re-checks org ownership and auto-mints credits on approval (1 credit
        // per whole hour, regardless of org wallet balance) — identical to React.
        $belongs = \Illuminate\Support\Facades\DB::selectOne(
            'SELECT id FROM vol_logs WHERE id = ? AND tenant_id = ? AND organization_id = ?',
            [$logId, TenantContext::getId(), $id]
        );

        $ok = false;
        if ($belongs !== null) {
            try {
                $ok = VolunteerService::verifyHours($logId, $userId, $action);
            } catch (\Throwable $e) {
                report($e);
            }
        }

        $status = $ok
            ? ($action === 'approve' ? 'hours-approved' : 'hours-declined')
            : 'hours-verify-failed';

        return redirect()->route('govuk-alpha.volunteering.org.manage', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => $status]);
    }

    /**
     * Pending applications for an organisation, shaped for the manage view. Mirrors
     * the SELECT in VolunteerController::orgApplications (status = 'pending').
     *
     * @return list<array<string, mixed>>
     */
    private function volunteerOrgPendingApplications(int $orgId): array
    {
        $tenantId = TenantContext::getId();
        $rows = \Illuminate\Support\Facades\DB::select(
            "SELECT va.id, va.message, va.created_at, va.shift_id,
                    u.id as user_id, u.name as user_name,
                    vo.id as opportunity_id, vo.title as opportunity_title,
                    vs.start_time as shift_start, vs.end_time as shift_end
             FROM vol_applications va
             INNER JOIN vol_opportunities vo ON va.opportunity_id = vo.id AND vo.organization_id = ? AND vo.tenant_id = va.tenant_id
             INNER JOIN users u ON va.user_id = u.id AND u.tenant_id = va.tenant_id
             LEFT JOIN vol_shifts vs ON va.shift_id = vs.id AND vs.tenant_id = va.tenant_id
             WHERE va.tenant_id = ? AND va.status = 'pending'
             ORDER BY va.id DESC
             LIMIT 100",
            [$orgId, $tenantId]
        );

        return array_map(static fn (object $r): array => [
            'id' => (int) $r->id,
            'message' => $r->message,
            'created_at' => $r->created_at,
            'user' => ['id' => (int) $r->user_id, 'name' => $r->user_name],
            'opportunity' => ['id' => (int) $r->opportunity_id, 'title' => $r->opportunity_title],
            'shift' => $r->shift_start ? ['start_time' => $r->shift_start, 'end_time' => $r->shift_end] : null,
        ], $rows);
    }

    /**
     * Pending logged hours for an organisation, shaped for the manage view. Mirrors
     * the SELECT in VolunteerController::orgHoursPending (status = 'pending').
     *
     * @return list<array<string, mixed>>
     */
    private function volunteerOrgPendingHours(int $orgId): array
    {
        $tenantId = TenantContext::getId();
        $rows = \Illuminate\Support\Facades\DB::select(
            "SELECT vl.id, vl.hours, vl.date_logged as date, vl.description, vl.created_at,
                    u.id as user_id, u.name as user_name,
                    vo.id as opportunity_id, vo.title as opportunity_title
             FROM vol_logs vl
             INNER JOIN users u ON vl.user_id = u.id AND u.tenant_id = vl.tenant_id
             LEFT JOIN vol_opportunities vo ON vl.opportunity_id = vo.id AND vo.tenant_id = vl.tenant_id
             WHERE vl.organization_id = ? AND vl.tenant_id = ? AND vl.status = 'pending'
             ORDER BY vl.id DESC
             LIMIT 100",
            [$orgId, $tenantId]
        );

        return array_map(static fn (object $r): array => [
            'id' => (int) $r->id,
            'hours' => (float) $r->hours,
            'date' => $r->date,
            'description' => $r->description,
            'created_at' => $r->created_at,
            'user' => ['id' => (int) $r->user_id, 'name' => $r->user_name],
            'opportunity' => $r->opportunity_id ? ['id' => (int) $r->opportunity_id, 'title' => $r->opportunity_title] : null,
        ], $rows);
    }

    public function withdrawVolunteerApplication(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('volunteering'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $ok = false;
        try {
            $ok = VolunteerService::withdrawApplication($id, $userId);
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.volunteering.index', [
            'tenantSlug' => $tenantSlug,
            'tab' => 'applications',
            'status' => $ok ? 'application-withdrawn' : 'application-withdraw-failed',
        ]);
    }

    public function volunteeringHours(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('volunteering'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $applications = VolunteerService::getMyApplications($userId, ['limit' => 50, 'status' => 'approved'])['items'] ?? [];
        $organizations = VolunteerService::getMyOrganizations($userId, ['limit' => 50])['items'] ?? [];

        return $this->view('accessible-frontend::volunteering-hours', [
            'title' => __('govuk_alpha.volunteering.hours_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'volunteering',
            'summary' => VolunteerService::getHoursSummary($userId),
            'logs' => VolunteerService::getMyHours($userId, ['limit' => 10])['items'] ?? [],
            'organizations' => $this->volunteeringHourOrganizations($organizations, $applications),
            'applications' => $applications,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    public function storeVolunteeringHours(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('volunteering'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        try {
            $logId = VolunteerService::logHours($userId, [
                'organization_id' => (int) $request->input('organization_id'),
                'opportunity_id' => $request->input('opportunity_id') ? (int) $request->input('opportunity_id') : null,
                'date' => $request->input('date'),
                'hours' => (float) $request->input('hours'),
                'description' => trim(self::asStr($request->input('description'))),
            ]);
        } catch (\Throwable $e) {
            report($e);
            $logId = null;
        }

        if ($logId === null) {
            return redirect()->route('govuk-alpha.volunteering.hours', ['tenantSlug' => $tenantSlug, 'status' => 'hours-failed']);
        }

        return redirect()->route('govuk-alpha.volunteering.hours', ['tenantSlug' => $tenantSlug, 'status' => 'hours-created']);
    }

    public function volunteerAccessibility(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('volunteering'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $needs = \App\Services\VolunteerFormService::getAccessibilityNeeds($userId, TenantContext::getId());

        // HTML-first simplification: surface the set of need categories plus one
        // shared set of detail fields (the React tab supports per-need detail; the
        // accessible form keeps it to a single, clearer form). Read back the first
        // non-empty value for each shared field.
        $selectedTypes = [];
        $shared = ['description' => '', 'accommodations' => '', 'emergency_name' => '', 'emergency_phone' => ''];
        foreach ($needs as $need) {
            $type = (string) ($need['need_type'] ?? '');
            if (in_array($type, self::ACCESSIBILITY_NEED_TYPES, true)) {
                $selectedTypes[] = $type;
            }
            foreach ([
                'description' => 'description',
                'accommodations' => 'accommodations_required',
                'emergency_name' => 'emergency_contact_name',
                'emergency_phone' => 'emergency_contact_phone',
            ] as $viewKey => $rowKey) {
                if ($shared[$viewKey] === '' && !empty($need[$rowKey])) {
                    $shared[$viewKey] = (string) $need[$rowKey];
                }
            }
        }

        return $this->view('accessible-frontend::volunteering-accessibility', [
            'title' => __('govuk_alpha.volunteering.accessibility_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'volunteering',
            'needTypes' => self::ACCESSIBILITY_NEED_TYPES,
            'selectedTypes' => array_values(array_unique($selectedTypes)),
            'accessibility' => $shared,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    public function updateVolunteerAccessibility(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('volunteering'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $rawTypes = $request->input('need_types', []);
        $rawTypes = is_array($rawTypes) ? array_map('strval', $rawTypes) : [];
        $selected = array_values(array_intersect(self::ACCESSIBILITY_NEED_TYPES, $rawTypes));

        $sharedDetail = [
            'description' => trim(self::asStr($request->input('description'))) ?: null,
            'accommodations_required' => trim(self::asStr($request->input('accommodations_required'))) ?: null,
            'emergency_contact_name' => trim(self::asStr($request->input('emergency_contact_name'))) ?: null,
            'emergency_contact_phone' => trim(self::asStr($request->input('emergency_contact_phone'))) ?: null,
        ];

        $needs = array_map(
            static fn (string $type): array => array_merge(['need_type' => $type], $sharedDetail),
            $selected
        );

        $ok = false;
        try {
            $ok = \App\Services\VolunteerFormService::updateAccessibilityNeeds($userId, $needs, TenantContext::getId());
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.volunteering.accessibility', [
            'tenantSlug' => $tenantSlug,
            'status' => $ok ? 'accessibility-saved' : 'accessibility-failed',
        ]);
    }

    public function feed(Request $request, string $tenantSlug): Response
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('feed'), 403);
        $userId = $this->currentUserId();
        $type = $this->allowed($request->query('type', 'all'), ['all', 'following', 'saved', 'posts', 'listings', 'events', 'goals', 'polls', 'jobs', 'challenges', 'volunteering', 'blogs', 'discussions'], 'all');
        $mode = $this->allowed($request->query('mode', 'ranking'), ['ranking', 'recent'], 'ranking');
        $subtype = $type === 'listings'
            ? $this->allowed($request->query('subtype'), ['offer', 'request'], null)
            : null;
        $perPage = $this->intQuery($request, 'per_page', 10, 1, 50);

        $items = [];
        $meta = ['has_more' => false, 'cursor' => null, 'per_page' => $perPage];
        $error = null;

        if ($userId !== null) {
            try {
                $result = $this->feedService->getFeed($userId, [
                    'limit' => $perPage,
                    'type' => $type,
                    'mode' => $mode === 'recent' ? 'recent' : 'ranked',
                    'subtype' => $subtype,
                    'cursor' => self::asStr($request->query('cursor')) ?: null,
                ]);
                $items = $this->attachPostMedia($result['items'] ?? []);
                $meta = [
                    'has_more' => (bool) ($result['has_more'] ?? false),
                    'cursor' => $result['cursor'] ?? null,
                    'per_page' => $perPage,
                ];
            } catch (\Throwable $e) {
                report($e);
                $error = __('govuk_alpha.states.error_title');
            }
        }

        return $this->view('accessible-frontend::feed', [
            'title' => __('govuk_alpha.feed.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'feed',
            'items' => $items,
            'commentsByTarget' => $this->commentsForFeedItems($items, $userId),
            'reactionsByTarget' => $this->reactionsForFeedItems($items, $userId),
            'alphaReactions' => self::ALPHA_FEED_REACTIONS,
            'meta' => $meta,
            'selectedType' => $type,
            'selectedMode' => $mode,
            'selectedSubtype' => $subtype,
            'requiresAuth' => $userId === null,
            'currentUserId' => $userId,
            'error' => $error,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    public function storeFeedPost(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('feed'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.feed', ['tenantSlug' => $tenantSlug]);
        }

        $content = trim(self::asStr($request->input('content')));
        if ($content === '') {
            return redirect()->route('govuk-alpha.feed', ['tenantSlug' => $tenantSlug, 'status' => 'post-empty']);
        }

        try {
            $post = $this->feedService->createPost($userId, [
                'content' => $content,
                'visibility' => 'public',
            ]);
            if (is_array($post) && isset($post['error'])) {
                return redirect()->route('govuk-alpha.feed', ['tenantSlug' => $tenantSlug, 'status' => 'post-failed']);
            }

            // Optional photo — attach via the shared post-media pipeline (validates,
            // strips EXIF, builds a thumbnail). Best-effort: a bad image must not
            // discard the text the member already wrote.
            if ($post instanceof \App\Models\FeedPost && $request->hasFile('image')) {
                $this->attachFeedPostImage($request, (int) $post->id);
            }
        } catch (\Throwable $e) {
            report($e);
            return redirect()->route('govuk-alpha.feed', ['tenantSlug' => $tenantSlug, 'status' => 'post-failed']);
        }

        return redirect()->route('govuk-alpha.feed', ['tenantSlug' => $tenantSlug, 'status' => 'post-created']);
    }

    private function attachFeedPostImage(Request $request, int $postId): void
    {
        $file = $request->file('image');
        if ($file === null || is_array($file) || !$file->isValid()) {
            return;
        }

        try {
            app(\App\Services\PostMediaService::class)->attachMedia(
                $postId,
                [$file],
                [trim(self::asStr($request->input('image_alt')))]
            );
        } catch (\Throwable $e) {
            report($e);
        }
    }

    public function storeFeedPollVote(Request $request, string $tenantSlug, int $pollId): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('feed'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return $this->redirectToFeed($request, $tenantSlug, 'auth-required', 'poll', $pollId);
        }

        $optionId = (int) $request->input('option_id');
        if ($optionId <= 0) {
            return $this->redirectToFeed($request, $tenantSlug, 'poll-vote-failed', 'poll', $pollId);
        }

        $ok = false;
        try {
            $ok = \App\Services\PollService::vote($pollId, $optionId, $userId);
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->redirectToFeed($request, $tenantSlug, $ok ? 'poll-voted' : 'poll-vote-failed', 'poll', $pollId);
    }

    public function storeFeedLike(Request $request, string $tenantSlug, string $type, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('feed'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return $this->redirectToFeed($request, $tenantSlug, 'auth-required', $type, $id);
        }

        $targetType = $this->normalizeFeedTargetType($type);
        if (!in_array($targetType, self::VALID_FEED_LIKE_TARGETS, true) || !FeedItemTables::canView($targetType, $id, $userId)) {
            return $this->redirectToFeed($request, $tenantSlug, 'like-failed', $targetType, $id);
        }

        try {
            $result = $this->toggleFeedItemLike($targetType, $id, $userId);
            return $this->redirectToFeed($request, $tenantSlug, $result['liked'] ? 'like-added' : 'like-removed', $targetType, $id);
        } catch (\Throwable $e) {
            report($e);
            return $this->redirectToFeed($request, $tenantSlug, 'like-failed', $targetType, $id);
        }
    }

    public function storeFeedComment(Request $request, string $tenantSlug, string $type, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('feed'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return $this->redirectToFeed($request, $tenantSlug, 'auth-required', $type, $id);
        }

        $targetType = $this->normalizeFeedTargetType($type);
        $content = trim(self::asStr($request->input('content')));

        if ($content === '') {
            return $this->redirectToFeed($request, $tenantSlug, 'comment-empty', $targetType, $id);
        }

        if (mb_strlen($content) > 10000) {
            return $this->redirectToFeed($request, $tenantSlug, 'comment-too-long', $targetType, $id);
        }

        if (!FeedItemTables::isCommentable($targetType) || !FeedItemTables::canView($targetType, $id, $userId)) {
            return $this->redirectToFeed($request, $tenantSlug, 'comment-failed', $targetType, $id);
        }

        $data = ['content' => $content];
        // A reply carries the parent comment id; CommentService::create enforces
        // the nesting-depth limit and that the parent belongs to the same target.
        $parentId = (int) $request->input('parent_id', 0);
        if ($parentId > 0) {
            $data['parent_id'] = $parentId;
        }

        try {
            CommentService::create($targetType, $id, $userId, TenantContext::getId(), $data);
        } catch (\Throwable $e) {
            report($e);
            return $this->redirectToFeed($request, $tenantSlug, 'comment-failed', $targetType, $id);
        }

        return $this->redirectToFeed($request, $tenantSlug, 'comment-created', $targetType, $id);
    }

    public function updateFeedPost(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('feed'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.feed', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $content = trim(self::asStr($request->input('content')));
        if ($content === '') {
            return redirect()->route('govuk-alpha.feed', ['tenantSlug' => $tenantSlug, 'status' => 'post-empty']);
        }

        $status = 'post-update-failed';
        try {
            $result = $this->feedService->updatePost($id, $userId, ['content' => $content]);
            $status = ! empty($result['success']) ? 'post-updated' : 'post-update-failed';
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.feed', ['tenantSlug' => $tenantSlug, 'status' => $status]);
    }

    public function deleteFeedPost(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('feed'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.feed', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $status = 'post-delete-failed';
        try {
            $status = $this->feedService->deletePost($id, $userId) ? 'post-deleted' : 'post-delete-failed';
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.feed', ['tenantSlug' => $tenantSlug, 'status' => $status]);
    }

    /** Hide a feed item from the viewer's own feed (any feed item type). */
    public function hideFeedItem(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('feed'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.feed', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $validTypes = ['post', 'listing', 'event', 'poll', 'goal', 'review', 'job', 'challenge', 'volunteer', 'resource', 'blog', 'discussion'];
        $type = in_array($request->input('type'), $validTypes, true) ? (string) $request->input('type') : 'post';

        $status = 'moderation-failed';
        if ($id > 0 && FeedItemTables::canView($type, $id, $userId)) {
            try {
                DB::table('feed_hidden')->insertOrIgnore([
                    'user_id'     => $userId,
                    'tenant_id'   => TenantContext::getId(),
                    'target_type' => $type,
                    'target_id'   => $id,
                    'created_at'  => now(),
                ]);
                $status = 'content-hidden';
            } catch (\Throwable $e) {
                report($e);
            }
        }

        return redirect()->route('govuk-alpha.feed', ['tenantSlug' => $tenantSlug, 'status' => $status]);
    }

    /** Mute another member so their content stops appearing in the viewer's feed. */
    public function muteFeedUser(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('feed'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.feed', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $tenantId = TenantContext::getId();
        $status = 'moderation-failed';
        if ($id > 0 && $id !== $userId && DB::table('users')->where('id', $id)->where('tenant_id', $tenantId)->exists()) {
            try {
                DB::table('feed_muted_users')->insertOrIgnore([
                    'user_id'       => $userId,
                    'tenant_id'     => $tenantId,
                    'muted_user_id' => $id,
                    'created_at'    => now(),
                ]);
                $status = 'author-muted';
            } catch (\Throwable $e) {
                report($e);
            }
        }

        return redirect()->route('govuk-alpha.feed', ['tenantSlug' => $tenantSlug, 'status' => $status]);
    }

    /** Report a feed item to moderators (mirrors SocialController::reportItemV2). */
    public function reportFeedItem(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('feed'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.feed', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $tenantId = TenantContext::getId();
        $rawType = (string) $request->input('type', 'post');
        $type = $rawType === 'volunteering' ? 'volunteer' : $rawType;
        $reason = trim(self::asStr($request->input('reason')));

        $status = 'moderation-failed';
        if (
            in_array($type, \App\Services\ReactionService::VALID_TARGET_TYPES, true)
            && $id > 0
            && $reason !== ''
            && FeedItemTables::canView($type, $id, $userId)
        ) {
            $reason = mb_substr($reason, 0, 1000);
            $already = DB::table('reports')
                ->where('reporter_id', $userId)->where('tenant_id', $tenantId)
                ->where('target_type', $type)->where('target_id', $id)->exists();

            if ($already) {
                // Idempotent from the member's perspective — already flagged.
                $status = 'content-reported';
            } else {
                try {
                    $reportId = DB::table('reports')->insertGetId([
                        'reporter_id' => $userId,
                        'tenant_id'   => $tenantId,
                        'target_type' => $type,
                        'target_id'   => $id,
                        'reason'      => $reason,
                        'status'      => 'open',
                        'created_at'  => now(),
                    ]);
                    try {
                        \App\Services\NotificationDispatcher::notifyModerationAdmins(
                            'social_report_created',
                            '/admin/reports',
                            'svc_notifications_2.social_report.admin_alert',
                            'emails_misc.moderation.social_subject',
                            'emails_misc.moderation.social_body',
                            ['target_type' => $type, 'reason' => $reason, 'report_id' => $reportId]
                        );
                    } catch (\Throwable $notifyError) {
                        Log::warning('Alpha social report admin alert failed: ' . $notifyError->getMessage());
                    }
                    $status = 'content-reported';
                } catch (\Throwable $e) {
                    report($e);
                }
            }
        }

        return redirect()->route('govuk-alpha.feed', ['tenantSlug' => $tenantSlug, 'status' => $status]);
    }

    public function updateFeedComment(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('feed'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.feed', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $content = trim(self::asStr($request->input('content')));
        if ($content === '') {
            return redirect()->route('govuk-alpha.feed', ['tenantSlug' => $tenantSlug, 'status' => 'comment-empty']);
        }

        $status = 'comment-update-failed';
        try {
            // CommentService::update is owner-scoped and returns the new content on
            // success, null when the comment is missing or not the user's own.
            $status = CommentService::update($id, $userId, $content) !== null ? 'comment-updated' : 'comment-update-failed';
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.feed', ['tenantSlug' => $tenantSlug, 'status' => $status]);
    }

    public function deleteFeedComment(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('feed'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.feed', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $status = 'comment-delete-failed';
        try {
            $status = CommentService::delete($id, $userId) > 0 ? 'comment-deleted' : 'comment-delete-failed';
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.feed', ['tenantSlug' => $tenantSlug, 'status' => $status]);
    }

    /**
     * Enrich feed post items with their attached images from post_media.
     * FeedService leaves top-level posts without media; the accessible
     * frontend has no API client, so we load it here.
     *
     * @param array<int, array<string, mixed>> $items
     * @return array<int, array<string, mixed>>
     */
    private function attachPostMedia(array $items): array
    {
        $postIds = [];
        foreach ($items as $item) {
            if (($item['type'] ?? null) === 'post' && !empty($item['id'])) {
                $postIds[] = (int) $item['id'];
            }
        }
        if ($postIds === []) {
            return $items;
        }

        $rows = DB::table('post_media')
            ->whereIn('post_id', $postIds)
            ->where('media_type', 'image')
            ->orderBy('post_id')
            ->orderBy('display_order')
            ->orderBy('id')
            ->get(['post_id', 'file_url', 'thumbnail_url', 'alt_text']);

        $mediaByPost = [];
        foreach ($rows as $row) {
            $mediaByPost[(int) $row->post_id][] = [
                'file_url' => $row->file_url,
                'thumbnail_url' => $row->thumbnail_url,
                'alt_text' => $row->alt_text,
            ];
        }

        foreach ($items as &$item) {
            if (($item['type'] ?? null) === 'post' && !empty($item['id'])) {
                $item['media'] = $mediaByPost[(int) $item['id']] ?? [];
            }
        }
        unset($item);

        return $items;
    }

    /**
     * @param array<int, array<string, mixed>> $items
     * @return array<string, array<int, array<int, array<string, mixed>>>>
     */
    private function commentsForFeedItems(array $items, ?int $userId): array
    {
        if ($userId === null) {
            return [];
        }

        $commentsByTarget = [];
        foreach ($items as $item) {
            $targetType = $this->normalizeFeedTargetType((string) ($item['type'] ?? ''));
            $targetId = (int) ($item['id'] ?? 0);
            if ($targetId <= 0 || !FeedItemTables::isCommentable($targetType)) {
                continue;
            }

            try {
                $commentsByTarget[$targetType][$targetId] = CommentService::getForEntity($targetType, $targetId, $userId);
            } catch (\Throwable $e) {
                report($e);
                $commentsByTarget[$targetType][$targetId] = [];
            }
        }

        return $commentsByTarget;
    }

    /**
     * @return array{liked: bool, likes_count: int}
     */
    private function toggleFeedItemLike(string $targetType, int $targetId, int $userId): array
    {
        $tenantId = TenantContext::getId();

        $existing = DB::table('likes')
            ->where('user_id', $userId)
            ->where('target_type', $targetType)
            ->where('target_id', $targetId)
            ->where('tenant_id', $tenantId)
            ->first();

        if ($existing) {
            DB::table('likes')
                ->where('id', $existing->id)
                ->where('tenant_id', $tenantId)
                ->delete();

            if ($targetType === 'post') {
                DB::table('feed_posts')
                    ->where('id', $targetId)
                    ->where('tenant_id', $tenantId)
                    ->update(['likes_count' => DB::raw('GREATEST(likes_count - 1, 0)')]);
            }

            $liked = false;
        } else {
            $affected = DB::affectingStatement(
                'INSERT IGNORE INTO likes (user_id, target_type, target_id, tenant_id, created_at) VALUES (?, ?, ?, ?, NOW())',
                [$userId, $targetType, $targetId, $tenantId]
            );

            if ($affected > 0 && $targetType === 'post') {
                $updated = DB::table('feed_posts')
                    ->where('id', $targetId)
                    ->where('tenant_id', $tenantId)
                    ->increment('likes_count');

                if ($updated === 0) {
                    DB::table('likes')
                        ->where('user_id', $userId)
                        ->where('target_type', $targetType)
                        ->where('target_id', $targetId)
                        ->where('tenant_id', $tenantId)
                        ->delete();
                }
            }

            $liked = true;

            try {
                $contentOwnerId = SocialNotificationService::getContentOwnerId($targetType, $targetId);
                if ($contentOwnerId && $contentOwnerId !== $userId) {
                    SocialNotificationService::notifyLike(
                        $contentOwnerId,
                        $userId,
                        $targetType,
                        $targetId,
                        SocialNotificationService::getContentPreview($targetType, $targetId)
                    );
                }
            } catch (\Throwable $e) {
                Log::warning('AlphaController::toggleFeedItemLike notification failed', ['error' => $e->getMessage()]);
            }
        }

        $count = (int) DB::table('likes')
            ->where('target_type', $targetType)
            ->where('target_id', $targetId)
            ->where('tenant_id', $tenantId)
            ->count();

        return ['liked' => $liked, 'likes_count' => $count];
    }

    private function normalizeFeedTargetType(string $targetType): string
    {
        return $targetType === 'volunteering' ? 'volunteer' : $targetType;
    }

    private function redirectToFeed(Request $request, string $tenantSlug, string $status, ?string $targetType = null, ?int $targetId = null): RedirectResponse
    {
        $query = ['tenantSlug' => $tenantSlug, 'status' => $status];
        foreach (['type', 'mode', 'subtype', 'per_page', 'cursor'] as $key) {
            $value = $request->input($key, $request->query($key));
            if ($value !== null && $value !== '') {
                $query[$key] = $value;
            }
        }

        $url = route('govuk-alpha.feed', $query);
        if ($targetType !== null && $targetId !== null) {
            $url .= '#feed-item-' . preg_replace('/[^a-z0-9_-]/i', '-', $targetType) . '-' . $targetId;
        }

        return redirect()->to($url);
    }

    public function listings(Request $request, string $tenantSlug): Response
    {
        $this->assertTenantSlug($tenantSlug);
        if (!TenantContext::hasModule('listings')) {
            return $this->view('accessible-frontend::listings', [
                'title' => __('govuk_alpha.listings.title'),
                'tenantSlug' => $tenantSlug,
                'activeNav' => 'listings',
                'items' => [],
                'categories' => [],
                'meta' => ['total_items' => 0, 'has_more' => false, 'cursor' => null],
                'filters' => $this->listingFilters($request),
                'moduleDisabled' => true,
                'error' => null,
            ], 403);
        }

        $filters = $this->listingFilters($request);
        $query = ['limit' => 12];

        foreach (['type', 'category_id', 'search', 'cursor', 'min_hours', 'max_hours', 'service_type', 'posted_within', 'near_lat', 'near_lng', 'radius_km'] as $key) {
            if (($filters[$key] ?? null) !== null && $filters[$key] !== '') {
                $query[$key] = $filters[$key];
            }
        }

        // "Recommended" surfaces featured listings first; "newest" (default) keeps
        // the id-descending order. Full personalised ranking is React-only.
        if (($filters['sort'] ?? 'newest') === 'recommended') {
            $query['featured_first'] = true;
        }

        // countAll does not run the haversine subquery, so total is the count of
        // listings matching the non-proximity filters (avoids a proximity count
        // edge case while keeping the page count meaningful).
        $countQuery = array_diff_key($query, array_flip(['near_lat', 'near_lng', 'radius_km']));

        $items = [];
        $meta = ['total_items' => 0, 'has_more' => false, 'cursor' => null];
        $error = null;

        try {
            $result = $this->listingService->getAll($query);
            $items = $this->withResolvedImageKey($result['items'] ?? [], 'image_url');
            $meta = [
                'total_items' => $this->listingService->countAll($countQuery),
                'has_more' => (bool) ($result['has_more'] ?? false),
                'cursor' => $result['cursor'] ?? null,
            ];
        } catch (\Throwable $e) {
            report($e);
            $error = __('govuk_alpha.states.error_title');
        }

        $categories = Category::where('type', 'listing')
            ->where('tenant_id', TenantContext::getId())
            ->orderBy('name')
            ->get(['id', 'name'])
            ->toArray();

        // Collect saved listing IDs for the current user so the card loop can
        // show a "Saved" badge inline — mirrors the React saved state indicator.
        $savedListingIds = [];
        $userId = $this->currentUserId();
        if ($userId !== null && !empty($items)) {
            try {
                $savedListingIds = \App\Models\Bookmark::where('user_id', $userId)
                    ->where('bookmarkable_type', 'listing')
                    ->whereIn('bookmarkable_id', array_column($items, 'id'))
                    ->pluck('bookmarkable_id')
                    ->map(fn ($v) => (int) $v)
                    ->all();
            } catch (\Throwable $e) {
                report($e);
            }
        }

        return $this->view('accessible-frontend::listings', [
            'title' => __('govuk_alpha.listings.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'listings',
            'items' => $items,
            'categories' => $categories,
            'meta' => $meta,
            'filters' => $filters,
            'moduleDisabled' => false,
            'error' => $error,
            'status' => self::asStr($request->query('status')) ?: null,
            'isAuthenticated' => $userId !== null,
            'savedListingIds' => $savedListingIds,
        ]);
    }

    public function listing(string $tenantSlug, int $id): Response
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('listings'), 403);

        $userId = $this->currentUserId();
        $listing = $this->listingService->getById($id, false, $this->currentUserId());
        abort_if($listing === null, 404);
        $ownerId = (int) ($listing['user_id'] ?? $listing['author_id'] ?? $listing['user']['id'] ?? 0);
        $isOwner = $userId !== null && $ownerId === $userId;

        // The author "Verified" trust tag must reflect ID verification (id_verified
        // badge), NOT email verification (is_verified). ListingService::getById()
        // populates author_verified from is_verified, so override it here.
        $listing['author_verified'] = $this->alphaIdentityVerified($ownerId);

        // Resolve the cover image to a same-origin URL and attach the multi-image
        // gallery (the ListingImage rows are not returned by ListingService::getById,
        // so we load them here exactly as the React ListingsController::show() does).
        $listing['image_url'] = $this->resolveAsset($listing['image_url'] ?? null);
        $listing['images'] = $this->listingGallery($id, $listing['image_url']);
        $listing['author_avatar'] = $this->resolveAsset(
            $listing['author_avatar'] ?? $listing['user']['avatar_url'] ?? $listing['user']['avatar'] ?? null
        );

        // Check whether the current user has saved this listing.
        $isSaved = false;
        if ($userId !== null && !$isOwner) {
            try {
                $isSaved = app(\App\Services\BookmarkService::class)->isBookmarked($userId, 'listing', $id);
            } catch (\Throwable $e) {
                report($e);
            }
        }

        return $this->view('accessible-frontend::listing-detail', [
            'title' => $listing['title'] ?? __('govuk_alpha.listings.detail_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'listings',
            'listing' => $listing,
            'requiresAuth' => $userId === null,
            'isAuthenticated' => $userId !== null,
            'isOwner' => $isOwner,
            'isSaved' => $isSaved,
            'exchangeWorkflowEnabled' => BrokerControlConfigService::isExchangeWorkflowEnabled(),
            'directMessagingEnabled' => BrokerControlConfigService::isDirectMessagingEnabled(),
            'activeExchange' => $userId && !$isOwner ? ExchangeWorkflowService::getActiveExchangeForListing($userId, $id) : null,
            'status' => self::asStr(request()->query('status')) ?: null,
            'ogImage' => $this->absoluteAssetUrl($listing['image_url'] ?? null),
            'ogImageAlt' => $listing['image_url'] ? ($listing['title'] ?? null) : null,
            'likeCount' => $this->alphaLikeCount('listing', $id),
            'hasLiked' => $userId !== null && $this->alphaUserLiked('listing', $id, $userId),
        ]);
    }

    /**
     * True iff the member holds an active `id_verified` verification badge — the
     * genuine identity-verification trust signal.
     *
     * CRITICAL: `users.is_verified` means EMAIL-verified, NOT identity-verified, so
     * it must never drive the green "Verified" trust tag (that falsely marked every
     * email-confirmed member as identity-verified). This mirrors React's
     * VerificationBadgeRow, which keys the trust badge on the id_verified badge.
     */
    private function alphaIdentityVerified(int $userId): bool
    {
        if ($userId <= 0) {
            return false;
        }
        try {
            foreach (app(\App\Services\MemberVerificationBadgeService::class)->getUserBadges($userId) as $badge) {
                if ((($badge['badge_type'] ?? $badge['type'] ?? '')) === 'id_verified') {
                    return true;
                }
            }
        } catch (\Throwable $e) {
            report($e);
        }

        return false;
    }

    /**
     * Attach an `identity_verified` flag to each member-card row via ONE batched
     * badge query (avoids N+1 across a directory page). Keyed on each row's `id`.
     *
     * @param  list<array<string, mixed>>  $members
     * @return list<array<string, mixed>>
     */
    private function alphaAttachIdentityVerified(array $members): array
    {
        $ids = [];
        foreach ($members as $m) {
            $id = (int) ($m['id'] ?? 0);
            if ($id > 0) {
                $ids[] = $id;
            }
        }

        $verified = [];
        if ($ids !== []) {
            try {
                $batch = app(\App\Services\MemberVerificationBadgeService::class)
                    ->getBatchUserBadges(array_values(array_unique($ids)));
                foreach ($batch as $uid => $badges) {
                    foreach ($badges as $badge) {
                        if ((($badge['type'] ?? $badge['badge_type'] ?? '')) === 'id_verified') {
                            $verified[(int) $uid] = true;
                            break;
                        }
                    }
                }
            } catch (\Throwable $e) {
                report($e);
            }
        }

        foreach ($members as &$m) {
            $m['identity_verified'] = ! empty($verified[(int) ($m['id'] ?? 0)]);
        }
        unset($m);

        return $members;
    }

    /**
     * Total likes for a feed target (tenant-scoped). Mirrors the count the React
     * SocialController returns; the accessible like button shows it inline.
     */
    private function alphaLikeCount(string $targetType, int $targetId): int
    {
        return (int) \Illuminate\Support\Facades\DB::table('likes')
            ->where('target_type', $targetType)
            ->where('target_id', $targetId)
            ->where('tenant_id', TenantContext::getId())
            ->count();
    }

    /** Whether the given user has liked a target (tenant-scoped). */
    private function alphaUserLiked(string $targetType, int $targetId, int $userId): bool
    {
        return \Illuminate\Support\Facades\DB::table('likes')
            ->where('user_id', $userId)
            ->where('target_type', $targetType)
            ->where('target_id', $targetId)
            ->where('tenant_id', TenantContext::getId())
            ->exists();
    }

    /**
     * Toggle a like for a feed target, mirroring SocialController::likeV2's
     * `likes`-table logic (INSERT IGNORE on like, delete on unlike, tenant-scoped,
     * canView-gated). Returns 'liked' | 'unliked'. The accessible no-JS path posts
     * a form here instead of calling the JSON endpoint.
     */
    private function alphaToggleLike(string $targetType, int $targetId, int $userId): string
    {
        $tenantId = TenantContext::getId();

        if (! \App\Support\FeedItemTables::canView($targetType, $targetId, $userId)) {
            abort(404);
        }

        $existing = \Illuminate\Support\Facades\DB::table('likes')
            ->where('user_id', $userId)
            ->where('target_type', $targetType)
            ->where('target_id', $targetId)
            ->where('tenant_id', $tenantId)
            ->first();

        if ($existing) {
            \Illuminate\Support\Facades\DB::table('likes')
                ->where('id', $existing->id)
                ->where('tenant_id', $tenantId)
                ->delete();
            return 'unliked';
        }

        \Illuminate\Support\Facades\DB::affectingStatement(
            'INSERT IGNORE INTO likes (user_id, target_type, target_id, tenant_id, created_at) VALUES (?, ?, ?, ?, NOW())',
            [$userId, $targetType, $targetId, $tenantId]
        );
        return 'liked';
    }

    /** Toggle a like on a listing from the accessible listing detail page. */
    public function listingsToggleLike(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('listings'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $action = 'like-failed';
        try {
            $action = $this->alphaToggleLike('listing', $id, $userId) === 'liked' ? 'liked' : 'unliked';
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.listings.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => $action])
            ->withFragment('like');
    }

    public function createListing(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('listings'), 403);

        if ($this->currentUserId() === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        return $this->view('accessible-frontend::listing-create', $this->listingFormViewData($tenantSlug, $request));
    }

    public function storeListing(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('listings'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        [$data, $errors] = $this->validateListingInput($request);
        if ($errors !== []) {
            return redirect()
                ->route('govuk-alpha.listings.create', ['tenantSlug' => $tenantSlug])
                ->withErrors($errors)
                ->withInput();
        }

        try {
            $listing = $this->listingService->create($userId, $data);
            $listingId = (int) $listing->id;

            // Optional cover photo. Mirror ListingsController::uploadImage(): push the
            // file through the shared pipeline and set the listing cover. Best-effort —
            // a bad image must never discard a listing the member already wrote.
            if ($request->hasFile('image')) {
                $this->attachListingCoverImage($request, $listingId);
            }

            // Optional skill tags (mirrors React's PUT /v2/listings/{id}/tags).
            $this->persistListingSkillTags($request, $listingId);
        } catch (ValidationException $e) {
            // Conditional service-side rules (per-user cap, tenant requirements not
            // mirrored above) — surface them per field where we can.
            return redirect()
                ->route('govuk-alpha.listings.create', ['tenantSlug' => $tenantSlug])
                ->withErrors($this->flattenValidationErrors($e))
                ->withInput();
        } catch (\Throwable $e) {
            report($e);

            return redirect()
                ->route('govuk-alpha.listings.create', ['tenantSlug' => $tenantSlug, 'status' => 'listing-create-failed'])
                ->withInput();
        }

        return redirect()->route('govuk-alpha.listings.show', ['tenantSlug' => $tenantSlug, 'id' => $listingId, 'status' => 'listing-created']);
    }

    /**
     * Parse the no-JS comma-separated skill_tags field and sync it onto a
     * listing via ListingSkillTagService::setTags (which normalises, dedupes and
     * caps at 10, tenant-scoped). Best-effort: a tag failure must never discard a
     * listing the member already saved. An empty/absent field clears the tags.
     */
    private function persistListingSkillTags(Request $request, int $listingId): void
    {
        try {
            $raw = self::asStr($request->input('skill_tags'));
            $tags = array_values(array_filter(array_map(
                static fn ($t) => trim((string) $t),
                explode(',', $raw)
            ), static fn ($t) => $t !== ''));
            app(\App\Services\ListingSkillTagService::class)->setTags($listingId, $tags);
        } catch (\Throwable $e) {
            report($e);
        }
    }

    /** Resolve a listing the current user is allowed to manage, or abort. */
    private function ownedListingOrAbort(int $id, int $userId): array
    {
        $listing = $this->listingService->getById($id, false, $userId);
        abort_if($listing === null, 404);
        $ownerId = (int) ($listing['user_id'] ?? $listing['author_id'] ?? $listing['user']['id'] ?? 0);
        abort_unless($ownerId === $userId, 403);

        return $listing;
    }

    public function editListing(Request $request, string $tenantSlug, int $id): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('listings'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $listing = $this->ownedListingOrAbort($id, $userId);
        $listing['image_url'] = $this->resolveAsset($listing['image_url'] ?? null);

        $data = $this->listingFormViewData($tenantSlug, $request);
        $data['title'] = __('govuk_alpha.listings.edit.title');
        $data['listing'] = $listing;

        // Pre-fill the skill-tags field from the source of truth.
        $existingTags = [];
        try {
            $existingTags = app(\App\Services\ListingSkillTagService::class)->getTags($id);
        } catch (\Throwable $e) {
            report($e);
        }
        $data['existingSkillTags'] = implode(', ', $existingTags);

        return $this->view('accessible-frontend::listing-edit', $data);
    }

    public function updateListing(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('listings'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $this->ownedListingOrAbort($id, $userId);

        [$data, $errors] = $this->validateListingInput($request);
        if ($errors !== []) {
            return redirect()
                ->route('govuk-alpha.listings.edit', ['tenantSlug' => $tenantSlug, 'id' => $id])
                ->withErrors($errors)
                ->withInput();
        }

        try {
            ListingService::update($id, $data);
            if ($request->hasFile('image')) {
                $this->attachListingCoverImage($request, $id);
            }
            // Sync skill tags (mirrors React's PUT /v2/listings/{id}/tags).
            $this->persistListingSkillTags($request, $id);
        } catch (ValidationException $e) {
            return redirect()
                ->route('govuk-alpha.listings.edit', ['tenantSlug' => $tenantSlug, 'id' => $id])
                ->withErrors($this->flattenValidationErrors($e))
                ->withInput();
        } catch (\Throwable $e) {
            report($e);

            return redirect()
                ->route('govuk-alpha.listings.edit', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'listing-update-failed'])
                ->withInput();
        }

        return redirect()->route('govuk-alpha.listings.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'listing-updated']);
    }

    public function deleteListing(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('listings'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $this->ownedListingOrAbort($id, $userId);

        $ok = false;
        try {
            $ok = ListingService::delete($id);
        } catch (\Throwable $e) {
            report($e);
        }

        if ($ok) {
            return redirect()->route('govuk-alpha.listings.index', ['tenantSlug' => $tenantSlug, 'status' => 'listing-deleted']);
        }

        return redirect()->route('govuk-alpha.listings.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'listing-delete-failed']);
    }

    public function requestExchange(string $tenantSlug, int $listingId): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('listings'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        if (!BrokerControlConfigService::isExchangeWorkflowEnabled()) {
            return redirect()->route('govuk-alpha.listings.show', ['tenantSlug' => $tenantSlug, 'id' => $listingId, 'status' => 'exchange-disabled']);
        }

        $listing = $this->listingService->getById($listingId, false, $userId);
        abort_if($listing === null, 404);

        if ((int) ($listing['user_id'] ?? $listing['author_id'] ?? $listing['user']['id'] ?? 0) === $userId) {
            return redirect()->route('govuk-alpha.listings.show', ['tenantSlug' => $tenantSlug, 'id' => $listingId, 'status' => 'own-listing']);
        }

        $walletBalance = null;
        try {
            $walletBalance = (float) (app(\App\Services\WalletService::class)->getBalance($userId)['balance'] ?? 0);
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::exchange-request', [
            'title' => __('govuk_alpha.exchanges.request_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'listing' => $listing,
            'config' => BrokerControlConfigService::getConfig('exchange_workflow'),
            'status' => self::asStr(request()->query('status')) ?: null,
            'walletBalance' => $walletBalance,
        ]);
    }

    public function storeExchangeRequest(Request $request, string $tenantSlug, int $listingId): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('listings'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        if (!BrokerControlConfigService::isExchangeWorkflowEnabled()) {
            return redirect()->route('govuk-alpha.listings.show', ['tenantSlug' => $tenantSlug, 'id' => $listingId, 'status' => 'exchange-disabled']);
        }

        $hours = max(0.25, min(24, (float) $request->input('proposed_hours', 1)));
        $prepTime = $request->input('prep_time');

        try {
            $violations = ExchangeWorkflowService::checkComplianceRequirements($listingId, $userId);
            if (!empty($violations)) {
                return redirect()->route('govuk-alpha.exchanges.request', ['tenantSlug' => $tenantSlug, 'listingId' => $listingId, 'status' => 'compliance-failed']);
            }

            $exchangeId = ExchangeWorkflowService::createRequest($userId, $listingId, [
                'proposed_hours' => $hours,
                'prep_time' => $prepTime !== null && $prepTime !== '' ? (float) $prepTime : null,
                'message' => trim(self::asStr($request->input('message'))) ?: null,
            ]);
        } catch (\Throwable $e) {
            report($e);
            $exchangeId = null;
        }

        if (!$exchangeId) {
            return redirect()->route('govuk-alpha.exchanges.request', ['tenantSlug' => $tenantSlug, 'listingId' => $listingId, 'status' => 'exchange-failed']);
        }

        return redirect()->route('govuk-alpha.exchanges.show', ['tenantSlug' => $tenantSlug, 'id' => $exchangeId, 'status' => 'exchange-created']);
    }

    public function exchanges(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('listings'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        // Tab-based filter: maps 'all'/'active'/'needs_confirmation'/'completed'
        // to the ExchangeService status values. A raw ?status_filter= param is
        // still supported for backwards compatibility.
        $tab = $this->allowed($request->query('tab'), ['all', 'active', 'needs_confirmation', 'completed'], 'all');
        $statusFilter = match ($tab) {
            'active'               => 'active',
            'needs_confirmation'   => 'needs_confirmation',
            'completed'            => 'completed',
            default                => null,
        };
        // Legacy ?status_filter= param fallback (keep existing REST callers working).
        if ($statusFilter === null && $request->query('status_filter') !== null) {
            $statusFilter = $this->allowed($request->query('status_filter'), ['active', 'pending_provider', 'pending_broker', 'accepted', 'in_progress', 'pending_confirmation', 'completed', 'cancelled', 'disputed'], null);
        }

        $filters = ['limit' => 20];
        if ($statusFilter !== null) {
            $filters['status'] = $statusFilter;
        }
        $cursorParam = self::asStr($request->query('cursor'));
        if ($cursorParam !== '') {
            $filters['cursor'] = $cursorParam;
        }

        $result = app(ExchangeService::class)->getAll($userId, $filters);

        return $this->view('accessible-frontend::exchanges', [
            'title' => __('govuk_alpha.exchanges.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'items' => $result['items'] ?? [],
            'meta' => ['has_more' => (bool) ($result['has_more'] ?? false), 'cursor' => $result['cursor'] ?? null],
            'filters' => ['status_filter' => $statusFilter, 'tab' => $tab],
            'workflowEnabled' => BrokerControlConfigService::isExchangeWorkflowEnabled(),
            'currentUserId' => $userId,
        ]);
    }

    public function exchange(string $tenantSlug, int $id): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('listings'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $exchange = ExchangeWorkflowService::getExchange($id);
        abort_if($exchange === null, 404);
        abort_unless((int) $exchange['requester_id'] === $userId || (int) $exchange['provider_id'] === $userId, 404);

        // Post-completion review prompt: only once the exchange is completed and the
        // viewer has not already rated it (mirrors the React detail page's has_rated gate).
        $canReview = false;
        $ratings = [];
        if (($exchange['status'] ?? '') === 'completed') {
            try {
                $ratingService = app(\App\Services\ExchangeRatingService::class);
                $canReview = !$ratingService->hasRated($id, $userId);
                // Surface the ratings each party has left (mirrors the React detail
                // page's GET /v2/exchanges/:id/ratings section).
                $ratings = $ratingService->getRatingsForExchange($id);
            } catch (\Throwable $e) {
                report($e);
            }
        }

        return $this->view('accessible-frontend::exchange-detail', [
            'title' => $exchange['listing_title'] ?? __('govuk_alpha.exchanges.detail_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'exchange' => $exchange,
            'history' => ExchangeWorkflowService::getExchangeHistory($id),
            'status' => self::asStr(request()->query('status')) ?: null,
            'currentUserId' => $userId,
            'canReview' => $canReview,
            'ratings' => $ratings,
        ]);
    }

    public function storeExchangeRating(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('listings'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $exchange = ExchangeWorkflowService::getExchange($id);
        abort_if($exchange === null, 404);
        abort_unless((int) $exchange['requester_id'] === $userId || (int) $exchange['provider_id'] === $userId, 404);

        $rating = (int) $request->input('rating');
        if ($rating < 1 || $rating > 5) {
            return redirect()->route('govuk-alpha.exchanges.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'rating-invalid']);
        }

        $comment = trim(self::asStr($request->input('comment'))) ?: null;
        $status = 'rating-failed';
        try {
            $result = app(\App\Services\ExchangeRatingService::class)->submitRating($id, $userId, $rating, $comment);
            if ((bool) ($result['success'] ?? false)) {
                $status = 'rating-submitted';
            }
        } catch (\App\Exceptions\SafeguardingPolicyException $e) {
            $status = $e->reasonCode === 'SAFEGUARDING_POLICY_UNAVAILABLE'
                ? 'rating-safeguarding-unavailable'
                : 'rating-safeguarding-restricted';
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.exchanges.show', [
            'tenantSlug' => $tenantSlug,
            'id' => $id,
            'status' => $status,
        ]);
    }

    public function storeExchangeAction(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('listings'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $exchange = ExchangeWorkflowService::getExchange($id);
        abort_if($exchange === null, 404);
        abort_unless((int) $exchange['requester_id'] === $userId || (int) $exchange['provider_id'] === $userId, 404);

        $action = $this->allowed($request->input('action'), ['accept', 'decline', 'start', 'complete', 'confirm', 'cancel'], '');
        $ok = false;

        try {
            $ok = match ($action) {
                'accept' => ExchangeWorkflowService::acceptRequest($id, $userId),
                'decline' => ExchangeWorkflowService::declineRequest($id, $userId, trim(self::asStr($request->input('reason')))),
                'start' => ExchangeWorkflowService::startProgress($id, $userId),
                'complete' => ExchangeWorkflowService::markReadyForConfirmation($id, $userId),
                'confirm' => ExchangeWorkflowService::confirmCompletion($id, $userId, max(0.25, min(24, (float) $request->input('hours', 0)))),
                'cancel' => ExchangeWorkflowService::cancelExchange($id, $userId, trim(self::asStr($request->input('reason')))),
                default => false,
            };
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.exchanges.show', [
            'tenantSlug' => $tenantSlug,
            'id' => $id,
            'status' => $ok ? 'exchange-updated' : 'exchange-action-failed',
        ]);
    }

    public function messages(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('messages'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $showArchived = $request->boolean('archived');
        $result = MessageService::getConversations($userId, [
            'limit' => 20,
            'archived' => $showArchived,
            'cursor' => self::asStr($request->query('cursor')) ?: null,
        ]);

        // Inline "start a conversation" search so a member can find someone and
        // open a thread without leaving the messages page (React uses a modal).
        $searchQuery = trim(self::asStr($request->query('q')));
        $searchResults = [];
        if ($searchQuery !== '') {
            $searchResults = $this->messageUserSearch($searchQuery, $userId);
        }

        // Conversation name filter (parity: React inbox search).
        $convFilter = trim(self::asStr($request->query('filter')));
        $items = $result['items'] ?? [];
        if ($convFilter !== '') {
            $lcFilter = mb_strtolower($convFilter);
            $items = array_values(array_filter($items, static function (array $conv) use ($lcFilter): bool {
                $other = $conv['other_user'] ?? [];
                $name = mb_strtolower(trim(
                    ($other['name'] ?? '') !== ''
                        ? (string) $other['name']
                        : (string) ($other['first_name'] ?? '') . ' ' . (string) ($other['last_name'] ?? '')
                ));
                return $name === '' || str_contains($name, $lcFilter);
            }));
        }

        // Total unread count across all conversations.
        $totalUnread = 0;
        try {
            $totalUnread = (int) MessageService::getUnreadCount($userId);
        } catch (\Throwable $e) {
            // Unread count is best-effort.
        }

        return $this->view('accessible-frontend::messages', [
            'title' => __('govuk_alpha.messages.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'messages',
            'items' => $items,
            'meta' => ['has_more' => (bool) ($result['has_more'] ?? false), 'cursor' => $result['cursor'] ?? null],
            'showArchived' => $showArchived,
            'directMessagingEnabled' => BrokerControlConfigService::isDirectMessagingEnabled(),
            'restriction' => app(\App\Services\BrokerMessageVisibilityService::class)->getUserRestrictionStatus($userId),
            'status' => self::asStr($request->query('status')) ?: null,
            'currentUserId' => $userId,
            'searchQuery' => $searchQuery,
            'searchResults' => $searchResults,
            'convFilter' => $convFilter,
            'totalUnread' => $totalUnread,
        ]);
    }

    /**
     * Find up to 10 members (tenant-scoped, excluding self) matching a query,
     * for the messages page's inline start-a-conversation search.
     *
     * @return array<int, array<string, mixed>>
     */
    private function messageUserSearch(string $query, int $viewerId): array
    {
        try {
            $tenantId = TenantContext::getId();
            $ids = SearchService::searchUsersStatic($query, $tenantId);
            if (!is_array($ids) || empty($ids)) {
                return [];
            }
            $ids = array_slice(array_map('intval', $ids), 0, 10);

            return DB::table('users')
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->where('id', '!=', $viewerId)
                // Honour the search opt-out: the Meilisearch path that produced
                // these IDs does not carry privacy_search, so re-filter here.
                ->where(function ($q) {
                    $q->where('privacy_search', 1)->orWhereNull('privacy_search');
                })
                ->whereIn('id', $ids)
                ->select(
                    'id',
                    DB::raw("CASE WHEN profile_type = 'organisation' AND organization_name IS NOT NULL AND organization_name != '' THEN organization_name ELSE CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, '')) END as name"),
                    // Disambiguation fields for the recipient picker: two members can
                    // share a display name, so callers render location + "member since".
                    'location',
                    'created_at'
                )
                ->get()
                ->map(static fn ($r): array => (array) $r)
                ->all();
        } catch (\Throwable $e) {
            report($e);

            return [];
        }
    }

    /**
     * Resolve a single transfer recipient by id (used when the JS autocomplete
     * picks a member). Re-applies the same tenant + active + search-opt-out
     * filters as the text search, so a picked id can't bypass them.
     *
     * @return array<int, array<string, mixed>>
     */
    private function walletRecipientById(int $recipientId, int $viewerId): array
    {
        if ($recipientId <= 0 || $recipientId === $viewerId) {
            return [];
        }

        try {
            $row = DB::table('users')
                ->where('id', $recipientId)
                ->where('tenant_id', TenantContext::getId())
                ->where('status', 'active')
                ->where(function ($q) {
                    $q->where('privacy_search', 1)->orWhereNull('privacy_search');
                })
                ->select(
                    'id',
                    DB::raw("CASE WHEN profile_type = 'organisation' AND organization_name IS NOT NULL AND organization_name != '' THEN organization_name ELSE CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, '')) END as name"),
                    'location',
                    'created_at'
                )
                ->first();

            return $row ? [(array) $row] : [];
        } catch (\Throwable $e) {
            report($e);

            return [];
        }
    }

    /**
     * JSON suggestions for the wallet recipient autocomplete (progressive
     * enhancement). Reuses the tenant-scoped, privacy-respecting member search
     * and adds the disambiguation fields (location + "member since"). The no-JS
     * path never calls this — it uses the server-rendered search results.
     */
    public function walletRecipients(Request $request, string $tenantSlug): \Illuminate\Http\JsonResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('wallet'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return response()->json(['results' => []], 401);
        }

        $query = trim(self::asStr($request->query('q')));
        if (mb_strlen($query) < 2) {
            return response()->json(['results' => []]);
        }

        $results = [];
        foreach ($this->messageUserSearch($query, $userId) as $r) {
            $since = !empty($r['created_at'])
                ? \Illuminate\Support\Carbon::parse($r['created_at'])->translatedFormat('M Y')
                : null;
            $results[] = [
                'id'       => (int) ($r['id'] ?? 0),
                'name'     => trim((string) ($r['name'] ?? '')),
                'location' => (trim((string) ($r['location'] ?? '')) ?: null),
                'since'    => $since,
            ];
        }

        return response()->json(['results' => $results]);
    }

    /**
     * "My account" hub — a single landing page that gathers the member's
     * personal/transactional facilities (Wallet, Messages, Connections, Profile,
     * Settings) so the flat GOV.UK service navigation can stay focused on
     * community + discovery. Linked from the top header account zone.
     */
    public function account(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        return $this->view('accessible-frontend::account', [
            'title' => __('govuk_alpha.account.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'account',
        ]);
    }

    // === Gamification (reached from the My account hub) ===

    /** Achievements: the member's level/XP plus earned badges and badges in progress. */
    public function achievements(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('gamification'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $tenantId = TenantContext::getId();
        $profile = [];
        $badges = [];
        $progress = [];
        try {
            $profile = \App\Services\GamificationService::getProfile($userId, $tenantId);
        } catch (\Throwable $e) {
            report($e);
        }
        try {
            $badges = \App\Services\GamificationService::getBadges($userId, $tenantId);
        } catch (\Throwable $e) {
            report($e);
        }
        try {
            $progress = \App\Services\GamificationService::getBadgeProgress($userId);
        } catch (\Throwable $e) {
            report($e);
        }

        // ===== WAVE POLISH-GAMIFY: daily reward + challenges =====
        $dailyCanClaim = false;
        $dailyStreak = 0;
        $dailyBaseXp = 5; // DailyRewardService::BASE_XP (private const)
        $dailyNextXp = $dailyBaseXp;
        $challenges = [];
        try {
            $rewardConfig = \App\Services\DailyRewardService::getRewardConfig(TenantContext::getId());
            $dailyBaseXp = (int) ($rewardConfig['base_xp'] ?? 5);
            $dailyCanClaim = \App\Services\DailyRewardService::canClaim(TenantContext::getId(), $userId);
            $dailyStreak = \App\Services\DailyRewardService::getStreak(TenantContext::getId(), $userId);
            $streakBonuses = $rewardConfig['streak_bonuses'] ?? [3 => 5, 7 => 15, 14 => 25, 30 => 45, 60 => 70, 90 => 95];
            $dailyNextXp = $dailyBaseXp;
            foreach ($streakBonuses as $days => $bonus) {
                if ($dailyStreak < (int) $days) {
                    $dailyNextXp = $dailyBaseXp + (int) $bonus;
                    break;
                }
            }
        } catch (\Throwable $e) {
            report($e);
        }
        try {
            $raw = app(\App\Services\ChallengeService::class)->getChallengesWithProgress($userId);
            $challenges = is_array($raw) ? $raw : [];
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::achievements', [
            'title' => __('govuk_alpha.achievements.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'achievements',
            'gamProfile' => is_array($profile) ? $profile : [],
            'earnedBadges' => is_array($badges) ? $badges : [],
            'badgeProgress' => is_array($progress) ? $progress : [],
            'dailyCanClaim' => $dailyCanClaim,
            'dailyStreak' => $dailyStreak,
            'dailyNextXp' => $dailyNextXp,
            'dailyRewardXp' => $dailyBaseXp,
            'dailyRewardStatus' => self::asStr($request->query('status')) ?: null,
            'challenges' => $challenges,
            'challengeStatus' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /** Leaderboard: members ranked by a chosen metric + period (server-rendered filter). */
    public function leaderboard(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('gamification'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $validTypes = ['credits_earned', 'credits_spent', 'vol_hours', 'badges', 'xp', 'connections', 'reviews', 'posts', 'streak'];
        $validPeriods = ['all_time', 'month', 'week'];
        $type = in_array($request->query('type'), $validTypes, true) ? (string) $request->query('type') : 'credits_earned';
        $period = in_array($request->query('period'), $validPeriods, true) ? (string) $request->query('period') : 'all_time';

        $rows = [];
        try {
            $svc = app(\App\Services\LeaderboardService::class);
            $rows = $svc->getLeaderboardByType(TenantContext::getId(), $type, $period, 20, $userId);
            foreach ($rows as &$row) {
                $row['score_display'] = $svc->formatScore($row['score'] ?? 0, $type);
            }
            unset($row);
        } catch (\Throwable $e) {
            report($e);
            $rows = [];
        }

        // ===== WAVE POLISH-GAMIFY: community impact stats =====
        $communityImpact = [];
        try {
            $communityImpact = app(\App\Services\CommunityDashboardService::class)->getCommunityImpact(TenantContext::getId());
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::leaderboard', [
            'title' => __('govuk_alpha.leaderboard.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'leaderboard',
            'leaderboardRows' => is_array($rows) ? $rows : [],
            'leaderboardType' => $type,
            'leaderboardPeriod' => $period,
            'leaderboardTypes' => $validTypes,
            'leaderboardPeriods' => $validPeriods,
            'communityImpact' => is_array($communityImpact) ? $communityImpact : [],
        ]);
    }

    /** NEXUS score: the member's reputation score with its category breakdown + tips. */
    public function nexusScore(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('gamification'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $score = [];
        try {
            $score = app(\App\Services\NexusScoreCacheService::class)->getScore($userId, TenantContext::getId());
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::nexus-score', [
            'title' => __('govuk_alpha.nexus_score.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'nexus_score',
            'nexusScore' => is_array($score) ? $score : [],
        ]);
    }

    // === Notifications inbox (auth + notifications module) ===

    public function notifications(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        // Parity with React, which wraps /notifications in <FeatureGate module="notifications">
        // (App.tsx) — when an admin switches the module off, the page is unreachable.
        abort_unless(TenantContext::hasModule('notifications'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $unreadOnly = self::asStr($request->query('filter')) === 'unread';
        $filters = ['limit' => 30];
        if ($unreadOnly) {
            $filters['unread_only'] = true;
        }
        $cursor = self::asStr($request->query('cursor'));
        if ($cursor !== '') {
            $filters['cursor'] = $cursor;
        }

        $data = ['items' => [], 'cursor' => null, 'has_more' => false];
        $counts = ['total' => 0];
        try {
            $svc = app(\App\Services\NotificationService::class);
            // Collapse same-target notifications into groups (mirrors React).
            $data = $svc->getGroupedNotifications($userId, $filters);
            $counts = $svc->getCounts($userId);
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::notifications', [
            'title' => __('govuk_alpha.notifications.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'notifications',
            'notifications' => is_array($data['items'] ?? null) ? $data['items'] : [],
            'notificationsCursor' => $data['cursor'] ?? null,
            'notificationsHasMore' => (bool) ($data['has_more'] ?? false),
            'notificationCounts' => is_array($counts) ? $counts : ['total' => 0],
            'notificationsUnreadOnly' => $unreadOnly,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /**
     * Mark every notification in a "type:link" group as read (mirrors React's
     * mark-group-read). The group_key is posted in the body because it can
     * contain slashes (the link). NotificationService::markGroupRead is
     * user + tenant scoped.
     */
    public function markGroupNotificationsRead(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('notifications'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $groupKey = self::asStr($request->input('group_key'));
        if ($groupKey === '') {
            return redirect()->route('govuk-alpha.notifications.index', ['tenantSlug' => $tenantSlug]);
        }

        try {
            app(\App\Services\NotificationService::class)->markGroupRead($userId, $groupKey);
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.notifications.index', ['tenantSlug' => $tenantSlug, 'status' => 'group-marked-read']);
    }

    public function markAllNotificationsRead(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('notifications'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }
        try {
            app(\App\Services\NotificationService::class)->markAllRead($userId);
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.notifications.index', ['tenantSlug' => $tenantSlug, 'status' => 'marked-read']);
    }

    public function deleteNotification(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('notifications'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }
        try {
            app(\App\Services\NotificationService::class)->delete($id, $userId);
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.notifications.index', ['tenantSlug' => $tenantSlug, 'status' => 'notification-deleted']);
    }

    public function markNotificationRead(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('notifications'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }
        try {
            // Tenant + ownership scoped: only the recipient's own row is touched.
            \Illuminate\Support\Facades\DB::table('notifications')
                ->where('id', $id)
                ->where('user_id', $userId)
                ->where('tenant_id', TenantContext::getId())
                ->update(['is_read' => 1, 'read_at' => now()]);
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.notifications.index', ['tenantSlug' => $tenantSlug, 'status' => 'notification-marked-read']);
    }

    public function deleteAllNotifications(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('notifications'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }
        try {
            \Illuminate\Support\Facades\DB::table('notifications')
                ->where('user_id', $userId)
                ->where('tenant_id', TenantContext::getId())
                ->delete();
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.notifications.index', ['tenantSlug' => $tenantSlug, 'status' => 'all-notifications-deleted']);
    }

    // === Personal activity (auth-only, self) ===

    public function activity(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $data = [];
        try {
            $data = app(\App\Services\MemberActivityService::class)->getDashboardData($userId);
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::activity', [
            'title' => __('govuk_alpha.activity.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'activity',
            'activity' => is_array($data) ? $data : [],
        ]);
    }

    // === Reviews (received / given / pending) ===

    public function reviews(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('reviews'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $received = [];
        $given = [];
        $pending = [];
        $stats = [];
        try {
            $svc = app(\App\Services\ReviewService::class);
            $received = $svc->getForUser($userId, ['limit' => 20])['items'] ?? [];
            $given = $svc->getGivenByUser($userId, ['limit' => 20])['items'] ?? [];
            $pending = $svc->getPendingReviews($userId, ['limit' => 20])['items'] ?? [];
            $stats = $svc->getStats($userId);
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::reviews', [
            'title' => __('govuk_alpha.reviews_page.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'reviews',
            'reviewsReceived' => is_array($received) ? $received : [],
            'reviewsGiven' => is_array($given) ? $given : [],
            'reviewsPending' => is_array($pending) ? $pending : [],
            'reviewStats' => is_array($stats) ? $stats : [],
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /**
     * Submit a review for a completed exchange straight from the Pending tab.
     * Mirrors POST /v2/reviews (ReviewService::create + XP + feed activity).
     */
    public function storeReview(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('reviews'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $receiverId = (int) $request->input('receiver_id');
        $rating = (int) $request->input('rating');
        $comment = trim(self::asStr($request->input('comment')));
        $transactionId = (int) $request->input('transaction_id');

        $data = [
            'receiver_id'    => $receiverId,
            'rating'         => $rating,
            'comment'        => $comment !== '' ? $comment : null,
            'transaction_id' => $transactionId > 0 ? $transactionId : null,
        ];

        $status = 'review-submitted';
        try {
            $review = app(\App\Services\ReviewService::class)->create($userId, $data);

            try {
                \App\Services\GamificationService::awardXP($userId, \App\Services\GamificationService::XP_VALUES['leave_review'], 'leave_review', 'Left a review');
            } catch (\Throwable $e) {
                // Gamification is best-effort and must not change the review outcome.
            }

            try {
                app(\App\Services\FeedActivityService::class)->recordActivity(
                    (int) TenantContext::getId(),
                    $userId,
                    'review',
                    (int) ($review['id'] ?? 0),
                    [
                        'content'  => $review['comment'] ?? null,
                        'metadata' => ['rating' => $review['rating'] ?? $rating, 'receiver_id' => $receiverId],
                    ]
                );
            } catch (\Throwable $e) {
                // Feed activity is best-effort.
            }
        } catch (\Illuminate\Validation\ValidationException $e) {
            $status = 'review-invalid';
        } catch (\App\Exceptions\SafeguardingPolicyException $e) {
            $status = $e->reasonCode === 'SAFEGUARDING_POLICY_UNAVAILABLE'
                ? 'review-safeguarding-unavailable'
                : 'review-safeguarding-restricted';
        } catch (\RuntimeException $e) {
            $status = str_contains($e->getMessage(), 'yourself') ? 'review-invalid' : 'review-duplicate';
        } catch (\Throwable $e) {
            report($e);
            $status = 'review-failed';
        }

        return redirect()->route('govuk-alpha.reviews.index', ['tenantSlug' => $tenantSlug, 'status' => $status]);
    }

    // === Static marketing pages (public) ===

    public function features(Request $request, string $tenantSlug): Response
    {
        $this->assertTenantSlug($tenantSlug);

        return $this->view('accessible-frontend::features', [
            'title' => __('govuk_alpha.features.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'features',
        ]);
    }

    public function faq(Request $request, string $tenantSlug): Response
    {
        $this->assertTenantSlug($tenantSlug);

        return $this->view('accessible-frontend::faq', [
            'title' => __('govuk_alpha.faq.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'faq',
        ]);
    }

    // === Explore hub (discovery facilities — keeps the flat service nav lean) ===

    public function explore(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        if ($this->currentUserId() === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $recentListings = [];
        $upcomingEvents = [];
        try {
            if (TenantContext::hasModule('listings')) {
                $recentListings = \App\Services\ListingService::getAll(['limit' => 5, 'status' => 'active'])['items'] ?? [];
            }
        } catch (\Throwable $e) {
            report($e);
        }
        try {
            if (TenantContext::hasFeature('events')) {
                $upcomingEvents = \App\Services\EventService::getAll(['limit' => 5, 'when' => 'upcoming'])['items'] ?? [];
            }
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::explore', [
            'title' => __('govuk_alpha.explore.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'exploreRecentListings' => is_array($recentListings) ? $recentListings : [],
            'exploreUpcomingEvents' => is_array($upcomingEvents) ? $upcomingEvents : [],
        ]);
    }

    // === Global search ===

    public function search(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('search'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $q = trim(self::asStr($request->query('q')));
        $type = in_array($request->query('type'), ['all', 'listing', 'user', 'event', 'group'], true) ? (string) $request->query('type') : 'all';
        $results = [];
        $total = 0;
        if ($q !== '') {
            try {
                $r = app(\App\Services\SearchService::class)->unifiedSearch($q, $userId, ['type' => $type, 'limit' => 30]);
                $results = is_array($r['items'] ?? null) ? $r['items'] : [];
                $total = (int) ($r['total'] ?? count($results));
            } catch (\Throwable $e) {
                report($e);
            }
        }

        return $this->view('accessible-frontend::search', [
            'title' => __('govuk_alpha.search.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'searchQuery' => $q,
            'searchType' => $type,
            'searchResults' => $results,
            'searchTotal' => $total,
        ]);
    }

    // === Groups ===

    public function groups(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('groups'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $q = trim(self::asStr($request->query('q')));
        $page = max(1, (int) $request->query('page', 1));
        $perPage = 30;
        $filters = ['limit' => $perPage, 'offset' => ($page - 1) * $perPage, 'viewer_user_id' => $userId];
        if ($q !== '') {
            $filters['search'] = $q;
        }

        // Visibility / membership filter (mirrors React: all | joined | public |
        // private). GroupService::getAll honours `visibility` and `user_id`
        // (joined). Only whitelisted values reach the query.
        $groupsFilter = $this->allowed(self::asStr($request->query('filter')), ['all', 'joined', 'public', 'private'], 'all');
        if ($groupsFilter === 'joined') {
            $filters['user_id'] = $userId;
        } elseif ($groupsFilter === 'public' || $groupsFilter === 'private') {
            $filters['visibility'] = $groupsFilter;
        }

        $items = [];
        $total = 0;
        try {
            $result = \App\Services\GroupService::getAll($filters);
            $items = $result['items'] ?? [];
            $total = (int) ($result['total'] ?? count($items));
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::groups', [
            'title' => __('govuk_alpha.groups.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'groups' => is_array($items) ? $items : [],
            'groupsQuery' => $q,
            'groupsFilter' => $groupsFilter,
            'groupsTotal' => $total,
            'groupsPerPage' => $perPage,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    public function group(Request $request, string $tenantSlug, int $id): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('groups'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $group = null;
        $members = [];
        try {
            $group = \App\Services\GroupService::getById($id, $userId, true);
        } catch (\Throwable $e) {
            report($e);
        }
        abort_if($group === null, 404);
        try {
            $members = \App\Services\GroupService::getMembers($id, ['limit' => 50])['items'] ?? [];
        } catch (\Throwable $e) {
            report($e);
        }

        $isMember = false;
        foreach ($members as $m) {
            if ((int) ($m['user_id'] ?? ($m['id'] ?? 0)) === $userId) {
                $isMember = true;
                break;
            }
        }

        // WAVE T1-GROUPS: events + feed tabs on the group detail page.
        // A participant is an active member OR the group owner — both can read and
        // post to the group feed (canPostInGroup is the authority and short-circuits
        // for the owner). The members roster does not always include the owner row,
        // so derive participation from owner_id too.
        $isParticipant = $isMember || (int) ($group['owner_id'] ?? 0) === $userId;

        // Both reads are member-and-visibility scoped at the service layer:
        //   - EventService::getAll is tenant-scoped (HasTenantScope) and filtered to this group.
        //   - FeedService::getFeed gates private-group posts to members (and 404s a
        //     non-member viewer of a private group), so we never leak posts.
        [$groupEvents, $groupFeed] = $this->loadGroupTabData($group, $userId, $isParticipant);

        // Pinned announcements — direct DB query (no GroupService wrapper exists).
        $pinnedAnnouncements = [];
        try {
            $tenantId = TenantContext::getId();
            $pinnedAnnouncements = DB::table('group_announcements')
                ->where('group_id', $id)
                ->where('tenant_id', $tenantId)
                ->where('is_pinned', 1)
                ->where(function ($q) {
                    $q->whereNull('expires_at')->orWhere('expires_at', '>', now());
                })
                ->orderBy('priority', 'asc')
                ->orderBy('created_at', 'desc')
                ->limit(5)
                ->get()
                ->toArray();
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::group-detail', [
            'title' => ($group['name'] ?? '') ?: __('govuk_alpha.groups.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'group' => $group,
            'groupMembers' => is_array($members) ? $members : [],
            'isMember' => $isMember,
            'groupCanParticipate' => $isParticipant,
            'groupEvents' => $groupEvents,
            'groupFeed' => $groupFeed,
            'pinnedAnnouncements' => $pinnedAnnouncements,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    // ===== WAVE T1-GROUPS: events + feed tabs =====

    /**
     * Build the events + feed tab payloads for the group detail page.
     *
     * Visibility rules (mirrors React GroupDetailPage):
     *   - Events: this group's upcoming events, always tenant-scoped. For a private
     *     group the events tab is only populated for members (parity with the feed).
     *   - Feed: only members of the group see its posts. FeedService::getFeed already
     *     gates private-group posts to members, but we additionally skip the read for
     *     non-members so an empty list never doubles as a membership oracle.
     *
     * @param array<string, mixed> $group
     * @return array{0: array<int, array<string, mixed>>, 1: array<int, array<string, mixed>>}
     */
    private function loadGroupTabData(array $group, int $userId, bool $isParticipant): array
    {
        $groupId = (int) ($group['id'] ?? 0);
        $isPrivate = ($group['visibility'] ?? 'public') !== 'public';
        $events = [];
        $feed = [];

        if ($groupId <= 0) {
            return [$events, $feed];
        }

        // Events: visible to anyone who can see the group page, except for a private
        // group where only participants (members/owner) get the listing.
        if (!$isPrivate || $isParticipant) {
            try {
                $result = EventService::getAll([
                    'group_id' => $groupId,
                    'when'     => 'upcoming',
                    'limit'    => 10,
                ]);
                $events = $this->withResolvedImageKey($result['items'] ?? [], 'cover_image');
            } catch (\Throwable $e) {
                report($e);
            }
        }

        // Feed: participants only. FeedService enforces this too, but skipping the read
        // for non-participants avoids any chance of leaking post existence.
        if ($isParticipant) {
            try {
                $result = $this->feedService->getFeed($userId, [
                    'group_id' => $groupId,
                    'mode'     => 'chronological',
                    'limit'    => 20,
                ]);
                $feed = is_array($result['items'] ?? null) ? $result['items'] : [];
            } catch (\Throwable $e) {
                report($e);
            }
        }

        return [$events, $feed];
    }

    /**
     * Post to a group's feed (members only). The service layer (FeedService::createPost
     * → FeedItemTables::canPostInGroup) is the authority: a non-member, or a member of a
     * different group passing another group's id, is rejected there with a 403-equivalent
     * error array. We also gate up-front so the redirect status is meaningful.
     */
    public function storeGroupFeedPost(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $userId = $this->groupGuard($tenantSlug);
        if (is_object($userId)) {
            return $userId;
        }

        $back = fn (string $status): RedirectResponse => redirect()->route(
            'govuk-alpha.groups.show',
            ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => $status]
        )->withFragment('group-feed');

        // The group must exist in this tenant and the user must be allowed to post.
        // canPostInGroup is tenant-scoped and membership-aware, so this single check
        // blocks both the non-member case and the cross-group (member of A → B) case.
        if (!\App\Support\FeedItemTables::canPostInGroup($id, $userId)) {
            return $back('group-post-forbidden');
        }

        $content = trim(self::asStr($request->input('content')));
        if ($content === '') {
            return $back('group-post-empty');
        }

        try {
            $post = $this->feedService->createPost($userId, [
                'content'    => $content,
                'visibility' => 'public',
                'group_id'   => $id,
            ]);
            if (is_array($post) && isset($post['error'])) {
                return $back('group-post-failed');
            }

            if ($post instanceof \App\Models\FeedPost && $request->hasFile('image')) {
                $this->attachFeedPostImage($request, (int) $post->id);
            }
        } catch (\Throwable $e) {
            report($e);
            return $back('group-post-failed');
        }

        return $back('group-posted');
    }

    public function joinGroup(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $userId = $this->alphaAuthGuard($tenantSlug);
        if (is_object($userId)) {
            return $userId;
        }
        abort_unless(TenantContext::hasFeature('groups'), 403);
        $ok = false;
        try {
            $res = \App\Services\GroupService::join($id, $userId);
            $ok = (bool) ($res['success'] ?? (is_array($res) ? !isset($res['error']) : (bool) $res));
        } catch (\App\Exceptions\SafeguardingPolicyException $e) {
            $safeguardingStatus = $e->reasonCode === 'SAFEGUARDING_POLICY_UNAVAILABLE'
                ? 'group-safeguarding-unavailable'
                : 'group-safeguarding-restricted';
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.groups.show', [
            'tenantSlug' => $tenantSlug,
            'id' => $id,
            'status' => $ok ? 'group-joined' : ($safeguardingStatus ?? 'group-failed'),
        ]);
    }

    public function leaveGroup(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $userId = $this->alphaAuthGuard($tenantSlug);
        if (is_object($userId)) {
            return $userId;
        }
        abort_unless(TenantContext::hasFeature('groups'), 403);
        $ok = false;
        try {
            $ok = \App\Services\GroupService::leave($id, $userId);
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.groups.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => $ok ? 'group-left' : 'group-failed']);
    }

    // === Groups: management (create / edit / delete / roles / requests / discussions) ===

    /**
     * Shared auth + feature gate for every group management action. Returns the
     * authenticated user id, or a redirect (to login / 403) the caller must return.
     */
    private function groupGuard(string $tenantSlug): int|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('groups'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        return $userId;
    }

    /**
     * Load a group the current user is allowed to administer (owner/admin), or
     * abort. A group in another tenant resolves to null (tenant global scope) →
     * 404; a group the user cannot modify → 403. Returns the GroupService array.
     *
     * @return array<string, mixed>
     */
    private function managedGroupOrAbort(int $groupId, int $userId): array
    {
        $group = null;
        try {
            $group = \App\Services\GroupService::getById($groupId, $userId, false);
        } catch (\Throwable $e) {
            report($e);
        }
        abort_if($group === null, 404);
        abort_unless(\App\Services\GroupService::canModify($groupId, $userId), 403);

        return $group;
    }

    public function createGroup(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $userId = $this->groupGuard($tenantSlug);
        if (is_object($userId)) {
            return $userId;
        }

        return $this->view('accessible-frontend::group-create', [
            'title' => __('govuk_alpha.groups.create.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    public function storeGroup(Request $request, string $tenantSlug): RedirectResponse
    {
        $userId = $this->groupGuard($tenantSlug);
        if (is_object($userId)) {
            return $userId;
        }

        $name = trim(self::asStr($request->input('name')));
        $description = trim(self::asStr($request->input('description')));
        $visibility = self::asStr($request->input('visibility')) === 'private' ? 'private' : 'public';
        $location = trim(self::asStr($request->input('location')));
        $tags = trim(self::asStr($request->input('tags')));

        $errors = [];
        if ($name === '') {
            $errors['name'] = __('govuk_alpha.groups.errors.name_required');
        } elseif (mb_strlen($name) > 255) {
            $errors['name'] = __('govuk_alpha.groups.errors.name_too_long');
        }
        if ($errors !== []) {
            return redirect()
                ->route('govuk-alpha.groups.create', ['tenantSlug' => $tenantSlug])
                ->withErrors($errors)
                ->withInput();
        }

        $data = [
            'name' => $name,
            'description' => $description,
            'visibility' => $visibility,
        ];
        if ($location !== '') {
            $data['location'] = $location;
        }
        if ($tags !== '') {
            // Normalise comma-separated tags; appended to the description so the
            // accessible group keeps a single text body (the API tags pipeline is
            // JS-managed and out of scope here).
            $tagList = array_values(array_filter(array_map('trim', explode(',', $tags))));
            if ($tagList !== []) {
                $data['description'] = trim($description . "\n\n" . __('govuk_alpha.groups.create.tags_label') . ': ' . implode(', ', $tagList));
            }
        }

        $group = null;
        try {
            $group = \App\Services\GroupService::create($userId, $data);
        } catch (\Throwable $e) {
            report($e);
        }

        if ($group === null || empty($group->id)) {
            return redirect()
                ->route('govuk-alpha.groups.create', ['tenantSlug' => $tenantSlug, 'status' => 'group-create-failed'])
                ->withInput();
        }

        $groupId = (int) $group->id;

        // Optional cover image — best-effort; a bad image must never discard the
        // group the member already created. updateImage re-checks ownership.
        if ($request->hasFile('cover')) {
            $this->attachGroupCoverImage($request, $groupId, $userId);
        }

        return redirect()->route('govuk-alpha.groups.show', ['tenantSlug' => $tenantSlug, 'id' => $groupId, 'status' => 'group-created']);
    }

    public function editGroup(Request $request, string $tenantSlug, int $id): Response|RedirectResponse
    {
        $userId = $this->groupGuard($tenantSlug);
        if (is_object($userId)) {
            return $userId;
        }
        $group = $this->managedGroupOrAbort($id, $userId);

        return $this->view('accessible-frontend::group-edit', [
            'title' => __('govuk_alpha.groups.edit.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'group' => $group,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    public function updateGroup(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $userId = $this->groupGuard($tenantSlug);
        if (is_object($userId)) {
            return $userId;
        }
        $this->managedGroupOrAbort($id, $userId);

        $name = trim(self::asStr($request->input('name')));
        $description = trim(self::asStr($request->input('description')));
        $visibility = self::asStr($request->input('visibility')) === 'private' ? 'private' : 'public';
        $location = trim(self::asStr($request->input('location')));
        $tags = trim(self::asStr($request->input('tags')));

        $errors = [];
        if ($name === '') {
            $errors['name'] = __('govuk_alpha.groups.errors.name_required');
        } elseif (mb_strlen($name) > 255) {
            $errors['name'] = __('govuk_alpha.groups.errors.name_too_long');
        }
        if ($errors !== []) {
            return redirect()
                ->route('govuk-alpha.groups.edit', ['tenantSlug' => $tenantSlug, 'id' => $id])
                ->withErrors($errors)
                ->withInput();
        }

        $updateData = [
            'name' => $name,
            'description' => $description,
            'visibility' => $visibility,
            'location' => $location,
        ];
        if ($tags !== '') {
            $tagList = array_values(array_filter(array_map('trim', explode(',', $tags))));
            if ($tagList !== []) {
                $updateData['tags'] = $tagList;
            }
        } else {
            $updateData['tags'] = [];
        }

        $ok = false;
        try {
            $ok = \App\Services\GroupService::update($id, $userId, $updateData);
        } catch (\Throwable $e) {
            report($e);
        }

        if ($request->hasFile('cover')) {
            $this->attachGroupCoverImage($request, $id, $userId);
        }

        if (!$ok) {
            return redirect()
                ->route('govuk-alpha.groups.edit', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'group-update-failed'])
                ->withInput();
        }

        return redirect()->route('govuk-alpha.groups.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'group-updated']);
    }

    public function deleteGroup(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $userId = $this->groupGuard($tenantSlug);
        if (is_object($userId)) {
            return $userId;
        }
        // Only the owner (or platform admin) may delete — GroupService::delete
        // enforces this; managedGroupOrAbort guarantees the group is in-tenant.
        $this->managedGroupOrAbort($id, $userId);

        $ok = false;
        try {
            $ok = \App\Services\GroupService::delete($id, $userId);
        } catch (\Throwable $e) {
            report($e);
        }

        if ($ok) {
            return redirect()->route('govuk-alpha.groups.index', ['tenantSlug' => $tenantSlug, 'status' => 'group-deleted']);
        }

        return redirect()->route('govuk-alpha.groups.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'group-delete-failed']);
    }

    public function manageGroup(Request $request, string $tenantSlug, int $id): Response|RedirectResponse
    {
        $userId = $this->groupGuard($tenantSlug);
        if (is_object($userId)) {
            return $userId;
        }
        $group = $this->managedGroupOrAbort($id, $userId);

        $members = [];
        $pending = [];
        try {
            $members = \App\Services\GroupService::getMembers($id, ['limit' => 100])['items'] ?? [];
        } catch (\Throwable $e) {
            report($e);
        }
        try {
            $pending = \App\Services\GroupService::getPendingRequests($id, $userId) ?? [];
        } catch (\Throwable $e) {
            report($e);
        }

        $ownerId = (int) ($group['owner_id'] ?? 0);

        return $this->view('accessible-frontend::group-manage', [
            'title' => __('govuk_alpha.groups.manage.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'group' => $group,
            'groupMembers' => is_array($members) ? $members : [],
            'pendingRequests' => is_array($pending) ? $pending : [],
            'ownerId' => $ownerId,
            'currentUserId' => $userId,
            'isPrivate' => ($group['visibility'] ?? 'public') !== 'public',
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    public function updateGroupMember(Request $request, string $tenantSlug, int $id, int $memberId): RedirectResponse
    {
        $userId = $this->groupGuard($tenantSlug);
        if (is_object($userId)) {
            return $userId;
        }
        $this->managedGroupOrAbort($id, $userId);

        $action = self::asStr($request->input('action'));
        $status = 'member-failed';
        try {
            if ($action === 'promote') {
                $ok = \App\Services\GroupService::updateMemberRole($id, $memberId, $userId, 'admin');
                $status = $ok ? 'member-promoted' : 'member-failed';
            } elseif ($action === 'demote') {
                $ok = \App\Services\GroupService::updateMemberRole($id, $memberId, $userId, 'member');
                $status = $ok ? 'member-demoted' : 'member-failed';
            } elseif ($action === 'remove') {
                $ok = \App\Services\GroupService::removeMember($id, $memberId, $userId);
                $status = $ok ? 'member-removed' : 'member-failed';
            }
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.groups.manage', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => $status]);
    }

    public function handleGroupRequest(Request $request, string $tenantSlug, int $id, int $requesterId): RedirectResponse
    {
        $userId = $this->groupGuard($tenantSlug);
        if (is_object($userId)) {
            return $userId;
        }
        $this->managedGroupOrAbort($id, $userId);

        $action = self::asStr($request->input('action')) === 'reject' ? 'reject' : 'accept';
        $ok = false;
        try {
            $ok = \App\Services\GroupService::handleJoinRequest($id, $requesterId, $userId, $action);
        } catch (\App\Exceptions\SafeguardingPolicyException $e) {
            $safeguardingStatus = $e->reasonCode === 'SAFEGUARDING_POLICY_UNAVAILABLE'
                ? 'request-safeguarding-unavailable'
                : 'request-safeguarding-restricted';
        } catch (\Throwable $e) {
            report($e);
        }

        $status = $ok
            ? ($action === 'accept' ? 'request-approved' : 'request-rejected')
            : ($safeguardingStatus ?? 'request-failed');

        return redirect()->route('govuk-alpha.groups.manage', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => $status]);
    }

    public function groupDiscussions(Request $request, string $tenantSlug, int $id): Response|RedirectResponse
    {
        $userId = $this->groupGuard($tenantSlug);
        if (is_object($userId)) {
            return $userId;
        }

        $group = null;
        try {
            $group = \App\Services\GroupService::getById($id, $userId, true);
        } catch (\Throwable $e) {
            report($e);
        }
        abort_if($group === null, 404);

        // Discussions require active membership (mirrors GroupService::getDiscussions).
        $isMember = \App\Services\GroupService::isActiveMember($id, $userId);
        $discussions = [];
        if ($isMember) {
            try {
                $discussions = \App\Services\GroupService::getDiscussions($id, $userId, ['limit' => 50])['items'] ?? [];
            } catch (\Throwable $e) {
                report($e);
            }
        }

        return $this->view('accessible-frontend::group-discussions', [
            'title' => __('govuk_alpha.groups.discussions.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'group' => $group,
            'discussions' => is_array($discussions) ? $discussions : [],
            'isMember' => $isMember,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    public function createGroupDiscussion(Request $request, string $tenantSlug, int $id): Response|RedirectResponse
    {
        $userId = $this->groupGuard($tenantSlug);
        if (is_object($userId)) {
            return $userId;
        }

        $group = null;
        try {
            $group = \App\Services\GroupService::getById($id, $userId, true);
        } catch (\Throwable $e) {
            report($e);
        }
        abort_if($group === null, 404);
        // Only active members may open the create form.
        abort_unless(\App\Services\GroupService::isActiveMember($id, $userId), 403);

        return $this->view('accessible-frontend::group-discussion-create', [
            'title' => __('govuk_alpha.groups.discussions.new_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'group' => $group,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    public function storeGroupDiscussion(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $userId = $this->groupGuard($tenantSlug);
        if (is_object($userId)) {
            return $userId;
        }
        // Membership is re-checked inside GroupService::createDiscussion.

        $dtitle = trim(self::asStr($request->input('title')));
        $content = trim(self::asStr($request->input('content')));

        $errors = [];
        if ($dtitle === '') {
            $errors['title'] = __('govuk_alpha.groups.errors.title_required');
        }
        if ($content === '') {
            $errors['content'] = __('govuk_alpha.groups.errors.content_required');
        }
        if ($errors !== []) {
            return redirect()
                ->route('govuk-alpha.groups.discussions.create', ['tenantSlug' => $tenantSlug, 'id' => $id])
                ->withErrors($errors)
                ->withInput();
        }

        $result = null;
        try {
            $result = \App\Services\GroupService::createDiscussion($id, $userId, [
                'title' => $dtitle,
                'content' => $content,
            ]);
        } catch (\Throwable $e) {
            report($e);
        }

        if ($result === null) {
            return redirect()
                ->route('govuk-alpha.groups.discussions.create', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'discussion-failed'])
                ->withInput();
        }

        return redirect()->route('govuk-alpha.groups.discussions.show', [
            'tenantSlug' => $tenantSlug,
            'id' => $id,
            'discussionId' => (int) ($result['id'] ?? 0),
            'status' => 'discussion-created',
        ]);
    }

    public function groupDiscussion(Request $request, string $tenantSlug, int $id, int $discussionId): Response|RedirectResponse
    {
        $userId = $this->groupGuard($tenantSlug);
        if (is_object($userId)) {
            return $userId;
        }

        $group = null;
        try {
            $group = \App\Services\GroupService::getById($id, $userId, true);
        } catch (\Throwable $e) {
            report($e);
        }
        abort_if($group === null, 404);

        $thread = null;
        try {
            $thread = \App\Services\GroupService::getDiscussionMessages($id, $discussionId, $userId, ['limit' => 100]);
        } catch (\Throwable $e) {
            report($e);
        }
        // Null = not a member or discussion not found → 404 (no info leak).
        abort_if($thread === null, 404);

        return $this->view('accessible-frontend::group-discussion-detail', [
            'title' => self::asStr($thread['discussion']['title'] ?? '') ?: __('govuk_alpha.groups.discussions.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'group' => $group,
            'discussion' => $thread['discussion'] ?? [],
            'messages' => $thread['items'] ?? [],
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    public function replyGroupDiscussion(Request $request, string $tenantSlug, int $id, int $discussionId): RedirectResponse
    {
        $userId = $this->groupGuard($tenantSlug);
        if (is_object($userId)) {
            return $userId;
        }

        $content = trim(self::asStr($request->input('content')));
        if ($content === '') {
            return redirect()
                ->route('govuk-alpha.groups.discussions.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'discussionId' => $discussionId])
                ->withErrors(['content' => __('govuk_alpha.groups.errors.content_required')])
                ->withInput();
        }

        $result = null;
        try {
            $result = \App\Services\GroupService::postToDiscussion($id, $discussionId, $userId, ['content' => $content]);
        } catch (\Throwable $e) {
            report($e);
        }

        $status = $result === null ? 'reply-failed' : 'reply-posted';

        return redirect()->route('govuk-alpha.groups.discussions.show', [
            'tenantSlug' => $tenantSlug,
            'id' => $id,
            'discussionId' => $discussionId,
            'status' => $status,
        ])->withFragment('discussion-replies');
    }

    /**
     * Attach an optional uploaded cover image to a group. Mirrors the listing /
     * event cover-image flow: best-effort (a failed or absent image never blocks
     * the group), and GroupService::updateImage re-checks ownership + tenant scope.
     */
    private function attachGroupCoverImage(Request $request, int $groupId, int $userId): void
    {
        $file = $request->file('cover');
        if ($file === null || is_array($file) || !$file->isValid()) {
            return;
        }

        try {
            $imageUrl = \App\Core\ImageUploader::upload([
                'name' => $file->getClientOriginalName(),
                'type' => $file->getMimeType(),
                'tmp_name' => $file->getRealPath(),
                'error' => UPLOAD_ERR_OK,
                'size' => $file->getSize(),
            ], 'groups');

            if (is_string($imageUrl) && $imageUrl !== '') {
                \App\Services\GroupService::updateImage($groupId, $userId, $imageUrl, 'cover');
            }
        } catch (\Throwable $e) {
            report($e);
        }
    }

    // === Goals ===

    public function goals(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('goals'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $items = [];
        try {
            $items = app(\App\Services\GoalService::class)->getAll(['limit' => 30, 'user_id' => $userId])['items'] ?? [];
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::goals', [
            'title' => __('govuk_alpha.goals.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'goals' => is_array($items) ? $items : [],
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    public function goal(Request $request, string $tenantSlug, int $id): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('goals'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $goal = null;
        try {
            $model = app(\App\Services\GoalService::class)->getById($id);
            $goal = $model?->toArray();
        } catch (\Throwable $e) {
            report($e);
        }
        abort_if($goal === null, 404);

        $isOwner = (int) ($goal['user_id'] ?? 0) === $userId;
        $isPublic = (bool) ($goal['is_public'] ?? false);
        $hasBuddy = ($goal['mentor_id'] ?? null) !== null;
        $isBuddy = $hasBuddy && (int) ($goal['mentor_id'] ?? 0) === $userId;

        // Non-owners may only view goals that are public (or that they buddy).
        abort_unless($isOwner || $isPublic || $isBuddy, 403);

        $history = [];
        $buddyNotes = [];
        try {
            $progress = app(\App\Services\GoalProgressService::class);
            $history = $progress->getProgressHistory($id, ['limit' => 30])['items'] ?? [];
            $buddyNotes = $progress->getBuddyNotes($id);
        } catch (\Throwable $e) {
            report($e);
        }

        // A signed-in member can offer to buddy a public goal that is not theirs
        // and has no buddy yet (mirrors GoalService::offerBuddy() guards).
        $canBecomeBuddy = $isPublic && !$isOwner && !$hasBuddy;

        return $this->view('accessible-frontend::goal-detail', [
            'title' => ($goal['title'] ?? '') ?: __('govuk_alpha.goals.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'goal' => $goal,
            'isOwner' => $isOwner,
            'isBuddy' => $isBuddy,
            'canBecomeBuddy' => $canBecomeBuddy,
            'goalHistory' => is_array($history) ? $history : [],
            'buddyNotes' => is_array($buddyNotes) ? $buddyNotes : [],
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /** Owner-only edit form for an existing goal. */
    public function editGoalForm(Request $request, string $tenantSlug, int $id): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('goals'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $goal = null;
        try {
            $model = app(\App\Services\GoalService::class)->getById($id);
            $goal = $model?->toArray();
        } catch (\Throwable $e) {
            report($e);
        }
        abort_if($goal === null, 404);
        // Owner check server-side: non-owners get 403, never the edit form.
        abort_unless((int) ($goal['user_id'] ?? 0) === $userId, 403);

        return $this->view('accessible-frontend::goal-edit', [
            'title' => __('govuk_alpha.goals.edit_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'goal' => $goal,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /** Owner-only update of an existing goal. */
    public function updateGoal(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('goals'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        // Load tenant-scoped + verify owner before any write; 404 if it does not
        // exist in this tenant, 403 if it is not the caller's goal.
        $goal = null;
        try {
            $goal = app(\App\Services\GoalService::class)->getById($id)?->toArray();
        } catch (\Throwable $e) {
            report($e);
        }
        abort_if($goal === null, 404);
        abort_unless((int) ($goal['user_id'] ?? 0) === $userId, 403);

        $title = trim(self::asStr($request->input('title')));
        $target = (float) $request->input('target_value');
        if ($title === '' || $target <= 0) {
            return redirect()->route('govuk-alpha.goals.edit', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'goal-invalid']);
        }

        $frequency = self::asStr($request->input('checkin_frequency'));
        if (!in_array($frequency, ['none', 'daily', 'weekly', 'biweekly', 'monthly'], true)) {
            $frequency = 'none';
        }

        $ok = false;
        try {
            $ok = app(\App\Services\GoalService::class)->update($id, $userId, [
                'title' => mb_substr($title, 0, 255),
                'description' => trim(self::asStr($request->input('description'))) ?: null,
                'target_value' => $target,
                'deadline' => self::asStr($request->input('deadline')) ?: null,
                'is_public' => $request->boolean('is_public'),
                'checkin_frequency' => $frequency,
            ]) !== null;
        } catch (\Throwable $e) {
            report($e);
        }

        if (!$ok) {
            return redirect()->route('govuk-alpha.goals.edit', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'goal-failed']);
        }

        return redirect()->route('govuk-alpha.goals.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'goal-edited']);
    }

    /** Owner-only delete of a goal (confirmed POST behind a warning). */
    public function deleteGoal(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('goals'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $goal = null;
        try {
            $goal = app(\App\Services\GoalService::class)->getById($id)?->toArray();
        } catch (\Throwable $e) {
            report($e);
        }
        abort_if($goal === null, 404);
        abort_unless((int) ($goal['user_id'] ?? 0) === $userId, 403);

        $ok = false;
        try {
            $ok = app(\App\Services\GoalService::class)->delete($id, $userId);
        } catch (\Throwable $e) {
            report($e);
        }

        if (!$ok) {
            return redirect()->route('govuk-alpha.goals.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'goal-failed']);
        }

        return redirect()->route('govuk-alpha.goals.index', ['tenantSlug' => $tenantSlug, 'status' => 'goal-deleted']);
    }

    /** Goal templates picker — start a goal from a shared template. */
    public function goalTemplates(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('goals'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $templates = [];
        $categories = [];
        $category = trim(self::asStr($request->query('category')));
        try {
            $svc = app(\App\Services\GoalTemplateService::class);
            $filters = ['limit' => 50];
            if ($category !== '') {
                $filters['category'] = $category;
            }
            $templates = $svc->getAll($filters)['items'] ?? [];
            $categories = $svc->getCategories();
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::goal-templates', [
            'title' => __('govuk_alpha.goals.templates_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'templates' => is_array($templates) ? $templates : [],
            'categories' => is_array($categories) ? $categories : [],
            'category' => $category ?: null,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /** Create a goal from a template (POST). */
    public function storeGoalFromTemplate(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('goals'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        // Confirm the template exists in this tenant before creating from it.
        $template = null;
        try {
            $template = app(\App\Services\GoalTemplateService::class)->getById($id);
        } catch (\Throwable $e) {
            report($e);
        }
        abort_if($template === null, 404);

        $overrides = [];
        $title = trim(self::asStr($request->input('title')));
        if ($title !== '') {
            $overrides['title'] = mb_substr($title, 0, 255);
        }
        $deadline = self::asStr($request->input('deadline'));
        if ($deadline !== '') {
            $overrides['deadline'] = $deadline;
        }
        $overrides['is_public'] = $request->boolean('is_public');

        $newId = null;
        try {
            $goal = app(\App\Services\GoalTemplateService::class)->createGoalFromTemplate($id, $userId, $overrides);
            $newId = $goal?->id;
        } catch (\Throwable $e) {
            report($e);
        }

        if ($newId === null) {
            return redirect()->route('govuk-alpha.goals.templates', ['tenantSlug' => $tenantSlug, 'status' => 'goal-failed']);
        }

        return redirect()->route('govuk-alpha.goals.show', ['tenantSlug' => $tenantSlug, 'id' => $newId, 'status' => 'goal-created']);
    }

    /** Buddy system: goals the member buddies + public goals they can offer to buddy. */
    public function goalBuddying(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('goals'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $buddying = [];
        $available = [];
        try {
            $svc = app(\App\Services\GoalService::class);
            $buddying = $svc->getGoalsAsMentor($userId, ['limit' => 30])['items'] ?? [];
            $available = $svc->getPublicForBuddy($userId, ['limit' => 30])['items'] ?? [];
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::goal-buddying', [
            'title' => __('govuk_alpha.goals.buddying_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'buddying' => is_array($buddying) ? $buddying : [],
            'available' => is_array($available) ? $available : [],
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /** Offer to become the buddy/mentor for a public goal (POST). */
    public function becomeGoalBuddy(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('goals'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        // offerBuddy() enforces is_public + no-existing-buddy + not-own-goal and
        // returns null when any guard fails, so an IDOR or double-buddy attempt
        // simply reports failure.
        $status = 'buddy-failed';
        try {
            if (app(\App\Services\GoalService::class)->offerBuddy($id, $userId) !== null) {
                $status = 'buddy-joined';
            }
        } catch (\App\Exceptions\SafeguardingPolicyException $e) {
            $status = $e->reasonCode === 'SAFEGUARDING_POLICY_UNAVAILABLE'
                ? 'buddy-safeguarding-unavailable'
                : 'buddy-safeguarding-restricted';
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.goals.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => $status]);
    }

    public function storeGoal(Request $request, string $tenantSlug): RedirectResponse
    {
        $userId = $this->alphaAuthGuard($tenantSlug);
        if (is_object($userId)) {
            return $userId;
        }
        abort_unless(TenantContext::hasFeature('goals'), 403);

        $title = trim(self::asStr($request->input('title')));
        $target = (float) $request->input('target_value');
        if ($title === '' || $target <= 0) {
            return redirect()->route('govuk-alpha.goals.index', ['tenantSlug' => $tenantSlug, 'status' => 'goal-invalid']);
        }

        $ok = false;
        try {
            $goal = app(\App\Services\GoalService::class)->create($userId, [
                'title' => mb_substr($title, 0, 255),
                'description' => trim(self::asStr($request->input('description'))) ?: null,
                'target_value' => $target,
                'current_value' => 0,
                'deadline' => self::asStr($request->input('deadline')) ?: null,
                'is_public' => $request->boolean('is_public'),
            ]);
            $ok = $goal !== null;
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.goals.index', ['tenantSlug' => $tenantSlug, 'status' => $ok ? 'goal-created' : 'goal-failed']);
    }

    public function incrementGoal(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $userId = $this->alphaAuthGuard($tenantSlug);
        if (is_object($userId)) {
            return $userId;
        }
        abort_unless(TenantContext::hasFeature('goals'), 403);

        $inc = (float) $request->input('increment');
        $status = 'goal-invalid';
        if ($inc > 0) {
            try {
                $status = app(\App\Services\GoalService::class)->incrementProgress($id, $userId, $inc) !== null ? 'goal-updated' : 'goal-failed';
            } catch (\Throwable $e) {
                report($e);
                $status = 'goal-failed';
            }
        }

        return redirect()->route('govuk-alpha.goals.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => $status]);
    }

    public function completeGoal(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $userId = $this->alphaAuthGuard($tenantSlug);
        if (is_object($userId)) {
            return $userId;
        }
        abort_unless(TenantContext::hasFeature('goals'), 403);

        $ok = false;
        try {
            $ok = app(\App\Services\GoalService::class)->complete($id, $userId) !== null;
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.goals.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => $ok ? 'goal-completed' : 'goal-failed']);
    }

    // === Skills directory (ungated — no 'skills' feature flag) ===

    public function skills(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $svc = app(\App\Services\SkillTaxonomyService::class);
        $tree = [];
        try {
            $tree = $svc->getTree(true);
        } catch (\Throwable $e) {
            report($e);
        }

        // Category drill-in: ?category={id} shows the skills breakdown for that
        // category (user / offering / requesting counts), mirroring the React
        // page's expand-a-category behaviour without any JavaScript.
        $categoryId = (int) $request->query('category', 0);
        $selectedCategory = null;
        $categorySkills = [];
        if ($categoryId > 0) {
            try {
                $selectedCategory = $svc->getCategoryById($categoryId);
                if ($selectedCategory !== null) {
                    $categorySkills = $svc->getCategorySkills($categoryId);
                }
            } catch (\Throwable $e) {
                report($e);
            }
        }

        $skillQuery = trim(self::asStr($request->query('skill')));
        $skillMembers = [];
        if ($skillQuery !== '') {
            try {
                $skillMembers = $svc->getMembersWithSkill($skillQuery, 40);
            } catch (\Throwable $e) {
                report($e);
            }
        }

        return $this->view('accessible-frontend::skills', [
            'title' => __('govuk_alpha.skills.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'skillTree' => is_array($tree) ? $tree : [],
            'skillQuery' => $skillQuery,
            'skillMembers' => is_array($skillMembers) ? $skillMembers : [],
            'selectedCategoryId' => $categoryId > 0 ? $categoryId : null,
            'selectedCategory' => is_array($selectedCategory) ? $selectedCategory : null,
            'categorySkills' => is_array($categorySkills) ? $categorySkills : [],
        ]);
    }

    // === Organisations ===

    public function organisations(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('volunteering'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $q = trim(self::asStr($request->query('q')));
        $filters = ['limit' => 30];
        if ($q !== '') {
            $filters['search'] = $q;
        }
        $items = [];
        try {
            $items = \App\Services\VolunteerService::getOrganisations($filters)['items'] ?? [];
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::organisations', [
            'title' => __('govuk_alpha.organisations.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'organisations' => is_array($items) ? $items : [],
            'organisationsQuery' => $q,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    public function organisation(Request $request, string $tenantSlug, int $id): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('volunteering'), 403);
        if ($this->currentUserId() === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $org = null;
        try {
            $org = \App\Services\VolunteerService::getOrganisationById($id);
        } catch (\Throwable $e) {
            report($e);
        }
        abort_if($org === null, 404);

        // WAVE O: depth — opportunities, member reviews and aggregate stats for
        // this organisation. All data is loaded through tenant-scoped service
        // methods (see waveOrgDetailExtras) so a cross-tenant org id 404s above
        // and never leaks another community's volunteering data.
        $extras = $this->waveOrgDetailExtras($id);

        return $this->view('accessible-frontend::organisation-detail', [
            'title' => ($org['name'] ?? '') ?: __('govuk_alpha.organisations.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'organisation' => $org,
            'orgOpportunities' => $extras['opportunities'],
            'orgReviews' => $extras['reviews'],
            'orgStats' => $extras['stats'],
        ]);
    }

    public function storeOrganisation(Request $request, string $tenantSlug): RedirectResponse
    {
        $userId = $this->alphaAuthGuard($tenantSlug);
        if (is_object($userId)) {
            return $userId;
        }
        abort_unless(TenantContext::hasFeature('volunteering'), 403);

        // Bona-fide organisations only: registration is gated behind required
        // identity fields and an explicit terms agreement. Individual volunteers
        // never register — they browse opportunities and log hours instead. The
        // org is created with status=pending so an administrator vets it before
        // it is publicly listed (preserved via VolunteerService::createOrganization).
        $name = trim(self::asStr($request->input('name')));
        $description = trim(self::asStr($request->input('description')));
        $email = trim(self::asStr($request->input('email')));
        $website = trim(self::asStr($request->input('website')));
        $agreedTerms = self::asStr($request->input('agreed_terms'));
        $termsAccepted = in_array(strtolower($agreedTerms), ['1', 'on', 'true'], true);

        $valid = mb_strlen($name) >= 3
            && mb_strlen($description) >= 20
            && filter_var($email, FILTER_VALIDATE_EMAIL) !== false
            && ($website === '' || preg_match('#^https?://#i', $website) === 1)
            && $termsAccepted;

        if (! $valid) {
            return redirect()
                ->route('govuk-alpha.organisations.index', ['tenantSlug' => $tenantSlug, 'status' => 'org-invalid'])
                ->withInput();
        }

        $ok = false;
        try {
            $id = \App\Services\VolunteerService::createOrganization($userId, [
                'name' => mb_substr($name, 0, 255),
                'description' => $description,
                'contact_email' => $email,
                'website' => $website ?: null,
            ]);
            $ok = $id !== null;
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.organisations.index', ['tenantSlug' => $tenantSlug, 'status' => $ok ? 'org-submitted' : 'org-failed']);
    }

    // === Saved / bookmarks (ungated, auth-only) ===

    public function saved(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $typeFilter = self::asStr($request->query('type'));
        $items = [];
        try {
            $typeArg = $typeFilter !== '' ? $typeFilter : null;
            $paginator = app(\App\Services\BookmarkService::class)->getUserBookmarks($userId, $typeArg, null, 1, 50);
            $items = method_exists($paginator, 'items') ? $paginator->items() : (array) $paginator;
            $items = array_map(static fn ($b) => is_array($b) ? $b : (array) $b, $items);
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::saved', [
            'title' => __('govuk_alpha.saved.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'saved',
            'savedItems' => is_array($items) ? $items : [],
            'savedTypeFilter' => $typeFilter,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /** Remove a single bookmarked item (toggle off). */
    public function destroySaved(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $type = self::asStr($request->input('type'));
        $id = (int) $request->input('id');
        $ok = false;
        if ($type !== '' && $id > 0) {
            try {
                app(\App\Services\BookmarkService::class)->toggle($userId, $type, $id);
                $ok = true;
            } catch (\Throwable $e) {
                report($e);
            }
        }

        return redirect()->route('govuk-alpha.saved.index', [
            'tenantSlug' => $tenantSlug,
            'status' => $ok ? 'bookmark-removed' : 'bookmark-failed',
        ]);
    }

    // === Resources ===

    public function resources(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('resources'), 403);
        if ($this->currentUserId() === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $q = trim(self::asStr($request->query('q')));
        $filters = ['limit' => 30];
        if ($q !== '') {
            $filters['search'] = $q;
        }
        $items = [];
        try {
            $items = app(\App\Services\ResourceService::class)->getAll($filters)['items'] ?? [];
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::resources', [
            'title' => __('govuk_alpha.resources.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'resources' => is_array($items) ? $items : [],
            'resourcesQuery' => $q,
        ]);
    }

    // === Jobs / vacancies ===

    public function jobs(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('job_vacancies'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $perPage = 12;
        $offset = max(0, (int) $request->query('offset', 0));
        $f = $this->jobsFilters($request);

        // The service supports offset pagination (returns total + has_more) when an
        // 'offset' key is present, so the GOV.UK pagination block can show progress.
        $query = ['limit' => $perPage, 'offset' => $offset, 'status' => 'open', 'sort' => $f['sort']];
        if ($f['q'] !== '') {
            $query['search'] = $f['q'];
        }
        if ($f['type'] !== '') {
            $query['type'] = $f['type'];
        }
        if ($f['commitment'] !== '') {
            $query['commitment'] = $f['commitment'];
        }
        if ($f['remote']) {
            $query['is_remote'] = 1;
        }

        $items = [];
        $meta = ['total' => 0, 'has_more' => false, 'offset' => $offset, 'per_page' => $perPage];
        try {
            $result = app(\App\Services\JobVacancyService::class)->getAll($query, $userId);
            $items = is_array($result['items'] ?? null) ? $result['items'] : [];
            $meta['total'] = (int) ($result['total'] ?? 0);
            $meta['has_more'] = (bool) ($result['has_more'] ?? false);
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::jobs', [
            'title' => __('govuk_alpha.jobs.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'jobs' => $items,
            'jobsQuery' => $f['q'],
            'jobsFilters' => $f,
            'jobsMeta' => $meta,
            'jobsActiveTab' => 'browse',
        ]);
    }

    public function job(Request $request, string $tenantSlug, int $id): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('job_vacancies'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $svc = app(\App\Services\JobVacancyService::class);
        $job = null;
        try {
            // legacyGetById forwards $userId so has_applied/is_saved resolve — the
            // bare getById() leaves has_applied=false and shows the apply form even
            // to members who already applied.
            $job = $svc->legacyGetById($id, $userId);
        } catch (\Throwable $e) {
            report($e);
        }
        abort_if($job === null, 404);

        // Count the view, mirroring the React detail page. Best-effort: a failure
        // here must never block rendering.
        try {
            $svc->incrementViews($id, $userId);
        } catch (\Throwable $e) {
            report($e);
        }

        // Skills match for the viewer — only meaningful when the role lists skills.
        $match = null;
        if (!empty($job['skills_required'])) {
            try {
                $match = $svc->calculateMatchPercentage($userId, $id);
            } catch (\Throwable $e) {
                report($e);
            }
        }

        // Similar opportunities (same tenant, by title overlap), excluding this one.
        $similar = [];
        try {
            $similar = array_values(array_filter(
                $svc->findSimilarJobs((string) ($job['title'] ?? ''), null, TenantContext::getId()),
                static fn ($s) => (int) ($s['id'] ?? 0) !== $id
            ));
            $similar = array_slice($similar, 0, 5);
        } catch (\Throwable $e) {
            report($e);
        }

        $cvUploadEnabled = filter_var(
            \App\Services\JobConfigurationService::get(\App\Services\JobConfigurationService::CONFIG_ENABLE_CV_UPLOAD, true),
            FILTER_VALIDATE_BOOLEAN
        );

        return $this->view('accessible-frontend::job-detail', [
            'title' => ($job['title'] ?? '') ?: __('govuk_alpha.jobs.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'job' => $job,
            'jobMatch' => is_array($match) ? $match : null,
            'similarJobs' => $similar,
            'isJobOwner' => (int) ($job['user_id'] ?? 0) === $userId,
            'cvUploadEnabled' => $cvUploadEnabled,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    public function applyJob(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('job_vacancies'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $cover = trim(self::asStr($request->input('cover_letter')));

        // Mirror JobVacanciesController::apply config gates.
        $requireCover = filter_var(
            \App\Services\JobConfigurationService::get(\App\Services\JobConfigurationService::CONFIG_REQUIRE_COVER_MESSAGE, false),
            FILTER_VALIDATE_BOOLEAN
        );
        if ($requireCover && $cover === '') {
            return redirect()->route('govuk-alpha.jobs.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'cover-required']);
        }

        $tenantId = TenantContext::getId();
        $jobOwnerId = \App\Models\JobVacancy::where('tenant_id', $tenantId)
            ->where('id', $id)
            ->value('user_id');
        if ($jobOwnerId !== null && (int) $jobOwnerId !== $userId) {
            try {
                app(\App\Services\SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
                    $userId,
                    (int) $jobOwnerId,
                    $tenantId,
                    'job_application',
                );
            } catch (\App\Exceptions\SafeguardingPolicyException $e) {
                return redirect()->route('govuk-alpha.jobs.show', [
                    'tenantSlug' => $tenantSlug,
                    'id' => $id,
                    'status' => $e->reasonCode === 'SAFEGUARDING_POLICY_UNAVAILABLE'
                        ? 'apply-safeguarding-unavailable'
                        : 'apply-safeguarding-restricted',
                ]);
            }
        }

        // Optional CV upload (PDF/DOC/DOCX ≤5MB), validated exactly as the React
        // API path: extension + MIME whitelist, sanitised filename, local disk.
        $cvPath = null;
        $cvFilename = null;
        $cvSize = null;
        if ($request->hasFile('cv')) {
            $cvEnabled = filter_var(
                \App\Services\JobConfigurationService::get(\App\Services\JobConfigurationService::CONFIG_ENABLE_CV_UPLOAD, true),
                FILTER_VALIDATE_BOOLEAN
            );
            if (! $cvEnabled) {
                return redirect()->route('govuk-alpha.jobs.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'apply-failed']);
            }

            $file = $request->file('cv');
            $allowed = ['pdf', 'doc', 'docx'];
            $ext = strtolower((string) $file->getClientOriginalExtension());
            if (! in_array($ext, $allowed, true)) {
                return redirect()->route('govuk-alpha.jobs.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'cv-invalid']);
            }
            if ($file->getSize() > 5 * 1024 * 1024) {
                return redirect()->route('govuk-alpha.jobs.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'cv-too-large']);
            }
            $allowedMimes = [
                'pdf'  => ['application/pdf'],
                'doc'  => ['application/msword', 'application/vnd.ms-office'],
                'docx' => ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'],
            ];
            $detectedMime = $file->getMimeType();
            if (! $detectedMime || ! in_array($detectedMime, $allowedMimes[$ext], true)) {
                return redirect()->route('govuk-alpha.jobs.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'cv-invalid']);
            }
            $rawName = basename((string) $file->getClientOriginalName());
            $safeName = preg_replace('/[^A-Za-z0-9._-]/', '_', $rawName) ?: 'cv';
            $safeName = substr($safeName, 0, 120);
            try {
                $cvPath = $file->store('job-applications/' . TenantContext::getId(), 'local');
                $cvFilename = $safeName;
                $cvSize = $file->getSize();
            } catch (\Throwable $e) {
                report($e);
                return redirect()->route('govuk-alpha.jobs.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'apply-failed']);
            }
        }

        $ok = false;
        try {
            $ok = app(\App\Services\JobVacancyService::class)->apply($id, $userId, [
                'cover_letter' => mb_substr($cover, 0, 5000),
                'cv_path' => $cvPath,
                'cv_filename' => $cvFilename,
                'cv_size' => $cvSize,
            ]) !== null;
        } catch (\App\Exceptions\SafeguardingPolicyException $e) {
            $safeguardingStatus = $e->reasonCode === 'SAFEGUARDING_POLICY_UNAVAILABLE'
                ? 'apply-safeguarding-unavailable'
                : 'apply-safeguarding-restricted';
        } catch (\Throwable $e) {
            report($e);
        }

        // Clean up an orphaned CV upload when the application itself was rejected
        // (already applied, vacancy closed, etc.) — mirrors the API controller.
        if (! $ok && $cvPath !== null) {
            try {
                \Illuminate\Support\Facades\Storage::disk('local')->delete($cvPath);
            } catch (\Throwable $e) {
                // best-effort cleanup
            }
        }

        // The service does not send the applicant/employer emails — the API
        // controller does. Mirror that here so the accessible path notifies too
        // (only on a genuinely new application).
        if ($ok) {
            $this->dispatchJobApplicationNotifications($id, $userId);
        }

        return redirect()->route('govuk-alpha.jobs.show', [
            'tenantSlug' => $tenantSlug,
            'id' => $id,
            'status' => $ok ? 'applied' : ($safeguardingStatus ?? 'apply-failed'),
        ]);
    }

    /**
     * Applicant-confirmation + employer-alert notifications for a new job
     * application, mirroring JobVacanciesController::apply. Every send is wrapped
     * in LocaleContext (recipient's language) and best-effort: a failure here must
     * never change the application outcome.
     */
    private function dispatchJobApplicationNotifications(int $jobId, int $applicantId): void
    {
        $tenantId = TenantContext::getId();
        $job = null;

        // Bell + push to the job owner.
        try {
            $job = \Illuminate\Support\Facades\DB::selectOne(
                'SELECT user_id, title FROM job_vacancies WHERE id = ? AND tenant_id = ?',
                [$jobId, $tenantId]
            );
            if ($job && (int) $job->user_id !== $applicantId) {
                $applicant = \App\Models\User::find($applicantId);
                $jobOwner = \App\Models\User::find((int) $job->user_id);
                \App\I18n\LocaleContext::withLocale($jobOwner, function () use ($applicant, $job, $jobId) {
                    $applicantName = $applicant->first_name ?? $applicant->name ?? __('emails.common.fallback_someone');
                    $msg = __('svc_notifications.job_application.owner_applied', ['name' => $applicantName, 'title' => $job->title]);
                    \App\Models\Notification::createNotification((int) $job->user_id, $msg, "/jobs/{$jobId}/applications", 'job_application');
                    \App\Services\NotificationDispatcher::fanOutPush((int) $job->user_id, 'job_application', $msg, "/jobs/{$jobId}/applications");
                });
            }
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('Alpha job application notification failed', ['vacancy_id' => $jobId, 'error' => $e->getMessage()]);
        }

        // Email confirmation to the applicant.
        try {
            $job = $job ?? \Illuminate\Support\Facades\DB::selectOne('SELECT user_id, title FROM job_vacancies WHERE id = ? AND tenant_id = ?', [$jobId, $tenantId]);
            if ($job) {
                $applicantUser = \Illuminate\Support\Facades\DB::table('users')->where('id', $applicantId)->where('tenant_id', $tenantId)->select(['email', 'first_name', 'name', 'preferred_language'])->first();
                if ($applicantUser && !empty($applicantUser->email)) {
                    \App\I18n\LocaleContext::withLocale($applicantUser, function () use ($applicantUser, $job, $jobId, $tenantId) {
                        $firstName = $applicantUser->first_name ?? $applicantUser->name ?? __('emails.common.fallback_name');
                        $community = TenantContext::getName();
                        $jobTitle = htmlspecialchars((string) $job->title, ENT_QUOTES, 'UTF-8');
                        $appUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/jobs/' . $jobId;
                        $html = \App\Core\EmailTemplateBuilder::make()->theme('brand')
                            ->title(__('emails_commerce.job_application_applicant.title'))
                            ->greeting($firstName)
                            ->paragraph(__('emails_commerce.job_application_applicant.body', ['job_title' => $jobTitle]))
                            ->paragraph(__('emails_commerce.job_application_applicant.next_steps'))
                            ->button(__('emails_commerce.job_application_applicant.cta'), $appUrl)
                            ->render();
                        \App\Services\EmailDispatchService::sendRaw($applicantUser->email, __('emails_commerce.job_application_applicant.subject', ['job_title' => $jobTitle, 'community' => $community]), $html, null, null, null, 'job_application', ['tenant_id' => $tenantId]);
                    });
                }
            }
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('Alpha applicant confirmation email failed: ' . $e->getMessage());
        }

        // Email alert to the job poster / employer.
        try {
            if ($job && (int) $job->user_id !== $applicantId) {
                $posterUser = \Illuminate\Support\Facades\DB::table('users')->where('id', $job->user_id)->where('tenant_id', $tenantId)->select(['email', 'first_name', 'name', 'preferred_language'])->first();
                if ($posterUser && !empty($posterUser->email)) {
                    $applicant = \App\Models\User::find($applicantId);
                    \App\I18n\LocaleContext::withLocale($posterUser, function () use ($posterUser, $applicant, $job, $jobId, $tenantId) {
                        $posterFirst = $posterUser->first_name ?? $posterUser->name ?? __('emails.common.fallback_name');
                        $community = TenantContext::getName();
                        $jobTitle = htmlspecialchars((string) $job->title, ENT_QUOTES, 'UTF-8');
                        $applicantName = $applicant ? (trim(($applicant->first_name ?? '') . ' ' . ($applicant->last_name ?? '')) ?: ($applicant->name ?? __('emails.common.fallback_someone'))) : __('emails.common.fallback_someone');
                        $reviewUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/jobs/' . $jobId . '/applications';
                        $html = \App\Core\EmailTemplateBuilder::make()->theme('federation')
                            ->title(__('emails_commerce.job_application_employer.title'))
                            ->greeting($posterFirst)
                            ->paragraph(__('emails_commerce.job_application_employer.body', ['applicant_name' => htmlspecialchars($applicantName, ENT_QUOTES, 'UTF-8'), 'job_title' => $jobTitle]))
                            ->button(__('emails_commerce.job_application_employer.cta'), $reviewUrl)
                            ->render();
                        \App\Services\EmailDispatchService::sendRaw($posterUser->email, __('emails_commerce.job_application_employer.subject', ['job_title' => $jobTitle, 'community' => $community]), $html, null, null, null, 'job_application', ['tenant_id' => $tenantId]);
                    });
                }
            }
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('Alpha employer alert email failed: ' . $e->getMessage());
        }
    }

    // === Ideation challenges ===

    public function ideation(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('ideation_challenges'), 403);
        if ($this->currentUserId() === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $statusFilter = self::asStr($request->query('status'));
        $query = trim(self::asStr($request->query('q')));
        $filters = ['limit' => 30];
        if ($statusFilter !== '') {
            $filters['status'] = $statusFilter;
        }
        if ($query !== '') {
            $filters['search'] = $query;
        }
        $items = [];
        try {
            $items = app(\App\Services\IdeationChallengeService::class)->getAll($filters)['items'] ?? [];
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::ideation', [
            'title' => __('govuk_alpha.ideation.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'challenges' => is_array($items) ? $items : [],
            'ideationStatus' => $statusFilter,
            'ideationQuery' => $query,
        ]);
    }

    public function ideationChallenge(Request $request, string $tenantSlug, int $id): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('ideation_challenges'), 403);
        if ($this->currentUserId() === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $svc = app(\App\Services\IdeationChallengeService::class);
        $challenge = null;
        $ideas = [];
        try {
            $challenge = $svc->getById($id);
        } catch (\Throwable $e) {
            report($e);
        }
        abort_if($challenge === null, 404);
        try {
            $ideas = $svc->getIdeas($id, ['limit' => 30, 'sort' => 'votes'])['items'] ?? [];
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::ideation-detail', [
            'title' => ($challenge['title'] ?? '') ?: __('govuk_alpha.ideation.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'challenge' => $challenge,
            'ideas' => is_array($ideas) ? $ideas : [],
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    public function submitIdea(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('ideation_challenges'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $title = trim(self::asStr($request->input('idea_title')));
        $content = trim(self::asStr($request->input('idea_content')));
        if ($title === '') {
            return redirect()->route('govuk-alpha.ideation.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'idea-invalid'])->withFragment('submit');
        }
        $ok = false;
        try {
            $ok = app(\App\Services\IdeationChallengeService::class)->submitIdea($id, $userId, [
                'title' => mb_substr($title, 0, 255),
                'description' => mb_substr($content, 0, 5000),
            ]) > 0;
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.ideation.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => $ok ? 'idea-submitted' : 'idea-failed']);
    }

    public function voteIdea(Request $request, string $tenantSlug, int $challengeId, int $ideaId): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('ideation_challenges'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $ok = false;
        try {
            $ok = app(\App\Services\IdeationChallengeService::class)->voteIdea($ideaId, $userId) !== null;
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.ideation.show', ['tenantSlug' => $tenantSlug, 'id' => $challengeId, 'status' => $ok ? 'idea-voted' : 'idea-failed'])->withFragment('ideas');
    }

    // === Marketplace ===

    public function marketplace(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('marketplace'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $q = trim(self::asStr($request->query('q')));
        $categoryId = (int) self::asStr($request->query('category_id'));
        $filters = ['limit' => 30, 'current_user_id' => $userId];
        if ($q !== '') {
            $filters['search'] = $q;
        }
        if ($categoryId > 0) {
            $filters['category_id'] = $categoryId;
        }
        $items = [];
        $categories = [];
        try {
            $items = \App\Services\MarketplaceListingService::getAll($filters)['items'] ?? [];
            $items = array_map(static fn ($i) => is_array($i) ? $i : (array) $i, $items);
            $rawCats = \App\Services\MarketplaceListingService::getCategories();
            $categories = is_array($rawCats) ? array_map(static fn ($c) => is_array($c) ? $c : (array) $c, $rawCats) : [];
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::marketplace', [
            'title' => __('govuk_alpha.marketplace.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'listings' => is_array($items) ? $items : [],
            'marketplaceQuery' => $q,
            'categories' => $categories,
            'marketplaceCategoryId' => $categoryId > 0 ? $categoryId : null,
        ]);
    }

    public function marketplaceItem(Request $request, string $tenantSlug, int $id): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('marketplace'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $item = null;
        try {
            $item = \App\Services\MarketplaceListingService::getById($id, $userId);
        } catch (\Throwable $e) {
            report($e);
        }
        abort_if($item === null, 404);

        return $this->view('accessible-frontend::marketplace-detail', [
            'title' => ($item['title'] ?? '') ?: __('govuk_alpha.marketplace.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'item' => $item,
            'currentUserId' => $userId,
        ]);
    }

    // === Courses ===

    public function courses(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('courses'), 403);
        if ($this->currentUserId() === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $q = trim(self::asStr($request->query('q')));
        $filters = ['per_page' => 30, 'include_member_only' => true];
        if ($q !== '') {
            $filters['search'] = $q;
        }

        // Category + level filters mirror the React CoursesPage (CourseService
        // ::browse supports category_id + level). Only whitelisted level values
        // reach the query.
        $categoryId = (int) $request->query('category', 0);
        if ($categoryId > 0) {
            $filters['category_id'] = $categoryId;
        }
        $level = strtolower(trim(self::asStr($request->query('level'))));
        $allowedLevels = ['beginner', 'intermediate', 'advanced'];
        if (! in_array($level, $allowedLevels, true)) {
            $level = '';
        }
        if ($level !== '') {
            $filters['level'] = $level;
        }

        $items = [];
        try {
            $items = \App\Services\CourseService::browse($filters)['items'] ?? [];
            $items = array_map(static fn ($c) => is_array($c) ? $c : $c->toArray(), $items);
        } catch (\Throwable $e) {
            report($e);
        }

        $categories = [];
        try {
            $categories = \App\Services\CourseCategoryService::all();
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::courses', [
            'title' => __('govuk_alpha.courses.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'courses' => is_array($items) ? $items : [],
            'coursesQuery' => $q,
            'courseCategories' => is_array($categories) ? $categories : [],
            'courseCategoryId' => $categoryId > 0 ? $categoryId : null,
            'courseLevel' => $level,
        ]);
    }

    public function course(Request $request, string $tenantSlug, int $id): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('courses'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $course = null;
        $isEnrolled = false;
        $isCompleted = false;
        $canReview = false;
        $prerequisites = [];
        $reviews = [];
        $ratingAvg = 0.0;
        $ratingCount = 0;
        try {
            $course = \App\Services\CourseService::findById($id);
            if ($course !== null) {
                $isEnrolled = \App\Services\CourseEnrollmentService::isEnrolled($id, $userId);
                // Completion drives the certificate-download affordance.
                $enrollment = \App\Services\CourseEnrollmentService::find($id, $userId);
                $isCompleted = $enrollment !== null && ($enrollment->status ?? '') === 'completed';
                // Only active/completed enrolees may review (mirrors the API).
                $canReview = $enrollment !== null && in_array($enrollment->status ?? '', ['active', 'completed'], true);
                // Prerequisite courses + per-learner completion (mirrors React).
                $prerequisites = \App\Services\CoursePrerequisiteService::statusFor($course, $userId);

                // Approved ratings/reviews + the cached aggregate (CourseReview is
                // tenant-scoped via HasTenantScope; bodies are escaped in the view).
                $ratingAvg = (float) ($course->rating_avg ?? 0);
                $ratingCount = (int) ($course->rating_count ?? 0);
                $reviews = \App\Models\CourseReview::where('course_id', $id)
                    ->where('status', 'approved')
                    ->with('user:id,first_name,last_name')
                    ->orderByDesc('created_at')
                    ->limit(50)
                    ->get(['id', 'course_id', 'user_id', 'rating', 'body', 'created_at'])
                    ->map(static fn ($r) => [
                        'rating' => (int) $r->rating,
                        'body' => (string) ($r->body ?? ''),
                        'created_at' => $r->created_at?->toIso8601String(),
                        'name' => $r->user ? trim(($r->user->first_name ?? '') . ' ' . ($r->user->last_name ?? '')) : '',
                    ])
                    ->all();
            }
        } catch (\Throwable $e) {
            report($e);
        }
        abort_if($course === null, 404);

        return $this->view('accessible-frontend::course-detail', [
            'title' => ($course->title ?? '') ?: __('govuk_alpha.courses.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'course' => $course->toArray(),
            'isEnrolled' => $isEnrolled,
            'isCompleted' => $isCompleted,
            'canReview' => $canReview,
            'prerequisites' => is_array($prerequisites) ? $prerequisites : [],
            'reviews' => is_array($reviews) ? $reviews : [],
            'ratingAvg' => $ratingAvg,
            'ratingCount' => $ratingCount,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    public function enrolCourse(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('courses'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $status = 'enrol-failed';
        try {
            $course = \App\Services\CourseService::findById($id);
            if ($course === null) {
                abort(404);
            }
            $cost = (float) ($course->credit_cost ?? 0);
            if ($cost > 0) {
                // Credit-priced: this moves time credits. enrollWithPayment throws
                // a RuntimeException carrying the wallet failure reason.
                \App\Services\CourseEnrollmentService::enrollWithPayment($course, $userId);
            } else {
                \App\Services\CourseEnrollmentService::enroll($id, $userId);
            }
            $status = 'enrolled';
        } catch (\RuntimeException $e) {
            $status = stripos($e->getMessage(), 'insufficient') !== false ? 'insufficient-credits' : 'enrol-failed';
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.courses.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => $status]);
    }

    /**
     * Download (view) the completion certificate for a course. Mirrors
     * CourseEnrollmentController::certificate: requires an enrolment in the
     * 'completed' state, then issues (idempotently) + renders the certificate
     * HTML as a standalone printable page.
     */
    public function courseCertificate(Request $request, string $tenantSlug, int $id): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('courses'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $enrollment = \App\Services\CourseEnrollmentService::find($id, $userId);
        if ($enrollment === null) {
            return redirect()->route('govuk-alpha.courses.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'enrol-required']);
        }
        if (($enrollment->status ?? '') !== 'completed') {
            return redirect()->route('govuk-alpha.courses.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'certificate-locked']);
        }

        try {
            $cert = \App\Services\CourseCertificateService::issue($id, $userId);
            $html = \App\Services\CourseCertificateService::generateHtml($cert);
        } catch (\Throwable $e) {
            report($e);
            return redirect()->route('govuk-alpha.courses.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'certificate-failed']);
        }

        // The generated HTML is a complete, self-contained certificate document
        // (its own <html>), so it is returned directly rather than wrapped in the
        // alpha layout — the learner can print or save it.
        return response($html, 200)->header('Content-Type', 'text/html; charset=UTF-8');
    }

    /**
     * Submit (or update) a course rating/review. Mirrors
     * CourseEnrollmentController::review: only an active/completed enrolee may
     * review, rating 1–5, one row per (course,user) via updateOrCreate, then the
     * cached course aggregate is recomputed. CourseReview is tenant-scoped.
     */
    public function submitCourseReview(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('courses'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $enrollment = \App\Services\CourseEnrollmentService::find($id, $userId);
        if ($enrollment === null || ! in_array($enrollment->status ?? '', ['active', 'completed'], true)) {
            return redirect()->route('govuk-alpha.courses.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'review-not-enrolled'])->withFragment('reviews');
        }

        $rating = (int) $request->input('rating');
        if ($rating < 1 || $rating > 5) {
            return redirect()->route('govuk-alpha.courses.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'review-invalid'])->withFragment('reviews');
        }

        try {
            \App\Models\CourseReview::updateOrCreate(
                ['course_id' => $id, 'user_id' => $userId],
                ['rating' => $rating, 'body' => mb_substr(trim(self::asStr($request->input('body'))), 0, 2000), 'status' => 'approved']
            );

            // Recompute the cached aggregate from approved reviews (tenant-scoped
            // via the CourseReview model scope), then write it to the course.
            $agg = \App\Models\CourseReview::where('course_id', $id)
                ->where('status', 'approved')
                ->selectRaw('AVG(rating) as avg_rating, COUNT(*) as cnt')
                ->first();
            \App\Models\Course::where('id', $id)
                ->where('tenant_id', TenantContext::getId())
                ->update([
                    // Aggregate-only first() returns a row over an empty set, but
                    // ?-> hardens against any null defensively.
                    'rating_avg' => round((float) ($agg?->avg_rating ?? 0), 2),
                    'rating_count' => (int) ($agg?->cnt ?? 0),
                ]);
        } catch (\Throwable $e) {
            report($e);
            return redirect()->route('govuk-alpha.courses.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'review-failed'])->withFragment('reviews');
        }

        return redirect()->route('govuk-alpha.courses.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'review-saved'])->withFragment('reviews');
    }

    // === Podcasts ===

    public function podcasts(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('podcasts'), 403);
        if ($this->currentUserId() === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $podcastQuery = trim(self::asStr($request->query('q')));
        $podcastSort  = trim(self::asStr($request->query('sort')));
        $allowedSorts = ['newest', 'title', 'episodes', 'followers'];
        if (!in_array($podcastSort, $allowedSorts, true)) {
            $podcastSort = 'newest';
        }
        $podcastPage = max(1, (int) $request->query('page', 1));
        $browseFilters = [
            'page' => $podcastPage,
            'per_page' => 30,
            'sort' => $podcastSort,
            'include_member_only' => true,
        ];
        if ($podcastQuery !== '') {
            $browseFilters['search'] = $podcastQuery;
        }

        // Category filter (mirrors React). Only a category present in the tenant's
        // own distinct list reaches the query.
        $podcastCategories = [];
        try {
            $podcastCategories = \App\Models\PodcastShow::query()
                ->published()
                ->whereIn('visibility', ['public', 'members'])
                ->whereNotNull('category')
                ->where('category', '!=', '')
                ->distinct()
                ->orderBy('category')
                ->pluck('category')
                ->map(static fn ($category): string => (string) $category)
                ->all();
        } catch (\Throwable $e) {
            report($e);
        }
        $podcastCategory = trim(self::asStr($request->query('category')));
        if ($podcastCategory !== '' && ! in_array($podcastCategory, $podcastCategories, true)) {
            $podcastCategory = '';
        }
        if ($podcastCategory !== '') {
            $browseFilters['category'] = $podcastCategory;
        }

        $items = [];
        $podcastTotal = 0;
        $podcastPerPage = 30;
        try {
            $browseResult = \App\Services\PodcastService::browse($browseFilters);
            $items = $browseResult['items'] ?? [];
            $podcastTotal = (int) ($browseResult['total'] ?? 0);
            $podcastPage = (int) ($browseResult['page'] ?? $podcastPage);
            $podcastPerPage = (int) ($browseResult['per_page'] ?? $podcastPerPage);
            $items = array_map(static fn ($s) => is_array($s) ? $s : $s->toArray(), $items);
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::podcasts', [
            'title' => __('govuk_alpha.podcasts.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'shows' => is_array($items) ? $items : [],
            'podcastQuery' => $podcastQuery,
            'podcastSort' => $podcastSort,
            'podcastCategory' => $podcastCategory,
            'podcastCategories' => is_array($podcastCategories) ? $podcastCategories : [],
            'podcastPage' => $podcastPage,
            'podcastTotal' => $podcastTotal,
            'podcastPerPage' => $podcastPerPage,
            'canAccessPodcastStudio' => $this->commerceCanAuthorPodcasts(),
        ]);
    }

    public function podcast(Request $request, string $tenantSlug, int $id): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('podcasts'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $show = null;
        $showData = [];
        $episodes = [];
        $isSubscribed = false;
        $isAdmin = $this->commercePodcastViewerIsAdmin($userId);
        try {
            $show = \App\Services\PodcastService::findShowById($id);
            // Defence in depth: never surface another tenant's show by id.
            if ($show !== null && (int) $show->tenant_id !== TenantContext::getId()) {
                $show = null;
            }
            if ($show !== null && !\App\Services\PodcastService::canViewShow($show, $userId, $isAdmin)) {
                $show = null;
            }
            if ($show !== null) {
                // Check subscription status for the current member.
                $isSubscribed = \Illuminate\Support\Facades\DB::table('podcast_show_subscriptions')
                    ->where('tenant_id', TenantContext::getId())
                    ->where('show_id', $show->id)
                    ->where('user_id', $userId)
                    ->exists();

                // Only published, approved, released episodes — findShowById does not
                // scope the episodes relation, so the raw relation would include
                // drafts/pending uploads.
                foreach ($show->episodes()->orderByDesc('published_at')->orderByDesc('id')->get() as $ep) {
                    $ep->setRelation('show', $show);
                    if (!\App\Services\PodcastService::canViewEpisode($ep, $show, $userId, $isAdmin)) {
                        continue;
                    }
                    $url = '';
                    try {
                        \App\Services\PodcastService::prepareEpisodeForResponse($ep, $userId, $isAdmin);
                        $url = (string) ($ep->audio_url ?? '');
                    } catch (\Throwable $e) {
                        $url = '';
                    }
                    // Only surface episodes with genuinely playable audio — this also
                    // hides pending/draft uploads (their URL is a non-http placeholder).
                    if (!\Illuminate\Support\Str::startsWith($url, ['http://', 'https://', '/'])) {
                        continue;
                    }
                    $episodes[] = [
                        'id' => (int) $ep->id,
                        'title' => (string) ($ep->title ?? ''),
                        'description' => (string) ($ep->description ?? ''),
                        'audio_url' => $url,
                    ];
                }

                $rssEnabled = (bool) \App\Services\PodcastConfigurationService::get(
                    \App\Services\PodcastConfigurationService::CONFIG_ENABLE_RSS_FEED
                ) && $show->status === 'published'
                    && $show->moderation_status === 'approved'
                    && $show->visibility === 'public';
                $showData = [
                    'id' => (int) $show->id,
                    'title' => (string) ($show->title ?? ''),
                    'description' => (string) ($show->description ?? ''),
                    'artwork_url' => (string) ($show->artwork_url ?? ''),
                    'owner' => $show->owner ? ['name' => (string) ($show->owner->name ?? '')] : null,
                    'rss_enabled' => $rssEnabled,
                    'rss_url' => $rssEnabled
                        ? rtrim((string) config('app.url'), '/') . '/api/v2/podcasts/feed/'
                            . TenantContext::getId() . '/' . rawurlencode((string) $show->slug) . '.xml'
                        : '',
                ];
            }
        } catch (\Throwable $e) {
            report($e);
        }
        abort_if($show === null, 404);

        return $this->view('accessible-frontend::podcast-detail', [
            'title' => ($show->title ?? '') ?: __('govuk_alpha.podcasts.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'show' => $showData,
            'episodes' => $episodes,
            'isSubscribed' => $isSubscribed,
            'currentUserId' => $userId,
        ]);
    }

    // === Coupons ===

    public function coupons(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('merchant_coupons'), 403);
        if ($this->currentUserId() === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $items = [];
        try {
            $rows = \App\Services\MerchantCouponService::listForMember();
            foreach ($rows as $c) {
                $c = is_array($c) ? (object) $c : $c;
                $items[] = [
                    'id' => (int) ($c->id ?? 0),
                    'code' => (string) ($c->code ?? ''),
                    'title' => (string) ($c->title ?? ''),
                    'description' => (string) ($c->description ?? ''),
                    'discount_type' => (string) ($c->discount_type ?? ''),
                    'discount_value' => $c->discount_value ?? null,
                    'valid_until' => $c->valid_until ?? null,
                ];
            }
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::coupons', [
            'title' => __('govuk_alpha.coupons.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'coupons' => $items,
        ]);
    }

    // === Member premium ===

    public function premium(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('member_premium'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $tenantId = TenantContext::getId();
        $tiers = [];
        $currentTier = null;
        try {
            $tiers = \App\Services\MemberPremiumService::listTiers($tenantId);
            $tiers = array_map(static fn ($t) => is_array($t) ? $t : (array) $t, is_array($tiers) ? $tiers : []);
            $currentTier = \App\Services\MemberPremiumService::getMemberTier($userId);
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::premium', [
            'title' => __('govuk_alpha.premium.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'tiers' => $tiers,
            'currentTier' => is_array($currentTier) ? $currentTier : null,
            'currency' => \App\Core\TenantContext::getCurrency(),
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    public function subscribePremium(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('member_premium'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $tierId = (int) $request->input('tier_id');
        $rawInterval = self::asStr($request->input('interval'));
        $interval = $rawInterval === 'yearly' ? 'yearly' : ($rawInterval === 'year' ? 'yearly' : 'monthly');
        $returnUrl = route('govuk-alpha.premium.return', ['tenantSlug' => $tenantSlug, 'status' => 'success']);

        try {
            $session = \App\Services\MemberPremiumService::createCheckoutSession($userId, $tierId, $interval, $returnUrl);
            $url = self::asStr($session['checkout_url'] ?? '');
            if ($url !== '') {
                return redirect()->away($url);
            }
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.premium.index', ['tenantSlug' => $tenantSlug, 'status' => 'subscribe-failed']);
    }

    // === Clubs (Vereine) — public directory, no feature flag (gated by club orgs existing) ===

    public function clubs(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        if ($this->currentUserId() === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $q = trim(self::asStr($request->query('q')));
        $tenantId = TenantContext::getId();

        // Clubs has no feature flag — the directory only exists for tenants that
        // actually run club organisations. 404 for everyone else so the endpoint
        // is not exposed (mirrors the Explore-card existence gate).
        $tenantHasClubs = \Illuminate\Support\Facades\DB::table('vol_organizations')
            ->where('tenant_id', $tenantId)
            ->where('org_type', 'club')
            ->where('status', 'active')
            ->exists();
        abort_unless($tenantHasClubs, 404);

        $conditions = ['o.tenant_id = ?', "o.org_type = 'club'", "o.status = 'active'"];
        $params = [$tenantId];
        if ($q !== '') {
            $conditions[] = '(o.name LIKE ? OR o.description LIKE ?)';
            $pattern = '%' . addcslashes($q, '%_\\') . '%';
            $params[] = $pattern;
            $params[] = $pattern;
        }
        $where = implode(' AND ', $conditions);

        $clubs = [];
        try {
            $rows = \Illuminate\Support\Facades\DB::select(
                "SELECT o.id, o.name, o.description, o.logo_url, o.contact_email, o.website, o.meeting_schedule,
                    (SELECT COUNT(DISTINCT om.user_id) FROM org_members om
                     WHERE om.organization_id = o.id AND om.org_type = 'volunteer' AND om.status = 'active') AS member_count
                 FROM vol_organizations o WHERE {$where} ORDER BY o.name ASC LIMIT 100",
                $params
            );
            $clubs = array_map(static fn ($r) => (array) $r, $rows);
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::clubs', [
            'title' => __('govuk_alpha.clubs.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'clubs' => $clubs,
            'clubsQuery' => $q,
        ]);
    }

    // === Federation — the network hub + core flows ===

    /**
     * Federation hub: network stats, an opt-in CTA when the member is not yet
     * opted in, a preview of partner communities, and quick links into the rest
     * of the federation surface. Mirrors FederationV2Controller::status().
     */
    public function federation(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('federation'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $tenantId = TenantContext::getId();
        $stats = $this->federationStats($tenantId, $userId);
        $loadError = false;

        $partners = [];
        try {
            $partners = $this->federationPartnersForDisplay($tenantId);
        } catch (\Throwable $e) {
            report($e);
            $loadError = true;
        }

        // Recent federation activity — opted-in members only. Mark read on view
        // (a server round-trip is in scope; mirrors the API activity() side-effect).
        $activity = [];
        if (($stats['enabled'] ?? false)) {
            try {
                $rawActivity = \App\Services\FederationActivityService::getActivityFeed($userId, 5);
                $activity = array_map(static function (array $a): array {
                    return [
                        'type' => (string) ($a['type'] ?? 'activity'),
                        'title' => (string) ($a['title'] ?? ''),
                        'description' => (string) ($a['description'] ?? ($a['preview'] ?? '')),
                        'community' => (string) ($a['subtitle'] ?? ''),
                        'created_at' => $a['timestamp'] ?? null,
                    ];
                }, $rawActivity);
                \App\Services\FederationActivityService::markAllRead($userId);
            } catch (\Throwable $e) {
                report($e);
            }
        }

        return $this->view('accessible-frontend::federation', [
            'title' => __('govuk_alpha.federation.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'federationActiveTab' => 'overview',
            'partners' => array_slice($partners, 0, 6),
            'partnerTotal' => count($partners),
            'activity' => $activity,
            'stats' => $stats,
            'loadError' => $loadError,
        ]);
    }

    /**
     * Active federation partners (internal partnerships + external partners),
     * mirroring FederationV2Controller::partners but shaped for a read-only,
     * server-rendered list. Defensive: any failure yields an empty list.
     *
     * @return array<int,array<string,mixed>>
     */
    private function federationPartnersForDisplay(int $tenantId): array
    {
        // Emit lowercase slugs; the blade resolves them through
        // govuk_alpha.federation.levels.* so the tag label is translatable.
        // Slugs MUST mirror the source-of-truth FederationV2Controller::LEVEL_NAMES
        // (1=Discovery, 2=Social, 3=Economic, 4=Integrated) — keep in sync.
        $levelNames = [1 => 'discovery', 2 => 'social', 3 => 'economic', 4 => 'integrated'];

        $rows = \Illuminate\Support\Facades\DB::select("
            SELECT
                fp.federation_level, fp.created_at as partnership_since,
                fp.profiles_enabled, fp.messaging_enabled, fp.transactions_enabled,
                fp.listings_enabled, fp.events_enabled, fp.groups_enabled,
                CASE WHEN fp.tenant_id = ? THEN fp.partner_tenant_id ELSE fp.tenant_id END as partner_tenant_id,
                CASE WHEN fp.tenant_id = ? THEN t2.name ELSE t1.name END as partner_name,
                CASE WHEN fp.tenant_id = ? THEN t2.tagline ELSE t1.tagline END as partner_tagline,
                CASE WHEN fp.tenant_id = ? THEN t2.location_name ELSE t1.location_name END as partner_location,
                CASE WHEN fp.tenant_id = ? THEN t2.country_code ELSE t1.country_code END as partner_country,
                (SELECT COUNT(*) FROM users u
                 JOIN federation_user_settings fus2 ON fus2.user_id = u.id AND fus2.federation_optin = 1
                 WHERE u.tenant_id = CASE WHEN fp.tenant_id = ? THEN fp.partner_tenant_id ELSE fp.tenant_id END
                   AND u.status = 'active') as partner_member_count,
                (SELECT COUNT(*) FROM listings li
                 JOIN federation_user_settings fusl ON fusl.user_id = li.user_id
                 WHERE li.tenant_id = CASE WHEN fp.tenant_id = ? THEN fp.partner_tenant_id ELSE fp.tenant_id END
                   AND li.status = 'active'
                   AND li.federated_visibility IN ('listed', 'bookable')
                   AND fusl.federation_optin = 1
                   AND fusl.profile_visible_federated = 1
                   AND fusl.appear_in_federated_search = 1) as partner_listing_count
            FROM federation_partnerships fp
            LEFT JOIN tenants t1 ON fp.tenant_id = t1.id
            LEFT JOIN tenants t2 ON fp.partner_tenant_id = t2.id
            WHERE (fp.tenant_id = ? OR fp.partner_tenant_id = ?) AND fp.status = 'active'
            ORDER BY partner_name ASC
        ", [$tenantId, $tenantId, $tenantId, $tenantId, $tenantId, $tenantId, $tenantId, $tenantId, $tenantId]);

        $partners = array_map(static function ($r) use ($levelNames) {
            $level = (int) ($r->federation_level ?? 1);
            return [
                // Internal partners are linkable by their integer tenant id.
                'id' => (int) ($r->partner_tenant_id ?? 0),
                'is_external' => false,
                'name' => (string) ($r->partner_name ?? ''),
                'tagline' => (string) ($r->partner_tagline ?? ''),
                'location' => (string) ($r->partner_location ?? ''),
                'country' => (string) ($r->partner_country ?? ''),
                'member_count' => (int) ($r->partner_member_count ?? 0),
                'listing_count' => (int) ($r->partner_listing_count ?? 0),
                'level' => $level,
                'level_name' => $levelNames[$level] ?? 'discovery',
                'permissions' => self::federationPermissionList($r),
                'partnership_since' => $r->partnership_since ?? null,
            ];
        }, $rows);

        // Merge active external partners (best-effort). External partners carry an
        // "ext-N" id so the detail page can resolve them via the external service.
        try {
            $external = \App\Services\FederationExternalPartnerService::getActivePartners($tenantId);
            foreach ($external as $ep) {
                $perms = [];
                if (!empty($ep['allow_member_search'])) $perms[] = 'profiles';
                if (!empty($ep['allow_messaging'])) $perms[] = 'messaging';
                if (!empty($ep['allow_transactions'])) $perms[] = 'transactions';
                if (!empty($ep['allow_listing_search'])) $perms[] = 'listings';
                if (!empty($ep['allow_events'])) $perms[] = 'events';
                if (!empty($ep['allow_groups'])) $perms[] = 'groups';
                $partners[] = [
                    'id' => 'ext-' . (int) ($ep['id'] ?? 0),
                    'is_external' => true,
                    'name' => (string) ($ep['name'] ?? ''),
                    'tagline' => (string) ($ep['description'] ?? ''),
                    'location' => '',
                    'country' => '',
                    'member_count' => (int) ($ep['partner_member_count'] ?? 0),
                    'listing_count' => 0,
                    'level' => 0,
                    'level_name' => 'external',
                    'permissions' => $perms,
                    'partnership_since' => $ep['created_at'] ?? null,
                ];
            }
        } catch (\Throwable $e) {
            // External partners are optional; ignore failures.
        }

        return $partners;
    }

    /**
     * Build the permission slug list for an internal partnership row.
     *
     * @param object $r A federation_partnerships row.
     * @return list<string>
     */
    private static function federationPermissionList(object $r): array
    {
        $permissions = [];
        if (!empty($r->profiles_enabled)) $permissions[] = 'profiles';
        if (!empty($r->messaging_enabled)) $permissions[] = 'messaging';
        if (!empty($r->transactions_enabled)) $permissions[] = 'transactions';
        if (!empty($r->listings_enabled)) $permissions[] = 'listings';
        if (!empty($r->events_enabled)) $permissions[] = 'events';
        if (!empty($r->groups_enabled)) $permissions[] = 'groups';
        return $permissions;
    }

    /**
     * Network-wide stats for the federation hub. Mirrors
     * FederationV2Controller::status() but shaped for server-side rendering.
     *
     * @return array{
     *   tenant_federation_enabled: bool, federation_optin: bool, enabled: bool,
     *   partnerships_count: int, messages_count: int, transactions_count: int
     * }
     */
    private function federationStats(int $tenantId, int $userId): array
    {
        $feature = app(\App\Services\FederationFeatureService::class);
        $tenantEnabled = false;
        try {
            $tenantEnabled = $feature->isGloballyEnabled() && $feature->isTenantFederationEnabled($tenantId);
        } catch (\Throwable $e) {
            report($e);
        }

        $settings = \App\Services\FederationUserService::getUserSettings($userId);
        $optedIn = (bool) ($settings['federation_optin'] ?? false);

        $partnershipsCount = 0;
        try {
            $row = DB::selectOne(
                "SELECT COUNT(*) as cnt FROM federation_partnerships
                 WHERE (tenant_id = ? OR partner_tenant_id = ?) AND status = 'active'",
                [$tenantId, $tenantId]
            );
            $partnershipsCount = (int) ($row->cnt ?? 0);
        } catch (\Throwable $e) {
            // Defensive — table may be empty/missing in some environments.
        }

        $messagesCount = 0;
        $transactionsCount = 0;
        if ($tenantEnabled && $optedIn) {
            try {
                // The send path dual-inserts an inbound AND an outbound copy with
                // identical sender/receiver columns, so counting without a
                // direction filter doubles the figure. Match the React API's
                // semantics (FederationV2Controller::status): outbound copies
                // count for the sender, inbound copies for the receiver.
                $row = DB::selectOne(
                    "SELECT COUNT(*) as cnt FROM federation_messages
                     WHERE (direction = 'outbound' AND sender_user_id = ? AND sender_tenant_id = ?)
                        OR (direction = 'inbound' AND receiver_user_id = ? AND receiver_tenant_id = ?)",
                    [$userId, $tenantId, $userId, $tenantId]
                );
                $messagesCount = (int) ($row->cnt ?? 0);
            } catch (\Throwable $e) {
                // federation_messages table may not exist yet.
            }
            try {
                $row = DB::selectOne(
                    "SELECT COUNT(*) as cnt FROM transactions
                     WHERE is_federated = 1
                       AND (
                        (sender_id = ? AND sender_tenant_id = ?)
                        OR (receiver_id = ? AND receiver_tenant_id = ?)
                       )",
                    [$userId, $tenantId, $userId, $tenantId]
                );
                $transactionsCount = (int) ($row->cnt ?? 0);
            } catch (\Throwable $e) {
                // ignore
            }
        }

        return [
            'tenant_federation_enabled' => $tenantEnabled,
            'federation_optin' => $optedIn,
            'enabled' => $tenantEnabled && $optedIn,
            'partnerships_count' => $partnershipsCount,
            'messages_count' => $messagesCount,
            'transactions_count' => $transactionsCount,
        ];
    }

    /**
     * Federation level slug for a numeric level — kept in sync with the
     * govuk_alpha.federation.levels.* lang keys.
     */
    private static function federationLevelSlug(int $level): string
    {
        // Mirror the source-of-truth FederationV2Controller::LEVEL_NAMES
        // (1=Discovery, 2=Social, 3=Economic, 4=Integrated).
        return [1 => 'discovery', 2 => 'social', 3 => 'economic', 4 => 'integrated'][$level] ?? 'discovery';
    }

    /**
     * Whether a federation operation (profiles|listings|events) is allowed for
     * the current tenant. Defensive — returns false on any failure so the page
     * shows the "not available" inset instead of erroring.
     */
    private function federationOperationAllowed(string $operation, int $tenantId): bool
    {
        try {
            $check = app(\App\Services\FederationFeatureService::class)->isOperationAllowed($operation, $tenantId);
            return (bool) ($check['allowed'] ?? false);
        } catch (\Throwable $e) {
            report($e);
            return false;
        }
    }

    private function federationOptInRedirectIfRequired(int $userId, string $tenantSlug): ?RedirectResponse
    {
        if (\App\Services\FederationUserService::hasOptedIn($userId, TenantContext::getId())) {
            return null;
        }

        return redirect()->route('govuk-alpha.federation.opt-in', ['tenantSlug' => $tenantSlug]);
    }

    /**
     * Partner DETAIL — `/federation/partners/{id}` where {id} is an integer for
     * an internal partner tenant, or "ext-{N}" for an external partner. Mirrors
     * FederationV2Controller::partnerDetail().
     */
    public function federationPartner(Request $request, string $tenantSlug, string $id): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('federation'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $tenantId = TenantContext::getId();
        $partner = null;

        try {
            if (str_starts_with($id, 'ext-')) {
                $extId = (int) substr($id, 4);
                $ep = $extId > 0 ? \App\Services\FederationExternalPartnerService::getById($extId, $tenantId) : null;
                if ($ep && ($ep['status'] ?? '') === 'active') {
                    $perms = [];
                    if (!empty($ep['allow_member_search'])) $perms[] = 'profiles';
                    if (!empty($ep['allow_messaging'])) $perms[] = 'messaging';
                    if (!empty($ep['allow_transactions'])) $perms[] = 'transactions';
                    if (!empty($ep['allow_listing_search'])) $perms[] = 'listings';
                    if (!empty($ep['allow_events'])) $perms[] = 'events';
                    if (!empty($ep['allow_groups'])) $perms[] = 'groups';
                    $partner = [
                        'id' => 'ext-' . (int) ($ep['id'] ?? 0),
                        'is_external' => true,
                        'name' => (string) ($ep['name'] ?? ''),
                        'tagline' => (string) ($ep['description'] ?? ''),
                        'location' => '',
                        'country' => '',
                        'member_count' => (int) ($ep['partner_member_count'] ?? 0),
                        'listing_count' => 0,
                        'level' => 0,
                        'level_name' => 'external',
                        'permissions' => $perms,
                        'partnership_since' => $ep['created_at'] ?? null,
                    ];
                }
            } else {
                $partnerTenantId = (int) $id;
                if ($partnerTenantId > 0) {
                    $row = DB::selectOne("
                        SELECT
                            fp.federation_level, fp.created_at as partnership_since,
                            fp.profiles_enabled, fp.messaging_enabled, fp.transactions_enabled,
                            fp.listings_enabled, fp.events_enabled, fp.groups_enabled,
                            CASE WHEN fp.tenant_id = ? THEN fp.partner_tenant_id ELSE fp.tenant_id END as partner_tenant_id,
                            CASE WHEN fp.tenant_id = ? THEN t2.name ELSE t1.name END as partner_name,
                            CASE WHEN fp.tenant_id = ? THEN t2.tagline ELSE t1.tagline END as partner_tagline,
                            CASE WHEN fp.tenant_id = ? THEN t2.location_name ELSE t1.location_name END as partner_location,
                            CASE WHEN fp.tenant_id = ? THEN t2.country_code ELSE t1.country_code END as partner_country,
                            (SELECT COUNT(*) FROM users u
                             JOIN federation_user_settings fus2 ON fus2.user_id = u.id AND fus2.federation_optin = 1
                             WHERE u.tenant_id = CASE WHEN fp.tenant_id = ? THEN fp.partner_tenant_id ELSE fp.tenant_id END
                               AND u.status = 'active') as partner_member_count,
                            (SELECT COUNT(*) FROM listings li
                             JOIN federation_user_settings fusl ON fusl.user_id = li.user_id
                             WHERE li.tenant_id = CASE WHEN fp.tenant_id = ? THEN fp.partner_tenant_id ELSE fp.tenant_id END
                               AND li.status = 'active'
                               AND li.federated_visibility IN ('listed', 'bookable')
                               AND fusl.federation_optin = 1
                               AND fusl.profile_visible_federated = 1
                               AND fusl.appear_in_federated_search = 1) as partner_listing_count
                        FROM federation_partnerships fp
                        LEFT JOIN tenants t1 ON fp.tenant_id = t1.id
                        LEFT JOIN tenants t2 ON fp.partner_tenant_id = t2.id
                        WHERE (fp.tenant_id = ? OR fp.partner_tenant_id = ?) AND fp.status = 'active'
                          AND CASE WHEN fp.tenant_id = ? THEN fp.partner_tenant_id ELSE fp.tenant_id END = ?
                        LIMIT 1
                    ", [$tenantId, $tenantId, $tenantId, $tenantId, $tenantId, $tenantId, $tenantId, $tenantId, $tenantId, $tenantId, $partnerTenantId]);

                    if ($row) {
                        $level = (int) ($row->federation_level ?? 1);
                        $partner = [
                            'id' => (int) ($row->partner_tenant_id ?? 0),
                            'is_external' => false,
                            'name' => (string) ($row->partner_name ?? ''),
                            'tagline' => (string) ($row->partner_tagline ?? ''),
                            'location' => (string) ($row->partner_location ?? ''),
                            'country' => (string) ($row->partner_country ?? ''),
                            'member_count' => (int) ($row->partner_member_count ?? 0),
                            'listing_count' => (int) ($row->partner_listing_count ?? 0),
                            'level' => $level,
                            'level_name' => self::federationLevelSlug($level),
                            'permissions' => self::federationPermissionList($row),
                            'partnership_since' => $row->partnership_since ?? null,
                        ];
                    }
                }
            }
        } catch (\Throwable $e) {
            report($e);
        }

        abort_if($partner === null, 404);

        return $this->view('accessible-frontend::federation-partner', [
            'title' => $partner['name'] ?: __('govuk_alpha.federation.partner.caption'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'federationActiveTab' => 'partners',
            'partner' => $partner,
        ]);
    }

    /**
     * Partners LIST — `/federation/partners` (GET). The full list of partner
     * communities (internal + external), mirroring the React FederationPartnersPage.
     * The hub only shows a capped preview; this page shows every partner.
     */
    public function federationPartners(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('federation'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $tenantId = TenantContext::getId();
        $partners = [];
        try {
            $partners = $this->federationPartnersForDisplay($tenantId);
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::federation-partners', [
            'title' => __('govuk_alpha.federation.partners_list.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'federationActiveTab' => 'partners',
            'partners' => $partners,
        ]);
    }

    /**
     * Opt-IN form — `/federation/opt-in` (GET).
     */
    public function federationOptIn(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('federation'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        // Already opted in → send them to settings.
        if (\App\Services\FederationUserService::hasOptedIn($userId)) {
            return redirect()->route('govuk-alpha.federation.settings', ['tenantSlug' => $tenantSlug]);
        }

        // A short partner-community preview on the confirmation form (FEDONB-07),
        // so members can see who they will connect with before opting in.
        $partners = [];
        try {
            $partners = array_slice($this->federationPartnersForDisplay(TenantContext::getId()), 0, 5);
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::federation-opt-in', [
            'title' => __('govuk_alpha.federation.optin.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'federationActiveTab' => 'overview',
            'partners' => $partners,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /**
     * Opt-IN submit — `/federation/opt-in` (POST). Sets federation_optin plus
     * sensible visibility defaults via FederationUserService::updateSettings.
     */
    public function storeFederationOptIn(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('federation'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $tenantId = TenantContext::getId();
        $feature = app(\App\Services\FederationFeatureService::class);
        $tenantEnabled = false;
        try {
            $tenantEnabled = $feature->isGloballyEnabled() && $feature->isTenantFederationEnabled($tenantId);
        } catch (\Throwable $e) {
            report($e);
        }
        if (!$tenantEnabled) {
            return redirect()->route('govuk-alpha.federation.opt-in', ['tenantSlug' => $tenantSlug, 'status' => 'unavailable']);
        }

        $current = \App\Services\FederationUserService::getUserSettings($userId);

        // The rich opt-in form posts an explicit preference set (marked by the
        // preferences_submitted hidden field). When present we honour the member's
        // choices; otherwise we apply React-style sensible defaults (location off
        // for GDPR data-minimisation). Either path now explicitly sets the
        // messaging/transactions flags, which the old path silently omitted.
        if ($request->boolean('preferences_submitted')) {
            $reachRaw = self::asStr($request->input('service_reach'));
            $reach = in_array($reachRaw, ['local_only', 'remote_ok', 'travel_ok'], true) ? $reachRaw : 'local_only';
            $settings = array_merge($current, [
                'federation_optin' => true,
                'profile_visible_federated' => $request->boolean('profile_visible_federated'),
                'appear_in_federated_search' => $request->boolean('appear_in_federated_search'),
                'show_skills_federated' => $request->boolean('show_skills_federated'),
                'show_location_federated' => $request->boolean('show_location_federated'),
                'show_reviews_federated' => $request->boolean('show_reviews_federated'),
                'email_notifications' => $request->boolean('email_notifications'),
                'messaging_enabled_federated' => $request->boolean('messaging_enabled_federated'),
                'transactions_enabled_federated' => $request->boolean('transactions_enabled_federated'),
                'service_reach' => $reach,
                'travel_radius_km' => max(0, min(500, (int) $request->input('travel_radius_km'))),
            ]);
        } else {
            $settings = array_merge($current, [
                'federation_optin' => true,
                'profile_visible_federated' => true,
                'appear_in_federated_search' => true,
                'show_skills_federated' => true,
                // Location is personal data — leave it off by default; members enable
                // it explicitly (GDPR data-minimisation).
                'show_location_federated' => $current['show_location_federated'] ?? false,
                'show_reviews_federated' => true,
                'email_notifications' => true,
                'messaging_enabled_federated' => true,
                'transactions_enabled_federated' => true,
                'service_reach' => $current['service_reach'] ?? 'local_only',
            ]);
        }

        $ok = \App\Services\FederationUserService::updateSettings($userId, $settings);

        return redirect()->route(
            $ok ? 'govuk-alpha.federation.index' : 'govuk-alpha.federation.opt-in',
            $ok
                ? ['tenantSlug' => $tenantSlug, 'status' => 'opted-in']
                : ['tenantSlug' => $tenantSlug, 'status' => 'optin-failed']
        );
    }

    /**
     * Opt-OUT confirmation — `/federation/opt-out` (GET).
     */
    public function federationOptOut(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('federation'), 403);
        if ($this->currentUserId() === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        return $this->view('accessible-frontend::federation-opt-out', [
            'title' => __('govuk_alpha.federation.optout.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'federationActiveTab' => 'overview',
        ]);
    }

    /**
     * Opt-OUT submit — `/federation/opt-out` (POST). Calls
     * FederationUserService::optOut AND dispatches UserFederatedOptOut so
     * federated partners are asked to delete the member's data (GDPR).
     */
    public function storeFederationOptOut(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('federation'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $tenantId = TenantContext::getId();
        $ok = \App\Services\FederationUserService::optOut($userId);

        if ($ok) {
            // GDPR propagation — the service does NOT dispatch this itself.
            try {
                \App\Events\UserFederatedOptOut::dispatch($userId, $tenantId, 'opt_out');
            } catch (\Throwable $e) {
                report($e);
            }
        }

        return redirect()->route('govuk-alpha.federation.index', [
            'tenantSlug' => $tenantSlug,
            'status' => $ok ? 'opted-out' : 'optout-failed',
        ]);
    }

    /**
     * Federation SETTINGS — `/federation/settings` (GET).
     */
    public function federationSettings(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('federation'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $settings = \App\Services\FederationUserService::getUserSettings($userId);

        return $this->view('accessible-frontend::federation-settings', [
            'title' => __('govuk_alpha.federation.settings.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'federationActiveTab' => 'settings',
            'settings' => $settings,
            'optedIn' => (bool) ($settings['federation_optin'] ?? false),
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /**
     * Federation SETTINGS submit — `/federation/settings` (POST). Persists the
     * ~10 federation_user_settings fields via the service (which is the only
     * tenant-safe path — the table has no tenant_id column).
     */
    public function updateFederationSettings(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('federation'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $current = \App\Services\FederationUserService::getUserSettings($userId);

        // Only members who have opted in may manage these toggles.
        if (!($current['federation_optin'] ?? false)) {
            return redirect()->route('govuk-alpha.federation.opt-in', ['tenantSlug' => $tenantSlug]);
        }

        $reachRaw = self::asStr($request->input('service_reach'));
        $reach = in_array($reachRaw, ['local_only', 'remote_ok', 'travel_ok'], true) ? $reachRaw : ($current['service_reach'] ?? 'local_only');

        $settings = array_merge($current, [
            'federation_optin' => true,
            'profile_visible_federated' => $request->boolean('profile_visible_federated'),
            'appear_in_federated_search' => $request->boolean('appear_in_federated_search'),
            'show_skills_federated' => $request->boolean('show_skills_federated'),
            'show_location_federated' => $request->boolean('show_location_federated'),
            'show_reviews_federated' => $request->boolean('show_reviews_federated'),
            'email_notifications' => $request->boolean('email_notifications'),
            'messaging_enabled_federated' => $request->boolean('messaging_enabled_federated'),
            'transactions_enabled_federated' => $request->boolean('transactions_enabled_federated'),
            'service_reach' => $reach,
            // Travel radius is only meaningful for travel_ok; clamp 0–500km to match
            // the React/API bounds. Previously omitted, so it could never be edited.
            'travel_radius_km' => max(0, min(500, (int) $request->input('travel_radius_km'))),
        ]);

        $ok = \App\Services\FederationUserService::updateSettings($userId, $settings);

        return redirect()->route('govuk-alpha.federation.settings', [
            'tenantSlug' => $tenantSlug,
            'status' => $ok ? 'settings-saved' : 'settings-failed',
        ]);
    }

    /**
     * Members BROWSE — `/federation/members` (GET, cursor pagination via ?cursor=).
     * Mirrors FederationV2Controller::members() member-visibility join.
     */
    public function federationMembers(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('federation'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }
        if ($redirect = $this->federationOptInRedirectIfRequired($userId, $tenantSlug)) {
            return $redirect;
        }

        $tenantId = TenantContext::getId();
        $allowed = $this->federationOperationAllowed('profiles', $tenantId);
        $q = trim(self::asStr($request->query('q')));
        $skills = trim(self::asStr($request->query('skills')));
        $partnerId = (int) $request->query('partner_id');
        $reachRaw = self::asStr($request->query('service_reach'));
        $reach = in_array($reachRaw, ['local_only', 'remote_ok', 'travel_ok'], true) ? $reachRaw : '';
        $members = [];
        $nextCursor = null;
        $total = null;
        $loadError = false;

        // Partner options for the community filter + the no-partnerships empty state.
        $partnerOptions = $allowed ? $this->federationInternalPartnerOptions($tenantId) : [];

        // Viewer participation gates the per-card "Send message" action.
        $viewerSettings = \App\Services\FederationUserService::getUserSettings($userId);
        $viewerCanMessage = (bool) ($viewerSettings['federation_optin'] ?? false) && (bool) ($viewerSettings['messaging_enabled_federated'] ?? false);

        if ($allowed) {
            $perPage = 20;
            $cursorId = $this->decodeFederationCursor(self::asStr($request->query('cursor')));

            try {
                $selectCols = "SELECT u.id, u.first_name, u.last_name, u.avatar_url, u.bio, u.skills,
                        u.location, u.tenant_id, t.name as tenant_name,
                        fus.service_reach, fus.show_skills_federated, fus.show_location_federated";
                $fromWhere = "
                    FROM users u
                    JOIN federation_user_settings fus ON fus.user_id = u.id
                    JOIN tenants t ON t.id = u.tenant_id
                    JOIN federation_partnerships fp ON (
                        (fp.tenant_id = :tid1 AND fp.partner_tenant_id = u.tenant_id)
                        OR (fp.partner_tenant_id = :tid2 AND fp.tenant_id = u.tenant_id)
                    )
                    WHERE fp.status = 'active' AND fp.profiles_enabled = 1
                    AND fus.federation_optin = 1 AND fus.profile_visible_federated = 1 AND fus.appear_in_federated_search = 1
                    AND u.status = 'active' AND u.tenant_id != :tid3";
                $filterParams = [':tid1' => $tenantId, ':tid2' => $tenantId, ':tid3' => $tenantId];

                if ($q !== '') {
                    $fromWhere .= " AND (u.first_name LIKE :q1 OR u.last_name LIKE :q2 OR (fus.show_skills_federated = 1 AND u.skills LIKE :q3) OR u.bio LIKE :q4)";
                    $term = "%{$q}%";
                    $filterParams[':q1'] = $term;
                    $filterParams[':q2'] = $term;
                    $filterParams[':q3'] = $term;
                    $filterParams[':q4'] = $term;
                }
                // Skills filter: comma-separated, capped at 10, each ANDed and gated
                // on the member exposing skills federated (mirrors the API).
                $skillTerms = array_slice(array_values(array_filter(array_map('trim', explode(',', $skills)))), 0, 10);
                foreach ($skillTerms as $i => $st) {
                    $key = ":sk{$i}";
                    $fromWhere .= " AND (fus.show_skills_federated = 1 AND u.skills LIKE {$key})";
                    $filterParams[$key] = "%{$st}%";
                }
                // Service reach: remote_ok matches remote_ok+travel_ok (API parity).
                if ($reach === 'remote_ok') {
                    $fromWhere .= " AND fus.service_reach IN ('remote_ok','travel_ok')";
                } elseif ($reach === 'local_only' || $reach === 'travel_ok') {
                    $fromWhere .= " AND fus.service_reach = :reach";
                    $filterParams[':reach'] = $reach;
                }
                // Partner-community filter (internal partners only).
                if ($partnerId > 0) {
                    $fromWhere .= " AND u.tenant_id = :partner_id";
                    $filterParams[':partner_id'] = $partnerId;
                }

                // Total count — first page only (mirrors the React showing X of Y chip).
                if ($cursorId === null) {
                    $countRows = $this->federationSelect("SELECT COUNT(DISTINCT u.id) as cnt" . $fromWhere, $filterParams);
                    $total = (int) ($countRows[0]['cnt'] ?? 0);
                }

                $sql = $selectCols . $fromWhere;
                $params = $filterParams;
                if ($cursorId !== null) {
                    $sql .= " AND u.id < :cursor_id";
                    $params[':cursor_id'] = $cursorId;
                }
                $sql .= " ORDER BY u.id DESC LIMIT :lim";
                $params[':lim'] = $perPage + 1;

                $rows = $this->federationSelect($sql, $params);

                $hasMore = count($rows) > $perPage;
                if ($hasMore) {
                    $rows = array_slice($rows, 0, $perPage);
                }

                $members = array_map(static function (array $m): array {
                    return [
                        'id' => (int) $m['id'],
                        'name' => trim(((string) ($m['first_name'] ?? '')) . ' ' . ((string) ($m['last_name'] ?? ''))),
                        'avatar' => $m['avatar_url'] ?: null,
                        'bio' => (string) ($m['bio'] ?? ''),
                        'skills' => (!empty($m['show_skills_federated']) && !empty($m['skills']))
                            ? array_values(array_filter(array_map('trim', explode(',', (string) $m['skills']))))
                            : [],
                        'location' => !empty($m['show_location_federated']) ? ($m['location'] ?? null) : null,
                        'service_reach' => in_array(($m['service_reach'] ?? 'local_only'), ['local_only', 'remote_ok', 'travel_ok'], true) ? (string) $m['service_reach'] : 'local_only',
                        'tenant_id' => (int) $m['tenant_id'],
                        'tenant_name' => (string) ($m['tenant_name'] ?? ''),
                    ];
                }, $rows);

                if ($hasMore && !empty($rows)) {
                    $last = end($rows);
                    $nextCursor = base64_encode((string) ((int) $last['id']));
                }
            } catch (\Throwable $e) {
                report($e);
                $loadError = true;
            }
        }

        return $this->view('accessible-frontend::federation-members', [
            'title' => __('govuk_alpha.federation.members_browse.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'federationActiveTab' => 'members',
            'allowed' => $allowed,
            'members' => $members,
            'query' => $q,
            'skills' => $skills,
            'partnerId' => $partnerId,
            'serviceReach' => $reach,
            'partnerOptions' => $partnerOptions,
            'total' => $total,
            'viewerCanMessage' => $viewerCanMessage,
            'loadError' => $loadError,
            'nextCursor' => $nextCursor,
        ]);
    }

    /**
     * Active INTERNAL federation partner options for browse filter dropdowns
     * (members / listings / events / groups). External (ext-N) partners are
     * intentionally excluded from these server-rendered browse filters — the
     * cross-platform "ext-N" federation saga is out of scope for the accessible
     * surface. Defensive: any failure yields an empty list (no filter shown).
     *
     * @return array<int,array{id:int,name:string}>
     */
    private function federationInternalPartnerOptions(int $tenantId): array
    {
        try {
            $rows = DB::select("
                SELECT DISTINCT
                    CASE WHEN fp.tenant_id = ? THEN fp.partner_tenant_id ELSE fp.tenant_id END as partner_tenant_id,
                    CASE WHEN fp.tenant_id = ? THEN t2.name ELSE t1.name END as partner_name
                FROM federation_partnerships fp
                LEFT JOIN tenants t1 ON fp.tenant_id = t1.id
                LEFT JOIN tenants t2 ON fp.partner_tenant_id = t2.id
                WHERE (fp.tenant_id = ? OR fp.partner_tenant_id = ?) AND fp.status = 'active'
                ORDER BY partner_name ASC
            ", [$tenantId, $tenantId, $tenantId, $tenantId]);

            return array_values(array_filter(array_map(static function ($r): array {
                return ['id' => (int) ($r->partner_tenant_id ?? 0), 'name' => (string) ($r->partner_name ?? '')];
            }, $rows), static fn ($p) => $p['id'] > 0 && $p['name'] !== ''));
        } catch (\Throwable $e) {
            report($e);
            return [];
        }
    }

    /**
     * Member PROFILE — `/federation/members/{id}?tenant_id=X` (GET). The
     * tenant_id query param scopes the lookup to the owning community.
     */
    public function federationMember(Request $request, string $tenantSlug, int $id): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('federation'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }
        if ($redirect = $this->federationOptInRedirectIfRequired($userId, $tenantSlug)) {
            return $redirect;
        }

        $tenantId = TenantContext::getId();
        abort_unless($this->federationOperationAllowed('profiles', $tenantId), 404);

        $memberTenantId = (int) $request->query('tenant_id');
        $member = null;
        $reviews = [];

        try {
            $sql = "
                SELECT u.id, u.first_name, u.last_name, u.avatar_url, u.bio, u.skills,
                    u.location, u.tenant_id, t.name as tenant_name,
                    fus.show_skills_federated, fus.show_location_federated,
                    fus.show_reviews_federated, fus.service_reach,
                    fus.messaging_enabled_federated, fus.transactions_enabled_federated,
                    fp.messaging_enabled as partner_messaging_enabled,
                    fp.transactions_enabled as partner_transactions_enabled
                FROM users u
                JOIN federation_user_settings fus ON fus.user_id = u.id
                JOIN tenants t ON t.id = u.tenant_id
                JOIN federation_partnerships fp ON (
                    (fp.tenant_id = :tid1 AND fp.partner_tenant_id = u.tenant_id)
                    OR (fp.partner_tenant_id = :tid2 AND fp.tenant_id = u.tenant_id)
                )
                WHERE u.id = :user_id AND fp.status = 'active' AND fp.profiles_enabled = 1
                AND fus.federation_optin = 1 AND fus.profile_visible_federated = 1
                AND u.status = 'active' AND u.tenant_id != :tid_self
            ";
            $params = [':tid1' => $tenantId, ':tid2' => $tenantId, ':user_id' => $id, ':tid_self' => $tenantId];
            if ($memberTenantId > 0) {
                $sql .= " AND u.tenant_id = :member_tenant_id";
                $params[':member_tenant_id'] = $memberTenantId;
            }
            $sql .= " LIMIT 1";

            $rows = $this->federationSelect($sql, $params);
            $m = $rows[0] ?? null;

            if ($m) {
                $member = [
                    'id' => (int) $m['id'],
                    'name' => trim(((string) ($m['first_name'] ?? '')) . ' ' . ((string) ($m['last_name'] ?? ''))),
                    'avatar' => $m['avatar_url'] ?: null,
                    'bio' => (string) ($m['bio'] ?? ''),
                    'skills' => (!empty($m['show_skills_federated']) && !empty($m['skills']))
                        ? array_values(array_filter(array_map('trim', explode(',', (string) $m['skills']))))
                        : [],
                    'location' => !empty($m['show_location_federated']) ? ($m['location'] ?? null) : null,
                    'service_reach' => in_array(($m['service_reach'] ?? 'local_only'), ['local_only', 'remote_ok', 'travel_ok'], true) ? (string) $m['service_reach'] : 'local_only',
                    'tenant_id' => (int) $m['tenant_id'],
                    'tenant_name' => (string) ($m['tenant_name'] ?? ''),
                    // Capability flags — a member-side opt-in AND a partnership-level
                    // permission must BOTH be set before the action is offered.
                    'messaging_enabled' => !empty($m['messaging_enabled_federated']) && !empty($m['partner_messaging_enabled']),
                    'transactions_enabled' => !empty($m['transactions_enabled_federated']) && !empty($m['partner_transactions_enabled']),
                    // Reputation tag in the header (mirrors React FederatedTrustBadge);
                    // only surfaced when the member exposes reviews federated.
                    'reputation_score' => null,
                    'reputation_count' => 0,
                    'show_reviews' => !empty($m['show_reviews_federated']),
                ];

                // Reviews — only when the member exposes them federated. Mirrors
                // FederationV2Controller::memberReviews (local member path).
                if (!empty($m['show_reviews_federated'])) {
                    $reviews = $this->federationMemberReviewList((int) $m['id'], (int) $m['tenant_id']);
                    // Reputation aggregate over ALL active reviews (mirrors API member()).
                    [$repScore, $repCount] = $this->federationMemberReputation((int) $m['id'], (int) $m['tenant_id']);
                    $member['reputation_score'] = $repScore;
                    $member['reputation_count'] = $repCount;
                }
            }
        } catch (\Throwable $e) {
            report($e);
        }

        abort_if($member === null, 404);

        // Connection status between the viewer and this member (mirrors the
        // React member-profile connect button states).
        $connectionStatus = ['status' => 'none', 'connection_id' => null];
        try {
            $connectionStatus = app(\App\Services\FederatedConnectionService::class)
                ->getStatus($userId, $member['id'], $member['tenant_id']);
        } catch (\Throwable $e) {
            report($e);
        }

        // The viewer's own federation participation gates the message / transfer
        // / connect actions (you cannot act across the network unless opted in).
        $viewerSettings = \App\Services\FederationUserService::getUserSettings($userId);

        return $this->view('accessible-frontend::federation-member', [
            'title' => $member['name'] ?: __('govuk_alpha.federation.member.caption'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'federationActiveTab' => 'members',
            'member' => $member,
            'reviews' => $reviews,
            'connectionStatus' => $connectionStatus,
            'viewerOptedIn' => (bool) ($viewerSettings['federation_optin'] ?? false),
            'viewerMessagingEnabled' => (bool) ($viewerSettings['messaging_enabled_federated'] ?? false),
            'viewerTransactionsEnabled' => (bool) ($viewerSettings['transactions_enabled_federated'] ?? false),
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /**
     * Fetch the visible federated review list for a local federated member.
     * Mirrors FederationV2Controller::memberReviews (local path): merges local +
     * cross-tenant reviews so reputation follows the user. Read-only; any failure
     * yields an empty list. Always scoped to the member's owning tenant id.
     *
     * @return array<int,array<string,mixed>>
     */
    private function federationMemberReviewList(int $memberId, int $memberTenantId): array
    {
        if ($memberId <= 0 || $memberTenantId <= 0) {
            return [];
        }

        try {
            $rows = \App\Models\Review::query()
                ->withoutGlobalScope(\App\Scopes\TenantScope::class)
                ->with(['reviewer:id,first_name,last_name,avatar_url,organization_name,profile_type'])
                ->where('receiver_id', $memberId)
                ->where(function ($q) use ($memberTenantId) {
                    // Federated reviews targeting this tenant are only visible when
                    // the review is federated AND the reviewer opted into cross-tenant
                    // display (mirrors Review::scopeWithFederated); without these two
                    // conditions an opted-out reviewer's rating still leaked across.
                    $q->where(function ($q2) use ($memberTenantId) {
                        $q2->where('receiver_tenant_id', $memberTenantId)
                           ->where('review_type', 'federated')
                           ->where('show_cross_tenant', 1);
                    })
                      ->orWhere(function ($q2) use ($memberTenantId) {
                          $q2->where('tenant_id', $memberTenantId)
                             ->whereNull('receiver_tenant_id');
                      });
                })
                ->where(function ($q) {
                    $q->whereNull('status')->orWhereIn('status', ['active', 'approved']);
                })
                ->orderByDesc('id')
                // Match the API memberReviews() cap (100) so members with many
                // reviews are not silently truncated at 20.
                ->limit(100)
                ->get();

            // Resolve the names of any cross-tenant (partner) communities a review
            // originated from, so each card can show a "From {community}" chip
            // mirroring the React reviews panel. One query for all distinct tenants.
            $originTenantIds = [];
            foreach ($rows as $r) {
                $origin = (int) ($r->reviewer_tenant_id ?: $r->tenant_id);
                if ($origin > 0 && $origin !== $memberTenantId) {
                    $originTenantIds[$origin] = true;
                }
            }
            $tenantNames = [];
            if (!empty($originTenantIds)) {
                $tenantNames = DB::table('tenants')
                    ->whereIn('id', array_keys($originTenantIds))
                    ->pluck('name', 'id')
                    ->all();
            }

            return $rows->map(function (\App\Models\Review $r) use ($memberTenantId, $tenantNames): array {
                $reviewer = $r->reviewer;
                $isAnon = (bool) ($r->is_anonymous ?? false);
                $reviewerName = ($reviewer && ($reviewer->profile_type ?? null) === 'organisation' && !empty($reviewer->organization_name))
                    ? $reviewer->organization_name
                    : trim(((string) ($reviewer->first_name ?? '')) . ' ' . ((string) ($reviewer->last_name ?? '')));

                $origin = (int) ($r->reviewer_tenant_id ?: $r->tenant_id);
                $partnerName = ($origin > 0 && $origin !== $memberTenantId)
                    ? (string) ($tenantNames[$origin] ?? '')
                    : '';

                return [
                    'id' => (int) $r->id,
                    'rating' => (int) $r->rating,
                    'comment' => (string) ($r->comment ?? ''),
                    'reviewer_name' => $isAnon ? __('govuk_alpha.fed2.reviews.anonymous') : ($reviewerName ?: __('govuk_alpha.fed2.reviews.anonymous')),
                    'created_at' => $r->created_at?->toIso8601String(),
                    // Cross-tenant origin chip + verified (federated) badge.
                    'partner_name' => $partnerName,
                    'verified' => (string) ($r->review_type ?? '') === 'federated',
                ];
            })->all();
        } catch (\Throwable $e) {
            report($e);
            return [];
        }
    }

    /**
     * Reputation aggregate for a federated member — [score, count] over their
     * active/approved reviews, scoped to the member's owning tenant. Mirrors the
     * reputation_score/reputation_count returned by FederationV2Controller::member().
     * Read-only; any failure yields [null, 0].
     *
     * @return array{0: float|null, 1: int}
     */
    private function federationMemberReputation(int $memberId, int $memberTenantId): array
    {
        if ($memberId <= 0 || $memberTenantId <= 0) {
            return [null, 0];
        }

        try {
            $row = \App\Models\Review::query()
                ->withoutGlobalScope(\App\Scopes\TenantScope::class)
                ->where('receiver_id', $memberId)
                ->where(function ($q) use ($memberTenantId) {
                    // Federated reviews targeting this tenant are only visible when
                    // the review is federated AND the reviewer opted into cross-tenant
                    // display (mirrors Review::scopeWithFederated); without these two
                    // conditions an opted-out reviewer's rating still leaked across.
                    $q->where(function ($q2) use ($memberTenantId) {
                        $q2->where('receiver_tenant_id', $memberTenantId)
                           ->where('review_type', 'federated')
                           ->where('show_cross_tenant', 1);
                    })
                      ->orWhere(function ($q2) use ($memberTenantId) {
                          $q2->where('tenant_id', $memberTenantId)
                             ->whereNull('receiver_tenant_id');
                      });
                })
                ->where(function ($q) {
                    $q->whereNull('status')->orWhereIn('status', ['active', 'approved']);
                })
                ->selectRaw('COUNT(*) as cnt, AVG(rating) as avg_rating')
                ->first();

            $count = (int) ($row->cnt ?? 0);
            $score = ($count > 0 && $row->avg_rating !== null) ? round((float) $row->avg_rating, 2) : null;

            return [$score, $count];
        } catch (\Throwable $e) {
            report($e);
            return [null, 0];
        }
    }

    /**
     * Listings BROWSE — `/federation/listings` (GET, cursor pagination).
     * Mirrors FederationV2Controller::listings() (internal partnerships only;
     * external partners are deferred for this server-rendered surface).
     */
    public function federationListings(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('federation'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }
        if ($redirect = $this->federationOptInRedirectIfRequired($userId, $tenantSlug)) {
            return $redirect;
        }

        $tenantId = TenantContext::getId();
        $allowed = $this->federationOperationAllowed('listings', $tenantId);
        $q = trim(self::asStr($request->query('q')));
        $typeRaw = self::asStr($request->query('type'));
        $type = in_array($typeRaw, ['offer', 'request'], true) ? $typeRaw : '';
        $partnerId = (int) $request->query('partner_id');
        $listings = [];
        $nextCursor = null;
        $loadError = false;
        $partnerOptions = $allowed ? $this->federationInternalPartnerOptions($tenantId) : [];

        if ($allowed) {
            $perPage = 20;
            $cursorId = $this->decodeFederationCursor(self::asStr($request->query('cursor')));

            try {
                $sql = "
                    SELECT l.id, l.title, l.description, l.type, c.name as category_name,
                        l.location, l.tenant_id, l.created_at, l.user_id, l.image_url,
                        l.price as estimated_hours,
                        u.first_name, u.last_name, t.name as tenant_name
                    FROM listings l
                    JOIN users u ON u.id = l.user_id AND u.tenant_id = l.tenant_id
                    JOIN tenants t ON t.id = l.tenant_id
                    LEFT JOIN categories c ON c.id = l.category_id
                    JOIN federation_partnerships fp ON (
                        (fp.tenant_id = :tid1 AND fp.partner_tenant_id = l.tenant_id)
                        OR (fp.partner_tenant_id = :tid2 AND fp.tenant_id = l.tenant_id)
                    )
                    JOIN federation_user_settings fus ON fus.user_id = l.user_id
                    WHERE fp.status = 'active' AND fp.listings_enabled = 1
                    AND l.status = 'active' AND l.tenant_id != :tid3
                    AND fus.federation_optin = 1 AND fus.profile_visible_federated = 1 AND fus.appear_in_federated_search = 1
                    AND l.federated_visibility IN ('listed', 'bookable')
                ";
                $params = [':tid1' => $tenantId, ':tid2' => $tenantId, ':tid3' => $tenantId];

                if ($q !== '') {
                    $sql .= " AND (l.title LIKE :q1 OR l.description LIKE :q2)";
                    $term = "%{$q}%";
                    $params[':q1'] = $term;
                    $params[':q2'] = $term;
                }
                if ($type !== '') {
                    $sql .= " AND l.type = :type";
                    $params[':type'] = $type;
                }
                if ($partnerId > 0) {
                    $sql .= " AND l.tenant_id = :partner_id";
                    $params[':partner_id'] = $partnerId;
                }
                if ($cursorId !== null) {
                    $sql .= " AND l.id < :cursor_id";
                    $params[':cursor_id'] = $cursorId;
                }
                $sql .= " ORDER BY l.id DESC LIMIT :lim";
                $params[':lim'] = $perPage + 1;

                $rows = $this->federationSelect($sql, $params);

                $hasMore = count($rows) > $perPage;
                if ($hasMore) {
                    $rows = array_slice($rows, 0, $perPage);
                }

                $listings = array_map(static function (array $l): array {
                    return [
                        'id' => (int) $l['id'],
                        'title' => (string) ($l['title'] ?? ''),
                        'description' => (string) ($l['description'] ?? ''),
                        'type' => (string) ($l['type'] ?? 'offer'),
                        'category_name' => $l['category_name'] ?? null,
                        'location' => $l['location'] ?? null,
                        'image_url' => $l['image_url'] ?: null,
                        'estimated_hours' => ($l['estimated_hours'] !== null && $l['estimated_hours'] !== '') ? (float) $l['estimated_hours'] : null,
                        'created_at' => $l['created_at'] ?? null,
                        'author_name' => trim(((string) ($l['first_name'] ?? '')) . ' ' . ((string) ($l['last_name'] ?? ''))),
                        'user_id' => (int) $l['user_id'],
                        'tenant_id' => (int) $l['tenant_id'],
                        'tenant_name' => (string) ($l['tenant_name'] ?? ''),
                    ];
                }, $rows);

                if ($hasMore && !empty($rows)) {
                    $last = end($rows);
                    $nextCursor = base64_encode((string) ((int) $last['id']));
                }
            } catch (\Throwable $e) {
                report($e);
                $loadError = true;
            }
        }

        return $this->view('accessible-frontend::federation-listings', [
            'title' => __('govuk_alpha.federation.listings_browse.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'federationActiveTab' => 'listings',
            'allowed' => $allowed,
            'listings' => $listings,
            'query' => $q,
            'type' => $type,
            'partnerId' => $partnerId,
            'partnerOptions' => $partnerOptions,
            'loadError' => $loadError,
            'nextCursor' => $nextCursor,
        ]);
    }

    /**
     * Listing DETAIL — `/federation/listings/{tenantId}/{id}` (GET). Renders the
     * full federated listing (full description, image, estimated hours, location,
     * posted date, author profile link, contact-author messaging link), mirroring
     * the React FederationListingsPage detail modal. Re-runs the same
     * partnership/visibility gate as the browse so only a genuinely shareable
     * listing is shown. Internal partners only.
     */
    public function federationListingShow(Request $request, string $tenantSlug, int $tenantId, int $id): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('federation'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }
        if ($redirect = $this->federationOptInRedirectIfRequired($userId, $tenantSlug)) {
            return $redirect;
        }

        $viewerTenantId = TenantContext::getId();
        abort_unless($this->federationOperationAllowed('listings', $viewerTenantId), 404);

        $listing = null;
        try {
            $rows = $this->federationSelect("
                SELECT l.id, l.title, l.description, l.type, c.name as category_name,
                    l.location, l.tenant_id, l.created_at, l.user_id, l.image_url,
                    l.price as estimated_hours,
                    u.first_name, u.last_name, t.name as tenant_name,
                    fus.messaging_enabled_federated, fp.messaging_enabled as partner_messaging_enabled
                FROM listings l
                JOIN users u ON u.id = l.user_id AND u.tenant_id = l.tenant_id
                JOIN tenants t ON t.id = l.tenant_id
                LEFT JOIN categories c ON c.id = l.category_id
                JOIN federation_partnerships fp ON (
                    (fp.tenant_id = :tid1 AND fp.partner_tenant_id = l.tenant_id)
                    OR (fp.partner_tenant_id = :tid2 AND fp.tenant_id = l.tenant_id)
                )
                JOIN federation_user_settings fus ON fus.user_id = l.user_id
                WHERE l.id = :lid AND l.tenant_id = :listing_tenant
                AND fp.status = 'active' AND fp.listings_enabled = 1
                AND l.status = 'active' AND l.tenant_id != :tid3
                AND fus.federation_optin = 1 AND fus.profile_visible_federated = 1 AND fus.appear_in_federated_search = 1
                AND l.federated_visibility IN ('listed', 'bookable')
                LIMIT 1
            ", [
                ':tid1' => $viewerTenantId, ':tid2' => $viewerTenantId, ':tid3' => $viewerTenantId,
                ':lid' => $id, ':listing_tenant' => $tenantId,
            ]);
            $l = $rows[0] ?? null;
            if ($l) {
                $listing = [
                    'id' => (int) $l['id'],
                    'title' => (string) ($l['title'] ?? ''),
                    'description' => (string) ($l['description'] ?? ''),
                    'type' => (string) ($l['type'] ?? 'offer'),
                    'category_name' => $l['category_name'] ?? null,
                    'location' => $l['location'] ?? null,
                    'image_url' => $l['image_url'] ?: null,
                    'estimated_hours' => ($l['estimated_hours'] !== null && $l['estimated_hours'] !== '') ? (float) $l['estimated_hours'] : null,
                    'created_at' => $l['created_at'] ?? null,
                    'author_name' => trim(((string) ($l['first_name'] ?? '')) . ' ' . ((string) ($l['last_name'] ?? ''))),
                    'user_id' => (int) $l['user_id'],
                    'tenant_id' => (int) $l['tenant_id'],
                    'tenant_name' => (string) ($l['tenant_name'] ?? ''),
                    'can_contact' => !empty($l['messaging_enabled_federated']) && !empty($l['partner_messaging_enabled']),
                ];
            }
        } catch (\Throwable $e) {
            report($e);
        }

        abort_if($listing === null, 404);

        return $this->view('accessible-frontend::federation-listing-show', [
            'title' => $listing['title'] ?: __('govuk_alpha.federation.listings_browse.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'federationActiveTab' => 'listings',
            'listing' => $listing,
        ]);
    }

    /**
     * Events BROWSE — `/federation/events` (GET, cursor pagination).
     * Mirrors FederationV2Controller::events() (internal partnerships only).
     */
    public function federationEvents(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('federation'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }
        if ($redirect = $this->federationOptInRedirectIfRequired($userId, $tenantSlug)) {
            return $redirect;
        }

        $tenantId = TenantContext::getId();
        $allowed = $this->federationOperationAllowed('events', $tenantId);
        $q = trim(self::asStr($request->query('q')));
        $partnerId = (int) $request->query('partner_id');
        // Upcoming-only defaults ON (mirrors React's default), off only when
        // explicitly ?upcoming=false.
        $upcoming = self::asStr($request->query('upcoming')) !== 'false';
        $events = [];
        $nextCursor = null;
        $loadError = false;
        $partnerOptions = $allowed ? $this->federationInternalPartnerOptions($tenantId) : [];

        if ($allowed) {
            $perPage = 20;
            $cursorId = $this->decodeFederationCursor(self::asStr($request->query('cursor')));

            try {
                $sql = "
                    SELECT e.id, e.title, e.description, e.start_time as start_date,
                        e.location, e.allow_remote_attendance as is_online, e.max_attendees,
                        e.tenant_id, t.name as tenant_name, e.cover_image, e.user_id,
                        u.first_name, u.last_name, u.avatar_url,
                        (SELECT COUNT(*) FROM event_rsvps er WHERE er.event_id = e.id AND er.status = 'going') as attendees_count
                    FROM events e
                    JOIN users u ON u.id = e.user_id AND u.tenant_id = e.tenant_id
                    JOIN tenants t ON t.id = e.tenant_id
                    JOIN federation_partnerships fp ON (
                        (fp.tenant_id = :tid1 AND fp.partner_tenant_id = e.tenant_id)
                        OR (fp.partner_tenant_id = :tid2 AND fp.tenant_id = e.tenant_id)
                    )
                    JOIN federation_user_settings fus ON fus.user_id = e.user_id AND fus.federation_optin = 1 AND fus.profile_visible_federated = 1 AND fus.appear_in_federated_search = 1
                    WHERE fp.status = 'active' AND fp.events_enabled = 1
                    AND e.tenant_id != :tid3 AND e.status = 'active'
                    AND e.federated_visibility IN ('listed', 'joinable')
                ";
                $params = [':tid1' => $tenantId, ':tid2' => $tenantId, ':tid3' => $tenantId];

                if ($q !== '') {
                    $sql .= " AND (e.title LIKE :q1 OR e.description LIKE :q2)";
                    $term = "%{$q}%";
                    $params[':q1'] = $term;
                    $params[':q2'] = $term;
                }
                if ($partnerId > 0) {
                    $sql .= " AND e.tenant_id = :partner_id";
                    $params[':partner_id'] = $partnerId;
                }
                if ($upcoming) {
                    $sql .= " AND e.start_time >= NOW()";
                }
                if ($cursorId !== null) {
                    $sql .= " AND e.id < :cursor_id";
                    $params[':cursor_id'] = $cursorId;
                }
                $sql .= " ORDER BY e.id DESC LIMIT :lim";
                $params[':lim'] = $perPage + 1;

                $rows = $this->federationSelect($sql, $params);

                $hasMore = count($rows) > $perPage;
                if ($hasMore) {
                    $rows = array_slice($rows, 0, $perPage);
                }

                $events = array_map(static function (array $e): array {
                    return [
                        'id' => (int) $e['id'],
                        'title' => (string) ($e['title'] ?? ''),
                        'description' => (string) ($e['description'] ?? ''),
                        'start_date' => $e['start_date'] ?? null,
                        'location' => $e['location'] ?? null,
                        'is_online' => (bool) ($e['is_online'] ?? false),
                        'attendees_count' => (int) ($e['attendees_count'] ?? 0),
                        'max_attendees' => !empty($e['max_attendees']) ? (int) $e['max_attendees'] : null,
                        'cover_image' => $e['cover_image'] ?: null,
                        'organiser_name' => trim(((string) ($e['first_name'] ?? '')) . ' ' . ((string) ($e['last_name'] ?? ''))),
                        'tenant_id' => (int) $e['tenant_id'],
                        'tenant_name' => (string) ($e['tenant_name'] ?? ''),
                    ];
                }, $rows);

                if ($hasMore && !empty($rows)) {
                    $last = end($rows);
                    $nextCursor = base64_encode((string) ((int) $last['id']));
                }
            } catch (\Throwable $e) {
                report($e);
                $loadError = true;
            }
        }

        return $this->view('accessible-frontend::federation-events', [
            'title' => __('govuk_alpha.federation.events_browse.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'federationActiveTab' => 'events',
            'allowed' => $allowed,
            'events' => $events,
            'query' => $q,
            'partnerId' => $partnerId,
            'upcoming' => $upcoming,
            'partnerOptions' => $partnerOptions,
            'loadError' => $loadError,
            'nextCursor' => $nextCursor,
        ]);
    }

    /**
     * Run a federation browse query with PDO bound params (int vs str), matching
     * the FederationV2Controller binding approach. Returns assoc-array rows.
     *
     * @param array<string,mixed> $params
     * @return array<int,array<string,mixed>>
     */
    private function federationSelect(string $sql, array $params): array
    {
        $stmt = DB::getPdo()->prepare($sql);
        foreach ($params as $key => $value) {
            $stmt->bindValue($key, $value, is_int($value) ? \PDO::PARAM_INT : \PDO::PARAM_STR);
        }
        $stmt->execute();
        $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);
        return is_array($rows) ? $rows : [];
    }

    /**
     * Decode a federation cursor (base64 of the last row id). Returns null for
     * empty/invalid cursors.
     */
    private function decodeFederationCursor(string $cursor): ?int
    {
        if ($cursor === '') {
            return null;
        }
        $decoded = base64_decode($cursor, true);
        if ($decoded === false || !ctype_digit($decoded)) {
            return null;
        }
        $id = (int) $decoded;
        return $id > 0 ? $id : null;
    }

    /**
     * "How timebanking works" — a plain, public educational page. No auth or
     * module gate: it helps newcomers (and the accessibility-first audience in
     * particular) understand the model before signing up.
     */
    public function guide(Request $request, string $tenantSlug): Response
    {
        $this->assertTenantSlug($tenantSlug);

        return $this->view('accessible-frontend::guide', [
            'title' => __('govuk_alpha.guide.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'guide',
        ]);
    }

    /**
     * Connections inbox: the member's accepted network plus pending requests
     * (received — which they can accept/decline — and sent, which they can
     * cancel). Backed by the tenant-scoped ConnectionService.
     */
    public function connections(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('connections'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $accepted = [];
        $received = [];
        $sent = [];
        $counts = ['received' => 0, 'sent' => 0, 'total_friends' => 0];
        $connSearch = trim(self::asStr($request->query('q')));

        try {
            $searchFilter = $connSearch !== '' ? ['q' => $connSearch] : [];
            $accepted = \App\Services\ConnectionService::getConnections($userId, array_merge(['status' => 'accepted', 'limit' => 50], $searchFilter))['items'] ?? [];
            $received = \App\Services\ConnectionService::getConnections($userId, ['status' => 'pending_received', 'limit' => 50])['items'] ?? [];
            $sent = \App\Services\ConnectionService::getConnections($userId, ['status' => 'pending_sent', 'limit' => 50])['items'] ?? [];
            $counts = \App\Services\ConnectionService::getPendingCounts($userId);

            // Client-side name filter fallback: if the service doesn't accept 'q', filter in PHP.
            if ($connSearch !== '') {
                $lcSearch = mb_strtolower($connSearch);
                $nameOf = static function (array $c) use ($lcSearch): bool {
                    $p = $c['partner'] ?? $c['user'] ?? [];
                    $name = mb_strtolower(trim(
                        ($p['name'] ?? '') !== ''
                            ? (string) $p['name']
                            : (string) ($p['first_name'] ?? '') . ' ' . (string) ($p['last_name'] ?? '')
                    ));
                    return $name === '' || str_contains($name, $lcSearch);
                };
                $accepted = array_values(array_filter($accepted, $nameOf));
                $received = array_values(array_filter($received, $nameOf));
                $sent     = array_values(array_filter($sent, $nameOf));
            }
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::connections', [
            'title' => __('govuk_alpha.connections.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'connections',
            'acceptedConnections' => $accepted,
            'receivedRequests' => $received,
            'sentRequests' => $sent,
            'connectionCounts' => $counts,
            'connSearch' => $connSearch,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    public function acceptConnection(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        return $this->connectionAction($tenantSlug, $id, 'accept');
    }

    public function declineConnection(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        return $this->connectionAction($tenantSlug, $id, 'decline');
    }

    public function cancelConnection(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        return $this->connectionAction($tenantSlug, $id, 'remove');
    }

    /** Shared accept/decline/remove handler for connection requests. */
    private function connectionAction(string $tenantSlug, int $id, string $action): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('connections'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $ok = false;
        try {
            // ConnectionService verifies the actor is the receiver (accept/decline)
            // or a participant (remove), so a member can only act on their own.
            $ok = match ($action) {
                'accept'  => \App\Services\ConnectionService::acceptRequest($id, $userId),
                'decline' => \App\Services\ConnectionService::rejectRequest($id, $userId),
                'remove'  => \App\Services\ConnectionService::removeConnection($id, $userId),
                default   => false,
            };
        } catch (\Throwable $e) {
            report($e);
            $ok = false;
        }

        $okStatus = match ($action) {
            'accept'  => 'connection-accepted',
            'decline' => 'connection-declined',
            default   => 'connection-removed',
        };

        return redirect()->route('govuk-alpha.connections.index', [
            'tenantSlug' => $tenantSlug,
            'status' => $ok ? $okStatus : 'connection-failed',
        ])->withFragment('connections-top');
    }

    /**
     * Matches — members whose offers/requests complement the viewer's listings,
     * ranked by SmartMatchingEngine (the same engine that powers the React app).
     * Gated by the listings module since matches are listing-based.
     */
    public function matches(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('listings'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        // Source filter maps UI tab keys to module names understood by CrossModuleMatchingService.
        $source = $this->allowed($request->query('source'), ['all', 'listing', 'group', 'volunteering', 'event'], 'all');
        $modules = match ($source) {
            'listing'      => ['listings'],
            'group'        => ['groups'],
            'volunteering' => ['volunteering'],
            'event'        => ['events'],
            default        => ['listings', 'groups', 'volunteering', 'events'],
        };

        $allMatches = [];
        $matchStats = ['total' => 0, 'avg_score' => 0];
        try {
            $result = app(\App\Services\CrossModuleMatchingService::class)->getAllMatches($userId, [
                'limit'   => 30,
                'modules' => $modules,
            ]);
            $allMatches = $result['matches'] ?? [];
            $total = count($allMatches);
            $avgScore = $total > 0
                ? (int) round(array_sum(array_map(fn ($m) => (float) ($m['match_score'] ?? 0) > 1 ? (float) ($m['match_score'] ?? 0) : (float) ($m['match_score'] ?? 0) * 100, $allMatches)) / $total)
                : 0;
            $matchStats = ['total' => $total, 'avg_score' => $avgScore];
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::matches', [
            'title' => __('govuk_alpha.matches.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'matches',
            'matches' => $allMatches,
            'matchStats' => $matchStats,
        ]);
    }

    /**
     * Community polls — a standalone listing where members can vote and see
     * results. The alpha already votes on polls inline in the feed; this gives
     * them their own page. Ballot integrity (hidden running totals while a poll
     * is open) is enforced by PollService::getById.
     */
    public function polls(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('polls'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        // "My polls" + category filters (mirror React Polls page). PollService
        // ::getAll honours `user_id` (mine) + `category`.
        $pollsMine = $request->query('mine') === '1';
        $pollsCategory = trim(self::asStr($request->query('category')));

        $listFilters = ['limit' => 30];
        if ($pollsMine) {
            $listFilters['user_id'] = $userId;
        }
        if ($pollsCategory !== '') {
            $listFilters['category'] = $pollsCategory;
        }

        $polls = [];
        $pollCategories = [];
        try {
            $list = \App\Services\PollService::getAll($listFilters)['items'] ?? [];
            foreach ($list as $p) {
                $full = \App\Services\PollService::getById((int) ($p['id'] ?? 0), $userId);
                if ($full !== null) {
                    $polls[] = $full;
                }
            }
            $pollCategories = \App\Services\PollService::getCategories();
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::polls', [
            'title' => __('govuk_alpha.polls.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'polls' => $polls,
            'pollsMine' => $pollsMine,
            'pollsCategory' => $pollsCategory,
            'pollCategories' => is_array($pollCategories) ? $pollCategories : [],
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /** Cast a vote on a poll from the standalone polls page. */
    public function storePollVote(Request $request, string $tenantSlug, int $pollId): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('polls'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $optionId = (int) $request->input('option_id');
        $ok = false;
        if ($optionId > 0) {
            try {
                $ok = \App\Services\PollService::vote($pollId, $optionId, $userId);
            } catch (\Throwable $e) {
                report($e);
            }
        }

        return redirect()->route('govuk-alpha.polls.index', [
            'tenantSlug' => $tenantSlug, 'status' => $ok ? 'voted' : 'vote-failed',
        ])->withFragment('poll-' . $pollId);
    }

    /** Create a new poll from the polls page form. */
    public function storePoll(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('polls'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $question = trim(self::asStr($request->input('question')));
        $rawOptions = $request->input('options', []);
        $options = array_values(array_filter(
            array_map(static fn ($o) => trim((string) $o), is_array($rawOptions) ? $rawOptions : [])
        ));

        if ($question === '' || count($options) < 2) {
            return redirect()->route('govuk-alpha.polls.index', [
                'tenantSlug' => $tenantSlug, 'status' => 'poll-create-failed',
            ]);
        }

        $status = 'poll-create-failed';
        try {
            \App\Services\PollService::create($userId, [
                'question'    => $question,
                'description' => trim(self::asStr($request->input('description'))),
                'expires_at'  => self::asStr($request->input('expires_at')) ?: null,
                'poll_type'   => in_array($request->input('poll_type'), ['standard', 'multiple'], true)
                    ? (string) $request->input('poll_type')
                    : 'standard',
                // The view renders an is_anonymous checkbox (value=1); forward it so
                // accessible-created polls honour the anonymity choice (was dropped).
                'is_anonymous' => $request->boolean('is_anonymous'),
                'options'     => $options,
            ]);
            $status = 'poll-created';
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.polls.index', ['tenantSlug' => $tenantSlug, 'status' => $status]);
    }

    // === Group exchanges (multi-party time-credit exchanges) ===

    /** List the viewer's group exchanges (as organiser or participant). */
    public function groupExchanges(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('group_exchanges'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        // Status-tab filter (mirrors React tabs). `state` keeps the flash `status`
        // param free. GroupExchangeService::listForUser honours a `status` filter.
        $exchangeState = $this->allowed(self::asStr($request->query('state')), ['draft', 'pending', 'active', 'completed', 'cancelled'], '');
        $listFilters = ['limit' => 50];
        if ($exchangeState !== '') {
            $listFilters['status'] = $exchangeState;
        }

        $items = [];
        try {
            $items = app(\App\Services\GroupExchangeService::class)->listForUser($userId, $listFilters)['items'] ?? [];
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::group-exchanges', [
            'title' => __('govuk_alpha.group_exchanges.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'group_exchanges',
            'exchanges' => $items,
            'exchangeState' => $exchangeState,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /** Show the "start a group exchange" form. */
    public function createGroupExchange(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('group_exchanges'), 403);
        if ($this->currentUserId() === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        return $this->view('accessible-frontend::group-exchange-create', [
            'title' => __('govuk_alpha.group_exchanges.create_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'group_exchanges',
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /** Create a draft group exchange, then redirect to its detail page to add people. */
    public function storeGroupExchange(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('group_exchanges'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $title = trim(self::asStr($request->input('title')));
        $hours = round((float) $request->input('total_hours'), 2);
        $rawSplit = self::asStr($request->input('split_type'));
        $splitType = in_array($rawSplit, ['equal', 'custom'], true) ? $rawSplit : 'equal';
        $description = trim(self::asStr($request->input('description')));

        if ($title === '' || $hours <= 0) {
            return redirect()->route('govuk-alpha.group-exchanges.create', ['tenantSlug' => $tenantSlug, 'status' => 'create-invalid']);
        }

        $id = null;
        try {
            $id = app(\App\Services\GroupExchangeService::class)->create($userId, [
                'title' => $title,
                'description' => $description,
                'total_hours' => $hours,
                'split_type' => $splitType,
                'status' => 'draft',
            ]);
        } catch (\Throwable $e) {
            report($e);
        }

        if (!$id) {
            return redirect()->route('govuk-alpha.group-exchanges.create', ['tenantSlug' => $tenantSlug, 'status' => 'create-failed']);
        }

        return redirect()->route('govuk-alpha.group-exchanges.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'created']);
    }

    /** Group exchange detail — info, participants, calculated split, and role-appropriate actions. */
    public function groupExchange(Request $request, string $tenantSlug, int $id): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('group_exchanges'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $svc = app(\App\Services\GroupExchangeService::class);
        $exchange = $svc->get($id);
        abort_if($exchange === null, 404);

        $participants = is_array($exchange['participants'] ?? null) ? $exchange['participants'] : [];
        $isOrganizer = (int) ($exchange['organizer_id'] ?? 0) === $userId;
        $viewerRow = null;
        foreach ($participants as $p) {
            if ((int) ($p['user_id'] ?? 0) === $userId) {
                $viewerRow = $p;
                break;
            }
        }
        $isParticipant = $viewerRow !== null;
        abort_unless($isOrganizer || $isParticipant, 403);

        // Organiser can edit while the exchange is not yet completed/cancelled.
        $editable = $isOrganizer && in_array($exchange['status'] ?? '', ['draft', 'pending', 'approved'], true);

        $splitByUser = [];
        try {
            foreach ($svc->calculateSplit($id) as $s) {
                $splitByUser[(int) ($s['user_id'] ?? 0)] = round((float) ($s['hours'] ?? 0), 2);
            }
        } catch (\Throwable $e) {
            report($e);
        }

        // Member search to add a participant (organiser + editable only). Hide
        // anyone already in the exchange.
        $existingIds = array_map(static fn ($p): int => (int) ($p['user_id'] ?? 0), $participants);
        $participantQuery = trim(self::asStr($request->query('participant_q')));
        $participantResults = [];
        if ($editable && $participantQuery !== '') {
            $participantResults = array_values(array_filter(
                $this->messageUserSearch($participantQuery, $userId),
                static fn ($r): bool => !in_array((int) ($r['id'] ?? 0), $existingIds, true)
            ));
        }

        return $this->view('accessible-frontend::group-exchange-detail', [
            'title' => ($exchange['title'] ?? '') ?: __('govuk_alpha.group_exchanges.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'group_exchanges',
            'exchange' => $exchange,
            'participants' => $participants,
            'splitByUser' => $splitByUser,
            'isOrganizer' => $isOrganizer,
            'isParticipant' => $isParticipant,
            'editable' => $editable,
            'viewerConfirmed' => (bool) ($viewerRow['confirmed'] ?? false),
            'participantQuery' => $participantQuery,
            'participantResults' => $participantResults,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    public function addGroupExchangeParticipant(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $userId = $this->geGuard($tenantSlug);
        if (is_object($userId)) {
            return $userId;
        }

        $svc = app(\App\Services\GroupExchangeService::class);
        $exchange = $svc->get($id);
        if ($exchange === null) {
            abort(404);
        }
        // Organiser only, and only while the exchange is still editable.
        if ((int) ($exchange['organizer_id'] ?? 0) !== $userId || !in_array($exchange['status'] ?? '', ['draft', 'pending', 'approved'], true)) {
            return $this->geRedirect($tenantSlug, $id, 'add-failed');
        }

        $participantId = (int) $request->input('participant_id');
        $rawRole = self::asStr($request->input('role'));
        $role = in_array($rawRole, ['provider', 'receiver'], true) ? $rawRole : 'provider';
        $hours = round((float) $request->input('hours'), 2);
        if ($hours < 0) {
            $hours = 0;
        }

        // Defensive same-tenant check (the service does not re-scope the id).
        $sameTenant = $participantId > 0 && DB::table('users')
            ->where('id', $participantId)
            ->where('tenant_id', TenantContext::getId())
            ->exists();
        if (!$sameTenant) {
            return $this->geRedirect($tenantSlug, $id, 'add-failed');
        }

        $ok = false;
        try {
            $ok = $svc->addParticipant($id, $participantId, $role, $hours, 1.0);
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->geRedirect($tenantSlug, $id, $ok ? 'participant-added' : 'add-failed');
    }

    public function removeGroupExchangeParticipant(Request $request, string $tenantSlug, int $id, int $participantUserId): RedirectResponse
    {
        $userId = $this->geGuard($tenantSlug);
        if (is_object($userId)) {
            return $userId;
        }

        $svc = app(\App\Services\GroupExchangeService::class);
        $exchange = $svc->get($id);
        if ($exchange === null) {
            abort(404);
        }
        if ((int) ($exchange['organizer_id'] ?? 0) !== $userId || !in_array($exchange['status'] ?? '', ['draft', 'pending', 'approved'], true)) {
            return $this->geRedirect($tenantSlug, $id, 'failed');
        }

        $ok = false;
        try {
            $ok = $svc->removeParticipant($id, $participantUserId);
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->geRedirect($tenantSlug, $id, $ok ? 'participant-removed' : 'failed');
    }

    public function confirmGroupExchange(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $userId = $this->geGuard($tenantSlug);
        if (is_object($userId)) {
            return $userId;
        }

        $svc = app(\App\Services\GroupExchangeService::class);
        $exchange = $svc->get($id);
        if ($exchange === null) {
            abort(404);
        }
        $participants = is_array($exchange['participants'] ?? null) ? $exchange['participants'] : [];
        $isParticipant = false;
        foreach ($participants as $p) {
            if ((int) ($p['user_id'] ?? 0) === $userId) {
                $isParticipant = true;
                break;
            }
        }
        if (!$isParticipant) {
            return $this->geRedirect($tenantSlug, $id, 'failed');
        }

        $ok = false;
        try {
            $ok = $svc->confirmParticipation($id, $userId);
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->geRedirect($tenantSlug, $id, $ok ? 'confirmed' : 'failed');
    }

    public function completeGroupExchange(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $userId = $this->geGuard($tenantSlug);
        if (is_object($userId)) {
            return $userId;
        }

        $svc = app(\App\Services\GroupExchangeService::class);
        $exchange = $svc->get($id);
        if ($exchange === null) {
            abort(404);
        }
        if ((int) ($exchange['organizer_id'] ?? 0) !== $userId) {
            abort(403);
        }

        $success = false;
        try {
            $result = $svc->complete($id);
            $success = (bool) ($result['success'] ?? false);
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->geRedirect($tenantSlug, $id, $success ? 'completed' : 'complete-failed');
    }

    public function cancelGroupExchange(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $userId = $this->geGuard($tenantSlug);
        if (is_object($userId)) {
            return $userId;
        }

        $svc = app(\App\Services\GroupExchangeService::class);
        $exchange = $svc->get($id);
        if ($exchange === null) {
            abort(404);
        }
        if ((int) ($exchange['organizer_id'] ?? 0) !== $userId) {
            abort(403);
        }

        $ok = false;
        try {
            $ok = $svc->updateStatus($id, 'cancelled');
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->geRedirect($tenantSlug, $id, $ok ? 'cancelled' : 'failed');
    }

    /** Shared auth/feature guard for group-exchange POST actions; returns the user id or a redirect. */
    private function geGuard(string $tenantSlug): int|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('group_exchanges'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        return $userId;
    }

    /**
     * Feature-agnostic auth guard: assert the slug and resolve the current user,
     * redirecting to login when absent. Callers MUST apply their own module gate
     * (hasFeature/hasModule) immediately after. This exists because geGuard()
     * also enforces the 'group_exchanges' feature and must stay reserved for
     * group-exchange handlers — using it as a generic auth guard 403s unrelated
     * actions (group join/leave, goals, organisation registration) whenever a
     * tenant disables the group-exchanges feature.
     */
    private function alphaAuthGuard(string $tenantSlug): int|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        return $userId;
    }

    private function geRedirect(string $tenantSlug, int $id, string $status): RedirectResponse
    {
        return redirect()->route('govuk-alpha.group-exchanges.show', [
            'tenantSlug' => $tenantSlug, 'id' => $id, 'status' => $status,
        ])->withFragment('group-exchange-top');
    }

    /** Time-credit wallet: balance, transaction history, and a transfer form. */
    public function wallet(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('wallet'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $walletService = app(\App\Services\WalletService::class);

        $wallet = null;
        try {
            $wallet = $walletService->getBalance($userId);
        } catch (\Throwable $e) {
            report($e);
        }

        // WAVE T1-WALLET: server-rendered transaction filter (all/earned/spent/pending)
        // + page-based pagination. The filter is a sanitised GET param so the no-JS
        // path can switch tabs and load further pages with plain links.
        $filter = self::walletFilterParam(self::asStr($request->query('filter')));
        $page = max(1, (int) $request->query('page', '1'));
        $perPage = 20;

        $txPage = ['items' => [], 'has_more' => false, 'page' => $page, 'filter' => $filter];
        try {
            $txPage = $this->walletTransactionsPage($userId, $filter, $page, $perPage);
        } catch (\Throwable $e) {
            report($e);
        }

        // WAVE T1-WALLET: community fund balance (read-only display + a donate target).
        $fund = null;
        try {
            $fund = \App\Services\CommunityFundService::getBalance();
        } catch (\Throwable $e) {
            report($e);
        }

        // Reuse the tenant-scoped member search to pick a recipient safely.
        // A `recipient_id` (set by the JS autocomplete enhancement when a member
        // is picked) resolves to exactly that one member; otherwise fall back to
        // the no-JS text search. Both honour the same tenant + privacy filters.
        $recipientId = (int) $request->query('recipient_id');
        $recipientQuery = trim(self::asStr($request->query('recipient_q')));
        if ($recipientId > 0) {
            $recipientResults = $this->walletRecipientById($recipientId, $userId);
        } elseif ($recipientQuery !== '') {
            $recipientResults = $this->messageUserSearch($recipientQuery, $userId);
        } else {
            $recipientResults = [];
        }

        return $this->view('accessible-frontend::wallet', [
            'title' => __('govuk_alpha.wallet.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'wallet',
            'wallet' => $wallet,
            'transactions' => $txPage['items'],
            'txFilter' => $filter,
            'txPage' => $txPage['page'],
            'txHasMore' => $txPage['has_more'],
            'fund' => $fund,
            'recipientQuery' => $recipientQuery,
            'recipientResults' => $recipientResults,
            'status' => self::asStr($request->query('status')) ?: null,
            'transferError' => self::asStr($request->query('error')) ?: null,
            'donateError' => self::asStr($request->query('donate_error')) ?: null,
        ]);
    }

    /** Transfer time credits to another member via the canonical WalletService. */
    public function transferCredits(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('wallet'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $recipientId = (int) $request->input('recipient_id');
        $amount = (float) $request->input('amount');
        $note = trim(self::asStr($request->input('note')));

        $fail = fn (string $error): RedirectResponse => redirect()->route('govuk-alpha.wallet.index', [
            'tenantSlug' => $tenantSlug, 'status' => 'transfer-failed', 'error' => $error,
        ])->withFragment('transfer');

        if ($recipientId <= 0 || $amount <= 0) {
            return $fail('invalid');
        }

        // Defensive tenant check: only ever transfer to a member of THIS tenant
        // (the WalletService resolves the recipient by id without re-scoping).
        $sameTenant = DB::table('users')
            ->where('id', $recipientId)
            ->where('tenant_id', TenantContext::getId())
            ->exists();
        if (!$sameTenant) {
            return $fail('not-found');
        }

        try {
            app(\App\Services\WalletService::class)->transfer($userId, [
                'recipient'      => $recipientId,
                'amount'         => $amount,
                'description'    => mb_substr($note, 0, 255),
                // Anti-double-submit: the form carries a per-render idempotency
                // token so a double-click collapses to one debit server-side.
                'idempotency_key' => self::asStr($request->input('idempotency_key')),
            ]);
        } catch (\App\Exceptions\SafeguardingPolicyException $e) {
            return $fail($e->reasonCode === 'SAFEGUARDING_POLICY_UNAVAILABLE'
                ? 'safeguarding-unavailable'
                : 'safeguarding');
        } catch (\Throwable $e) {
            $msg = $e->getMessage();
            return $fail(match (true) {
                str_contains($msg, 'Insufficient')  => 'insufficient',
                str_contains($msg, 'not found')     => 'not-found',
                str_contains($msg, 'yourself')      => 'self',
                str_contains($msg, 'not active')    => 'inactive',
                str_contains($msg, 'exceed')        => 'too-large',
                str_contains($msg, 'decimal')       => 'decimals',
                default                             => 'failed',
            });
        }

        return redirect()->route('govuk-alpha.wallet.index', ['tenantSlug' => $tenantSlug, 'status' => 'transfer-sent'])->withFragment('transactions');
    }

    public function conversation(Request $request, string $tenantSlug, int $userId): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('messages'), 403);

        $currentUserId = $this->currentUserId();
        if ($currentUserId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $conversation = MessageService::getConversation($userId, $currentUserId);
        abort_if($conversation === null, 404);

        $result = MessageService::getMessages($userId, $currentUserId, [
            'limit' => 50,
            'cursor' => self::asStr($request->query('cursor')) ?: null,
        ]);
        MessageService::markAsRead($userId, $currentUserId);

        $listing = null;
        if ($request->query('listing')) {
            $listing = $this->listingService->getById((int) $request->query('listing'), false, $currentUserId);
        }

        return $this->view('accessible-frontend::conversation', [
            'title' => __('govuk_alpha.messages.conversation_title', ['name' => $conversation['other_user']['name'] ?? __('govuk_alpha.members.unknown_member')]),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'messages',
            'conversation' => $conversation,
            'messages' => array_reverse($result['items'] ?? []),
            'meta' => ['has_more' => (bool) ($result['has_more'] ?? false), 'cursor' => $result['cursor'] ?? null],
            'listing' => $listing,
            'status' => self::asStr($request->query('status')) ?: null,
            'currentUserId' => $currentUserId,
            'directMessagingEnabled' => BrokerControlConfigService::isDirectMessagingEnabled(),
            'restriction' => app(\App\Services\BrokerMessageVisibilityService::class)->getUserRestrictionStatus($currentUserId),
        ]);
    }

    public function storeMessage(Request $request, string $tenantSlug, int $userId): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('messages'), 403);

        $currentUserId = $this->currentUserId();
        if ($currentUserId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $body = trim(self::asStr($request->input('body')));

        if (!BrokerControlConfigService::isDirectMessagingEnabled()) {
            return redirect()->route('govuk-alpha.messages.show', ['tenantSlug' => $tenantSlug, 'userId' => $userId, 'status' => 'message-disabled']);
        }

        // Run the authoritative contact checks before accepting any file bytes.
        // MessageService repeats the check immediately before persistence to
        // close the race between this preflight and the final write.
        $preflightError = MessageService::preflightWrite($currentUserId, $userId);
        if ($preflightError !== null) {
            return redirect()->route('govuk-alpha.messages.show', [
                'tenantSlug' => $tenantSlug,
                'userId' => $userId,
                'status' => self::accessibleMessageFailureStatus([$preflightError], 'message-failed'),
            ]);
        }

        // File/image attachments (no-JS multipart). Store each before sending so a
        // bad file is reported rather than silently dropped. Mirrors the React
        // composer + the API MessagesController::send attachment handling.
        $uploaded = $request->file('attachments');
        $files = is_array($uploaded) ? $uploaded : ($uploaded ? [$uploaded] : []);
        if (count($files) > \App\Core\MessageAttachmentUploader::MAX_FILES) {
            return redirect()->route('govuk-alpha.messages.show', ['tenantSlug' => $tenantSlug, 'userId' => $userId, 'status' => 'attachment-too-many']);
        }
        $attachments = [];
        foreach ($files as $file) {
            if (!$file || !$file->isValid()) {
                self::deleteAccessibleMessageAttachments($attachments);
                return redirect()->route('govuk-alpha.messages.show', ['tenantSlug' => $tenantSlug, 'userId' => $userId, 'status' => 'attachment-failed']);
            }
            try {
                $attachments[] = \App\Core\MessageAttachmentUploader::upload([
                    'name'     => $file->getClientOriginalName(),
                    'type'     => $file->getMimeType(),
                    'tmp_name' => $file->getRealPath(),
                    'error'    => UPLOAD_ERR_OK,
                    'size'     => $file->getSize(),
                ]);
            } catch (\InvalidArgumentException $e) {
                self::deleteAccessibleMessageAttachments($attachments);
                return redirect()->route('govuk-alpha.messages.show', ['tenantSlug' => $tenantSlug, 'userId' => $userId, 'status' => 'attachment-invalid']);
            } catch (\Throwable $e) {
                self::deleteAccessibleMessageAttachments($attachments);
                report($e);
                return redirect()->route('govuk-alpha.messages.show', ['tenantSlug' => $tenantSlug, 'userId' => $userId, 'status' => 'attachment-failed']);
            }
        }

        // A message needs either text or at least one attachment.
        if ($body === '' && empty($attachments)) {
            return redirect()->route('govuk-alpha.messages.show', ['tenantSlug' => $tenantSlug, 'userId' => $userId, 'status' => 'message-empty']);
        }

        $payload = [
            'recipient_id' => $userId,
            'body' => $body,
            'context_type' => $request->input('context_type') ?: null,
            'context_id' => $request->input('context_id') ?: null,
        ];
        if (!empty($attachments)) {
            $payload['attachments'] = $attachments;
        }

        $message = MessageService::send($currentUserId, $payload);

        if ($message === []) {
            self::deleteAccessibleMessageAttachments($attachments);
        }

        return redirect()->route('govuk-alpha.messages.show', [
            'tenantSlug' => $tenantSlug,
            'userId' => $userId,
            'status' => $message !== []
                ? 'message-sent'
                : self::accessibleMessageFailureStatus(MessageService::getErrors(), 'message-failed'),
        ]);
    }

    /**
     * Send a voice message in a 1-to-1 conversation (no-JS): the user uploads a
     * recorded audio clip (on mobile, the file input's `capture` opens the
     * recorder directly). Mirrors the React MediaRecorder flow via the same
     * AudioUploader + voice send path. The clip is transcribed best-effort BEFORE
     * upload so it is captioned for deaf/hard-of-hearing recipients.
     */
    public function storeVoiceMessage(Request $request, string $tenantSlug, int $userId): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('messages'), 403);

        $currentUserId = $this->currentUserId();
        if ($currentUserId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        if (!BrokerControlConfigService::isDirectMessagingEnabled()) {
            return redirect()->route('govuk-alpha.messages.show', ['tenantSlug' => $tenantSlug, 'userId' => $userId, 'status' => 'message-disabled']);
        }

        // Do not transcribe or store a voice clip until the same direct-message
        // gate used by MessageService confirms the attempted contact may proceed.
        $preflightError = MessageService::preflightWrite($currentUserId, $userId);
        if ($preflightError !== null) {
            return redirect()->route('govuk-alpha.messages.show', [
                'tenantSlug' => $tenantSlug,
                'userId' => $userId,
                'status' => self::accessibleMessageFailureStatus([$preflightError], 'voice-failed'),
            ]);
        }

        $file = $request->file('voice');
        if (!$file || !$file->isValid()) {
            return redirect()->route('govuk-alpha.messages.show', ['tenantSlug' => $tenantSlug, 'userId' => $userId, 'status' => 'voice-required']);
        }

        // Transcribe BEFORE the upload moves the temp file (best-effort; a failure
        // or missing transcription provider never blocks the send).
        $transcript = null;
        try {
            $tmpPath = $file->getRealPath();
            if ($tmpPath && is_file($tmpPath)) {
                $result = \App\Services\TranscriptionService::transcribe($tmpPath);
                if (is_array($result) && !empty($result['text'])) {
                    $transcript = (string) $result['text'];
                }
            }
        } catch (\Throwable $e) {
            report($e);
        }

        try {
            // duration=0 → AudioUploader skips its max-duration gate (we cannot
            // reliably probe clip length server-side without ffprobe). The 10 MB
            // file-size ceiling in AudioUploader is the effective bound here.
            $audioResult = \App\Core\AudioUploader::upload([
                'name'     => $file->getClientOriginalName(),
                'type'     => $file->getMimeType(),
                'tmp_name' => $file->getRealPath(),
                'error'    => UPLOAD_ERR_OK,
                'size'     => $file->getSize(),
            ], 0);
        } catch (\Throwable $e) {
            report($e);
            return redirect()->route('govuk-alpha.messages.show', ['tenantSlug' => $tenantSlug, 'userId' => $userId, 'status' => 'voice-failed']);
        }

        $message = MessageService::sendVoice(
            $currentUserId,
            $userId,
            (string) ($audioResult['url'] ?? ''),
            (int) ($audioResult['duration'] ?? 0),
        );

        if (empty($message)) {
            \App\Core\AudioUploader::delete((string) ($audioResult['url'] ?? ''));
            return redirect()->route('govuk-alpha.messages.show', [
                'tenantSlug' => $tenantSlug,
                'userId' => $userId,
                'status' => self::accessibleMessageFailureStatus(MessageService::getErrors(), 'voice-failed'),
            ]);
        }

        if ($transcript !== null && !empty($message['id'])) {
            try {
                \Illuminate\Support\Facades\DB::table('messages')
                    ->where('id', (int) $message['id'])
                    ->where('tenant_id', TenantContext::getId())
                    ->update(['transcript' => $transcript]);
            } catch (\Throwable $e) {
                report($e);
            }
        }

        return redirect()->route('govuk-alpha.messages.show', ['tenantSlug' => $tenantSlug, 'userId' => $userId, 'status' => 'message-sent']);
    }

    /** @param array<int, array<string, mixed>> $errors */
    private static function accessibleMessageFailureStatus(array $errors, string $fallback): string
    {
        return match ($errors[0]['code'] ?? null) {
            'SAFEGUARDING_POLICY_UNAVAILABLE' => 'message-policy-unavailable',
            'VETTING_REQUIRED' => 'message-vetting-required',
            'SAFEGUARDING_CONTACT_RESTRICTED' => 'message-contact-restricted',
            'MESSAGING_DISABLED' => 'message-disabled',
            default => $fallback,
        };
    }

    /** @param array<int, array<string, mixed>> $attachments */
    private static function deleteAccessibleMessageAttachments(array $attachments): void
    {
        foreach ($attachments as $attachment) {
            \App\Core\MessageAttachmentUploader::delete((string) ($attachment['url'] ?? ''));
        }
    }

    public function archiveConversation(string $tenantSlug, int $userId): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('messages'), 403);

        $currentUserId = $this->currentUserId();
        if ($currentUserId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        MessageService::archiveConversation($userId, $currentUserId, 'self');

        return redirect()->route('govuk-alpha.messages.index', ['tenantSlug' => $tenantSlug, 'status' => 'conversation-archived']);
    }

    public function restoreConversation(string $tenantSlug, int $userId): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('messages'), 403);

        $currentUserId = $this->currentUserId();
        if ($currentUserId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        MessageService::unarchiveConversation($userId, $currentUserId);

        return redirect()->route('govuk-alpha.messages.index', ['tenantSlug' => $tenantSlug, 'archived' => 1, 'status' => 'conversation-restored']);
    }

    /**
     * Edit one of the current user's own messages (24-hour window, mirrors PUT /v2/messages/{id}).
     */
    public function updateMessage(Request $request, string $tenantSlug, int $userId, int $messageId): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('messages'), 403);

        $currentUserId = $this->currentUserId();
        if ($currentUserId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $body = trim(self::asStr($request->input('body')));
        if ($body === '') {
            return redirect()->route('govuk-alpha.messages.show', ['tenantSlug' => $tenantSlug, 'userId' => $userId, 'status' => 'message-empty']);
        }

        $result = MessageService::editMessage($messageId, $currentUserId, $body);

        $status = 'message-edited';
        if ($result === null) {
            $code = MessageService::getErrors()[0]['code'] ?? 'NOT_FOUND';
            $status = match ($code) {
                'FORBIDDEN'    => 'message-edit-forbidden',
                'EDIT_EXPIRED' => 'message-edit-expired',
                default        => 'message-edit-failed',
            };
        }

        return redirect()->route('govuk-alpha.messages.show', ['tenantSlug' => $tenantSlug, 'userId' => $userId, 'status' => $status]);
    }

    /**
     * Delete one of the current user's messages, scope self|everyone (mirrors DELETE /v2/messages/{id}).
     */
    public function deleteMessage(Request $request, string $tenantSlug, int $userId, int $messageId): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('messages'), 403);

        $currentUserId = $this->currentUserId();
        if ($currentUserId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $scope = in_array($request->input('scope'), ['self', 'everyone'], true)
            ? self::asStr($request->input('scope'))
            : 'everyone';

        $success = MessageService::deleteMessage($messageId, $currentUserId, $scope);

        return redirect()->route('govuk-alpha.messages.show', [
            'tenantSlug' => $tenantSlug,
            'userId'     => $userId,
            'status'     => $success ? 'message-deleted' : 'message-delete-failed',
        ]);
    }

    public function members(Request $request, string $tenantSlug): Response
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('connections'), 403);
        $userId = $this->currentUserId();
        $filters = $this->memberFilters($request);
        $items = [];
        $meta = ['total_items' => 0, 'offset' => $filters['offset'], 'per_page' => $filters['limit'], 'has_more' => false];
        $error = null;

        if ($userId !== null) {
            try {
                $result = $this->memberDirectory($filters, $userId);
                $items = $result['items'];
                $meta = $result['meta'];
            } catch (\Throwable $e) {
                report($e);
                $error = __('govuk_alpha.states.error_title');
            }
        }

        return $this->view('accessible-frontend::members', [
            'title' => __('govuk_alpha.members.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'members',
            'items' => $items,
            'meta' => $meta,
            'filters' => $filters,
            'requiresAuth' => $userId === null,
            'error' => $error,
        ]);
    }

    public function myProfile(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();

        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        return $this->memberProfile($request, $tenantSlug, $userId);
    }

    public function memberProfile(Request $request, string $tenantSlug, int $id): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('connections'), 403);
        $viewerId = $this->currentUserId();

        if ($viewerId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $profile = $this->profileForViewer($id, $viewerId);
        abort_if($profile === null, 404);

        $displayName = $this->profileDisplayName($profile);

        return $this->view('accessible-frontend::profile', [
            'title' => $displayName,
            'tenantSlug' => $tenantSlug,
            'activeNav' => $id === $viewerId ? 'profile' : 'members',
            'profile' => $profile,
            'displayName' => $displayName,
            'isOwnProfile' => $id === $viewerId,
            // Identity-verified trust tag keys on the id_verified badge, NOT the
            // email-verified `is_verified` column (mirrors React VerificationBadgeRow).
            'identityVerified' => $this->alphaIdentityVerified($id),
            'status' => self::asStr($request->query('status')) ?: null,
            'profileStats' => $this->profileStats($profile),
            'profileListings' => $this->profileListings($id),
            'profileSkills' => $this->profileSkills($id, $profile),
            'profileAvailability' => $this->profileAvailability($id, $profile),
            'profileReviews' => $this->profileReviews($id),
            'memberId' => $id,
            'directMessagingEnabled' => BrokerControlConfigService::isDirectMessagingEnabled(),
            'profileBadges' => $this->memberBadges($id),
            'connectionState' => $id === $viewerId
                ? null
                : (ConnectionService::getStatus($viewerId, $id)['status'] ?? 'none'),
            'endorsements' => $this->memberEndorsements($id, $viewerId),
            'canEndorse' => $id !== $viewerId,
            'profileActivity' => $this->profileActivity($id),
            'isBlocked' => $id === $viewerId ? false : \App\Services\BlockUserService::isBlocked($viewerId, $id),
        ]);
    }

    // ===== WAVE T1-SAFETY: block users + authenticator-app 2FA enrolment =====

    /**
     * Block another member (mirrors POST /v2/users/{id}/block). Auto-disconnects
     * any connection (handled by the service). Tenant + self scoped.
     */
    public function blockMember(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('connections'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        if ($id === $userId) {
            return redirect()->route('govuk-alpha.members.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'block-self']);
        }

        $exists = DB::table('users')->where('id', $id)->where('tenant_id', TenantContext::getId())->exists();
        abort_unless($exists, 404);

        $status = 'member-blocked';
        try {
            \App\Services\BlockUserService::block($userId, $id, self::asStr($request->input('reason')) ?: null);
        } catch (\RuntimeException $e) {
            $status = 'block-self';
        } catch (\Throwable $e) {
            report($e);
            $status = 'block-failed';
        }

        return redirect()->route('govuk-alpha.members.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => $status]);
    }

    /**
     * Unblock a member (mirrors DELETE /v2/users/{id}/block). 'from=list' returns
     * to the blocked-users settings page; otherwise back to the member profile.
     */
    public function unblockMember(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('connections'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        \App\Services\BlockUserService::unblock($userId, $id);

        if (self::asStr($request->input('from')) === 'list') {
            return redirect()->route('govuk-alpha.profile.blocked', ['tenantSlug' => $tenantSlug, 'status' => 'member-unblocked']);
        }

        return redirect()->route('govuk-alpha.members.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'member-unblocked']);
    }

    /**
     * Blocked-users management page (mirrors GET /v2/users/blocked).
     */
    public function blockedUsers(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $blocked = \App\Services\BlockUserService::getBlockedUsers($userId);

        return $this->view('accessible-frontend::blocked-users', [
            'title' => __('govuk_alpha.blocked_users.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'profile',
            'blocked' => $blocked->all(),
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /**
     * Authenticator-app (TOTP) 2FA setup page. When 2FA is off this initialises a
     * fresh secret + QR (server-rendered SVG, no JS) and shows a verify form; when
     * on it shows status + a password-gated disable form. Mirrors the React
     * Security tab's TOTP flow (only the passkey ceremony is JS-only/excluded).
     */
    public function twoFactorSetup(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $totp = app(\App\Services\TotpService::class);
        $enabled = $totp->isEnabled($userId);
        abort_if(!$enabled && !TenantContext::hasFeature('two_factor_authentication'), 403);

        $setup = null;
        if (!$enabled) {
            try {
                $init = $totp->initializeSetup($userId);
                $setup = [
                    'qr_data_uri' => 'data:image/svg+xml;base64,' . base64_encode((string) ($init['qr_code'] ?? '')),
                    'secret' => self::asStr($init['secret'] ?? ''),
                ];
            } catch (\Throwable $e) {
                report($e);
            }
        }

        return $this->view('accessible-frontend::two-factor-setup', [
            'title' => __('govuk_alpha.security_2fa.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'profile',
            'enabled' => $enabled,
            'setup' => $setup,
            'backupCodesRemaining' => $enabled ? (int) $totp->getBackupCodeCount($userId) : 0,
            'status' => self::asStr($request->query('status')) ?: null,
            'backupCodes' => [],
        ]);
    }

    /**
     * Verify the 6-digit code and enable TOTP 2FA. On success the one-time backup
     * codes are rendered once (this is the only moment they are shown).
     */
    public function verifyTwoFactorSetup(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }
        abort_unless(TenantContext::hasFeature('two_factor_authentication'), 403);

        $code = trim(self::asStr($request->input('code')));
        if ($code === '') {
            return redirect()->route('govuk-alpha.profile.2fa', ['tenantSlug' => $tenantSlug, 'status' => '2fa-code-required']);
        }

        $result = app(\App\Services\TotpService::class)->completeSetup($userId, $code);
        if (empty($result['success'])) {
            return redirect()->route('govuk-alpha.profile.2fa', ['tenantSlug' => $tenantSlug, 'status' => '2fa-code-invalid']);
        }

        $this->dispatch2faSecurityAlert($userId, true);

        // Backup codes are shown exactly once, so render them on the POST response
        // rather than redirecting (a redirect would lose them).
        return $this->view('accessible-frontend::two-factor-setup', [
            'title' => __('govuk_alpha.security_2fa.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'profile',
            'enabled' => true,
            'setup' => null,
            'backupCodesRemaining' => count($result['backup_codes'] ?? []),
            'status' => '2fa-enabled',
            'backupCodes' => is_array($result['backup_codes'] ?? null) ? $result['backup_codes'] : [],
        ]);
    }

    /**
     * Disable TOTP 2FA. Requires the account password (mirrors the API disable).
     */
    public function disableTwoFactor(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $password = self::asStr($request->input('password'));
        if ($password === '') {
            return redirect()->route('govuk-alpha.profile.2fa', ['tenantSlug' => $tenantSlug, 'status' => '2fa-password-required']);
        }

        $result = app(\App\Services\TotpService::class)->disable($userId, $password);
        if (empty($result['success'])) {
            return redirect()->route('govuk-alpha.profile.2fa', ['tenantSlug' => $tenantSlug, 'status' => '2fa-disable-failed']);
        }

        $this->dispatch2faSecurityAlert($userId, false);

        return redirect()->route('govuk-alpha.profile.2fa', ['tenantSlug' => $tenantSlug, 'status' => '2fa-disabled']);
    }

    /**
     * Bell + email security alert when 2FA is enabled/disabled, rendered in the
     * member's own preferred_language. Best-effort: never changes the outcome.
     */
    private function dispatch2faSecurityAlert(int $userId, bool $enabled): void
    {
        try {
            $user = \App\Models\User::query()->find($userId);
            if ($user === null) {
                return;
            }
            $locale = $user->preferred_language ?? null;
            $tpl = $enabled ? '2fa_enabled' : '2fa_disabled';
            $event = $enabled ? '2fa_enabled' : '2fa_disabled';
            $msgKey = $enabled ? 'api_controllers_2.two_factor.enabled_notification' : 'api_controllers_2.two_factor.disabled_notification';

            \App\I18n\LocaleContext::withLocale($locale, function () use ($userId, $msgKey, $event) {
                \App\Models\Notification::createNotification($userId, __($msgKey), null, $event);
                \App\Services\NotificationDispatcher::fanOutPush($userId, $event, __($msgKey), null);
            });

            if (!empty($user->email)) {
                $tenantId = (int) ($user->tenant_id ?? TenantContext::getId());
                $theme = $enabled ? 'success' : 'danger';
                TenantContext::runForTenant($tenantId, function () use ($user, $locale, $tenantId, $tpl, $theme) {
                    \App\I18n\LocaleContext::withLocale($locale, function () use ($user, $tenantId, $tpl, $theme) {
                        $tenantName = TenantContext::get()['name'] ?? 'Project NEXUS';
                        $html = \App\Core\EmailTemplateBuilder::make()
                            ->theme($theme)
                            ->title(__("emails_security_alerts.{$tpl}.title"))
                            ->previewText(__("emails_security_alerts.{$tpl}.preview"))
                            ->greeting(self::asStr($user->first_name ?? $user->name ?? ''))
                            ->paragraph(__("emails_security_alerts.{$tpl}.body"))
                            ->paragraph(__("emails_security_alerts.{$tpl}.warning"))
                            ->render();
                        $subject = __("emails_security_alerts.{$tpl}.subject", ['community' => $tenantName]);
                        \App\Services\EmailDispatchService::sendRaw($user->email, $subject, $html, null, null, null, 'security_alert', ['tenant_id' => $tenantId]);
                    });
                });
            }
        } catch (\Throwable $e) {
            report($e);
        }
    }

    /**
     * Recent public activity for a member (posts, hours, comments, connections,
     * event RSVPs) via the shared MemberActivityService. Never blocks render.
     *
     * @return array<int, array<string, mixed>>
     */
    private function profileActivity(int $id): array
    {
        try {
            return app(\App\Services\MemberActivityService::class)
                ->getRecentTimeline($id, TenantContext::getId(), 12);
        } catch (\Throwable $e) {
            report($e);

            return [];
        }
    }

    /**
     * Skill-endorsement counts for a profile, plus the set of skills the viewer
     * has already endorsed (so the UI can offer endorse vs remove). Never blocks
     * the page render.
     *
     * @return array{counts: array<string, int>, viewerEndorsed: array<int, string>}
     */
    private function memberEndorsements(int $profileUserId, int $viewerId): array
    {
        $counts = [];
        $viewerEndorsed = [];

        try {
            foreach (\App\Services\EndorsementService::getEndorsements($profileUserId) as $group) {
                $skill = (string) ($group['skill_name'] ?? '');
                if ($skill === '') {
                    continue;
                }
                $counts[$skill] = (int) ($group['count'] ?? 0);
                foreach (($group['endorsers'] ?? []) as $endorser) {
                    if ((int) ($endorser['id'] ?? 0) === $viewerId) {
                        $viewerEndorsed[] = $skill;
                    }
                }
            }
        } catch (\Throwable $e) {
            report($e);
        }

        return ['counts' => $counts, 'viewerEndorsed' => $viewerEndorsed];
    }

    public function endorseMemberSkill(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('connections'), 403);

        $viewerId = $this->currentUserId();
        if ($viewerId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $skillName = trim(self::asStr($request->input('skill_name')));
        $action = $this->allowed($request->input('action'), ['endorse', 'remove'], '');

        if ($id === $viewerId || $skillName === '' || $action === '') {
            return redirect()->route('govuk-alpha.members.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'endorsement-failed']);
        }

        // Confirm the target is a real member of this tenant before acting.
        abort_if($this->profileForViewer($id, $viewerId) === null, 404);

        $status = 'endorsement-failed';
        try {
            if ($action === 'endorse') {
                $status = \App\Services\EndorsementService::endorse($viewerId, $id, $skillName) !== null
                    ? 'endorsement-added' : 'endorsement-failed';
            } else {
                $status = \App\Services\EndorsementService::removeEndorsement($viewerId, $id, $skillName)
                    ? 'endorsement-removed' : 'endorsement-failed';
            }
        } catch (\App\Exceptions\SafeguardingPolicyException $e) {
            $status = $e->reasonCode === 'SAFEGUARDING_POLICY_UNAVAILABLE'
                ? 'endorsement-safeguarding-unavailable'
                : 'endorsement-safeguarding-restricted';
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.members.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => $status]);
    }

    /**
     * Send, accept, decline, cancel or remove a connection with another member.
     *
     * The action is dispatched on a single posted field (mirroring the exchange
     * action form), and every transition is re-validated against the live
     * connection status server-side so a stale form cannot drive an invalid
     * state change. The connection id is always resolved from the service, never
     * trusted from the request.
     */
    public function updateMemberConnection(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('connections'), 403);

        $viewerId = $this->currentUserId();
        if ($viewerId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        if ($id === $viewerId) {
            return redirect()->route('govuk-alpha.members.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'connection-failed']);
        }

        // Confirm the target is a real member of this tenant before acting.
        $target = $this->profileForViewer($id, $viewerId);
        abort_if($target === null, 404);

        $action = $this->allowed($request->input('action'), ['connect', 'accept', 'decline', 'cancel', 'remove'], '');
        $current = ConnectionService::getStatus($viewerId, $id);
        $connectionId = (int) ($current['connection_id'] ?? 0);
        $status = 'connection-failed';

        try {
            switch ($action) {
                case 'connect':
                    if (($current['status'] ?? 'none') === 'none') {
                        $status = ConnectionService::sendRequest($viewerId, $id) === true
                            ? 'connection-sent' : 'connection-failed';
                    }
                    break;
                case 'accept':
                    if (($current['status'] ?? null) === 'pending_received' && $connectionId > 0) {
                        $status = ConnectionService::acceptRequest($connectionId, $viewerId)
                            ? 'connection-accepted' : 'connection-failed';
                    }
                    break;
                case 'decline':
                    if (($current['status'] ?? null) === 'pending_received' && $connectionId > 0) {
                        $status = ConnectionService::rejectRequest($connectionId, $viewerId)
                            ? 'connection-declined' : 'connection-failed';
                    }
                    break;
                case 'cancel':
                    if (($current['status'] ?? null) === 'pending_sent' && $connectionId > 0) {
                        $status = ConnectionService::removeConnection($connectionId, $viewerId)
                            ? 'connection-cancelled' : 'connection-failed';
                    }
                    break;
                case 'remove':
                    if (($current['status'] ?? null) === 'connected' && $connectionId > 0) {
                        $status = ConnectionService::removeConnection($connectionId, $viewerId)
                            ? 'connection-removed' : 'connection-failed';
                    }
                    break;
            }
        } catch (\App\Exceptions\SafeguardingPolicyException $e) {
            $status = $e->reasonCode === 'SAFEGUARDING_POLICY_UNAVAILABLE'
                ? 'connection-safeguarding-unavailable'
                : 'connection-safeguarding-restricted';
        } catch (\Throwable $e) {
            report($e);
            $status = 'connection-failed';
        }

        return redirect()->route('govuk-alpha.members.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => $status]);
    }

    /**
     * A member's earned badges (public achievements), for the profile page.
     *
     * @return array<int, array<string, mixed>>
     */
    private function memberBadges(int $userId): array
    {
        try {
            return \App\Services\GamificationService::getBadges($userId, TenantContext::getId());
        } catch (\Throwable $e) {
            report($e);

            return [];
        }
    }

    public function profileSettings(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();

        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $profile = $this->profileForViewer($userId, $userId);
        abort_if($profile === null, 404);

        $account = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', TenantContext::getId())
            ->select(
                'newsletter_opt_in', 'email', 'preferred_language',
                'prefers_chronological_feed', 'auto_translate_ugc', 'auto_translate_target_locale'
            )
            ->first();

        return $this->view('accessible-frontend::profile-settings', [
            'title' => __('govuk_alpha.profile_settings.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'profile',
            'profile' => $profile,
            'displayName' => $this->profileDisplayName($profile),
            'avatarUrl' => $profile['avatar_url'] ?? $profile['avatar'] ?? null,
            'marketingOptIn' => (bool) ($account->newsletter_opt_in ?? false),
            'currentEmail' => (string) ($account->email ?? ''),
            'currentLanguage' => (string) ($account->preferred_language ?? app()->getLocale()),
            'locales' => self::ALPHA_LOCALES,
            'notificationPrefs' => $this->alphaNotificationPrefs($userId),
            'digestFrequency' => $this->alphaDigestFrequency($userId),
            'passkeys' => $this->alphaPasskeys($userId),
            'twoFactorEnabled' => \App\Services\TotpService::isEnabled($userId),
            'twoFactorEnrollmentAllowed' => TenantContext::hasFeature('two_factor_authentication'),
            'passkeyEnrollmentAllowed' => (bool) config('webauthn.authentication_enabled', true)
                && TenantContext::hasFeature('biometric_login')
                && \App\Services\AuthenticationConfigurationService::get(
                    \App\Services\AuthenticationConfigurationService::CONFIG_PASSKEYS_ENROLLMENT_ENABLED,
                    true,
                    TenantContext::getId()
                ) === true,
            'prefersChronological' => (bool) ($account->prefers_chronological_feed ?? false),
            'autoTranslate' => (bool) ($account->auto_translate_ugc ?? false),
            'autoTranslateLocale' => (string) ($account->auto_translate_target_locale ?? $account->preferred_language ?? 'en'),
            'matchPrefs' => $this->alphaMatchPrefs($userId),
            'mySkills' => $this->alphaUserSkills($userId),
            'sessions' => $this->alphaSessions($userId),
            'safeguarding' => $this->alphaSafeguardingPreferences($userId),
            'vettingStatus' => $this->alphaVettingStatus($userId),
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /**
     * Match-digest preferences (frequency + hot/mutual toggles) for the alpha
     * settings page, mirroring MatchPreferencesController::show defaults.
     *
     * @return array{notification_frequency: string, notify_hot_matches: bool, notify_mutual_matches: bool}
     */
    private function alphaMatchPrefs(int $userId): array
    {
        $defaults = ['notification_frequency' => 'monthly', 'notify_hot_matches' => true, 'notify_mutual_matches' => true];
        try {
            $prefs = \App\Services\MatchingService::getPreferences($userId);

            return [
                'notification_frequency' => (string) ($prefs['notification_frequency'] ?? 'monthly'),
                'notify_hot_matches' => (bool) ($prefs['notify_hot_matches'] ?? true),
                'notify_mutual_matches' => (bool) ($prefs['notify_mutual_matches'] ?? true),
            ];
        } catch (\Throwable $e) {
            report($e);

            return $defaults;
        }
    }

    /**
     * The viewer's skills (offering/requesting) via the shared
     * SkillTaxonomyService (tenant-scoped internally).
     *
     * @return array<int, array<string, mixed>>
     */
    private function alphaUserSkills(int $userId): array
    {
        try {
            return app(\App\Services\SkillTaxonomyService::class)->getUserSkills($userId);
        } catch (\Throwable $e) {
            report($e);

            return [];
        }
    }

    /**
     * The viewer's active safeguarding preferences (label + what each one
     * activates), mirroring SafeguardingMemberController::myPreferences. Empty
     * for members who never set any.
     *
     * @return array<int, array<string, mixed>>
     */
    private function alphaSafeguardingPreferences(int $userId): array
    {
        try {
            $tenantId = TenantContext::getId();
            $rows = DB::table('user_safeguarding_preferences as p')
                ->join('tenant_safeguarding_options as o', function ($join) use ($tenantId) {
                    $join->on('o.id', '=', 'p.option_id')->where('o.tenant_id', $tenantId)->where('o.is_active', 1);
                })
                ->where('p.tenant_id', $tenantId)
                ->where('p.user_id', $userId)
                ->whereNull('p.revoked_at')
                ->select([
                    'p.option_id',
                    'p.selected_value',
                    'p.policy_review_required_at',
                    'p.policy_review_reason_code',
                    'o.option_key',
                    'o.option_type',
                    'o.preset_source',
                    'o.label',
                    'o.description',
                    'o.triggers',
                ])
                ->orderBy('o.sort_order')
                ->get();

            return $rows
                ->filter(static fn ($row): bool => UserSafeguardingPreference::isEffectivelySelected(
                    $row->option_type ?? null,
                    $row->selected_value ?? null,
                ))
                ->values()
                ->map(static function ($row): array {
                    $triggers = is_string($row->triggers) ? (json_decode($row->triggers, true) ?: []) : (array) ($row->triggers ?? []);

                    return [
                        'option_id' => (int) $row->option_id,
                        'label' => \App\Models\TenantSafeguardingOption::localizeOptionText(
                            $row->preset_source,
                            $row->option_key,
                            'label',
                            $row->label,
                        ),
                        'description' => \App\Models\TenantSafeguardingOption::localizeOptionText(
                            $row->preset_source,
                            $row->option_key,
                            'description',
                            $row->description,
                        ),
                        'restricts_messaging' => (bool) ($triggers['restricts_messaging'] ?? false),
                        'restricts_matching' => (bool) ($triggers['restricts_matching'] ?? false),
                        'requires_broker_approval' => (bool) ($triggers['requires_broker_approval'] ?? false),
                        'requires_vetted_interaction' => (bool) ($triggers['requires_vetted_interaction'] ?? false),
                        'policy_review_required' => $row->policy_review_required_at !== null,
                        'policy_review_reason_code' => $row->policy_review_reason_code,
                    ];
                })->all();
        } catch (\Throwable $e) {
            report($e);

            return [];
        }
    }

    /** @return array<string, mixed>|null */
    private function alphaVettingStatus(int $userId): ?array
    {
        try {
            return app(\App\Services\MemberVettingAttestationService::class)
                ->getMemberStatus(TenantContext::getId(), $userId);
        } catch (\Throwable $e) {
            report($e);

            return null;
        }
    }

    /**
     * The viewer's active sign-in sessions/devices (read-only list; no revoke
     * endpoint exists), mirroring UsersController::sessions.
     *
     * @return array<int, array<string, mixed>>
     */
    private function alphaSessions(int $userId): array
    {
        try {
            return DB::table('sessions')
                ->where('user_id', $userId)
                ->where('tenant_id', TenantContext::getId())
                ->where(function ($q) {
                    $q->whereNull('expires_at')->orWhere('expires_at', '>', now());
                })
                ->orderByDesc('last_activity')
                ->limit(20)
                ->select(['id', 'ip_address', 'user_agent', 'device_type', 'last_activity'])
                ->get()
                ->map(static fn ($r): array => (array) $r)
                ->all();
        } catch (\Throwable $e) {
            report($e);

            return [];
        }
    }

    /**
     * The notification toggles with their defaults, mirroring
     * UsersController::notificationPreferences so the alpha settings page
     * shows the same controls as the React NotificationsTab.
     *
     * @return array<string, bool>
     */
    private function alphaNotificationPrefs(int $userId): array
    {
        $prefs = User::getNotificationPreferences($userId);
        $fedEnabled = (bool) (DB::table('users')->where('id', $userId)->value('federation_notifications_enabled') ?? 1);

        return [
            'email_messages'                => (bool) ($prefs['email_messages'] ?? true),
            'email_connections'             => (bool) ($prefs['email_connections'] ?? true),
            'caring_smart_nudges'           => (bool) ($prefs['caring_smart_nudges'] ?? true),
            'federation_notifications_enabled' => $fedEnabled,
            'email_listings'                => (bool) ($prefs['email_listings'] ?? true),
            'email_events'                  => (bool) ($prefs['email_events'] ?? true),
            'email_transactions'            => (bool) ($prefs['email_transactions'] ?? true),
            'email_reviews'                 => (bool) ($prefs['email_reviews'] ?? true),
            'email_gamification_digest'     => (bool) ($prefs['email_gamification_digest'] ?? true),
            'email_gamification_milestones' => (bool) ($prefs['email_gamification_milestones'] ?? true),
            'email_digest'                  => (bool) ($prefs['email_digest'] ?? false),
            'email_org_payments'            => (bool) ($prefs['email_org_payments'] ?? true),
            'email_org_transfers'           => (bool) ($prefs['email_org_transfers'] ?? true),
            'email_org_membership'          => (bool) ($prefs['email_org_membership'] ?? true),
            'email_org_admin'               => (bool) ($prefs['email_org_admin'] ?? true),
            'push_enabled'                  => (bool) ($prefs['push_enabled'] ?? true),
            'push_campaigns_opted_in'       => (bool) ($prefs['push_campaigns_opted_in'] ?? false),
        ];
    }

    /**
     * The member's activity-digest frequency (notification_settings, global
     * context). Mirrors UsersController: legacy 'weekly' normalises to
     * 'monthly', and the absence of a row means the member has not opted in.
     */
    private function alphaDigestFrequency(int $userId): string
    {
        $frequency = DB::table('notification_settings')
            ->where('user_id', $userId)
            ->where('context_type', 'global')
            ->where('context_id', 0)
            ->value('frequency');

        $frequency = $frequency === null ? 'off' : (string) $frequency;

        return $frequency === 'weekly' ? 'monthly' : $frequency;
    }

    /** The activity-digest frequencies the member may choose. */
    private const ALPHA_DIGEST_FREQUENCIES = ['off', 'instant', 'daily', 'monthly'];

    /**
     * Persist the alpha notification-preference form. Checkboxes that are
     * unticked do not post, so every known key is read as a boolean (absent =
     * off) to honour the user's full intent.
     */
    public function updateProfileNotifications(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $jsonKeys = [
            'email_messages', 'email_connections', 'caring_smart_nudges',
            'email_listings', 'email_events', 'email_transactions', 'email_reviews',
            'email_gamification_digest', 'email_gamification_milestones', 'email_digest',
            'email_org_payments', 'email_org_transfers', 'email_org_membership', 'email_org_admin',
            'push_enabled', 'push_campaigns_opted_in',
        ];
        $prefs = [];
        foreach ($jsonKeys as $key) {
            $prefs[$key] = $request->boolean($key);
        }

        try {
            $ok = User::updateNotificationPreferences($userId, $prefs);
            DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', TenantContext::getId())
                ->update([
                    'federation_notifications_enabled' => $request->boolean('federation_notifications_enabled') ? 1 : 0,
                    'updated_at' => now(),
                ]);

            // Activity-digest frequency lives in notification_settings (global
            // context), exactly as UsersController::updateNotificationSettings
            // writes it. Only accept the known set; anything else is ignored.
            $digest = self::asStr($request->input('digest_frequency'));
            if (in_array($digest, self::ALPHA_DIGEST_FREQUENCIES, true)) {
                DB::table('notification_settings')->updateOrInsert(
                    ['user_id' => $userId, 'context_type' => 'global', 'context_id' => 0],
                    ['frequency' => $digest]
                );
            }
        } catch (\Throwable $e) {
            report($e);
            $ok = false;
        }

        return redirect()->route('govuk-alpha.profile.settings', [
            'tenantSlug' => $tenantSlug,
            'status' => $ok ? 'notifications-saved' : 'notifications-failed',
        ])->withFragment('notifications');
    }

    /**
     * The viewer's registered passkeys (tenant + user scoped), mirroring
     * WebAuthnController::credentials so the alpha settings page can list,
     * rename and remove them without JavaScript.
     *
     * @return array<int, array<string, mixed>>
     */
    private function alphaPasskeys(int $userId): array
    {
        try {
            $rows = DB::select(
                'SELECT credential_id, device_name, authenticator_type, created_at, last_used_at
                 FROM webauthn_credentials
                 WHERE user_id = ? AND tenant_id = ?
                 ORDER BY created_at DESC',
                [$userId, TenantContext::getId()]
            );

            return array_map(static fn ($r): array => (array) $r, $rows);
        } catch (\Throwable $e) {
            report($e);

            return [];
        }
    }

    /** Rename one of the viewer's passkeys. */
    public function renameProfilePasskey(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $credentialId = trim(self::asStr($request->input('credential_id')));
        $name = mb_substr(trim(self::asStr($request->input('device_name'))), 0, 100);

        if (
            $credentialId === ''
            || preg_match('/^[A-Za-z0-9_-]{1,1364}$/D', $credentialId) !== 1
            || $name === ''
            || preg_match('/[\x00-\x1F\x7F]/u', $name) === 1
        ) {
            return redirect()->route('govuk-alpha.profile.settings', ['tenantSlug' => $tenantSlug, 'status' => 'passkey-name-required'])->withFragment('passkeys');
        }

        if ($response = $this->confirmAccessiblePasskeyPassword($request, $tenantSlug, $userId)) {
            return $response;
        }

        $affected = DB::update(
            'UPDATE webauthn_credentials SET device_name = ?, updated_at = CURRENT_TIMESTAMP() WHERE credential_id = ? AND user_id = ? AND tenant_id = ?',
            [$name, $credentialId, $userId, TenantContext::getId()]
        );

        return redirect()->route('govuk-alpha.profile.settings', [
            'tenantSlug' => $tenantSlug,
            'status' => $affected > 0 ? 'passkey-renamed' : 'passkey-not-found',
        ])->withFragment('passkeys');
    }

    /** Remove one of the viewer's passkeys. */
    public function removeProfilePasskey(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $credentialId = trim(self::asStr($request->input('credential_id')));
        if ($credentialId === '' || preg_match('/^[A-Za-z0-9_-]{1,1364}$/D', $credentialId) !== 1) {
            return redirect()->route('govuk-alpha.profile.settings', ['tenantSlug' => $tenantSlug, 'status' => 'passkey-not-found'])->withFragment('passkeys');
        }

        if ($response = $this->confirmAccessiblePasskeyPassword($request, $tenantSlug, $userId)) {
            return $response;
        }

        $tenantId = TenantContext::getId();
        $status = DB::transaction(function () use ($credentialId, $tenantId, $userId): string {
            $hasAlternative = AuthenticationMethodGuard::hasAlternativeToPasskeys(
                $userId,
                $tenantId,
                true
            );
            $credentials = DB::table('webauthn_credentials')
                ->where('user_id', $userId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->pluck('credential_id');

            if (!$credentials->contains($credentialId)) {
                return 'passkey-not-found';
            }
            if ($credentials->count() === 1 && !$hasAlternative) {
                return 'passkey-last-sign-in-method';
            }

            $deleted = DB::table('webauthn_credentials')
                ->where('credential_id', $credentialId)
                ->where('user_id', $userId)
                ->where('tenant_id', $tenantId)
                ->delete();
            if ($deleted > 0) {
                $revoked = app(\App\Services\TokenService::class)->revokeAllTokensForUser($userId);
                if ($revoked < 1) {
                    throw new \RuntimeException('Unable to revoke sessions after accessible passkey removal.');
                }
                $user = User::withoutGlobalScopes()
                    ->whereKey($userId)
                    ->where('tenant_id', $tenantId)
                    ->first();
                if ($user === null) {
                    throw new \RuntimeException('Unable to resolve user for accessible session revocation.');
                }
                $user->tokens()->delete();
            }

            return 'passkey-removed';
        });

        if ($status !== 'passkey-removed') {
            return redirect()->route('govuk-alpha.profile.settings', [
                'tenantSlug' => $tenantSlug,
                'status' => $status,
            ])->withFragment('passkeys');
        }

        // Authenticator removal is a high-risk account change. End every active
        // legacy JWT and Sanctum session so a stolen session cannot silently
        // persist after the member changes their sign-in factors.
        if (session_status() === PHP_SESSION_ACTIVE) {
            $_SESSION = [];
            session_regenerate_id(true);
        }
        if ($request->hasSession()) {
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        $redirect = redirect()
            ->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'passkey-removed']);

        return app(AccessibleSessionCookies::class)->expireOn($redirect);
    }

    /**
     * The HTML-first frontend cannot run a WebAuthn ceremony, so require the
     * member's current password before changing a passkey. Members without a
     * password can use the main app, which supports passkey/TOTP step-up.
     */
    private function confirmAccessiblePasskeyPassword(
        Request $request,
        string $tenantSlug,
        int $userId
    ): ?RedirectResponse {
        $password = self::asStr($request->input('current_password'));
        if ($password === '') {
            return redirect()->route('govuk-alpha.profile.settings', [
                'tenantSlug' => $tenantSlug,
                'status' => 'passkey-password-required',
            ])->withFragment('passkeys');
        }

        $passwordHash = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', TenantContext::getId())
            ->value('password_hash');
        if (!is_string($passwordHash) || $passwordHash === '' || !password_verify($password, $passwordHash)) {
            return redirect()->route('govuk-alpha.profile.settings', [
                'tenantSlug' => $tenantSlug,
                'status' => 'passkey-password-incorrect',
            ])->withFragment('passkeys');
        }

        return null;
    }

    /** Personalisation: chronological feed + UGC auto-translation (user columns). */
    public function updateProfilePersonalisation(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $locale = $this->allowed($request->input('auto_translate_target_locale'), self::ALPHA_LOCALES, null);

        try {
            DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', TenantContext::getId())
                ->update([
                    'prefers_chronological_feed'   => $request->boolean('prefers_chronological'),
                    'auto_translate_ugc'           => $request->boolean('auto_translate_ugc'),
                    'auto_translate_target_locale' => $locale,
                    'updated_at'                   => now(),
                ]);
            $status = 'personalisation-saved';
        } catch (\Throwable $e) {
            report($e);
            $status = 'personalisation-failed';
        }

        return redirect()->route('govuk-alpha.profile.settings', ['tenantSlug' => $tenantSlug, 'status' => $status])->withFragment('personalisation');
    }

    /** Match-digest preferences (frequency + hot/mutual toggles). */
    public function updateProfileMatchPreferences(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $freq = $this->allowed($request->input('notification_frequency'), ['daily', 'weekly', 'monthly', 'fortnightly', 'never'], 'monthly');

        try {
            // Preserve the rest of the preference row (distance, score, …). The
            // alpha does not edit category matches, so drop 'categories' from the
            // payload — that keeps the existing categories untouched AND avoids the
            // service's optional (non-tenant-scoped) category-sync delete path.
            $updated = \App\Services\MatchingService::getPreferences($userId);
            unset($updated['categories']);
            $updated['notification_frequency'] = $freq;
            $updated['notify_hot_matches'] = $request->boolean('notify_hot_matches');
            $updated['notify_mutual_matches'] = $request->boolean('notify_mutual_matches');
            $ok = \App\Services\MatchingService::savePreferences($userId, $updated);
            $status = $ok ? 'match-prefs-saved' : 'match-prefs-failed';
        } catch (\Throwable $e) {
            report($e);
            $status = 'match-prefs-failed';
        }

        return redirect()->route('govuk-alpha.profile.settings', ['tenantSlug' => $tenantSlug, 'status' => $status])->withFragment('match-preferences');
    }

    /** Add a skill (offering/requesting) to the viewer's profile. */
    public function addProfileSkill(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $name = trim(self::asStr($request->input('skill_name')));
        if ($name === '') {
            return redirect()->route('govuk-alpha.profile.settings', ['tenantSlug' => $tenantSlug, 'status' => 'skill-name-required'])->withFragment('skills');
        }

        // Offer is the sensible default; both can be set.
        $isOffering = $request->boolean('is_offering') || !$request->boolean('is_requesting');

        try {
            $id = app(\App\Services\SkillTaxonomyService::class)->addUserSkill($userId, [
                'skill_name'    => mb_substr($name, 0, 100),
                'is_offering'   => $isOffering,
                'is_requesting' => $request->boolean('is_requesting'),
            ]);
            $status = $id !== null ? 'skill-added' : 'skill-failed';
        } catch (\Throwable $e) {
            report($e);
            $status = 'skill-failed';
        }

        return redirect()->route('govuk-alpha.profile.settings', ['tenantSlug' => $tenantSlug, 'status' => $status])->withFragment('skills');
    }

    /** Remove one of the viewer's skills. */
    public function removeProfileSkill(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $skillId = (int) $request->input('user_skill_id');
        try {
            $ok = $skillId > 0 && app(\App\Services\SkillTaxonomyService::class)->removeSkill($userId, $skillId);
            $status = $ok ? 'skill-removed' : 'skill-failed';
        } catch (\Throwable $e) {
            report($e);
            $status = 'skill-failed';
        }

        return redirect()->route('govuk-alpha.profile.settings', ['tenantSlug' => $tenantSlug, 'status' => $status])->withFragment('skills');
    }

    /** Revoke (withdraw) one of the viewer's safeguarding preferences. */
    public function revokeProfileSafeguarding(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $optionId = (int) $request->input('option_id');
        try {
            $ok = $optionId > 0 && \App\Services\SafeguardingPreferenceService::revokePreference($userId, $optionId);
            $status = $ok ? 'safeguarding-revoked' : 'safeguarding-failed';
        } catch (\Throwable $e) {
            report($e);
            $status = 'safeguarding-failed';
        }

        return redirect()->route('govuk-alpha.profile.settings', ['tenantSlug' => $tenantSlug, 'status' => $status])->withFragment('safeguarding');
    }

    /**
     * Request a broker review of the member's private contact attestation.
     *
     * This is deliberately an empty-body workflow. Certificates, references,
     * dates, results, notes and every other form of vetting evidence are
     * prohibited from entering Project NEXUS.
     */
    public function requestProfileVettingReview(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }
        if ($request->allFiles() !== [] || $request->except('_token') !== []) {
            $status = 'vetting-review-evidence-prohibited';
        } else {
            try {
                app(\App\Services\MemberVettingAttestationService::class)
                    ->requestReview(TenantContext::getId(), $userId);
                $this->notifyDecisionMakersOfVettingReviewRequest();
                $status = 'vetting-review-requested';
            } catch (\App\Exceptions\SafeguardingPolicyException $e) {
                $status = in_array($e->reasonCode, [
                    'SAFEGUARDING_JURISDICTION_REQUIRED',
                    'SAFEGUARDING_POLICY_UNAVAILABLE',
                ], true) ? 'vetting-review-unavailable' : 'vetting-review-failed';
            } catch (\Throwable $e) {
                report($e);
                $status = 'vetting-review-failed';
            }
        }

        return redirect()->route('govuk-alpha.profile.settings', [
            'tenantSlug' => $tenantSlug,
            'status' => $status,
        ])->withFragment('safeguarding');
    }

    /** Confirm that the member has reviewed updated safeguarding wording. */
    public function confirmProfileSafeguardingPolicyReview(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        if ($request->allFiles() !== [] || $request->except('_token') !== []) {
            $status = 'safeguarding-policy-review-failed';
        } else {
            try {
                DB::table('user_safeguarding_preferences')
                    ->where('tenant_id', TenantContext::getId())
                    ->where('user_id', $userId)
                    ->whereNull('revoked_at')
                    ->whereNotNull('policy_review_required_at')
                    ->update([
                        'policy_review_required_at' => null,
                        'policy_review_reason_code' => null,
                        'consent_given_at' => now(),
                    ]);
                $status = 'safeguarding-policy-reviewed';
            } catch (\Throwable $e) {
                report($e);
                $status = 'safeguarding-policy-review-failed';
            }
        }

        return redirect()->route('govuk-alpha.profile.settings', [
            'tenantSlug' => $tenantSlug,
            'status' => $status,
        ])->withFragment('safeguarding');
    }

    /** Notify active brokers/admins that a metadata-only review is waiting. */
    private function notifyDecisionMakersOfVettingReviewRequest(): void
    {
        try {
            $tenantId = TenantContext::getId();
            $recipients = DB::table('users')
                ->where('tenant_id', $tenantId)
                ->where(function ($query): void {
                    $query->where('role', 'broker')
                        ->orWhereIn('role', ['admin', 'tenant_admin', 'super_admin', 'god'])
                        ->orWhere('is_admin', 1)
                        ->orWhere('is_super_admin', 1)
                        ->orWhere('is_tenant_super_admin', 1)
                        ->orWhere('is_god', 1);
                })
                ->whereNotIn('status', ['deleted', 'deactivated', 'suspended', 'banned'])
                ->select(['id', 'preferred_language'])
                ->get();

            foreach ($recipients as $recipient) {
                \App\I18n\LocaleContext::withLocale(
                    $recipient->preferred_language ?? null,
                    static function () use ($recipient, $tenantId): void {
                        \App\Models\Notification::createNotification(
                            (int) $recipient->id,
                            __('svc_notifications.vetting_review_requested'),
                            '/broker/vetting?status=review_requested',
                            'safeguarding_review_requested',
                            false,
                            $tenantId,
                        );
                    },
                );
            }
        } catch (\Throwable $e) {
            report($e);
        }
    }

    public function updateProfileEmail(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $email = trim(self::asStr($request->input('email')));
        $currentPassword = self::asStr($request->input('current_password'));

        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return redirect()->route('govuk-alpha.profile.settings', ['tenantSlug' => $tenantSlug, 'status' => 'email-invalid']);
        }

        // The v2 profile update does not gate email changes on the password, but a
        // self-service email change is sensitive — re-authenticate first.
        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', TenantContext::getId())
            ->select('password_hash', 'email')
            ->first();

        if ($user === null || !password_verify($currentPassword, (string) $user->password_hash)) {
            return redirect()->route('govuk-alpha.profile.settings', ['tenantSlug' => $tenantSlug, 'status' => 'email-password-incorrect']);
        }

        if (strcasecmp($email, (string) $user->email) === 0) {
            return redirect()->route('govuk-alpha.profile.settings', ['tenantSlug' => $tenantSlug, 'status' => 'email-unchanged']);
        }

        try {
            $ok = UserService::updateProfile($userId, ['email' => $email]);
        } catch (\Throwable $e) {
            report($e);
            $ok = false;
        }

        return redirect()->route('govuk-alpha.profile.settings', [
            'tenantSlug' => $tenantSlug,
            'status' => $ok ? 'email-changed' : 'email-failed',
        ]);
    }

    public function updateProfilePassword(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $current = self::asStr($request->input('current_password'));
        $new = self::asStr($request->input('new_password'));
        $confirm = self::asStr($request->input('new_password_confirmation'));

        $preStatus = match (true) {
            $current === ''                  => 'password-current-required',
            $new === '' || mb_strlen($new) < 12 => 'password-weak',
            $new !== $confirm                => 'password-mismatch',
            default                          => null,
        };
        if ($preStatus !== null) {
            return redirect()->route('govuk-alpha.profile.settings', ['tenantSlug' => $tenantSlug, 'status' => $preStatus]);
        }

        try {
            $ok = UserService::updatePassword($userId, $current, $new);
        } catch (\Throwable $e) {
            report($e);
            $ok = false;
        }

        if ($ok) {
            return redirect()->route('govuk-alpha.profile.settings', ['tenantSlug' => $tenantSlug, 'status' => 'password-changed']);
        }

        $code = strtoupper((string) (UserService::getErrors()[0]['code'] ?? ''));
        $status = match (true) {
            str_contains($code, 'INVALID') => 'password-current-incorrect',
            str_contains($code, 'REUSED')  => 'password-reused',
            str_contains($code, 'WEAK')    => 'password-weak',
            default                        => 'password-failed',
        };

        return redirect()->route('govuk-alpha.profile.settings', ['tenantSlug' => $tenantSlug, 'status' => $status]);
    }

    public function updateProfileLanguage(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $language = $this->allowed($request->input('language'), self::ALPHA_LOCALES, null);
        if ($language === null) {
            return redirect()->route('govuk-alpha.profile.settings', ['tenantSlug' => $tenantSlug, 'status' => 'language-invalid']);
        }

        DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', TenantContext::getId())
            ->update(['preferred_language' => $language, 'updated_at' => now()]);

        if ($request->hasSession()) {
            $request->session()->put('locale', $language);
        }
        $_SESSION['locale'] = $language;

        return redirect()->route('govuk-alpha.profile.settings', ['tenantSlug' => $tenantSlug, 'status' => 'language-changed']);
    }

    public function updateProfileSettings(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();

        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $profileType = $this->allowed($request->input('profile_type', 'individual'), ['individual', 'organisation'], 'individual');
        $privacyProfile = $this->allowed($request->input('privacy_profile', 'public'), ['public', 'members', 'connections'], 'public');

        $data = [
            'first_name' => trim(self::asStr($request->input('first_name'))),
            'last_name' => trim(self::asStr($request->input('last_name'))),
            'phone' => trim(self::asStr($request->input('phone'))),
            'profile_type' => $profileType,
            'organization_name' => trim(self::asStr($request->input('organization_name'))),
            'tagline' => trim(self::asStr($request->input('tagline'))),
            'bio' => trim(self::asStr($request->input('bio'))),
            'location' => trim(self::asStr($request->input('location'))),
        ];

        if (!$this->profileSettingsInputIsValid($data)) {
            return redirect()->route('govuk-alpha.profile.settings', ['tenantSlug' => $tenantSlug, 'status' => 'profile-update-failed']);
        }

        // Profile photo: validate and store BEFORE the text update so an invalid
        // image aborts the whole save with a specific message rather than silently
        // persisting half the form. ImageUploader crops avatars to a 400x400 square.
        if ($request->hasFile('avatar')) {
            $avatarResult = $this->storeUploadedAvatar($request, $userId);
            if ($avatarResult === false) {
                return redirect()->route('govuk-alpha.profile.settings', ['tenantSlug' => $tenantSlug, 'status' => 'avatar-invalid']);
            }
        } elseif ($request->boolean('remove_avatar')) {
            DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', TenantContext::getId())
                ->update(['avatar_url' => null, 'updated_at' => now()]);
        }

        $success = UserService::updateProfile($userId, $data);
        if (!$success) {
            return redirect()->route('govuk-alpha.profile.settings', ['tenantSlug' => $tenantSlug, 'status' => 'profile-update-failed']);
        }

        DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', TenantContext::getId())
            ->update([
                'name' => trim($data['first_name'] . ' ' . $data['last_name']) ?: ($data['organization_name'] ?: __('govuk_alpha.members.unknown_member')),
                'privacy_profile' => $privacyProfile,
                'privacy_search' => $request->boolean('privacy_search'),
                // GDPR marketing consent — recipient-controlled newsletter opt-in.
                'newsletter_opt_in' => $request->boolean('newsletter_opt_in'),
                'updated_at' => now(),
            ]);

        return redirect()->route('govuk-alpha.profile.me', ['tenantSlug' => $tenantSlug, 'status' => 'profile-updated']);
    }

    /**
     * Store an uploaded profile photo for the user via the shared image
     * pipeline (validates MIME/size, crops to a 400x400 square). Returns the
     * stored URL on success, or false when the upload is missing/invalid so the
     * caller can surface a single "avatar-invalid" message.
     */
    private function storeUploadedAvatar(Request $request, int $userId): string|false
    {
        $file = $request->file('avatar');
        if ($file === null || is_array($file) || !$file->isValid()) {
            return false;
        }

        try {
            $avatarUrl = UserService::updateAvatar($userId, [
                'name' => $file->getClientOriginalName(),
                'type' => $file->getMimeType(),
                'tmp_name' => $file->getRealPath(),
                'error' => UPLOAD_ERR_OK,
                'size' => $file->getSize(),
            ]);
        } catch (\Throwable $e) {
            // ImageUploader throws on disallowed type / oversize / decompression
            // bomb — treat all as a validation failure, not a 500.
            report($e);
            return false;
        }

        return $avatarUrl ?: false;
    }

    public function requestDataExport(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();

        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        try {
            app(\App\Services\Enterprise\GdprService::class)->createRequest($userId, 'portability', [
                'notes' => __('govuk_alpha.profile_settings.data_export_note'),
                'metadata' => ['requested_via' => 'accessible-frontend', 'self_service' => true],
            ]);
        } catch (\RuntimeException) {
            // Same-type request already pending — tell the user it's in progress.
            return redirect()->route('govuk-alpha.profile.settings', ['tenantSlug' => $tenantSlug, 'status' => 'data-export-exists']);
        } catch (\Throwable $e) {
            report($e);
            return redirect()->route('govuk-alpha.profile.settings', ['tenantSlug' => $tenantSlug, 'status' => 'data-export-failed']);
        }

        return redirect()->route('govuk-alpha.profile.settings', ['tenantSlug' => $tenantSlug, 'status' => 'data-export-requested']);
    }

    public function confirmDeleteAccount(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();

        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        return $this->view('accessible-frontend::profile-delete', [
            'title' => __('govuk_alpha.delete_account.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'profile',
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    public function deleteAccount(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        $userId = $this->currentUserId();

        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $password = self::asStr($request->input('password'));
        if ($password === '') {
            return redirect()->route('govuk-alpha.profile.delete', ['tenantSlug' => $tenantSlug, 'status' => 'delete-password-required']);
        }

        if (!$request->boolean('confirm')) {
            return redirect()->route('govuk-alpha.profile.delete', ['tenantSlug' => $tenantSlug, 'status' => 'delete-confirm-required']);
        }

        // Re-authenticate with the password before destroying the account —
        // mirrors the React/API GdprController::deleteAccount contract.
        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', TenantContext::getId())
            ->select('password_hash')
            ->first();

        if ($user === null || !password_verify($password, (string) $user->password_hash)) {
            return redirect()->route('govuk-alpha.profile.delete', ['tenantSlug' => $tenantSlug, 'status' => 'delete-password-incorrect']);
        }

        try {
            app(\App\Services\Enterprise\GdprService::class)->createRequest($userId, 'erasure', [
                'notes' => trim(self::asStr($request->input('reason'))) ?: null,
                'metadata' => ['requested_via' => 'accessible-frontend', 'self_service' => true],
            ]);
            if (app(\App\Services\TokenService::class)->revokeAllTokensForUser(
                $userId,
                'account_deletion_request'
            ) < 1) {
                throw new \RuntimeException('Unable to revoke sessions for an account deletion request.');
            }
        } catch (\RuntimeException) {
            // An existing erasure request still requires immediate revocation.
            if (app(\App\Services\TokenService::class)->revokeAllTokensForUser(
                $userId,
                'account_deletion_request'
            ) < 1) {
                return redirect()->route('govuk-alpha.profile.delete', [
                    'tenantSlug' => $tenantSlug,
                    'status' => 'delete-failed',
                ]);
            }
        } catch (\Throwable $e) {
            report($e);
            return redirect()->route('govuk-alpha.profile.delete', ['tenantSlug' => $tenantSlug, 'status' => 'delete-failed']);
        }

        // Sign the user out immediately — the API contract returns logout_required.
        if (session_status() === PHP_SESSION_ACTIVE) {
            unset($_SESSION['user_id']);
        }
        if ($request->hasSession()) {
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        $redirect = redirect()
            ->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'account-deletion-requested']);

        return app(AccessibleSessionCookies::class)->expireOn($redirect);
    }

    private function view(string $name, array $data = [], int $status = 200): Response
    {
        return response()
            ->view($name, array_merge($this->sharedViewData(), $data), $status)
            ->header('Content-Type', 'text/html; charset=UTF-8');
    }

    private function sharedViewData(): array
    {
        $logoUrl = TenantContext::getSetting('logo_url');
        $logoDarkUrl = TenantContext::getSetting('logo_dark_url');
        $logoUrl = is_string($logoUrl) ? $logoUrl : null;
        $logoDarkUrl = is_string($logoDarkUrl) ? $logoDarkUrl : null;
        // Header is always black, so the dark variant (when present) is what's shown.
        $effectiveLogo = $logoDarkUrl ?: $logoUrl;

        // Optional per-tenant header theming (stored next to the logo in
        // tenants.configuration). Values are re-validated to #rrggbb here so
        // they are safe to inline into a <style> block; anything invalid or
        // absent falls back to the stock GOV.UK black + blue in the stylesheet.
        // When a custom background is set we also pick a readable foreground
        // (white or near-black) so header text keeps WCAG-AA contrast.
        $headerBg = $this->normalizeHeaderColor(TenantContext::getSetting('header_bg_color'));
        $headerAccent = $this->normalizeHeaderColor(TenantContext::getSetting('header_accent_color'));
        $headerFg = $headerBg !== null ? $this->readableForeground($headerBg) : null;

        return [
            'assetEntrypoint' => $this->assetEntrypoint(),
            'tenant' => TenantContext::get(),
            // Tenant-uploaded header logo (overrides the text brand). Resolved to
            // same-origin URLs. The GOV.UK alpha header is always black, so the
            // template prefers the dark-background variant when one was uploaded.
            'tenantLogoUrl' => $this->resolveAsset($logoUrl),
            'tenantLogoDarkUrl' => $this->resolveAsset($logoDarkUrl),
            // Smart sizing: bucket the logo by aspect ratio so a wide wordmark and
            // a square/stacked crest both read at a sensible size in the header.
            'tenantLogoShape' => $this->logoShapeClass($effectiveLogo),
            // Per-tenant header colours (null = keep the stock GOV.UK black + blue).
            'alphaHeaderBg' => $headerBg,
            'alphaHeaderAccent' => $headerAccent,
            'alphaHeaderFg' => $headerFg['fg'] ?? null,
            'alphaHeaderFgHover' => $headerFg['hover'] ?? null,
            'isAuthenticated' => $this->currentUserId() !== null,
            'alphaNavItems' => $this->alphaNavItems(),
            'alphaFooterColumns' => $this->alphaFooterColumns(),
            'alphaSignOutUrl' => $this->alphaSignOutUrl(),
            // Global, no-JS language switcher + RTL support (all 11 platform
            // locales are enabled for every tenant by default).
            'alphaLocaleOptions' => $this->alphaLocaleOptions(),
            'alphaCurrentLocale' => app()->getLocale(),
            'alphaTextDirection' => app()->getLocale() === 'ar' ? 'rtl' : 'ltr',
            'alphaUnreadMessages' => $this->alphaUnreadMessages(),
            'feedbackUrl' => $this->feedbackUrl(),
            'mainSiteUrl' => $this->mainSiteUrl(),
            'metaDescription' => __('govuk_alpha.seo.description'),
            'canonicalUrl' => request()->url(),
            'robotsDirective' => 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
            'defaultOgImage' => 'https://project-nexus.ie/og-image.png',
        ];
    }

    /**
     * Validate + normalise a #rrggbb hex colour for safe inlining into the
     * header <style> block. Accepts an optional '#' and 3- or 6-digit hex
     * (shorthand expanded); returns null for empty / invalid input.
     */
    private function normalizeHeaderColor($value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $hex = ltrim(trim($value), '#');
        if (preg_match('/^[0-9a-fA-F]{3}$/', $hex)) {
            $hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
        }
        return preg_match('/^[0-9a-fA-F]{6}$/', $hex) ? '#' . strtolower($hex) : null;
    }

    /**
     * Pick a header foreground (text) colour that stays legible on $hexBg,
     * using the WCAG relative-luminance contrast formula — white vs near-black,
     * whichever yields the higher contrast ratio. Returns the base text colour
     * and a slightly-muted hover variant.
     *
     * @return array{fg: string, hover: string}
     */
    private function readableForeground(string $hexBg): array
    {
        $channel = static function (string $pair): float {
            $c = hexdec($pair) / 255;
            return $c <= 0.03928 ? $c / 12.92 : (($c + 0.055) / 1.055) ** 2.4;
        };
        $luminance = 0.2126 * $channel(substr($hexBg, 1, 2))
            + 0.7152 * $channel(substr($hexBg, 3, 2))
            + 0.0722 * $channel(substr($hexBg, 5, 2));

        // Contrast ratio of white (L=1) and near-black (#0b0c0c, L≈0) on $hexBg.
        $contrastWhite = (1.0 + 0.05) / ($luminance + 0.05);
        $contrastBlack = ($luminance + 0.05) / (0.0 + 0.05);

        return $contrastWhite >= $contrastBlack
            ? ['fg' => '#ffffff', 'hover' => '#f3f2f1']
            : ['fg' => '#0b0c0c', 'hover' => '#505a5f'];
    }

    /**
     * Language options for the global locale switcher, keyed by code with the
     * language's own endonym as the label (a name reads the same in every locale).
     *
     * @return array<string, string>
     */
    private function alphaLocaleOptions(): array
    {
        $options = [];
        foreach (self::ALPHA_LOCALES as $code) {
            $options[$code] = __('govuk_alpha.profile_settings.languages.' . $code);
        }

        return $options;
    }

    /**
     * Unread-message total for the signed-in member, for the nav badge. Returns
     * 0 for anonymous viewers or on any failure (never blocks a page render).
     */
    private function alphaUnreadMessages(): int
    {
        $userId = $this->currentUserId();
        if ($userId === null || ! TenantContext::hasModule('messages')) {
            return 0;
        }

        try {
            return MessageService::getUnreadCount($userId);
        } catch (\Throwable $e) {
            report($e);

            return 0;
        }
    }

    private function mainSiteUrl(): string
    {
        $tenant = TenantContext::get();
        $tenantSlug = (string) ($tenant['slug'] ?? '');
        $frontendUrl = rtrim(TenantContext::getFrontendUrl(), '/');

        if ($tenantSlug === '') {
            return $frontendUrl;
        }

        $host = strtolower((string) parse_url($frontendUrl, PHP_URL_HOST));
        $sharedHosts = ['app.project-nexus.ie', 'localhost', '127.0.0.1'];

        if (in_array($host, $sharedHosts, true)) {
            return $frontendUrl . '/' . rawurlencode($tenantSlug);
        }

        return $frontendUrl;
    }

    private function feedbackUrl(): string
    {
        $tenant = TenantContext::get();
        $tenantSlug = (string) ($tenant['slug'] ?? '');

        // The host tenant (id 1) renders tenant-agnostic pages (the tenant
        // chooser) — same rule as tenantChooser(). Its feedback link must be
        // the generic platform mailto, not a tenant contact form.
        if ($tenantSlug === '' || (int) ($tenant['id'] ?? 0) <= 1) {
            return (string) __('govuk_alpha.feedback_url');
        }

        return route('govuk-alpha.contact', ['tenantSlug' => $tenantSlug]);
    }

    private function alphaNavItems(): array
    {
        $tenant = TenantContext::get();
        $tenantSlug = (string) ($tenant['slug'] ?? '');
        if ($tenantSlug === '') {
            return [];
        }

        $userId = $this->currentUserId();
        $items = [];

        if ($userId === null) {
            $items['home'] = route('govuk-alpha.home', ['tenantSlug' => $tenantSlug]);
        } else {
            // Personal/transactional items (Wallet, Messages, Connections, Matches,
            // Group exchanges, gamification) live in the top header "My account"
            // hub, not the service nav — which is reserved for community +
            // discovery facilities to keep the flat GOV.UK bar uncrowded. See
            // account() + the header in layout.blade.php.
            // Gate the dashboard link on the dashboard module (parity with React's
            // Navbar hasModule('dashboard') check) so a disabled module hides it.
            if (TenantContext::hasModule('dashboard')) {
                $items['dashboard'] = route('govuk-alpha.dashboard', ['tenantSlug' => $tenantSlug]);
            }
        }

        if (TenantContext::hasModule('feed')) {
            $items['feed'] = route('govuk-alpha.feed', ['tenantSlug' => $tenantSlug]);
        }

        if (TenantContext::hasModule('listings')) {
            $items['listings'] = route('govuk-alpha.listings.index', ['tenantSlug' => $tenantSlug]);
        }

        if (TenantContext::hasFeature('connections')) {
            $items['members'] = route('govuk-alpha.members.index', ['tenantSlug' => $tenantSlug]);
        }

        if (TenantContext::hasFeature('events')) {
            $items['events'] = route('govuk-alpha.events.index', ['tenantSlug' => $tenantSlug]);
        }

        // Anonymous visitors get the public What's On listing instead of the
        // member events page — the accessible twin of the React /whats-on.
        if ($userId === null
            && TenantContext::hasFeature('events')
            && TenantContext::hasFeature('public_events')) {
            $items['whats_on'] = route('govuk-alpha.whats-on.index', ['tenantSlug' => $tenantSlug]);
            unset($items['events']);
        }

        if (TenantContext::hasFeature('volunteering')) {
            $items['volunteering'] = route('govuk-alpha.volunteering.index', ['tenantSlug' => $tenantSlug]);
        }

        if ($userId !== null && TenantContext::hasFeature('partner_venues')) {
            $items['venues'] = route('govuk-alpha.venues.index', ['tenantSlug' => $tenantSlug]);
        }

        // Organisations is NOT on the flat service nav — it lives on the Explore
        // page and is reachable from the Volunteering hero ("Browse organisations")
        // and the org door. This keeps the GOV.UK service bar lean and matches the
        // owner's IA decision that Organisations belongs under Explore, not the bar.

        // "Explore" is the gateway to discovery facilities (groups, goals, skills,
        // organisations, marketplace, jobs, courses, exchanges, polls, …) so the
        // flat bar stays lean. Exchanges and Polls live there too, not in the bar.
        if ($userId !== null) {
            $items['explore'] = route('govuk-alpha.explore', ['tenantSlug' => $tenantSlug]);
        }

        return $items;
    }

    /**
     * Build the GOV.UK footer navigation columns. The React frontend footer is
     * the source of truth for which links appear; the Platform column is gated
     * by the same module/feature checks as alphaNavItems(), while Support and
     * Legal are universal. Each value is `key => href`; the Blade resolves the
     * label via govuk_alpha.footer.columns.<column>.<key>.
     */
    private function alphaFooterColumns(): array
    {
        $tenant = TenantContext::get();
        $tenantSlug = (string) ($tenant['slug'] ?? '');
        if ($tenantSlug === '') {
            return [];
        }

        $route = static fn (string $name): string => route($name, ['tenantSlug' => $tenantSlug]);

        $platform = [];
        if (TenantContext::hasModule('listings')) {
            $platform['listings'] = $route('govuk-alpha.listings.index');
        }
        if (TenantContext::hasFeature('connections')) {
            $platform['members'] = $route('govuk-alpha.members.index');
        }
        if (TenantContext::hasFeature('events')) {
            $platform['events'] = $route('govuk-alpha.events.index');
        }
        if (TenantContext::hasFeature('volunteering')) {
            $platform['volunteering'] = $route('govuk-alpha.volunteering.index');
        }
        if (TenantContext::hasFeature('blog')) {
            $platform['blog'] = $route('govuk-alpha.blog.index');
        }

        $support = [
            'help' => $route('govuk-alpha.help'),
            'kb' => $route('govuk-alpha.kb.index'),
            'trust_safety' => $route('govuk-alpha.trust-safety'),
            'contact' => $route('govuk-alpha.contact'),
            'about' => $route('govuk-alpha.about'),
        ];

        $legal = [
            'legal_hub' => $route('govuk-alpha.legal.hub'),
            'terms' => $route('govuk-alpha.legal.terms'),
            'privacy' => $route('govuk-alpha.legal.privacy'),
            'community_guidelines' => $route('govuk-alpha.legal.community-guidelines'),
            'acceptable_use' => $route('govuk-alpha.legal.acceptable-use'),
            'cookies' => $route('govuk-alpha.legal.cookies'),
            'accessibility' => $route('govuk-alpha.accessibility'),
        ];

        $columns = ['support' => $support, 'legal' => $legal];
        if ($platform !== []) {
            $columns = ['platform' => $platform] + $columns;
        }

        return $columns;
    }

    /**
     * The sign-out URL for the footer meta row. Sign-out changes state, so the
     * Blade renders it as a CSRF-protected POST form, not a link. Null when the
     * visitor is not signed in or no tenant is resolved.
     */
    private function alphaSignOutUrl(): ?string
    {
        $tenant = TenantContext::get();
        $tenantSlug = (string) ($tenant['slug'] ?? '');
        if ($tenantSlug === '' || $this->currentUserId() === null) {
            return null;
        }

        return route('govuk-alpha.logout', ['tenantSlug' => $tenantSlug]);
    }

    /**
     * Live platform statistics for the About page, reusing the same cached
     * computation as the React app's GET /v2/platform/stats. Returns null on
     * any failure so the About page simply hides the stats band.
     */
    private function platformStats(): ?array
    {
        try {
            $response = app(\App\Http\Controllers\Api\TenantBootstrapController::class)->platformStats();
            $decoded = json_decode((string) $response->getContent(), true);
            if (! is_array($decoded)) {
                return null;
            }

            return isset($decoded['data']) && is_array($decoded['data']) ? $decoded['data'] : $decoded;
        } catch (\Throwable $e) {
            report($e);

            return null;
        }
    }

    /**
     * The shared contributors list rendered on the About page — the same
     * react-frontend/src/data/contributors.json the React About page uses, so
     * credits stay in a single source of truth.
     */
    private function aboutContributors(): array
    {
        $path = base_path('react-frontend/src/data/contributors.json');
        if (! is_file($path)) {
            return [];
        }

        $decoded = json_decode((string) file_get_contents($path), true);

        return is_array($decoded) ? $decoded : [];
    }

    private function assetEntrypoint(): array
    {
        $manifestPath = base_path('httpdocs/build/accessible-frontend/.vite/manifest.json');
        if (!is_file($manifestPath)) {
            return ['css' => [], 'js' => null];
        }

        $manifest = json_decode((string) file_get_contents($manifestPath), true);
        $entry = $manifest['accessible-frontend/src/app.ts'] ?? [];

        return [
            'css' => array_map(fn (string $file): string => '/build/accessible-frontend/' . $file, $entry['css'] ?? []),
            'js' => isset($entry['file']) ? '/build/accessible-frontend/' . $entry['file'] : null,
        ];
    }

    private function assertTenantSlug(string $tenantSlug): void
    {
        $tenant = TenantContext::get();
        abort_unless(($tenant['slug'] ?? '') === $tenantSlug, 404);
    }

    private function currentUserId(): ?int
    {
        return app(AccessibleIdentityResolver::class)->userId(request());
    }

    private function profileForViewer(int $profileUserId, int $viewerId): ?array
    {
        return $profileUserId === $viewerId
            ? UserService::getOwnProfile($profileUserId)
            : UserService::getPublicProfile($profileUserId, $viewerId);
    }

    private function profileDisplayName(array $profile): string
    {
        $name = trim((string) ($profile['name'] ?? ''));
        if ($name !== '') {
            return $name;
        }

        $fallback = trim(((string) ($profile['first_name'] ?? '')) . ' ' . ((string) ($profile['last_name'] ?? '')));
        return $fallback !== '' ? $fallback : __('govuk_alpha.members.unknown_member');
    }

    private function profileStats(array $profile): array
    {
        $stats = $profile['stats'] ?? [];

        return [
            'hours_given' => (float) ($profile['total_hours_given'] ?? $stats['total_hours_given'] ?? $stats['given_count'] ?? 0),
            'hours_received' => (float) ($profile['total_hours_received'] ?? $stats['total_hours_received'] ?? $stats['received_count'] ?? 0),
            'listings_count' => (int) ($stats['listings_count'] ?? 0),
            'offers_count' => (int) ($stats['offers_count'] ?? 0),
            'requests_count' => (int) ($stats['requests_count'] ?? 0),
            'rating' => $profile['rating'] ?? $stats['average_rating'] ?? null,
            'level' => (int) ($profile['level'] ?? 1),
            'xp' => (int) ($profile['xp'] ?? 0),
        ];
    }

    private function profileListings(int $profileUserId): array
    {
        if (!TenantContext::hasModule('listings')) {
            return [];
        }

        try {
            $result = $this->listingService->getAll([
                'user_id' => $profileUserId,
                'limit' => 6,
            ]);

            return $result['items'] ?? [];
        } catch (\Throwable $e) {
            report($e);
            return [];
        }
    }

    private function profileSkills(int $profileUserId, array $profile): array
    {
        $tenantId = TenantContext::getId();
        $rows = DB::table('user_skills')
            ->select('skill_name', 'proficiency', 'is_offering', 'is_requesting')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $profileUserId)
            ->orderByDesc('is_offering')
            ->orderBy('skill_name')
            ->limit(20)
            ->get()
            ->map(fn (object $row): array => (array) $row)
            ->all();

        if (!empty($rows)) {
            return $rows;
        }

        return collect($profile['skills'] ?? [])
            ->filter(fn (mixed $skill): bool => trim((string) $skill) !== '')
            ->map(fn (mixed $skill): array => [
                'skill_name' => trim((string) $skill),
                'proficiency' => null,
                'is_offering' => true,
                'is_requesting' => false,
            ])
            ->values()
            ->all();
    }

    private function profileAvailability(int $profileUserId, array $profile): array
    {
        $tenantId = TenantContext::getId();
        $days = [
            __('govuk_alpha.profile.days.sunday'),
            __('govuk_alpha.profile.days.monday'),
            __('govuk_alpha.profile.days.tuesday'),
            __('govuk_alpha.profile.days.wednesday'),
            __('govuk_alpha.profile.days.thursday'),
            __('govuk_alpha.profile.days.friday'),
            __('govuk_alpha.profile.days.saturday'),
        ];

        $rows = DB::table('member_availability')
            ->select('day_of_week', 'start_time', 'end_time', 'specific_date', 'note')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $profileUserId)
            ->orderBy('day_of_week')
            ->orderBy('start_time')
            ->limit(12)
            ->get()
            ->map(function (object $row) use ($days): array {
                $day = isset($days[(int) $row->day_of_week]) ? $days[(int) $row->day_of_week] : '';
                return [
                    'label' => $row->specific_date ?: $day,
                    'time' => substr((string) $row->start_time, 0, 5) . ' - ' . substr((string) $row->end_time, 0, 5),
                    'note' => $row->note,
                ];
            })
            ->all();

        if (!empty($rows)) {
            return $rows;
        }

        $summary = trim((string) ($profile['availability'] ?? ''));
        return $summary === '' ? [] : [['label' => $summary, 'time' => '', 'note' => null]];
    }

    private function profileReviews(int $profileUserId): array
    {
        $tenantId = TenantContext::getId();

        return DB::table('reviews as r')
            ->leftJoin('users as reviewer', function ($join) use ($tenantId) {
                $join->on('reviewer.id', '=', 'r.reviewer_id')
                    ->where('reviewer.tenant_id', '=', $tenantId);
            })
            ->select(
                'r.rating',
                'r.comment',
                'r.created_at',
                'r.is_anonymous',
                DB::raw("CASE WHEN r.is_anonymous = 1 THEN NULL WHEN reviewer.profile_type = 'organisation' AND reviewer.organization_name IS NOT NULL AND reviewer.organization_name != '' THEN reviewer.organization_name ELSE CONCAT(COALESCE(reviewer.first_name, ''), ' ', COALESCE(reviewer.last_name, '')) END as reviewer_name")
            )
            ->where('r.tenant_id', $tenantId)
            ->where('r.receiver_id', $profileUserId)
            ->where(function ($query) {
                $query->whereNull('r.status')->orWhere('r.status', 'approved');
            })
            ->orderByDesc('r.created_at')
            ->limit(5)
            ->get()
            ->map(fn (object $row): array => (array) $row)
            ->all();
    }

    private function profileSettingsInputIsValid(array $data): bool
    {
        if (($data['first_name'] ?? '') === '' && ($data['organization_name'] ?? '') === '') {
            return false;
        }

        if (($data['phone'] ?? '') !== '' && !Validator::isPhone((string) $data['phone'])) {
            return false;
        }

        return mb_strlen((string) ($data['bio'] ?? '')) <= 5000
            && mb_strlen((string) ($data['tagline'] ?? '')) <= 255
            && mb_strlen((string) ($data['location'] ?? '')) <= 255;
    }

    /**
     * Resolve a stored asset path to a same-origin URL the browser can load,
     * mirroring the React frontend's resolveAssetUrl(): pass through absolute
     * http(s) URLs, otherwise ensure a leading-slash same-origin path. Returns
     * null for empty values so templates can omit the figure entirely.
     */
    private function resolveAsset(?string $path): ?string
    {
        $path = is_string($path) ? trim($path) : '';
        if ($path === '') {
            return null;
        }
        if (preg_match('#^https?://#i', $path) === 1) {
            return $path;
        }
        return '/' . ltrim($path, '/');
    }

    /**
     * Bucket a header logo by aspect ratio so the template can size it sensibly:
     * a wide wordmark needs little height, a square/stacked crest needs more.
     * Measured from the local file via getimagesize; SVGs and anything we can't
     * measure fall back to 'landscape'. Returns 'wide' | 'landscape' | 'square'.
     */
    private function logoShapeClass(?string $url): string
    {
        return \App\Support\LogoShape::classify($url);
    }

    /**
     * Turn a resolved (possibly relative) asset URL into an absolute URL for
     * social/Open Graph tags. Already-absolute URLs are returned unchanged.
     */
    private function absoluteAssetUrl(?string $resolved): ?string
    {
        if ($resolved === null || $resolved === '') {
            return null;
        }
        if (preg_match('#^https?://#i', $resolved) === 1) {
            return $resolved;
        }
        return url($resolved);
    }

    /**
     * Resolve a named cover-image key on each item in place so the templates
     * only ever receive a browser-ready URL (or null). Used for listings
     * (image_url) and events (cover_image).
     *
     * @param array<int, array<string, mixed>> $items
     * @return array<int, array<string, mixed>>
     */
    private function withResolvedImageKey(array $items, string $key): array
    {
        foreach ($items as &$item) {
            if (is_array($item)) {
                $item[$key] = $this->resolveAsset($item[$key] ?? null);
            }
        }
        unset($item);

        return $items;
    }

    /**
     * Load a listing's image gallery from the listing_images table, mirroring
     * ListingsController::show(). Tenant scoping is automatic via the
     * ListingImage HasTenantScope global scope. The cover image is skipped so
     * the hero photo is never duplicated as a thumbnail.
     *
     * @return array<int, array{id: int, url: string, sort_order: int, alt_text: ?string}>
     */
    private function listingGallery(int $listingId, ?string $coverUrl = null): array
    {
        try {
            return ListingImage::where('listing_id', $listingId)
                ->orderBy('sort_order')
                ->get()
                ->map(fn ($image): array => [
                    'id' => (int) $image->id,
                    'url' => $this->resolveAsset($image->image_url),
                    'sort_order' => (int) $image->sort_order,
                    'alt_text' => $image->alt_text,
                ])
                ->filter(fn (array $image): bool => $image['url'] !== null && $image['url'] !== $coverUrl)
                ->values()
                ->all();
        } catch (\Throwable $e) {
            report($e);

            return [];
        }
    }

    /**
     * Shared view data for the create-listing form (GET render + error redirect
     * back). The required-field markers follow the same tenant configuration the
     * React CreateListingPage reads.
     *
     * @return array<string, mixed>
     */
    private function listingFormViewData(string $tenantSlug, Request $request): array
    {
        return [
            'title' => __('govuk_alpha.listings.create.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'listings',
            'categories' => Category::where('type', 'listing')
                ->where('tenant_id', TenantContext::getId())
                ->orderBy('name')
                ->get(['id', 'name'])
                ->toArray(),
            'requireCategory' => $this->listingConfigBool(ListingConfigurationService::CONFIG_REQUIRE_CATEGORY),
            'requireLocation' => $this->listingConfigBool(ListingConfigurationService::CONFIG_REQUIRE_LOCATION),
            'requireHours' => $this->listingConfigBool(ListingConfigurationService::CONFIG_REQUIRE_HOURS_ESTIMATE),
            'enableServiceType' => $this->listingConfigBool(ListingConfigurationService::CONFIG_ENABLE_SERVICE_TYPE),
            'status' => self::asStr($request->query('status')) ?: null,
        ];
    }

    /**
     * Validate the create-listing form and build the ListingService::create()
     * payload. Returns [$data, $errors] where $errors is keyed by field name so
     * the Blade form can anchor a GOV.UK error summary and per-field messages.
     *
     * @return array{0: array<string, mixed>, 1: array<string, string>}
     */
    private function validateListingInput(Request $request): array
    {
        $minTitle = max(1, (int) ListingConfigurationService::get(ListingConfigurationService::CONFIG_MIN_TITLE_LENGTH));
        $minDescription = max(1, (int) ListingConfigurationService::get(ListingConfigurationService::CONFIG_MIN_DESCRIPTION_LENGTH));

        $title = trim(self::asStr($request->input('title')));
        $description = trim(self::asStr($request->input('description')));
        $type = $this->allowed($request->input('type'), ['offer', 'request'], '');
        $serviceType = $this->allowed($request->input('service_type'), ['physical_only', 'remote_only', 'hybrid', 'location_dependent'], 'physical_only');
        $categoryRaw = self::asStr($request->input('category_id'));
        $categoryId = $categoryRaw !== '' ? (int) $categoryRaw : null;
        $hoursRaw = self::asStr($request->input('hours_estimate'));
        $hours = $hoursRaw !== '' ? (float) $hoursRaw : null;
        $location = trim(self::asStr($request->input('location')));

        $errors = [];

        if ($title === '') {
            $errors['title'] = __('govuk_alpha.listings.create.errors.title_required');
        } elseif (mb_strlen($title) < $minTitle) {
            $errors['title'] = __('govuk_alpha.listings.create.errors.title_min', ['min' => $minTitle]);
        } elseif (mb_strlen($title) > 255) {
            $errors['title'] = __('govuk_alpha.listings.create.errors.title_max');
        }

        if ($description === '') {
            $errors['description'] = __('govuk_alpha.listings.create.errors.description_required');
        } elseif (mb_strlen($description) < $minDescription) {
            $errors['description'] = __('govuk_alpha.listings.create.errors.description_min', ['min' => $minDescription]);
        } elseif (mb_strlen($description) > 10000) {
            $errors['description'] = __('govuk_alpha.listings.create.errors.description_max');
        }

        if ($type === '') {
            $errors['type'] = __('govuk_alpha.listings.create.errors.type_required');
        }

        if ($this->listingConfigBool(ListingConfigurationService::CONFIG_REQUIRE_CATEGORY) && $categoryId === null) {
            $errors['category_id'] = __('govuk_alpha.listings.create.errors.category_required');
        }

        if ($this->listingConfigBool(ListingConfigurationService::CONFIG_REQUIRE_HOURS_ESTIMATE) && $hours === null) {
            $errors['hours_estimate'] = __('govuk_alpha.listings.create.errors.hours_required');
        } elseif ($hours !== null && ($hours < 0.5 || $hours > 2000)) {
            $errors['hours_estimate'] = __('govuk_alpha.listings.create.errors.hours_range');
        }

        if ($this->listingConfigBool(ListingConfigurationService::CONFIG_REQUIRE_LOCATION) && $location === '') {
            $errors['location'] = __('govuk_alpha.listings.create.errors.location_required');
        }

        $data = [
            'title' => $title,
            'description' => $description,
            'type' => $type !== '' ? $type : 'offer',
            'category_id' => $categoryId,
            'hours_estimate' => $hours,
            'service_type' => $serviceType,
            'location' => $location !== '' ? $location : null,
        ];

        return [$data, $errors];
    }

    /**
     * Upload an optional cover photo for a freshly-created listing and set it as
     * the listing cover, mirroring the React /v2/listings/{id}/image endpoint.
     * Best-effort: failures are reported but never bubble up to the member.
     */
    private function attachListingCoverImage(Request $request, int $listingId): void
    {
        $file = $request->file('image');
        if ($file === null || is_array($file) || !$file->isValid()) {
            return;
        }

        try {
            $imageUrl = \App\Core\ImageUploader::upload([
                'name' => $file->getClientOriginalName(),
                'type' => $file->getMimeType(),
                'tmp_name' => $file->getRealPath(),
                'error' => UPLOAD_ERR_OK,
                'size' => $file->getSize(),
            ], 'listings');

            if (is_string($imageUrl) && $imageUrl !== '') {
                ListingService::update($listingId, ['image_url' => $imageUrl]);
            }
        } catch (\Throwable $e) {
            report($e);
        }
    }

    /**
     * Attach an optional uploaded cover image to a newly-created event.
     *
     * Mirrors the listing cover-image flow: the upload is best-effort (a failed
     * or absent image never blocks event creation) and EventService::updateImage
     * re-checks ownership and tenant scope before writing.
     */
    private function attachEventCoverImage(
        Request $request,
        int $eventId,
        int $userId,
        ?string $scope = null,
    ): void
    {
        $imageUrl = $this->uploadEventCoverImage($request);
        if ($imageUrl === null) {
            return;
        }

        if (!EventService::updateImage($eventId, $userId, $imageUrl, $scope)) {
            ImageUploader::deleteTenantUpload($imageUrl, 'events');
        }
    }

    /** Store an optional Event cover image and return its tenant-scoped URL. */
    private function uploadEventCoverImage(Request $request): ?string
    {
        $file = $request->file('image');
        if ($file === null || is_array($file) || !$file->isValid()) {
            return null;
        }

        try {
            $imageUrl = \App\Core\ImageUploader::upload([
                'name' => $file->getClientOriginalName(),
                'type' => $file->getMimeType(),
                'tmp_name' => $file->getRealPath(),
                'error' => UPLOAD_ERR_OK,
                'size' => $file->getSize(),
            ], 'events');

            return is_string($imageUrl) && $imageUrl !== '' ? $imageUrl : null;
        } catch (\Throwable $e) {
            report($e);

            return null;
        }
    }

    /**
     * Flatten a Laravel ValidationException into a field => message map for the
     * GOV.UK error summary, falling back to a single generic message.
     *
     * @return array<string, string>
     */
    private function flattenValidationErrors(ValidationException $e): array
    {
        $out = [];
        foreach ($e->errors() as $field => $messages) {
            $message = is_array($messages) ? (string) reset($messages) : (string) $messages;
            if ($message !== '') {
                $out[(string) $field] = $message;
            }
        }

        return $out !== [] ? $out : ['title' => __('govuk_alpha.listings.create.errors.failed')];
    }

    private function listingConfigBool(string $key): bool
    {
        return filter_var(ListingConfigurationService::get($key), FILTER_VALIDATE_BOOLEAN);
    }

    private function listingFilters(Request $request): array
    {
        $type = $this->allowed($request->query('type'), ['offer', 'request'], null);
        $hours = $this->allowed($request->query('hours', 'any'), ['any', 'quick', 'short', 'half_day', 'full_day'], 'any');
        $service = $this->allowed($request->query('service', 'any'), ['any', 'remote', 'in_person'], 'any');
        $posted = $this->allowed($request->query('posted', 'any'), ['any', '1', '7', '30'], 'any');
        $sort = $this->allowed($request->query('sort', 'newest'), ['newest', 'recommended'], 'newest');

        $hoursMap = [
            'quick' => ['max_hours' => 1],
            'short' => ['min_hours' => 1, 'max_hours' => 3],
            'half_day' => ['min_hours' => 3, 'max_hours' => 6],
            'full_day' => ['min_hours' => 6],
        ];

        $filters = [
            'search' => trim(self::asStr($request->query('q'))) ?: null,
            'type' => $type,
            'category_id' => self::asStr($request->query('category_id')) !== '' ? (int) self::asStr($request->query('category_id')) : null,
            'step_free' => $this->allowed($request->query('step_free', 'any'), ['any', 'yes', 'no', 'unknown'], 'any'),
            'cursor' => self::asStr($request->query('cursor')) ?: null,
            'hours' => $hours,
            'service' => $service,
            'posted' => $posted,
            'sort' => $sort,
            'min_hours' => null,
            'max_hours' => null,
            'service_type' => null,
            'posted_within' => null,
        ];

        if ($hours !== 'any') {
            $filters = array_merge($filters, $hoursMap[$hours] ?? []);
        }

        if ($service === 'remote') {
            $filters['service_type'] = 'remote_only,hybrid';
        } elseif ($service === 'in_person') {
            $filters['service_type'] = 'physical_only';
        }

        if ($posted !== 'any') {
            $filters['posted_within'] = (int) $posted;
        }

        $near = $this->allowed(self::asStr($request->query('near', $this->savedNearDefault())), ['any', '5', '10', '25', '50', '100'], 'any');
        $filters['near'] = $near;
        $filters = array_merge($filters, $this->nearMeFilters($near));

        return $filters;
    }

    /**
     * Resolve near-me proximity filters from the signed-in member's STORED
     * location, so "near me" works with no browser geolocation/JS. Returns
     * near_lat/near_lng/radius_km when the member has a saved location and asked
     * for a radius; otherwise nulls plus a flag so the page can prompt them.
     *
     * @return array{near_lat: float|null, near_lng: float|null, radius_km: float|null, near_no_location: bool}
     */
    /**
     * The signed-in member's saved match-preference radius, snapped to the
     * near-me option set, as the DEFAULT for filter pages when no ?near= was
     * given. Parity with the React useSavedRadiusKm hook: the preference seeds
     * the filter, an explicit choice always wins. 'any' when signed out or no
     * preference is stored.
     */
    private function savedNearDefault(): string
    {
        $userId = $this->currentUserId();
        if ($userId === null) {
            return 'any';
        }

        try {
            $saved = DB::table('match_preferences')
                ->where('tenant_id', TenantContext::getId())
                ->where('user_id', $userId)
                ->value('max_distance_km');
        } catch (\Throwable) {
            return 'any';
        }

        if ($saved === null || ! is_numeric($saved)) {
            return 'any';
        }

        $km = (float) $saved;
        $best = '25';
        $bestDelta = PHP_FLOAT_MAX;
        foreach ([5, 10, 25, 50, 100] as $option) {
            $delta = abs($option - $km);
            if ($delta < $bestDelta) {
                $bestDelta = $delta;
                $best = (string) $option;
            }
        }

        return $best;
    }

    private function nearMeFilters(string $near): array
    {
        $out = ['near_lat' => null, 'near_lng' => null, 'radius_km' => null, 'near_no_location' => false];
        if ($near === 'any') {
            return $out;
        }
        $userId = $this->currentUserId();
        if ($userId === null) {
            return $out;
        }
        $loc = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', TenantContext::getId())
            ->first(['latitude', 'longitude']);
        if (!$loc || $loc->latitude === null || $loc->longitude === null) {
            $out['near_no_location'] = true;
            return $out;
        }
        $out['near_lat'] = (float) $loc->latitude;
        $out['near_lng'] = (float) $loc->longitude;
        $out['radius_km'] = (float) $near;
        return $out;
    }

    private function eventFilters(Request $request): array
    {
        $near = $this->allowed(self::asStr($request->query('near', $this->savedNearDefault())), ['any', '5', '10', '25', '50', '100'], 'any');

        return array_merge([
            'search' => trim(self::asStr($request->query('q'))) ?: null,
            'when' => $this->allowed($request->query('when', 'upcoming'), ['upcoming', 'past', 'all'], 'upcoming'),
            'category_id' => self::asStr($request->query('category_id')) !== '' ? (int) self::asStr($request->query('category_id')) : null,
            'step_free' => $this->allowed(
                $request->query('step_free', 'any'),
                ['any', 'yes', 'no', 'unknown'],
                'any',
            ),
            'cursor' => self::asStr($request->query('cursor')) ?: null,
            'near' => $near,
        ], $this->nearMeFilters($near));
    }

    private function eventInput(Request $request): array
    {
        $maxAttendees = trim(self::asStr($request->input('max_attendees')));
        $location = trim(self::asStr($request->input('location')));
        $onlineLink = trim(self::asStr($request->input('online_link')));
        $videoUrl = trim(self::asStr($request->input('video_url')));
        $timezone = trim(self::asStr($request->input('timezone')));
        if ($timezone === '') {
            $timezone = $this->accessibleEventDefaultTimezone();
        }
        $allDay = $request->boolean('all_day');
        $startTime = trim(self::asStr($request->input('start_time')));
        $endTime = trim(self::asStr($request->input('end_time')));
        if ($allDay) {
            $startTime = $this->accessibleAllDayBoundary($startTime, $timezone, false);
            $endTime = $this->accessibleAllDayBoundary($endTime, $timezone, true);
        }
        $categoryId = self::asStr($request->input('category_id'));
        $triState = static fn (mixed $value): ?bool => match (trim((string) $value)) {
            'yes' => true,
            'no' => false,
            default => null,
        };
        $accessibilityText = static function (Request $request, string $field): ?string {
            $value = trim(self::asStr($request->input($field)));

            return $value !== '' ? $value : null;
        };

        return [
            'title' => trim(self::asStr($request->input('title'))),
            'description' => trim(self::asStr($request->input('description'))),
            'start_time' => $startTime,
            'end_time' => $endTime !== '' ? $endTime : null,
            'timezone' => $timezone,
            'all_day' => $allDay,
            'location' => $location !== '' ? $location : null,
            'category_id' => $categoryId !== null && $categoryId !== '' ? (int) $categoryId : null,
            'max_attendees' => $maxAttendees !== '' ? max(1, (int) $maxAttendees) : null,
            'is_online' => $request->boolean('is_online'),
            'online_link' => $onlineLink !== '' ? $onlineLink : null,
            'allow_remote_attendance' => $request->boolean('allow_remote_attendance'),
            'video_url' => $videoUrl !== '' ? $videoUrl : null,
            'venue_accessibility' => [
                'step_free_access' => $triState($request->input('accessibility_step_free')),
                'accessible_toilet' => $triState($request->input('accessibility_toilet')),
                'hearing_loop' => $triState($request->input('accessibility_hearing_loop')),
                'quiet_space' => $triState($request->input('accessibility_quiet_space')),
                'seating_available' => $triState($request->input('accessibility_seating')),
                'accessible_parking' => $triState($request->input('accessibility_parking')),
                'parking_details' => $accessibilityText($request, 'accessibility_parking_details'),
                'transit_details' => $accessibilityText($request, 'accessibility_transit_details'),
                'assistance_contact' => $accessibilityText($request, 'accessibility_assistance_contact'),
                'notes' => $accessibilityText($request, 'accessibility_notes'),
            ],
        ];
    }

    private function accessibleEventDefaultTimezone(): string
    {
        $candidates = [
            app(TenantSettingsService::class)->get((int) TenantContext::getId(), 'general.timezone'),
            config('app.timezone', 'UTC'),
            'UTC',
        ];

        foreach ($candidates as $candidate) {
            $timezone = trim(is_string($candidate) ? $candidate : '');
            if ($timezone === '') {
                continue;
            }
            try {
                new \DateTimeZone($timezone);

                return $timezone;
            } catch (\Throwable) {
                // Continue to the auditable application/UTC fallback used by EventService.
            }
        }

        return 'UTC';
    }

    private function accessibleAllDayBoundary(string $value, string $timezone, bool $exclusiveEnd): string
    {
        if (preg_match('/^(\d{4}-\d{2}-\d{2})(?:[T ]|$)/', $value, $matches) !== 1) {
            return $value;
        }

        try {
            $date = new \DateTimeImmutable($matches[1] . ' 00:00:00', new \DateTimeZone($timezone));
            if ($exclusiveEnd) {
                $date = $date->modify('+1 day');
            }

            return $date->format('Y-m-d H:i:s');
        } catch (\Throwable) {
            return $value;
        }
    }

    private function volunteeringFilters(Request $request): array
    {
        return [
            'search' => trim(self::asStr($request->query('q'))) ?: null,
            'category_id' => self::asStr($request->query('category_id')) !== '' ? (int) self::asStr($request->query('category_id')) : null,
            'is_remote' => $request->boolean('is_remote') ? true : null,
            'cursor' => self::asStr($request->query('cursor')) ?: null,
        ];
    }

    private function categoriesForTypes(array $types): array
    {
        return Category::whereIn('type', $types)
            ->where('tenant_id', TenantContext::getId())
            ->orderBy('name')
            ->get(['id', 'name'])
            ->toArray();
    }

    private function volunteeringHourOrganizations(array $organizations, array $applications): array
    {
        $byId = [];

        foreach ($organizations as $organization) {
            if (!empty($organization['id'])) {
                $byId[(int) $organization['id']] = $organization;
            }
        }

        foreach ($applications as $application) {
            $organization = $application['organization'] ?? null;
            if (is_array($organization) && !empty($organization['id'])) {
                $byId[(int) $organization['id']] = $organization;
            }
        }

        uasort($byId, fn (array $a, array $b): int => strcasecmp((string) ($a['name'] ?? ''), (string) ($b['name'] ?? '')));

        return array_values($byId);
    }

    private function memberFilters(Request $request): array
    {
        return [
            'q' => trim(self::asStr($request->query('q'))),
            'sort' => $this->allowed($request->query('sort', 'name'), ['name', 'joined', 'rating', 'hours_given'], 'name'),
            'order' => $this->allowed(strtoupper(self::asStr($request->query('order'))), ['ASC', 'DESC'], 'ASC'),
            'limit' => $this->intQuery($request, 'limit', 20, 1, 100),
            'offset' => $this->intQuery($request, 'offset', 0, 0, 100000),
        ];
    }

    private function memberDirectory(array $filters, int $viewerId): array
    {
        $tenantId = TenantContext::getId();
        $params = [$tenantId, 'active'];
        $where = 'u.tenant_id = ? AND u.status = ? AND u.id != ? AND (u.privacy_search = 1 OR u.privacy_search IS NULL)';
        $params[] = $viewerId;

        if ($filters['q'] !== '') {
            $memberIds = SearchService::searchUsersStatic($filters['q'], $tenantId);
            if ($memberIds !== false && !empty($memberIds)) {
                $placeholders = implode(',', array_fill(0, count($memberIds), '?'));
                $where .= " AND u.id IN ($placeholders)";
                $params = array_merge($params, array_map('intval', $memberIds));
            } elseif ($memberIds !== false) {
                $where .= ' AND 1=0';
            }
        }

        foreach (OnboardingConfigService::getVisibilitySqlConditions($tenantId) as $condition) {
            $where .= " AND ($condition)";
        }

        $orderBy = [
            'name' => 'u.name',
            'joined' => 'u.created_at',
            'rating' => 'rating',
            'hours_given' => 'total_hours_given',
        ][$filters['sort']] ?? 'u.name';

        $total = (int) DB::selectOne("SELECT COUNT(*) as total FROM users u WHERE $where", $params)->total;

        $sql = "SELECT u.id,
                       CASE
                           WHEN u.profile_type = 'organisation' AND u.organization_name IS NOT NULL AND u.organization_name != '' THEN u.organization_name
                           ELSE CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))
                       END as name,
                       u.avatar_url as avatar,
                       COALESCE(u.tagline, LEFT(u.bio, 120)) as tagline,
                       u.location,
                       u.created_at,
                       u.is_verified,
                       r.avg_rating as rating,
                       COALESCE(tg.total_given, 0) as total_hours_given,
                       COALESCE(tr.total_received, 0) as total_hours_received
                FROM users u
                LEFT JOIN (SELECT receiver_id, AVG(rating) as avg_rating FROM reviews WHERE tenant_id = ? GROUP BY receiver_id) r ON r.receiver_id = u.id
                LEFT JOIN (SELECT sender_id, COALESCE(SUM(amount), 0) as total_given FROM transactions WHERE status = 'completed' AND tenant_id = ? GROUP BY sender_id) tg ON tg.sender_id = u.id
                LEFT JOIN (SELECT receiver_id, COALESCE(SUM(amount), 0) as total_received FROM transactions WHERE status = 'completed' AND tenant_id = ? GROUP BY receiver_id) tr ON tr.receiver_id = u.id
                WHERE $where
                ORDER BY $orderBy {$filters['order']}
                LIMIT ? OFFSET ?";

        $items = DB::select($sql, array_merge([$tenantId, $tenantId, $tenantId], $params, [$filters['limit'], $filters['offset']]));

        return [
            // Attach the viewer's connection state per card (≤ per_page lookups) so
            // the directory shows "Connected"/"Request sent" at a glance.
            'items' => $this->alphaAttachIdentityVerified(array_map(function (object $row) use ($viewerId): array {
                $member = (array) $row;
                try {
                    $member['connection_state'] = ConnectionService::getStatus($viewerId, (int) $member['id'])['status'] ?? 'none';
                } catch (\Throwable $e) {
                    $member['connection_state'] = 'none';
                }

                return $member;
            }, $items)),
            'meta' => [
                'total_items' => $total,
                'offset' => $filters['offset'],
                'per_page' => $filters['limit'],
                'has_more' => ($filters['offset'] + $filters['limit']) < $total,
            ],
        ];
    }

    private function intQuery(Request $request, string $key, int $default, int $min, int $max): int
    {
        $value = $request->query($key, $default);
        return max($min, min($max, is_numeric($value) ? (int) $value : $default));
    }

    private function allowed(mixed $value, array $allowed, mixed $default): mixed
    {
        return in_array($value, $allowed, true) ? $value : $default;
    }

    // ===== WAVE O: Organisations depth =====

    /**
     * Build the depth payload for an organisation detail page: open volunteering
     * opportunities, member reviews and aggregate stats (volunteer count, total
     * approved hours, average rating).
     *
     * Every backing call is tenant-scoped: VolunteerService::getOpportunities()
     * runs through the VolOpportunity tenant global scope, VolunteerService::
     * getReviews() and getOrganizationById() filter on tenant_id in SQL. The
     * caller has already 404'd a cross-tenant / unknown org id, so this only ever
     * returns the current tenant's data. Failures degrade to empty sections — the
     * page must still render the core organisation profile.
     *
     * @return array{opportunities: list<array<string, mixed>>, reviews: list<array<string, mixed>>, stats: array<string, mixed>}
     */
    private function waveOrgDetailExtras(int $orgId): array
    {
        $opportunities = [];
        $reviews = [];
        $stats = [];

        try {
            $opportunities = \App\Services\VolunteerService::getOpportunities([
                'organization_id' => $orgId,
                'limit' => 10,
            ])['items'] ?? [];
            $opportunities = is_array($opportunities) ? array_values($opportunities) : [];
        } catch (\Throwable $e) {
            report($e);
        }

        try {
            $rawReviews = \App\Services\VolunteerService::getReviews('organization', $orgId);
            foreach ((is_array($rawReviews) ? $rawReviews : []) as $review) {
                if (! is_array($review)) {
                    continue;
                }
                // Resolve the reviewer avatar to a same-origin URL, matching how
                // the rest of the accessible frontend handles user images.
                if (isset($review['author']) && is_array($review['author'])) {
                    $review['author']['avatar'] = $this->resolveAsset(
                        self::asStr($review['author']['avatar'] ?? null) ?: null
                    );
                }
                $reviews[] = $review;
            }
        } catch (\Throwable $e) {
            report($e);
        }

        try {
            // getOrganizationById() is the stats-bearing, fully tenant-scoped
            // accessor (volunteer/hours/rating aggregates computed in SQL).
            $withStats = \App\Services\VolunteerService::getOrganizationById($orgId);
            if (is_array($withStats)) {
                $stats = [
                    'opportunity_count' => (int) ($withStats['opportunity_count'] ?? 0),
                    'volunteer_count' => $withStats['volunteer_count'] ?? null,
                    'total_hours' => (float) ($withStats['total_hours'] ?? 0),
                    'review_count' => (int) ($withStats['review_count'] ?? 0),
                    'average_rating' => (float) ($withStats['average_rating'] ?? 0),
                ];
            }
        } catch (\Throwable $e) {
            report($e);
        }

        return [
            'opportunities' => $opportunities,
            'reviews' => $reviews,
            'stats' => $stats,
        ];
    }

    // ===== WAVE V2: Volunteering depth =====

    /**
     * Certificates tab — list the member's earned volunteer impact certificates
     * with a download action. Generation summarises the member's own approved
     * hours; every read/write is scoped to the authenticated user + tenant.
     */
    public function volunteeringCertificates(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('volunteering'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $certificates = [];
        $error = null;
        try {
            $result = \App\Services\VolunteerCertificateService::getUserCertificates($userId, ['limit' => 50]);
            $certificates = $result['items'] ?? [];
        } catch (\Throwable $e) {
            report($e);
            $error = __('govuk_alpha.vol_depth.certificates_error');
        }

        return $this->view('accessible-frontend::volunteering-certificates', [
            'title' => __('govuk_alpha.vol_depth.certificates_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'volunteering',
            'certificates' => $certificates,
            'error' => $error,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /**
     * Generate a new volunteer impact certificate for the authenticated member.
     * Backed by VolunteerCertificateService::generate(), which only ever
     * aggregates the supplied user's own approved hours within the tenant.
     */
    public function generateVolunteerCertificate(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('volunteering'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $certificate = null;
        try {
            $certificate = \App\Services\VolunteerCertificateService::generate($userId);
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.volunteering.certificates', [
            'tenantSlug' => $tenantSlug,
            'status' => $certificate === null ? 'certificate-no-hours' : 'certificate-generated',
        ]);
    }

    /**
     * Download a certificate as printable HTML. The certificate is loaded via
     * the tenant-scoped service and its user_id is compared to the caller:
     * a member can only download their OWN certificate (404 if the code does
     * not resolve to a certificate they own within this tenant — prevents IDOR
     * by guessing another member's verification code).
     */
    public function downloadVolunteerCertificate(Request $request, string $tenantSlug, string $code): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('volunteering'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        // Ownership gate: the certificate must belong to THIS user within the
        // current tenant. verify()/generateHtml() are tenant-scoped but not
        // user-scoped, so we enforce the user_id check here ourselves.
        $owns = DB::table('vol_certificates')
            ->where('verification_code', $code)
            ->where('user_id', $userId)
            ->where('tenant_id', TenantContext::getId())
            ->exists();
        abort_unless($owns, 404);

        $html = \App\Services\VolunteerCertificateService::generateHtml($code);
        abort_if($html === null, 404);

        \App\Services\VolunteerCertificateService::markDownloaded($code);

        return response($html, 200)
            ->header('Content-Type', 'text/html; charset=UTF-8')
            ->header('Content-Disposition', 'inline; filename="volunteer-certificate-' . preg_replace('/[^A-Za-z0-9_-]/', '', $code) . '.html"');
    }

    /**
     * Waitlist tab — list the shifts the member is currently waitlisted for,
     * with a leave-waitlist action. getUserWaitlists() is tenant-scoped via the
     * passed tenant id and only returns the supplied user's own entries.
     */
    public function volunteeringWaitlist(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('volunteering'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $entries = [];
        $error = null;
        try {
            $entries = \App\Services\ShiftWaitlistService::getUserWaitlists($userId, TenantContext::getId());
        } catch (\Throwable $e) {
            report($e);
            $error = __('govuk_alpha.vol_depth.waitlist_error');
        }

        return $this->view('accessible-frontend::volunteering-waitlist', [
            'title' => __('govuk_alpha.vol_depth.waitlist_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'volunteering',
            'entries' => $entries,
            'error' => $error,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /**
     * Leave the waitlist for a shift. ShiftWaitlistService::leave() is scoped to
     * the current tenant AND the supplied user id, so a member can only remove
     * their OWN waitlist entry — passing another member's shift id simply finds
     * no entry for this user and returns false (rendered as a not-found notice).
     */
    public function leaveVolunteerWaitlist(Request $request, string $tenantSlug, int $shiftId): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('volunteering'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $ok = false;
        try {
            $ok = \App\Services\ShiftWaitlistService::leave($shiftId, $userId);
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.volunteering.waitlist', [
            'tenantSlug' => $tenantSlug,
            'status' => $ok ? 'waitlist-left' : 'waitlist-leave-failed',
        ]);
    }

    /**
     * Shift swaps tab — list incoming/outgoing swap requests and render a form
     * to request a new swap. The "your shift" options are the caller's OWN
     * approved shift assignments (getMyShifts is user + tenant scoped); the
     * service re-verifies sign-up ownership before creating any swap.
     */
    public function volunteeringSwaps(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('volunteering'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $swaps = [];
        $myShifts = [];
        $error = null;
        try {
            $swaps = \App\Services\ShiftSwapService::getSwapRequests($userId, 'all');
            $myShifts = \App\Services\VolunteerService::getMyShifts($userId, ['limit' => 50])['items'] ?? [];
        } catch (\Throwable $e) {
            report($e);
            $error = __('govuk_alpha.vol_depth.swaps_error');
        }

        return $this->view('accessible-frontend::volunteering-swaps', [
            'title' => __('govuk_alpha.vol_depth.swaps_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'volunteering',
            'swaps' => $swaps,
            'myShifts' => $myShifts,
            'error' => $error,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /**
     * Request a shift swap. ShiftSwapService::requestSwap() verifies the caller
     * is signed up for from_shift and the target user is signed up for to_shift
     * (both tenant-scoped), so a member cannot offer a shift that is not theirs
     * or fabricate a swap on another member's behalf.
     */
    public function requestVolunteerSwap(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('volunteering'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $fromShiftId = (int) $request->input('from_shift_id');
        $toShiftId = (int) $request->input('to_shift_id');
        $toUserId = (int) $request->input('to_user_id');

        if ($fromShiftId <= 0 || $toShiftId <= 0 || $toUserId <= 0) {
            return redirect()->route('govuk-alpha.volunteering.swaps', [
                'tenantSlug' => $tenantSlug,
                'status' => 'swap-invalid',
            ]);
        }

        $swapId = null;
        try {
            $swapId = \App\Services\ShiftSwapService::requestSwap($userId, [
                'from_shift_id' => $fromShiftId,
                'to_shift_id' => $toShiftId,
                'to_user_id' => $toUserId,
                'message' => trim(self::asStr($request->input('message'))),
            ]);
        } catch (\App\Exceptions\SafeguardingPolicyException $e) {
            $safeguardingStatus = $e->reasonCode === 'SAFEGUARDING_POLICY_UNAVAILABLE'
                ? 'swap-safeguarding-unavailable'
                : 'swap-safeguarding-restricted';
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.volunteering.swaps', [
            'tenantSlug' => $tenantSlug,
            'status' => $swapId === null ? ($safeguardingStatus ?? 'swap-request-failed') : 'swap-requested',
        ]);
    }

    /**
     * Respond to an incoming swap request (accept / reject). The service checks
     * that the swap is addressed to THIS user (to_user_id === caller) and is
     * tenant-scoped, so a member cannot accept/reject a request directed at
     * someone else (returns false → handled as a not-found/forbidden notice).
     */
    public function respondVolunteerSwap(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('volunteering'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $action = $this->allowed($request->input('action'), ['accept', 'reject'], null);
        if ($action === null) {
            return redirect()->route('govuk-alpha.volunteering.swaps', [
                'tenantSlug' => $tenantSlug,
                'status' => 'swap-invalid',
            ]);
        }

        $ok = false;
        try {
            $ok = \App\Services\ShiftSwapService::respond($id, $userId, (string) $action);
        } catch (\App\Exceptions\SafeguardingPolicyException $e) {
            $safeguardingStatus = $e->reasonCode === 'SAFEGUARDING_POLICY_UNAVAILABLE'
                ? 'swap-safeguarding-unavailable'
                : 'swap-safeguarding-restricted';
        } catch (\Throwable $e) {
            report($e);
        }

        $statusCode = $safeguardingStatus ?? 'swap-respond-failed';
        if ($ok) {
            $statusCode = $action === 'accept' ? 'swap-accepted' : 'swap-rejected';
        }

        return redirect()->route('govuk-alpha.volunteering.swaps', [
            'tenantSlug' => $tenantSlug,
            'status' => $statusCode,
        ]);
    }

    /**
     * Cancel a swap request the caller sent. ShiftSwapService::cancel() filters
     * by from_user_id === caller AND tenant, so only the original requester can
     * cancel their own pending request.
     */
    public function cancelVolunteerSwap(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('volunteering'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $ok = false;
        try {
            $ok = \App\Services\ShiftSwapService::cancel($id, $userId, TenantContext::getId());
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.volunteering.swaps', [
            'tenantSlug' => $tenantSlug,
            'status' => $ok ? 'swap-cancelled' : 'swap-cancel-failed',
        ]);
    }

    // =====================================================================
    // WAVE FED2: Federation heavy slice — federated connections, messaging,
    // and hour transfers. CREDIT-MOVING code: every read is tenant-scoped,
    // every mutation is owner-scoped, and the transfer is balance-exact and
    // non-duplicable. Mirrors FederationV2Controller methods one-for-one.
    // =====================================================================

    /**
     * Federated CONNECTIONS list — `/federation/connections` (GET).
     * Mirrors FederationV2Controller::connections() — the
     * FederatedConnectionService::getConnections query is fully tenant-scoped
     * and only returns rows where the viewer is the requester OR receiver.
     */
    public function federationConnections(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('federation'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }
        if ($redirect = $this->federationOptInRedirectIfRequired($userId, $tenantSlug)) {
            return $redirect;
        }

        $tenantId = TenantContext::getId();
        $allowed = $this->federationOperationAllowed('profiles', $tenantId);

        // Tab selection. Default to accepted connections; the other tabs mirror
        // the React directional pending filters.
        $tab = self::asStr($request->query('tab')) ?: 'accepted';
        $statusFilter = match ($tab) {
            'received' => 'pending_received',
            'sent' => 'pending_sent',
            default => 'accepted',
        };
        if (!in_array($tab, ['accepted', 'received', 'sent'], true)) {
            $tab = 'accepted';
        }

        // Page-based pagination (mirrors the wallet history pattern): fetch one
        // extra row to detect a next page. A member with >$perPage connections
        // previously lost every row beyond the flat 100-cap.
        $page = max(1, (int) $request->query('page', 1));
        $perPage = 50;

        $connections = [];
        $hasMore = false;
        $loadError = false;
        if ($allowed) {
            try {
                $rows = app(\App\Services\FederatedConnectionService::class)
                    ->getConnections($userId, $statusFilter, $perPage + 1, ($page - 1) * $perPage);
                $hasMore = count($rows) > $perPage;
                $connections = array_slice($rows, 0, $perPage);
            } catch (\Throwable $e) {
                report($e);
                $loadError = true;
            }
        }

        return $this->view('accessible-frontend::federation-connections', [
            'title' => __('govuk_alpha.fed2.connections.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'federationActiveTab' => 'connections',
            'allowed' => $allowed,
            'connections' => $connections,
            'tab' => $tab,
            'page' => $page,
            'hasMore' => $hasMore,
            'loadError' => $loadError,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /**
     * Send a federated CONNECTION request — `/federation/connections` (POST).
     * Delegates to FederatedConnectionService::sendRequest which validates the
     * receiver opt-in, partnership status, and dispatches the same notification
     * + email the API path does (LocaleContext-wrapped inside the service).
     */
    public function storeFederationConnection(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('federation'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }
        if ($redirect = $this->federationOptInRedirectIfRequired($userId, $tenantSlug)) {
            return $redirect;
        }

        $tenantId = TenantContext::getId();
        $receiverId = (int) $request->input('receiver_id');
        $receiverTenantId = (int) $request->input('receiver_tenant_id');
        $message = self::asStr($request->input('message')) ?: null;

        // Send the viewer back to the member profile they connected from.
        $backToMember = fn (string $status): RedirectResponse => redirect()->route(
            'govuk-alpha.federation.members.show',
            ['tenantSlug' => $tenantSlug, 'id' => $receiverId, 'tenant_id' => $receiverTenantId, 'status' => $status]
        );

        if (!$this->federationOperationAllowed('profiles', $tenantId)) {
            return redirect()->route('govuk-alpha.federation.members.index', ['tenantSlug' => $tenantSlug, 'status' => 'connect-unavailable']);
        }
        if ($receiverId <= 0 || $receiverTenantId <= 0) {
            return redirect()->route('govuk-alpha.federation.members.index', ['tenantSlug' => $tenantSlug, 'status' => 'connect-failed']);
        }

        $result = ['success' => false];
        try {
            $result = app(\App\Services\FederatedConnectionService::class)
                ->sendRequest($userId, $receiverId, $receiverTenantId, $message);
        } catch (\Throwable $e) {
            report($e);
        }

        if ($result['success'] ?? false) {
            return $backToMember('connect-sent');
        }
        $errorCode = (string) ($result['error_code'] ?? '');
        return $backToMember(match ($errorCode) {
            'SAFEGUARDING_POLICY_UNAVAILABLE' => 'connect-safeguarding-unavailable',
            'VETTING_REQUIRED', 'SAFEGUARDING_CONTACT_RESTRICTED' => 'connect-safeguarding-restricted',
            default => 'connect-failed',
        });
    }

    /**
     * Accept a federated connection request — `/federation/connections/{id}/accept`.
     * FederatedConnectionService::acceptRequest only accepts a row where the
     * current user is the receiver AND in the current tenant AND status=pending,
     * so member A can never accept member B's request (returns failure → 404 page).
     */
    public function acceptFederationConnection(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        return $this->mutateFederationConnection($tenantSlug, $id, 'accept');
    }

    /** Reject a federated connection request — `/federation/connections/{id}/reject`. */
    public function rejectFederationConnection(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        return $this->mutateFederationConnection($tenantSlug, $id, 'reject');
    }

    /** Remove an existing federated connection — `/federation/connections/{id}/remove`. */
    public function removeFederationConnection(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        return $this->mutateFederationConnection($tenantSlug, $id, 'remove');
    }

    /**
     * Shared accept/reject/remove handler. Each underlying service method is
     * owner-scoped (accept/reject require the viewer to be the RECEIVER of a
     * pending row; remove requires the viewer to be EITHER party) — a guessed id
     * belonging to another member yields success=false and a 'failed' redirect.
     */
    private function mutateFederationConnection(string $tenantSlug, int $id, string $action): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('federation'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $service = app(\App\Services\FederatedConnectionService::class);
        $result = ['success' => false];
        try {
            $result = match ($action) {
                'accept' => $service->acceptRequest($id, $userId),
                'reject' => $service->rejectRequest($id, $userId),
                'remove' => $service->removeConnection($id, $userId),
                default => ['success' => false],
            };
        } catch (\Throwable $e) {
            report($e);
        }

        $ok = (bool) ($result['success'] ?? false);
        $statusMap = [
            'accept' => $ok ? 'connection-accepted' : 'connection-action-failed',
            'reject' => $ok ? 'connection-rejected' : 'connection-action-failed',
            'remove' => $ok ? 'connection-removed' : 'connection-action-failed',
        ];

        // Accept/reject act on a received request; default the tab so the user
        // lands where the row used to be.
        $tab = $action === 'remove' ? 'accepted' : 'received';

        return redirect()->route('govuk-alpha.federation.connections.index', [
            'tenantSlug' => $tenantSlug,
            'tab' => $tab,
            'status' => $statusMap[$action] ?? 'connection-action-failed',
        ]);
    }

    /**
     * Federated MESSAGES inbox — `/federation/messages` (GET).
     * Mirrors FederationV2Controller::messages() WHERE clause exactly: a row is
     * only returned when the viewer is the sender OR receiver (internal), or the
     * matching party on an external row. Read-only.
     */
    public function federationMessages(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('federation'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }
        if ($redirect = $this->federationOptInRedirectIfRequired($userId, $tenantSlug)) {
            return $redirect;
        }

        $tenantId = TenantContext::getId();
        $allowed = $this->federationOperationAllowed('messaging', $tenantId);
        $q = trim(self::asStr($request->query('q')));

        // Viewer participation differentiates "feature off for this community" from
        // "you have not opted in" so the gating notice can offer an opt-in CTA.
        $viewerSettings = \App\Services\FederationUserService::getUserSettings($userId);
        $viewerOptedIn = (bool) ($viewerSettings['federation_optin'] ?? false);
        $viewerCanMessage = $viewerOptedIn && (bool) ($viewerSettings['messaging_enabled_federated'] ?? false);

        $threads = [];
        $loadError = false;
        if ($allowed) {
            try {
                // Select ONLY the viewer's own copy of each message (outbound rows
                // they sent + inbound rows they received) so the dual-insert does
                // not surface duplicate cards. Then group into per-partner threads.
                $rows = DB::select("
                    SELECT fm.id, fm.subject, fm.body, fm.direction, fm.status, fm.read_at,
                        fm.created_at, fm.sender_tenant_id, fm.sender_user_id,
                        fm.receiver_tenant_id, fm.receiver_user_id,
                        COALESCE(su.first_name, '') as sender_first_name,
                        COALESCE(su.last_name, '') as sender_last_name,
                        st.name as sender_tenant_name,
                        COALESCE(ru.first_name, '') as receiver_first_name,
                        COALESCE(ru.last_name, '') as receiver_last_name,
                        rt.name as receiver_tenant_name
                    FROM federation_messages fm
                    LEFT JOIN users su ON su.id = fm.sender_user_id AND su.tenant_id = fm.sender_tenant_id
                    LEFT JOIN tenants st ON st.id = fm.sender_tenant_id
                    LEFT JOIN users ru ON ru.id = fm.receiver_user_id AND ru.tenant_id = fm.receiver_tenant_id
                    LEFT JOIN tenants rt ON rt.id = fm.receiver_tenant_id
                    WHERE fm.external_partner_id IS NULL
                      AND (
                        (fm.direction = 'outbound' AND fm.sender_user_id = ? AND fm.sender_tenant_id = ?)
                        OR (fm.direction = 'inbound' AND fm.receiver_user_id = ? AND fm.receiver_tenant_id = ?)
                      )
                    ORDER BY fm.created_at DESC, fm.id DESC LIMIT 500
                ", [$userId, $tenantId, $userId, $tenantId]);

                $byThread = [];
                foreach ($rows as $r) {
                    $outbound = ($r->direction === 'outbound');
                    $partnerUserId = $outbound ? (int) $r->receiver_user_id : (int) $r->sender_user_id;
                    $partnerTenantId = $outbound ? (int) $r->receiver_tenant_id : (int) $r->sender_tenant_id;
                    $partnerName = $outbound
                        ? trim(((string) $r->receiver_first_name) . ' ' . ((string) $r->receiver_last_name))
                        : trim(((string) $r->sender_first_name) . ' ' . ((string) $r->sender_last_name));
                    $partnerTenantName = $outbound ? (string) ($r->receiver_tenant_name ?? '') : (string) ($r->sender_tenant_name ?? '');
                    $key = $partnerUserId . '-' . $partnerTenantId;

                    if (!isset($byThread[$key])) {
                        // Rows are newest-first, so the first row seen is the latest.
                        $byThread[$key] = [
                            'partner_user_id' => $partnerUserId,
                            'partner_tenant_id' => $partnerTenantId,
                            'partner_name' => $partnerName ?: __('govuk_alpha.members.unknown_member'),
                            'partner_tenant_name' => $partnerTenantName,
                            'last_subject' => (string) ($r->subject ?? ''),
                            'last_preview' => mb_substr(trim((string) ($r->body ?? '')), 0, 120),
                            'last_created_at' => $r->created_at,
                            'last_outbound' => $outbound,
                            'unread_count' => 0,
                        ];
                    }
                    // Unread = an inbound copy the viewer has not read yet.
                    if (!$outbound && (string) ($r->status ?? '') !== 'read' && empty($r->read_at)) {
                        $byThread[$key]['unread_count']++;
                    }
                }

                $threads = array_values($byThread);

                // Thread search (partner name / community / last subject).
                if ($q !== '') {
                    $needle = mb_strtolower($q);
                    $threads = array_values(array_filter($threads, static function (array $t) use ($needle): bool {
                        return str_contains(mb_strtolower($t['partner_name']), $needle)
                            || str_contains(mb_strtolower($t['partner_tenant_name']), $needle)
                            || str_contains(mb_strtolower($t['last_subject']), $needle);
                    }));
                }
            } catch (\Throwable $e) {
                report($e);
                $loadError = true;
            }
        }

        return $this->view('accessible-frontend::federation-messages', [
            'title' => __('govuk_alpha.fed2.messages.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'federationActiveTab' => 'messages',
            'allowed' => $allowed,
            'threads' => $threads,
            'query' => $q,
            'viewerOptedIn' => $viewerOptedIn,
            'viewerCanMessage' => $viewerCanMessage,
            'loadError' => $loadError,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /**
     * CONVERSATION view — `/federation/messages/conversation/{partnerId}?tenant_id=`.
     * Renders the chronological message history between the viewer and one partner
     * member, marks the viewer's unread inbound messages from that partner as read
     * (a server round-trip, in scope), and offers a reply form + per-message
     * translate (feature-gated). Internal partners only.
     */
    public function federationConversation(Request $request, string $tenantSlug, int $partnerId): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('federation'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }
        if ($redirect = $this->federationOptInRedirectIfRequired($userId, $tenantSlug)) {
            return $redirect;
        }

        $tenantId = TenantContext::getId();
        if (!$this->federationOperationAllowed('messaging', $tenantId)) {
            return redirect()->route('govuk-alpha.federation.messages.index', ['tenantSlug' => $tenantSlug]);
        }

        $partnerTenantId = (int) $request->query('tenant_id');
        if ($partnerId <= 0 || $partnerTenantId <= 0) {
            return redirect()->route('govuk-alpha.federation.messages.index', ['tenantSlug' => $tenantSlug]);
        }

        $messages = [];
        $partnerName = '';
        $partnerTenantName = '';
        try {
            $rows = DB::select("
                SELECT fm.id, fm.subject, fm.body, fm.direction, fm.status, fm.read_at, fm.created_at,
                    fm.sender_user_id, fm.sender_tenant_id, fm.receiver_user_id, fm.receiver_tenant_id,
                    COALESCE(su.first_name, '') as sender_first_name, COALESCE(su.last_name, '') as sender_last_name,
                    st.name as sender_tenant_name,
                    COALESCE(ru.first_name, '') as receiver_first_name, COALESCE(ru.last_name, '') as receiver_last_name,
                    rt.name as receiver_tenant_name
                FROM federation_messages fm
                LEFT JOIN users su ON su.id = fm.sender_user_id AND su.tenant_id = fm.sender_tenant_id
                LEFT JOIN tenants st ON st.id = fm.sender_tenant_id
                LEFT JOIN users ru ON ru.id = fm.receiver_user_id AND ru.tenant_id = fm.receiver_tenant_id
                LEFT JOIN tenants rt ON rt.id = fm.receiver_tenant_id
                WHERE fm.external_partner_id IS NULL AND (
                    (fm.direction = 'outbound' AND fm.sender_user_id = ? AND fm.sender_tenant_id = ? AND fm.receiver_user_id = ? AND fm.receiver_tenant_id = ?)
                    OR (fm.direction = 'inbound' AND fm.receiver_user_id = ? AND fm.receiver_tenant_id = ? AND fm.sender_user_id = ? AND fm.sender_tenant_id = ?)
                )
                ORDER BY fm.created_at ASC, fm.id ASC LIMIT 500
            ", [$userId, $tenantId, $partnerId, $partnerTenantId, $userId, $tenantId, $partnerId, $partnerTenantId]);

            foreach ($rows as $r) {
                $outbound = ($r->direction === 'outbound');
                if ($partnerName === '') {
                    $partnerName = $outbound
                        ? trim(((string) $r->receiver_first_name) . ' ' . ((string) $r->receiver_last_name))
                        : trim(((string) $r->sender_first_name) . ' ' . ((string) $r->sender_last_name));
                    $partnerTenantName = $outbound ? (string) ($r->receiver_tenant_name ?? '') : (string) ($r->sender_tenant_name ?? '');
                }
                $messages[] = [
                    'id' => (int) $r->id,
                    'subject' => (string) ($r->subject ?? ''),
                    'body' => (string) ($r->body ?? ''),
                    'outbound' => $outbound,
                    'read' => ((string) ($r->status ?? '') === 'read' || !empty($r->read_at)),
                    'created_at' => $r->created_at,
                ];
            }
        } catch (\Throwable $e) {
            report($e);
        }

        // A conversation must already exist (threads are reached from the inbox).
        if (empty($messages)) {
            return redirect()->route('govuk-alpha.federation.messages.index', ['tenantSlug' => $tenantSlug]);
        }

        // Mark the viewer's unread inbound messages from this partner as read.
        try {
            DB::update("
                UPDATE federation_messages SET status = 'read', read_at = NOW()
                WHERE external_partner_id IS NULL AND direction = 'inbound'
                  AND receiver_user_id = ? AND receiver_tenant_id = ?
                  AND sender_user_id = ? AND sender_tenant_id = ?
                  AND status != 'read'
            ", [$userId, $tenantId, $partnerId, $partnerTenantId]);
        } catch (\Throwable $e) {
            report($e);
        }

        $viewerSettings = \App\Services\FederationUserService::getUserSettings($userId);
        $canReply = (bool) ($viewerSettings['federation_optin'] ?? false) && (bool) ($viewerSettings['messaging_enabled_federated'] ?? false);

        return $this->view('accessible-frontend::federation-conversation', [
            'title' => $partnerName ?: __('govuk_alpha.fed2.messages.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'federationActiveTab' => 'messages',
            'partnerId' => $partnerId,
            'partnerTenantId' => $partnerTenantId,
            'partnerName' => $partnerName ?: __('govuk_alpha.members.unknown_member'),
            'partnerTenantName' => $partnerTenantName,
            'messages' => $messages,
            'canReply' => $canReply,
            'translateEnabled' => TenantContext::hasFeature('message_translation'),
            'translation' => session('fed_translation'),
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /**
     * Translate a federated MESSAGE — `/federation/messages/translate/{id}` (POST).
     * Server-side POST-and-rerender equivalent of the React per-message Translate
     * button: translates into the viewer's locale via TranscriptionService and
     * flashes the result so the conversation view can show it inline with a
     * "show original" toggle. Feature-gated on message_translation.
     */
    public function translateFederationMessage(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('federation'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $tenantId = TenantContext::getId();
        $partnerId = (int) $request->input('partner_id');
        $partnerTenantId = (int) $request->input('partner_tenant_id');

        $back = fn (array $extra = []): RedirectResponse => redirect()->route(
            'govuk-alpha.federation.messages.conversation',
            array_merge(['tenantSlug' => $tenantSlug, 'partnerId' => $partnerId, 'tenant_id' => $partnerTenantId], $extra)
        );

        if (!TenantContext::hasFeature('message_translation') || !$this->federationOperationAllowed('messaging', $tenantId)) {
            return $back(['status' => 'translate-unavailable']);
        }

        // Viewer must be sender or receiver of the message.
        $message = DB::selectOne("
            SELECT id, body FROM federation_messages
            WHERE id = ? AND external_partner_id IS NULL
              AND ((sender_user_id = ? AND sender_tenant_id = ?) OR (receiver_user_id = ? AND receiver_tenant_id = ?))
        ", [$id, $userId, $tenantId, $userId, $tenantId]);

        if (!$message || trim((string) ($message->body ?? '')) === '') {
            return $back(['status' => 'translate-failed']);
        }

        $target = app()->getLocale();
        $translated = null;
        try {
            $translated = \App\Services\TranscriptionService::translate((string) $message->body, 'auto', $target);
        } catch (\Throwable $e) {
            report($e);
        }

        if ($translated === null || $translated === '') {
            return $back(['status' => 'translate-failed']);
        }

        // Pass the translated text to the re-rendered conversation via flash.
        session()->flash('fed_translation', ['id' => $id, 'text' => $translated]);
        return $back();
    }

    /**
     * Send a federated MESSAGE — `/federation/messages` (POST).
     *
     * CRITICAL DUAL-INSERT: mirrors FederationV2Controller::sendMessage() — a
     * single send writes EXACTLY ONE 'outbound' row (sender's copy) AND ONE
     * 'inbound' row (recipient's copy). All gating (sender opt-in, receiver
     * opt-in + messaging, active partnership with messaging) is replicated.
     * External (ext-) recipients are NOT supported on this server-rendered
     * surface and are rejected. Recipient notification is LocaleContext-wrapped.
     */
    public function storeFederationMessage(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('federation'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }
        if ($redirect = $this->federationOptInRedirectIfRequired($userId, $tenantSlug)) {
            return $redirect;
        }

        $tenantId = TenantContext::getId();
        $receiverId = (int) $request->input('receiver_id');
        $receiverTenantId = (int) $request->input('receiver_tenant_id');
        $subject = trim(self::asStr($request->input('subject')));
        $body = trim(self::asStr($request->input('body')));

        // A reply from the conversation thread carries context=conversation and a
        // reference_message_id; it returns to the conversation, while a first
        // message from a member profile returns to that profile.
        $isConversationReply = self::asStr($request->input('context')) === 'conversation';
        $referenceMessageId = (int) $request->input('reference_message_id');
        $referenceMessageId = $referenceMessageId > 0 ? $referenceMessageId : null;

        $backToMember = function (string $status) use ($isConversationReply, $tenantSlug, $receiverId, $receiverTenantId): RedirectResponse {
            if ($isConversationReply) {
                return redirect()->route('govuk-alpha.federation.messages.conversation', [
                    'tenantSlug' => $tenantSlug, 'partnerId' => $receiverId, 'tenant_id' => $receiverTenantId, 'status' => $status,
                ]);
            }
            return redirect()->route('govuk-alpha.federation.members.show', [
                'tenantSlug' => $tenantSlug, 'id' => $receiverId, 'tenant_id' => $receiverTenantId, 'status' => $status,
            ]);
        };

        if (!$this->federationOperationAllowed('messaging', $tenantId)) {
            return redirect()->route('govuk-alpha.federation.members.index', ['tenantSlug' => $tenantSlug, 'status' => 'message-unavailable']);
        }
        if ($receiverId <= 0 || $receiverTenantId <= 0) {
            return redirect()->route('govuk-alpha.federation.members.index', ['tenantSlug' => $tenantSlug, 'status' => 'message-failed']);
        }
        if ($body === '') {
            return $backToMember('message-empty');
        }
        if (mb_strlen($subject) > 255 || mb_strlen($body) > 10000) {
            return $backToMember('message-too-long');
        }

        // Sender must be opted in AND have federated messaging enabled.
        $senderSettings = \App\Services\FederationUserService::getUserSettings($userId);
        if (!($senderSettings['federation_optin'] ?? false) || !($senderSettings['messaging_enabled_federated'] ?? false)) {
            return $backToMember('message-not-enabled');
        }

        // Prevent self-messaging across the same identity.
        if ($receiverId === $userId && $receiverTenantId === $tenantId) {
            return $backToMember('message-failed');
        }

        $bodyClean = $body;

        try {
            // Receiver must exist, be opted in, and accept federated messages.
            $receiver = DB::selectOne("
                SELECT u.id, u.preferred_language, fus.federation_optin, fus.messaging_enabled_federated
                FROM users u
                JOIN federation_user_settings fus ON fus.user_id = u.id
                WHERE u.id = ? AND u.tenant_id = ? AND u.status = 'active'
            ", [$receiverId, $receiverTenantId]);

            if (!$receiver || empty($receiver->federation_optin) || empty($receiver->messaging_enabled_federated)) {
                return $backToMember('message-recipient-unavailable');
            }

            // Active partnership with messaging permission must exist.
            $partnership = \App\Services\FederationPartnershipService::getPartnership($tenantId, $receiverTenantId);
            if (!$partnership || ($partnership['status'] ?? null) !== 'active' || empty($partnership['messaging_enabled'])) {
                return $backToMember('message-recipient-unavailable');
            }

            $safeguardingDecision = app(\App\Services\SafeguardingInteractionPolicy::class)
                ->evaluateCrossTenantContact(
                    $userId,
                    $tenantId,
                    $receiverId,
                    $receiverTenantId,
                    'accessible_federated_message',
                );
            if (! $safeguardingDecision->isAllowed()) {
                return $backToMember($safeguardingDecision->isUnavailable()
                    ? 'message-safeguarding-unavailable'
                    : 'message-safeguarding-restricted');
            }

            // ── DUAL-INSERT: outbound (sender copy) + inbound (receiver copy) ──
            DB::insert("
                INSERT INTO federation_messages
                (sender_tenant_id, sender_user_id, receiver_tenant_id, receiver_user_id,
                 subject, body, direction, status, reference_message_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 'outbound', 'delivered', ?, NOW())
            ", [$tenantId, $userId, $receiverTenantId, $receiverId, $subject, $bodyClean, $referenceMessageId]);
            $outboundId = (int) DB::getPdo()->lastInsertId();

            DB::insert("
                INSERT INTO federation_messages
                (sender_tenant_id, sender_user_id, receiver_tenant_id, receiver_user_id,
                 subject, body, direction, status, reference_message_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 'inbound', 'unread', ?, NOW())
            ", [$tenantId, $userId, $receiverTenantId, $receiverId, $subject, $bodyClean, $referenceMessageId]);
            $inboundId = (int) DB::getPdo()->lastInsertId();

            // Audit (best-effort).
            try {
                \App\Services\FederationAuditService::log(
                    'cross_tenant_message', $tenantId, $receiverTenantId, $userId,
                    ['message_id' => $outboundId, 'receiver_id' => $receiverId],
                    \App\Services\FederationAuditService::LEVEL_INFO
                );
            } catch (\Throwable $e) {
                report($e);
            }

            // Recipient notification — rendered in the RECIPIENT's locale, never
            // the sender's. Wrapped in try/catch so a notification failure can
            // never undo the committed message rows.
            try {
                $senderRow = DB::selectOne(
                    "SELECT TRIM(CONCAT(COALESCE(first_name,''),' ',COALESCE(last_name,''))) AS sender_name FROM users WHERE id = ? AND tenant_id = ?",
                    [$userId, $tenantId]
                );
                $senderName = trim((string) ($senderRow->sender_name ?? '')) !== ''
                    ? (string) $senderRow->sender_name
                    : __('govuk_alpha.fed2.messages.someone');
                $senderTenant = DB::table('tenants')->where('id', $tenantId)->value('name') ?? '';

                \App\I18n\LocaleContext::withLocale($receiver, function () use ($receiverId, $receiverTenantId, $senderName, $senderTenant, $inboundId) {
                    $notifMessage = __('svc_notifications.federation.message_received', [
                        'sender' => $senderName,
                        'partner' => $senderTenant,
                    ]);
                    \App\Models\Notification::createNotification(
                        $receiverId, $notifMessage, '/federation/messages', 'federation_message', true, $receiverTenantId
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) $receiverId, 'federation_message', $notifMessage, '/federation/messages');
                    DB::update(
                        "UPDATE federation_messages SET notification_sent_at = NOW() WHERE id = ? AND receiver_tenant_id = ? AND notification_sent_at IS NULL",
                        [$inboundId, $receiverTenantId]
                    );
                });
            } catch (\Throwable $e) {
                report($e);
            }

            return $backToMember('message-sent');
        } catch (\Throwable $e) {
            report($e);
            return $backToMember('message-failed');
        }
    }

    /**
     * Hour-transfer CONFIRM form — `/federation/members/{id}/transfer` (GET).
     * Re-runs the same visibility + capability gate as the profile so the form
     * is only shown for a member who can actually receive a transfer. Shows the
     * viewer's current balance + a govuk-warning-text before confirming.
     */
    public function federationTransfer(Request $request, string $tenantSlug, int $id): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('federation'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }
        if ($redirect = $this->federationOptInRedirectIfRequired($userId, $tenantSlug)) {
            return $redirect;
        }

        $tenantId = TenantContext::getId();
        abort_unless($this->federationOperationAllowed('transactions', $tenantId), 404);

        $memberTenantId = (int) $request->query('tenant_id');
        $member = $this->resolveTransferableMember($userId, $tenantId, $id, $memberTenantId);
        abort_if($member === null, 404);

        // Viewer's federated transaction capability + balance.
        $viewerSettings = \App\Services\FederationUserService::getUserSettings($userId);
        $balance = (int) (DB::table('users')->where('id', $userId)->where('tenant_id', $tenantId)->value('balance') ?? 0);

        return $this->view('accessible-frontend::federation-transfer', [
            'title' => __('govuk_alpha.fed2.transfer.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'federationActiveTab' => 'members',
            'member' => $member,
            'balance' => $balance,
            'viewerEnabled' => (bool) ($viewerSettings['federation_optin'] ?? false) && (bool) ($viewerSettings['transactions_enabled_federated'] ?? false),
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /**
     * Resolve a federated member who is BOTH profile-visible AND can receive a
     * transfer (member opt-in for transactions + partnership transactions
     * permission). Returns null when not transferable. Always cross-tenant
     * (u.tenant_id != self) and partnership-scoped. Shared by the transfer
     * confirm form and the POST handler.
     *
     * @return array<string,mixed>|null
     */
    private function resolveTransferableMember(int $userId, int $tenantId, int $memberId, int $memberTenantId): ?array
    {
        if ($memberId <= 0) {
            return null;
        }

        try {
            $sql = "
                SELECT u.id, u.first_name, u.last_name, u.tenant_id, t.name as tenant_name,
                    u.preferred_language,
                    fus.transactions_enabled_federated,
                    fp.transactions_enabled as partner_transactions_enabled
                FROM users u
                JOIN federation_user_settings fus ON fus.user_id = u.id
                JOIN tenants t ON t.id = u.tenant_id
                JOIN federation_partnerships fp ON (
                    (fp.tenant_id = :tid1 AND fp.partner_tenant_id = u.tenant_id)
                    OR (fp.partner_tenant_id = :tid2 AND fp.tenant_id = u.tenant_id)
                )
                WHERE u.id = :user_id AND fp.status = 'active' AND fp.profiles_enabled = 1
                AND fus.federation_optin = 1 AND fus.profile_visible_federated = 1
                AND u.status = 'active' AND u.tenant_id != :tid_self
            ";
            $params = [':tid1' => $tenantId, ':tid2' => $tenantId, ':user_id' => $memberId, ':tid_self' => $tenantId];
            if ($memberTenantId > 0) {
                $sql .= " AND u.tenant_id = :member_tenant_id";
                $params[':member_tenant_id'] = $memberTenantId;
            }
            $sql .= " LIMIT 1";

            $rows = $this->federationSelect($sql, $params);
            $m = $rows[0] ?? null;
            if (!$m) {
                return null;
            }
            if (empty($m['transactions_enabled_federated']) || empty($m['partner_transactions_enabled'])) {
                return null;
            }

            return [
                'id' => (int) $m['id'],
                'name' => trim(((string) ($m['first_name'] ?? '')) . ' ' . ((string) ($m['last_name'] ?? ''))),
                'tenant_id' => (int) $m['tenant_id'],
                'tenant_name' => (string) ($m['tenant_name'] ?? ''),
                'preferred_language' => $m['preferred_language'] ?? null,
            ];
        } catch (\Throwable $e) {
            report($e);
            return null;
        }
    }

    /**
     * Send a federated hour TRANSFER — `/federation/members/{id}/transfer` (POST).
     *
     * Mirrors FederationV2Controller::sendTransaction() internal path EXACTLY:
     *   - conditional atomic debit (UPDATE ... WHERE balance >= amount) so the
     *     sender can never go negative and the debit is non-duplicable;
     *   - matching credit to the recipient in their owning tenant;
     *   - a single completed federated transactions row, all inside one DB
     *     transaction (rolled back on any failure → no half-moves);
     *   - recipient bell rendered in their preferred_language (LocaleContext),
     *     wrapped so a bell failure cannot undo the committed money move.
     *
     * The external ext-{N} SAGA is NOT exposed on this server-rendered surface
     * (no live partner in this context); only the local-partner path is offered.
     */
    public function storeFederationTransfer(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('federation'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }
        if ($redirect = $this->federationOptInRedirectIfRequired($userId, $tenantSlug)) {
            return $redirect;
        }

        $tenantId = TenantContext::getId();
        $memberTenantId = (int) $request->input('receiver_tenant_id');

        $backToTransfer = fn (string $status): RedirectResponse => redirect()->route(
            'govuk-alpha.federation.transfer',
            ['tenantSlug' => $tenantSlug, 'id' => $id, 'tenant_id' => $memberTenantId, 'status' => $status]
        );

        if (!$this->federationOperationAllowed('transactions', $tenantId)) {
            return redirect()->route('govuk-alpha.federation.members.index', ['tenantSlug' => $tenantSlug, 'status' => 'transfer-unavailable']);
        }

        // Viewer must be opted in AND have federated transactions enabled.
        $senderSettings = \App\Services\FederationUserService::getUserSettings($userId);
        if (!($senderSettings['federation_optin'] ?? false) || !($senderSettings['transactions_enabled_federated'] ?? false)) {
            return $backToTransfer('transfer-not-enabled');
        }

        // Amount: whole hours, 1..100 (matches API bounds).
        $amountRaw = $request->input('amount');
        if (!is_numeric($amountRaw)) {
            return $backToTransfer('transfer-amount-invalid');
        }
        $amount = (int) $amountRaw;
        if ($amount < 1 || $amount > 100) {
            return $backToTransfer('transfer-amount-invalid');
        }

        $description = trim(self::asStr($request->input('description')));
        if ($description === '') {
            return $backToTransfer('transfer-description-required');
        }
        if (mb_strlen($description) > 500) {
            return $backToTransfer('transfer-description-too-long');
        }
        // Re-resolve the recipient under the SAME gate as the form (do not trust
        // the posted member id — verify it is a real, transferable, cross-tenant
        // partner member right now).
        $member = $this->resolveTransferableMember($userId, $tenantId, $id, $memberTenantId);
        if ($member === null) {
            return $backToTransfer('transfer-recipient-unavailable');
        }
        $receiverId = $member['id'];
        $receiverTenantId = $member['tenant_id'];

        // Prevent self-transfer (defence-in-depth; the cross-tenant gate already
        // excludes the same tenant, but never assume).
        if ($receiverId === $userId && $receiverTenantId === $tenantId) {
            return $backToTransfer('transfer-self');
        }

        // Active partnership with transactions permission must exist.
        $partnership = \App\Services\FederationPartnershipService::getPartnership($tenantId, $receiverTenantId);
        if (!$partnership || ($partnership['status'] ?? null) !== 'active' || empty($partnership['transactions_enabled'])) {
            return $backToTransfer('transfer-recipient-unavailable');
        }

        $safeguardingDecision = app(\App\Services\SafeguardingInteractionPolicy::class)
            ->evaluateCrossTenantContact(
                $userId,
                $tenantId,
                $receiverId,
                $receiverTenantId,
                'accessible_federated_transaction',
            );
        if (! $safeguardingDecision->isAllowed()) {
            return $backToTransfer(
                $safeguardingDecision->isUnavailable()
                    ? 'transfer-safeguarding-unavailable'
                    : 'transfer-safeguarding-restricted'
            );
        }

        $explicitKey = trim(self::asStr($request->input('idempotency_key')));
        $hasExplicitKey = $explicitKey !== '';
        $fingerprint = $hasExplicitKey
            ? sha1('key:' . $explicitKey)
            : sha1('content:' . $receiverId . '|' . $receiverTenantId . '|' . $amount . '|' . $description);
        $idemCacheKey = "fedtx:idem:{$tenantId}:{$userId}:{$fingerprint}";
        $idemTtl = $hasExplicitKey ? 86400 : 120;

        try {
            $claimed = \Illuminate\Support\Facades\Cache::add($idemCacheKey, ['status' => 'pending'], $idemTtl);
        } catch (\Throwable $cacheEx) {
            $claimed = true;
            $idemCacheKey = null;
        }
        if (!$claimed) {
            $prior = null;
            try {
                $prior = \Illuminate\Support\Facades\Cache::get($idemCacheKey);
            } catch (\Throwable $cacheEx) {
                $prior = null;
            }
            if (is_array($prior) && isset($prior['transaction_id'])) {
                return redirect()->route('govuk-alpha.federation.members.show', [
                    'tenantSlug' => $tenantSlug,
                    'id' => $receiverId,
                    'tenant_id' => $receiverTenantId,
                    'status' => 'transfer-sent',
                ]);
            }

            return $backToTransfer('transfer-failed');
        }

        $txId = null;
        try {
            DB::beginTransaction();

            // Atomic conditional debit — only deducts when balance >= amount, so
            // the sender can never go negative and a concurrent double-submit
            // cannot double-debit (the second UPDATE sees the reduced balance).
            $deducted = DB::update(
                "UPDATE users SET balance = balance - ? WHERE id = ? AND tenant_id = ? AND balance >= ?",
                [$amount, $userId, $tenantId, $amount]
            );
            if ($deducted === 0) {
                DB::rollBack();
                if ($idemCacheKey !== null) {
                    try { \Illuminate\Support\Facades\Cache::forget($idemCacheKey); } catch (\Throwable $cacheEx) {}
                }
                return $backToTransfer('transfer-insufficient');
            }

            DB::update(
                "UPDATE users SET balance = balance + ? WHERE id = ? AND tenant_id = ?",
                [$amount, $receiverId, $receiverTenantId]
            );

            DB::insert(
                "INSERT INTO transactions (tenant_id, sender_id, receiver_id, amount, description, status, is_federated, sender_tenant_id, receiver_tenant_id, created_at)
                 VALUES (?, ?, ?, ?, ?, 'completed', 1, ?, ?, NOW())",
                [$tenantId, $userId, $receiverId, $amount, $description, $tenantId, $receiverTenantId]
            );
            $txId = (int) DB::getPdo()->lastInsertId();

            DB::commit();

            if ($idemCacheKey !== null) {
                try {
                    \Illuminate\Support\Facades\Cache::put(
                        $idemCacheKey,
                        ['transaction_id' => $txId, 'status' => 'completed', 'amount' => $amount],
                        $idemTtl
                    );
                } catch (\Throwable $cacheEx) {
                    // Best-effort only.
                }
            }
        } catch (\Throwable $e) {
            DB::rollBack();
            if ($idemCacheKey !== null) {
                try { \Illuminate\Support\Facades\Cache::forget($idemCacheKey); } catch (\Throwable $cacheEx) {}
            }
            report($e);
            return $backToTransfer('transfer-failed');
        }

        // Audit (best-effort, post-commit).
        try {
            \App\Services\FederationAuditService::log(
                'federation_transaction', $tenantId, $receiverTenantId, $userId,
                ['transaction_id' => $txId, 'amount' => $amount, 'receiver_id' => $receiverId]
            );
        } catch (\Throwable $e) {
            report($e);
        }

        // Recipient bell — rendered in the recipient's preferred_language, and
        // wrapped so a bell failure can never undo the committed transfer.
        try {
            $senderRow = DB::selectOne(
                "SELECT TRIM(CONCAT(COALESCE(u.first_name,''),' ',COALESCE(u.last_name,''))) AS sender_name, t.name AS sender_tenant_name
                 FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = ? AND u.tenant_id = ?",
                [$userId, $tenantId]
            );
            $senderName = trim((string) ($senderRow->sender_name ?? '')) !== ''
                ? (string) $senderRow->sender_name
                : __('govuk_alpha.fed2.messages.someone');
            $sourceCommunity = (string) ($senderRow->sender_tenant_name ?? '');

            $recipientLocale = (object) ['preferred_language' => $member['preferred_language'] ?? null];
            \App\I18n\LocaleContext::withLocale($recipientLocale, function () use ($receiverId, $receiverTenantId, $amount, $senderName, $sourceCommunity) {
                $notifMessage = __('svc_notifications.federation.transaction_received', [
                    'amount' => (string) $amount,
                    'sender' => $senderName,
                    'partner' => $sourceCommunity,
                ]);
                \App\Models\Notification::createNotification(
                    $receiverId, $notifMessage, '/wallet', 'federation_transaction', false, $receiverTenantId
                );
                \App\Services\NotificationDispatcher::fanOutPush((int) $receiverId, 'federation_transaction', $notifMessage, '/wallet');
            });
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.federation.members.show', [
            'tenantSlug' => $tenantSlug,
            'id' => $receiverId,
            'tenant_id' => $receiverTenantId,
            'status' => 'transfer-sent',
        ]);
    }

    // ===== WAVE T1-FEED: feed engagement =====

    /**
     * The small, fixed set of reactions the accessible feed exposes as plain
     * submit-buttons. These are a curated subset of ReactionService::VALID_TYPES
     * (the full picker is React-only). Mapping reaction-type to emoji glyph mirrors
     * the React REACTION_CONFIGS so both frontends agree on what each type means.
     *
     * @var array<string, string>
     */
    private const ALPHA_FEED_REACTIONS = [
        'like'      => "\u{1F44D}", // thumbs up
        'love'      => "\u{2764}\u{FE0F}", // heart
        'celebrate' => "\u{1F389}", // party popper
    ];

    /**
     * Toggle an emoji reaction on a feed post via the shared ReactionService.
     *
     * Mirrors ReactionController::togglePostReaction: the reaction type is
     * validated against the backend allowed set, the target is tenant-scoped and
     * visibility-checked, and the member can only react as themselves.
     */
    public function storeFeedPostReaction(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        return $this->toggleAlphaReaction($request, $tenantSlug, 'post', $id);
    }

    /**
     * Toggle an emoji reaction on a comment via the shared ReactionService.
     * Mirrors ReactionController::toggleCommentReaction.
     */
    public function storeFeedCommentReaction(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        return $this->toggleAlphaReaction($request, $tenantSlug, 'comment', $id);
    }

    /**
     * Shared reaction-toggle path for posts and comments. Only the reaction types
     * the accessible frontend renders are accepted; anything else is rejected
     * before touching the service so a tampered form cannot smuggle an arbitrary
     * (still backend-valid) emoji through.
     */
    private function toggleAlphaReaction(Request $request, string $tenantSlug, string $targetType, int $targetId): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('feed'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return $this->redirectToFeed($request, $tenantSlug, 'auth-required', $targetType, $targetId);
        }

        $emoji = self::asStr($request->input('emoji'));
        // Accept only the curated accessible set, which is itself a subset of
        // ReactionService::VALID_TYPES. Fail closed on anything else.
        if (!array_key_exists($emoji, self::ALPHA_FEED_REACTIONS)
            || !in_array($emoji, \App\Services\ReactionService::VALID_TYPES, true)) {
            return $this->redirectToFeed($request, $tenantSlug, 'reaction-failed', $targetType, $targetId);
        }

        if ($targetId <= 0 || !FeedItemTables::canView($targetType, $targetId, $userId)) {
            return $this->redirectToFeed($request, $tenantSlug, 'reaction-failed', $targetType, $targetId);
        }

        $status = 'reaction-failed';
        try {
            $result = app(\App\Services\ReactionService::class)->toggleReaction($targetId, $targetType, $emoji, $userId);
            $status = ($result['action'] ?? '') === 'removed' ? 'reaction-removed' : 'reaction-added';

            // Best-effort author notification, matching the like path. Reacting to
            // your own content never notifies.
            if ($status === 'reaction-added') {
                try {
                    $ownerId = SocialNotificationService::getContentOwnerId($targetType, $targetId);
                    if ($ownerId && $ownerId !== $userId) {
                        SocialNotificationService::notifyLike($ownerId, $userId, $targetType, $targetId, $emoji);
                    }
                } catch (\Throwable $e) {
                    Log::warning('Alpha reaction notification failed: ' . $e->getMessage());
                }
            }
        } catch (\Throwable $e) {
            report($e);
        }

        // Comment reactions live inside a post's comment thread; bounce back to the
        // anchor for the comment (or post) on the feed.
        $anchorType = $targetType === 'comment' ? 'comment' : 'post';

        return $this->redirectToFeed($request, $tenantSlug, $status, $anchorType, $targetId);
    }

    /**
     * Toggle a "share to my feed" repost of a feed post via ShareService.
     * Mirrors FeedSocialController::sharePost / unsharePost (toggle semantics).
     * The service blocks self-shares (DomainException) and unviewable posts.
     */
    public function storeFeedPostShare(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('feed'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return $this->redirectToFeed($request, $tenantSlug, 'auth-required', 'post', $id);
        }

        if ($id <= 0 || !FeedItemTables::canView('post', $id, $userId)) {
            return $this->redirectToFeed($request, $tenantSlug, 'share-failed', 'post', $id);
        }

        $status = 'share-failed';
        try {
            $result = app(\App\Services\ShareService::class)->toggle($userId, 'post', $id);
            $status = !empty($result['shared']) ? 'share-added' : 'share-removed';
        } catch (\DomainException $e) {
            // Self-share is not allowed; surface a distinct message.
            $status = 'share-own';
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->redirectToFeed($request, $tenantSlug, $status, 'post', $id);
    }

    /**
     * Toggle a bookmark (save) on a feed post via BookmarkService so the existing
     * feed "Saved" filter and the /saved page surface it. Bookmarks are stored
     * against the polymorphic ('post', id) target and are owner-scoped to the
     * member by the service.
     */
    public function storeFeedPostSave(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('feed'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return $this->redirectToFeed($request, $tenantSlug, 'auth-required', 'post', $id);
        }

        if ($id <= 0 || !FeedItemTables::canView('post', $id, $userId)) {
            return $this->redirectToFeed($request, $tenantSlug, 'save-failed', 'post', $id);
        }

        $status = 'save-failed';
        try {
            $result = app(\App\Services\BookmarkService::class)->toggle($userId, 'post', $id);
            $status = !empty($result['bookmarked']) ? 'save-added' : 'save-removed';
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->redirectToFeed($request, $tenantSlug, $status, 'post', $id);
    }

    /**
     * Single-post permalink page. Gives notification/email deep-links to a post a
     * real, server-rendered target with the full comment thread. Tenant-scoped:
     * 404s when the post is missing or not visible to the viewer.
     */
    public function feedPost(Request $request, string $tenantSlug, int $id): Response
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('feed'), 403);
        $userId = $this->currentUserId();

        // Visibility gate before the feed query; invisible/cross-tenant posts 404.
        abort_unless($id > 0 && FeedItemTables::canView('post', $id, $userId), 404);

        $item = null;
        try {
            $result = $this->feedService->getFeed($userId, ['post_id' => $id, 'limit' => 1]);
            $rows = $this->attachPostMedia($result['items'] ?? []);
            $item = $rows[0] ?? null;
        } catch (\Throwable $e) {
            report($e);
        }

        abort_if($item === null, 404);

        $comments = [];
        if ($userId !== null) {
            try {
                $comments = CommentService::getForEntity('post', $id, $userId);
            } catch (\Throwable $e) {
                report($e);
            }
        }

        $reactionsByTarget = $this->reactionsForFeedItems([$item], $userId);

        return $this->view('accessible-frontend::feed-post', [
            'title' => __('govuk_alpha.feed_t1.permalink_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'feed',
            'item' => $item,
            'comments' => $comments,
            'postReactions' => $reactionsByTarget['post'][(int) ($item['id'] ?? $id)] ?? null,
            'alphaReactions' => self::ALPHA_FEED_REACTIONS,
            'requiresAuth' => $userId === null,
            'currentUserId' => $userId,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /**
     * Batch-fetch reaction summaries for a set of feed items, keyed [type][id].
     * Comments already carry their reactions from CommentService::getForEntity;
     * this covers the top-level post/typed cards.
     *
     * @param array<int, array<string, mixed>> $items
     * @return array<string, array<int, array{counts: array<string,int>, total: int, user_reaction: string|null}>>
     */
    private function reactionsForFeedItems(array $items, ?int $userId): array
    {
        $lookup = [];
        foreach ($items as $item) {
            $type = $this->normalizeFeedTargetType((string) ($item['type'] ?? 'post'));
            $id = (int) ($item['id'] ?? 0);
            if ($id > 0 && in_array($type, \App\Services\ReactionService::VALID_TARGET_TYPES, true)) {
                $lookup[] = ['type' => $type, 'id' => $id];
            }
        }
        if ($lookup === []) {
            return [];
        }

        try {
            $byKey = app(\App\Services\ReactionService::class)->getReactionsForItems($lookup, $userId);
        } catch (\Throwable $e) {
            report($e);
            return [];
        }

        $byTarget = [];
        foreach ($byKey as $key => $data) {
            [$type, $id] = array_pad(explode(':', $key, 2), 2, null);
            if ($type !== null && $id !== null) {
                $byTarget[$type][(int) $id] = $data;
            }
        }

        return $byTarget;
    }

    // ===== WAVE T1-WALLET: donate + fund + tx depth =====

    /**
     * Allowed transaction filter tabs for the accessible wallet history.
     * Anything outside this whitelist collapses to 'all'.
     */
    private const WALLET_TX_FILTERS = ['all', 'earned', 'spent', 'pending'];

    /** Sanitise the wallet transaction filter GET param to a known tab. */
    private static function walletFilterParam(string $value): string
    {
        $value = strtolower(trim($value));

        return in_array($value, self::WALLET_TX_FILTERS, true) ? $value : 'all';
    }

    /**
     * Load one page of the caller's OWN transactions for the accessible wallet,
     * filtered by tab (all / earned / spent / pending) with offset pagination.
     *
     * Every row is tenant-scoped (transactions.tenant_id) AND constrained to the
     * caller as sender or receiver — a user can never page into another member's
     * history. Soft-delete flags (deleted_for_sender / deleted_for_receiver) are
     * honoured so hidden rows stay hidden, mirroring WalletService::getTransactions.
     *
     * @return array{items: array<int, array<string, mixed>>, has_more: bool, page: int, filter: string}
     */
    private function walletTransactionsPage(int $userId, string $filter, int $page, int $perPage): array
    {
        $tenantId = TenantContext::getId();
        $perPage = max(1, min($perPage, 100));
        $page = max(1, $page);
        $offset = ($page - 1) * $perPage;

        $query = DB::table('transactions as t')
            ->leftJoin('users as s', 's.id', '=', 't.sender_id')
            ->leftJoin('users as r', 'r.id', '=', 't.receiver_id')
            ->where('t.tenant_id', $tenantId);

        // Constrain to the caller's own rows (as sender or receiver), respecting
        // the per-side soft-delete flags. This is the IDOR guard.
        switch ($filter) {
            case 'earned':
                // Credits IN to the caller: they are the receiver, completed only.
                $query->where('t.receiver_id', $userId)
                    ->where('t.deleted_for_receiver', 0)
                    ->where('t.status', 'completed');
                break;
            case 'spent':
                // Credits OUT from the caller: they are the sender, completed only.
                $query->where('t.sender_id', $userId)
                    ->where('t.deleted_for_sender', 0)
                    ->where('t.status', 'completed');
                break;
            case 'pending':
                $query->where('t.status', 'pending')
                    ->where(function ($q) use ($userId) {
                        $q->where(function ($q2) use ($userId) {
                            $q2->where('t.sender_id', $userId)->where('t.deleted_for_sender', 0);
                        })->orWhere(function ($q2) use ($userId) {
                            $q2->where('t.receiver_id', $userId)->where('t.deleted_for_receiver', 0);
                        });
                    });
                break;
            case 'all':
            default:
                $query->where('t.status', 'completed')
                    ->where(function ($q) use ($userId) {
                        $q->where(function ($q2) use ($userId) {
                            $q2->where('t.sender_id', $userId)->where('t.deleted_for_sender', 0);
                        })->orWhere(function ($q2) use ($userId) {
                            $q2->where('t.receiver_id', $userId)->where('t.deleted_for_receiver', 0);
                        });
                    });
                break;
        }

        // Fetch one extra row to detect whether a further page exists.
        $rows = $query
            ->orderByDesc('t.id')
            ->offset($offset)
            ->limit($perPage + 1)
            ->get([
                't.id',
                't.sender_id',
                't.receiver_id',
                't.amount',
                't.description',
                't.transaction_type',
                't.status',
                't.created_at',
                DB::raw("CASE WHEN s.profile_type = 'organisation' AND s.organization_name IS NOT NULL AND s.organization_name != '' THEN s.organization_name ELSE TRIM(CONCAT(COALESCE(s.first_name, ''), ' ', COALESCE(s.last_name, ''))) END as sender_name"),
                DB::raw("CASE WHEN r.profile_type = 'organisation' AND r.organization_name IS NOT NULL AND r.organization_name != '' THEN r.organization_name ELSE TRIM(CONCAT(COALESCE(r.first_name, ''), ' ', COALESCE(r.last_name, ''))) END as receiver_name"),
            ]);

        $hasMore = $rows->count() > $perPage;
        if ($hasMore) {
            $rows = $rows->take($perPage);
        }

        $fundLabel = __('govuk_alpha.wallet.community_fund_label');

        $items = $rows->map(function ($row) use ($userId, $fundLabel): array {
            // A community-fund grant has sender_id = NULL; the caller is the receiver.
            $isCredit = ((int) $row->receiver_id === $userId);
            $otherName = $isCredit
                ? trim((string) ($row->sender_name ?? ''))
                : trim((string) ($row->receiver_name ?? ''));

            // System rows (fund grant / donation to fund) have no counterparty user.
            if ($otherName === '') {
                $otherName = $fundLabel;
            }

            return [
                'id' => (int) $row->id,
                'type' => $isCredit ? 'credit' : 'debit',
                'status' => $row->status ?? 'completed',
                'amount' => (float) $row->amount,
                'description' => (string) ($row->description ?? ''),
                'transaction_type' => (string) ($row->transaction_type ?? 'transfer'),
                'other_user' => ['name' => $otherName],
                'created_at' => $row->created_at,
            ];
        })->all();

        return ['items' => $items, 'has_more' => $hasMore, 'page' => $page, 'filter' => $filter];
    }

    /**
     * Donate the caller's OWN time credits to the community fund (and, when the
     * backend supports it, to another member). This mirrors the
     * WalletFeaturesController::donate / communityFundDonate contract EXACTLY —
     * it never hand-rolls the money math, it calls the same CreditDonationService
     * the API calls, which deducts atomically with a balance>=amount guard.
     *
     * The donor is ALWAYS the authenticated caller; a posted user id can only ever
     * be the RECIPIENT, never the debited account.
     */
    public function donateCredits(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('wallet'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $fail = fn (string $error): RedirectResponse => redirect()->route('govuk-alpha.wallet.index', [
            'tenantSlug' => $tenantSlug, 'status' => 'donate-failed', 'donate_error' => $error,
        ])->withFragment('donate');

        $amount = (float) $request->input('amount');
        $message = trim(self::asStr($request->input('message')));
        $target = self::asStr($request->input('target')) ?: 'community_fund';

        // Positive, whole-hour, sane-maximum amount. Donations move credits one way
        // and cannot be undone, so reject anything outside a tight band.
        if ($amount <= 0) {
            return $fail('invalid');
        }
        if (round($amount) != $amount) {
            return $fail('decimals');
        }
        if ($amount > 1000) {
            return $fail('too-large');
        }

        $donationService = app(\App\Services\CreditDonationService::class);

        if ($target === 'user') {
            $recipientId = (int) $request->input('recipient_id');
            if ($recipientId <= 0) {
                return $fail('invalid');
            }
            if ($recipientId === $userId) {
                return $fail('self');
            }
            // Defensive tenant check: only ever donate to a member of THIS tenant.
            $sameTenant = DB::table('users')
                ->where('id', $recipientId)
                ->where('tenant_id', TenantContext::getId())
                ->exists();
            if (!$sameTenant) {
                return $fail('not-found');
            }

            try {
                $result = $donationService->donateToMember(
                    $userId,
                    $recipientId,
                    $amount,
                    mb_substr($message, 0, 255)
                );
            } catch (\App\Exceptions\SafeguardingPolicyException $e) {
                return $fail($e->reasonCode === 'SAFEGUARDING_POLICY_UNAVAILABLE'
                    ? 'safeguarding-unavailable'
                    : 'safeguarding');
            }
        } else {
            $result = $donationService->donateToCommunityFund(
                $userId,
                $amount,
                mb_substr($message, 0, 255)
            );
        }

        if (empty($result['success'])) {
            $error = (string) ($result['error'] ?? '');
            return $fail(match (true) {
                stripos($error, 'insufficient') !== false => 'insufficient',
                stripos($error, 'not found') !== false || stripos($error, 'recipient') !== false => 'not-found',
                default => 'failed',
            });
        }

        return redirect()->route('govuk-alpha.wallet.index', [
            'tenantSlug' => $tenantSlug, 'status' => 'donate-sent',
        ])->withFragment('transactions');
    }

    /**
     * Stream the caller's OWN transaction history as a CSV download.
     *
     * Delegates to the canonical TransactionExportService, which builds a
     * tenant + user-scoped statement (WHERE tenant_id = ? AND (sender = ? OR
     * receiver = ?)) with CSV-injection escaping. There is no IDOR surface: the
     * user id is taken from the authenticated session, never from the request.
     */
    public function exportTransactions(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('wallet'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $result = app(\App\Services\TransactionExportService::class)
            ->exportPersonalStatementCSV($userId, []);

        if (empty($result['success']) || !isset($result['csv'])) {
            return redirect()->route('govuk-alpha.wallet.index', [
                'tenantSlug' => $tenantSlug, 'status' => 'export-failed',
            ]);
        }

        $filename = (string) ($result['filename'] ?? ('wallet_statement_' . date('Ymd_His') . '.csv'));

        return response((string) $result['csv'], 200, [
            'Content-Type' => 'text/csv; charset=utf-8',
            'Content-Disposition' => 'attachment; filename="' . $filename . '"',
            'Cache-Control' => 'no-cache, no-store, must-revalidate',
            'Pragma' => 'no-cache',
        ]);
    }

    // ===== WAVE JOBS-T2: jobs depth (browse filters, saved, my applications) =====

    /**
     * Validate + normalise the jobs browse filters from the query string. Unknown
     * values fall back to the neutral default so a hand-typed URL can never push an
     * arbitrary value into the service query.
     *
     * @return array{q: string, type: string, commitment: string, sort: string, remote: bool}
     */
    private function jobsFilters(Request $request): array
    {
        return [
            'q' => trim(self::asStr($request->query('q'))),
            'type' => self::asStr($this->allowed(self::asStr($request->query('type')), ['paid', 'volunteer', 'timebank'], '')),
            'commitment' => self::asStr($this->allowed(self::asStr($request->query('commitment')), ['full_time', 'part_time', 'flexible', 'one_off'], '')),
            'sort' => self::asStr($this->allowed(self::asStr($request->query('sort')), ['newest', 'deadline', 'salary_desc'], 'newest')),
            'remote' => $request->query('remote') === '1',
        ];
    }

    /**
     * Saved (bookmarked) opportunities for the current member — the accessible
     * equivalent of the React Jobs "Saved" tab. Cursor-paginated via the service.
     */
    public function savedJobs(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('job_vacancies'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $cursor = self::asStr($request->query('cursor')) ?: null;
        $items = [];
        $meta = ['has_more' => false, 'cursor' => null];
        try {
            $result = app(\App\Services\JobVacancyService::class)->getSavedJobs($userId, ['limit' => 12, 'cursor' => $cursor]);
            $items = is_array($result['items'] ?? null) ? $result['items'] : [];
            $meta['has_more'] = (bool) ($result['has_more'] ?? false);
            $meta['cursor'] = $result['cursor'] ?? null;
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::jobs-saved', [
            'title' => __('govuk_alpha.jobs_t2.saved_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'jobs' => $items,
            'jobsMeta' => $meta,
            'jobsActiveTab' => 'saved',
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /**
     * The current member's own job applications, with the vacancy summary and the
     * application status — the accessible equivalent of React's MyApplicationsPage.
     */
    public function myJobApplications(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('job_vacancies'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $statusFilter = self::asStr($this->allowed(
            self::asStr($request->query('status_filter')),
            ['applied', 'pending', 'screening', 'reviewed', 'interview', 'offer', 'accepted', 'rejected', 'withdrawn'],
            ''
        ));
        $cursor = self::asStr($request->query('cursor')) ?: null;

        $items = [];
        $meta = ['has_more' => false, 'cursor' => null];
        try {
            $params = ['limit' => 12, 'cursor' => $cursor];
            if ($statusFilter !== '') {
                $params['status'] = $statusFilter;
            }
            $result = app(\App\Services\JobVacancyService::class)->getMyApplications($userId, $params);
            $items = is_array($result['items'] ?? null) ? $result['items'] : [];
            $meta['has_more'] = (bool) ($result['has_more'] ?? false);
            $meta['cursor'] = $result['cursor'] ?? null;
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::jobs-applications', [
            'title' => __('govuk_alpha.jobs_t2.applications_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'applications' => $items,
            'jobsMeta' => $meta,
            'jobsActiveTab' => 'applications',
            'statusFilter' => $statusFilter,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /** Bookmark an opportunity. Idempotent; returns the member to where they were. */
    public function saveJobBookmark(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('job_vacancies'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $ok = false;
        try {
            $ok = app(\App\Services\JobVacancyService::class)->saveJob($id, $userId);
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->jobsBookmarkRedirect($tenantSlug, $id, self::asStr($request->input('from')), $ok ? 'saved' : 'save-failed');
    }

    /** Remove a bookmark. Returns the member to where they were (detail or saved list). */
    public function unsaveJobBookmark(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('job_vacancies'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        try {
            app(\App\Services\JobVacancyService::class)->unsaveJob($id, $userId);
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->jobsBookmarkRedirect($tenantSlug, $id, self::asStr($request->input('from')), 'unsaved');
    }

    /**
     * Route a save/unsave back to its origin. 'saved' returns to the saved list;
     * anything else (the default) returns to the opportunity detail page. The
     * origin is a fixed whitelist, never a raw redirect target.
     */
    private function jobsBookmarkRedirect(string $tenantSlug, int $id, string $from, string $status): RedirectResponse
    {
        if ($from === 'saved') {
            return redirect()->route('govuk-alpha.jobs.saved', ['tenantSlug' => $tenantSlug, 'status' => $status]);
        }

        return redirect()->route('govuk-alpha.jobs.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => $status]);
    }

    /**
     * Withdraw the member's own application. The service only permits a self-
     * withdraw when the caller owns the application (status 'withdrawn' + matching
     * user id), so passing the web-session user id as the actor is safe.
     */
    public function withdrawJobApplication(Request $request, string $tenantSlug, int $appId): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('job_vacancies'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $ok = false;
        try {
            $ok = app(\App\Services\JobVacancyService::class)->updateApplicationStatus($appId, $userId, 'withdrawn');
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.jobs.applications', [
            'tenantSlug' => $tenantSlug,
            'status' => $ok ? 'withdrawn' : 'withdraw-failed',
        ]);
    }

    // ===== WAVE JOBS-T3: employer suite (postings, create/edit/delete/renew, pipeline) =====

    /**
     * Collect the create/edit form fields from the request, normalising the
     * constrained ones to a whitelist. The service does the heavy validation
     * (salary transparency, type-enabled, spam) and reports its own errors.
     *
     * @return array<string, mixed>
     */
    private function jobFormInput(Request $request): array
    {
        return [
            'title' => trim(self::asStr($request->input('title'))),
            'description' => trim(self::asStr($request->input('description'))),
            'type' => self::asStr($this->allowed(self::asStr($request->input('type')), ['paid', 'volunteer', 'timebank'], 'volunteer')),
            'commitment' => self::asStr($this->allowed(self::asStr($request->input('commitment')), ['full_time', 'part_time', 'flexible', 'one_off'], 'flexible')),
            'category' => trim(self::asStr($request->input('category'))),
            'location' => trim(self::asStr($request->input('location'))),
            'is_remote' => $request->input('is_remote') === '1',
            'skills_required' => trim(self::asStr($request->input('skills_required'))),
            'hours_per_week' => trim(self::asStr($request->input('hours_per_week'))),
            'time_credits' => trim(self::asStr($request->input('time_credits'))),
            'deadline' => trim(self::asStr($request->input('deadline'))),
            'salary_min' => trim(self::asStr($request->input('salary_min'))),
            'salary_max' => trim(self::asStr($request->input('salary_max'))),
            'salary_currency' => trim(self::asStr($request->input('salary_currency'))),
            'salary_type' => self::asStr($this->allowed(self::asStr($request->input('salary_type')), ['hourly', 'monthly', 'annual'], '')),
            'salary_negotiable' => $request->input('salary_negotiable') === '1',
            'contact_email' => trim(self::asStr($request->input('contact_email'))),
            'status' => self::asStr($this->allowed(self::asStr($request->input('status')), ['open', 'draft'], 'open')),
        ];
    }

    /** Shared view payload for the create/edit form (mode drives the action + copy). */
    private function jobFormViewData(string $tenantSlug, string $mode, array $job, string $formAction): array
    {
        return [
            'title' => $mode === 'edit' ? __('govuk_alpha.jobs_t3.edit_title') : __('govuk_alpha.jobs_t3.create_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'jobsActiveTab' => 'create',
            'formMode' => $mode,
            'formAction' => $formAction,
            'jobForm' => $job,
            'jobFormErrors' => session('jobFormErrors', []),
        ];
    }

    /** The current member's own opportunities, with manage/edit links. */
    public function myJobPostings(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('job_vacancies'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $cursor = self::asStr($request->query('cursor')) ?: null;
        $items = [];
        $meta = ['has_more' => false, 'cursor' => null];
        try {
            $result = app(\App\Services\JobVacancyService::class)->getMyPostings($userId, TenantContext::getId(), ['limit' => 12, 'cursor' => $cursor]);
            $items = is_array($result['items'] ?? null) ? $result['items'] : [];
            $meta['has_more'] = (bool) ($result['has_more'] ?? false);
            $meta['cursor'] = $result['cursor'] ?? null;
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::jobs-postings', [
            'title' => __('govuk_alpha.jobs_t3.mine_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'jobsActiveTab' => 'mine',
            'jobs' => $items,
            'jobsMeta' => $meta,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /** Show the post-an-opportunity form. */
    public function createJobForm(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('job_vacancies'), 403);
        if ($this->currentUserId() === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        return $this->view('accessible-frontend::jobs-form', $this->jobFormViewData(
            $tenantSlug,
            'create',
            [],
            route('govuk-alpha.jobs.store', ['tenantSlug' => $tenantSlug]),
        ));
    }

    /** Create a new opportunity. */
    public function storeJob(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('job_vacancies'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $data = $this->jobFormInput($request);
        if ($data['title'] === '') {
            return redirect()->route('govuk-alpha.jobs.create', ['tenantSlug' => $tenantSlug])
                ->withInput()->with('jobFormErrors', [__('govuk_alpha.jobs_t3.error_title_required')]);
        }

        $svc = app(\App\Services\JobVacancyService::class);
        $newId = 0;
        try {
            $newId = $svc->create($userId, $data);
        } catch (\Throwable $e) {
            report($e);
        }

        if ($newId > 0) {
            return redirect()->route('govuk-alpha.jobs.show', ['tenantSlug' => $tenantSlug, 'id' => $newId, 'status' => 'created']);
        }

        return redirect()->route('govuk-alpha.jobs.create', ['tenantSlug' => $tenantSlug])
            ->withInput()->with('jobFormErrors', $this->jobServiceErrors($svc));
    }

    /** Show the edit form for one of the member's own opportunities. */
    public function editJobForm(Request $request, string $tenantSlug, int $id): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('job_vacancies'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $job = $this->ownedJobOr404($id, $userId);

        return $this->view('accessible-frontend::jobs-form', $this->jobFormViewData(
            $tenantSlug,
            'edit',
            $job,
            route('govuk-alpha.jobs.update', ['tenantSlug' => $tenantSlug, 'id' => $id]),
        ));
    }

    /** Persist edits to one of the member's own opportunities. */
    public function updateJob(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('job_vacancies'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $this->ownedJobOr404($id, $userId);

        $data = $this->jobFormInput($request);
        if ($data['title'] === '') {
            return redirect()->route('govuk-alpha.jobs.edit', ['tenantSlug' => $tenantSlug, 'id' => $id])
                ->withInput()->with('jobFormErrors', [__('govuk_alpha.jobs_t3.error_title_required')]);
        }

        $svc = app(\App\Services\JobVacancyService::class);
        $ok = false;
        try {
            $ok = $svc->update($id, $userId, $data);
        } catch (\Throwable $e) {
            report($e);
        }

        if ($ok) {
            return redirect()->route('govuk-alpha.jobs.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'updated']);
        }

        return redirect()->route('govuk-alpha.jobs.edit', ['tenantSlug' => $tenantSlug, 'id' => $id])
            ->withInput()->with('jobFormErrors', $this->jobServiceErrors($svc));
    }

    /** Delete one of the member's own opportunities. */
    public function deleteJob(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('job_vacancies'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $this->ownedJobOr404($id, $userId);

        $ok = false;
        try {
            $ok = app(\App\Services\JobVacancyService::class)->delete($id, $userId);
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.jobs.mine', ['tenantSlug' => $tenantSlug, 'status' => $ok ? 'deleted' : 'delete-failed']);
    }

    /** Renew (extend the deadline of) one of the member's own opportunities. */
    public function renewJobPosting(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('job_vacancies'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $this->ownedJobOr404($id, $userId);

        $ok = false;
        try {
            $ok = app(\App\Services\JobVacancyService::class)->renewJob($id, $userId, 30);
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.jobs.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => $ok ? 'renewed' : 'renew-failed']);
    }

    /** Owner pipeline: the applications to one of the member's own opportunities + analytics. */
    public function jobApplicants(Request $request, string $tenantSlug, int $id): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('job_vacancies'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $svc = app(\App\Services\JobVacancyService::class);
        $job = null;
        try {
            $job = $svc->legacyGetById($id, $userId);
        } catch (\Throwable $e) {
            report($e);
        }
        abort_if($job === null, 404);

        // getApplications enforces owner/admin/hiring-team management rights; a null
        // return on an existing job means the viewer may not manage it.
        $applications = null;
        try {
            $applications = $svc->getApplications($id, $userId);
        } catch (\Throwable $e) {
            report($e);
        }
        abort_if($applications === null, 403);

        $analytics = null;
        try {
            $analytics = $svc->getAnalytics($id, $userId);
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::jobs-applicants', [
            'title' => __('govuk_alpha.jobs_t3.applicants_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'jobsActiveTab' => 'mine',
            'job' => $job,
            'applications' => is_array($applications) ? $applications : [],
            'analytics' => is_array($analytics) ? $analytics : null,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /** Move an applicant to a new stage in the owner pipeline. */
    public function setApplicationStatus(Request $request, string $tenantSlug, int $id, int $appId): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('job_vacancies'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $newStatus = self::asStr($this->allowed(
            self::asStr($request->input('app_status')),
            ['applied', 'pending', 'screening', 'reviewed', 'shortlisted', 'interview', 'offer', 'accepted', 'rejected'],
            ''
        ));
        if ($newStatus === '') {
            return redirect()->route('govuk-alpha.jobs.applicants', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'status-failed']);
        }

        $notes = trim(self::asStr($request->input('notes')));
        $ok = false;
        try {
            $ok = app(\App\Services\JobVacancyService::class)->updateApplicationStatus($appId, $userId, $newStatus, $notes !== '' ? mb_substr($notes, 0, 2000) : null);
        } catch (\App\Exceptions\SafeguardingPolicyException $e) {
            $safeguardingStatus = $e->reasonCode === 'SAFEGUARDING_POLICY_UNAVAILABLE'
                ? 'status-safeguarding-unavailable'
                : 'status-safeguarding-restricted';
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.jobs.applicants', [
            'tenantSlug' => $tenantSlug,
            'id' => $id,
            'status' => $ok ? 'status-updated' : ($safeguardingStatus ?? 'status-failed'),
        ]);
    }

    /** Download the applications for one of the member's own opportunities as CSV. */
    public function exportJobApplications(Request $request, string $tenantSlug, int $id): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('job_vacancies'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $csv = null;
        try {
            $csv = app(\App\Services\JobVacancyService::class)->exportApplicationsCsv($id, $userId);
        } catch (\Throwable $e) {
            report($e);
        }

        if ($csv === null) {
            return redirect()->route('govuk-alpha.jobs.applicants', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'export-failed']);
        }

        $filename = 'job_' . $id . '_applications_' . date('Ymd_His') . '.csv';

        return response($csv, 200, [
            'Content-Type' => 'text/csv; charset=utf-8',
            'Content-Disposition' => 'attachment; filename="' . $filename . '"',
            'Cache-Control' => 'no-cache, no-store, must-revalidate',
            'Pragma' => 'no-cache',
        ]);
    }

    /**
     * Fetch a vacancy the member owns, or abort: 404 when it does not exist in the
     * current tenant (HasTenantScope makes a cross-tenant id invisible), 403 when
     * it exists but belongs to someone else.
     *
     * @return array<string, mixed>
     */
    private function ownedJobOr404(int $id, int $userId): array
    {
        $job = null;
        try {
            $job = app(\App\Services\JobVacancyService::class)->legacyGetById($id, $userId);
        } catch (\Throwable $e) {
            report($e);
        }
        abort_if($job === null, 404);
        abort_unless((int) ($job['user_id'] ?? 0) === $userId, 403);

        return $job;
    }

    /**
     * Flatten the service's error bag to a list of human messages for the form
     * error summary, with a generic fallback when the bag is empty.
     *
     * @return list<string>
     */
    private function jobServiceErrors(\App\Services\JobVacancyService $svc): array
    {
        $messages = [];
        foreach ($svc->getErrors() as $err) {
            $msg = is_array($err) ? ($err['message'] ?? '') : (string) $err;
            if ($msg !== '') {
                $messages[] = $msg;
            }
        }

        return $messages !== [] ? $messages : [__('govuk_alpha.jobs_t3.error_generic')];
    }

    // ===== WAVE JOBS-T4: job alerts =====

    /** List the member's job alerts and the form to create a new one. */
    public function jobAlerts(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('job_vacancies'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $alerts = [];
        try {
            $alerts = app(\App\Services\JobVacancyService::class)->getAlerts($userId);
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::jobs-alerts', [
            'title' => __('govuk_alpha.jobs_t4.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'jobsActiveTab' => 'alerts',
            'alerts' => is_array($alerts) ? $alerts : [],
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /** Create a job alert subscription. */
    public function subscribeJobAlert(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('job_vacancies'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $data = [
            'keywords' => trim(self::asStr($request->input('keywords'))),
            'categories' => trim(self::asStr($request->input('categories'))),
            'type' => self::asStr($this->allowed(self::asStr($request->input('type')), ['paid', 'volunteer', 'timebank'], '')),
            'commitment' => self::asStr($this->allowed(self::asStr($request->input('commitment')), ['full_time', 'part_time', 'flexible', 'one_off'], '')),
            'location' => trim(self::asStr($request->input('location'))),
            'is_remote_only' => $request->input('is_remote_only') === '1',
        ];

        $newId = null;
        try {
            $newId = app(\App\Services\JobVacancyService::class)->subscribeAlert($userId, $data);
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.jobs.alerts', [
            'tenantSlug' => $tenantSlug,
            'status' => $newId !== null ? 'alert-created' : 'alert-failed',
        ]);
    }

    /** Pause (deactivate) one of the member's alerts. */
    public function pauseJobAlert(Request $request, string $tenantSlug, int $alertId): RedirectResponse
    {
        return $this->jobAlertAction($tenantSlug, $alertId, 'pause');
    }

    /** Resume (reactivate) one of the member's alerts. */
    public function resumeJobAlert(Request $request, string $tenantSlug, int $alertId): RedirectResponse
    {
        return $this->jobAlertAction($tenantSlug, $alertId, 'resume');
    }

    /** Permanently delete one of the member's alerts. */
    public function deleteJobAlert(Request $request, string $tenantSlug, int $alertId): RedirectResponse
    {
        return $this->jobAlertAction($tenantSlug, $alertId, 'delete');
    }

    // ===== WAVE POLISH-GAMIFY =====

    /** POST: claim today's daily reward. Redirects back with status. */
    public function dailyReward(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('gamification'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $status = 'daily-reward-failed';
        try {
            $result = \App\Services\DailyRewardService::claim(TenantContext::getId(), $userId);
            if ($result !== null) {
                $status = 'daily-reward-claimed';
            }
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.achievements', ['tenantSlug' => $tenantSlug, 'status' => $status]);
    }

    /** POST: claim XP reward for a completed challenge. */
    public function claimChallengeReward(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('gamification'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $status = 'challenge-claim-failed';
        try {
            $ok = app(\App\Services\ChallengeService::class)->claim($id, $userId, TenantContext::getId());
            if ($ok) {
                $status = 'challenge-claimed';
            }
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.achievements', ['tenantSlug' => $tenantSlug, 'status' => $status]);
    }

    /** GET: Discover public goals you can buddy for. */
    public function goalDiscover(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('goals'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $discoverGoals = [];
        try {
            $raw = app(\App\Services\GoalService::class)->getPublicForBuddy($userId, []);
            $discoverGoals = is_array($raw['items'] ?? null) ? $raw['items'] : [];
        } catch (\Throwable $e) {
            report($e);
        }

        return $this->view('accessible-frontend::goals-discover', [
            'title' => __('govuk_alpha.polish_gamify.goals_discover_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'goals',
            'discoverGoals' => $discoverGoals,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /** POST: send a nudge/encouragement to a goal you are buddying. */
    public function buddyNudge(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('goals'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $status = 'buddy-nudge-failed';
        try {
            // createBuddyNote() verifies mentor_id === buddyId internally (tenant-scoped).
            $result = app(\App\Services\GoalService::class)->createBuddyNote($id, $userId, ['type' => 'nudge']);
            if ($result !== null) {
                $status = 'buddy-nudge-sent';
            }
        } catch (\App\Exceptions\SafeguardingPolicyException $e) {
            $status = $e->reasonCode === 'SAFEGUARDING_POLICY_UNAVAILABLE'
                ? 'buddy-nudge-safeguarding-unavailable'
                : 'buddy-nudge-safeguarding-restricted';
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.goals.buddying', ['tenantSlug' => $tenantSlug, 'status' => $status]);
    }

    /**
     * Shared pause/resume/delete handler. Each service call is filtered by
     * (id, user_id), so a member can only ever touch their own alerts.
     */
    private function jobAlertAction(string $tenantSlug, int $alertId, string $action): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('job_vacancies'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $svc = app(\App\Services\JobVacancyService::class);
        $status = 'alert-failed';
        try {
            switch ($action) {
                case 'pause':
                    $svc->unsubscribeAlert($alertId, $userId);
                    $status = 'alert-paused';
                    break;
                case 'resume':
                    $svc->resubscribeAlert($alertId, $userId);
                    $status = 'alert-resumed';
                    break;
                case 'delete':
                    $svc->deleteAlert($alertId, $userId);
                    $status = 'alert-deleted';
                    break;
            }
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.jobs.alerts', ['tenantSlug' => $tenantSlug, 'status' => $status]);
    }

    // ===== WAVE POLISH-COMMERCE =====

    public function podcastSubscribe(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('podcasts'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $status = 'subscribe-failed';
        try {
            $show = \App\Services\PodcastService::findShowById($id);
            if ($show !== null && (int) $show->tenant_id !== TenantContext::getId()) {
                $show = null;
            }
            $isAdmin = $this->commercePodcastViewerIsAdmin($userId);
            abort_if($show === null || !\App\Services\PodcastService::canViewShow($show, $userId, $isAdmin), 404);

            $subscribed = \App\Services\PodcastService::toggleSubscription($show, $userId);
            $status = $subscribed ? 'subscribed' : 'unsubscribed';
        } catch (\Throwable $e) {
            if ($e instanceof \Symfony\Component\HttpKernel\Exception\HttpExceptionInterface) {
                throw $e;
            }
            report($e);
        }

        return redirect()
            ->route('govuk-alpha.podcasts.show', ['tenantSlug' => $tenantSlug, 'id' => $id])
            ->with('podcast_status', $status);
    }

    public function podcastEpisode(Request $request, string $tenantSlug, int $showId, int $id): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('podcasts'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $show = null;
        $episode = null;
        $isAdmin = $this->commercePodcastViewerIsAdmin($userId);
        try {
            $show = \App\Services\PodcastService::findShowById($showId);
            if ($show !== null && (int) $show->tenant_id !== TenantContext::getId()) {
                $show = null;
            }
            if ($show !== null && !\App\Services\PodcastService::canViewShow($show, $userId, $isAdmin)) {
                $show = null;
            }
            if ($show !== null) {
                $ep = $show->episodes()->where('id', $id)->first();
                if ($ep !== null && \App\Services\PodcastService::canViewEpisode($ep, $show, $userId, $isAdmin)) {
                    $ep->setRelation('show', $show);
                    $url = '';
                    try {
                        \App\Services\PodcastService::prepareEpisodeForResponse($ep, $userId, $isAdmin);
                        $url = (string) ($ep->audio_url ?? '');
                    } catch (\Throwable $e) {
                        $url = '';
                    }
                    $episode = [
                        'id' => (int) $ep->id,
                        'title' => (string) ($ep->title ?? ''),
                        'description' => (string) ($ep->description ?? ''),
                        'audio_url' => $url,
                        'transcript' => \App\Services\PodcastConfigurationService::get(
                            \App\Services\PodcastConfigurationService::CONFIG_ENABLE_TRANSCRIPTS
                        ) ? (string) ($ep->transcript ?? '') : '',
                    ];
                }
            }
        } catch (\Throwable $e) {
            report($e);
        }
        abort_if($show === null || $episode === null, 404);

        return $this->view('accessible-frontend::podcast-episode', [
            'title' => ($episode['title'] ?: ($show->title ?? '')) ?: __('govuk_alpha.podcasts.episodes_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'show' => [
                'id' => (int) $show->id,
                'title' => (string) ($show->title ?? ''),
            ],
            'episode' => $episode,
        ]);
    }

    public function couponShow(Request $request, string $tenantSlug, int $id): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('merchant_coupons'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $coupon = null;
        try {
            $rows = \App\Services\MerchantCouponService::listForMember();
            foreach ($rows as $c) {
                $c = is_array($c) ? (object) $c : $c;
                if ((int) ($c->id ?? 0) === $id) {
                    $coupon = [
                        'id' => (int) ($c->id ?? 0),
                        'code' => (string) ($c->code ?? ''),
                        'title' => (string) ($c->title ?? ''),
                        'description' => (string) ($c->description ?? ''),
                        'discount_type' => (string) ($c->discount_type ?? ''),
                        'discount_value' => $c->discount_value ?? null,
                        'valid_until' => $c->valid_until ?? null,
                        'merchant' => is_object($c->merchant ?? null) ? (array) $c->merchant : ($c->merchant ?? []),
                        'merchant_name' => (string) ($c->merchant_name ?? ''),
                    ];
                    break;
                }
            }
        } catch (\Throwable $e) {
            report($e);
        }
        abort_if($coupon === null, 404);

        return $this->view('accessible-frontend::coupons-detail', [
            'title' => ($coupon['title'] ?: $coupon['code']) ?: __('govuk_alpha.coupons.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'coupon' => $coupon,
        ]);
    }

    public function premiumReturn(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('member_premium'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $returnStatus = self::asStr($request->query('status'));
        if (!in_array($returnStatus, ['success', 'pending', 'failed'], true)) {
            $returnStatus = 'failed';
        }

        $tierName = '';
        if ($returnStatus === 'success') {
            try {
                $currentTier = \App\Services\MemberPremiumService::getMemberTier($userId);
                $tierName = trim((string) ($currentTier['tier_name'] ?? ''));
            } catch (\Throwable $e) {
                report($e);
            }
        }

        return $this->view('accessible-frontend::premium-return', [
            'title' => __('govuk_alpha.polish_commerce.premium_success_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'returnStatus' => $returnStatus,
            'tierName' => $tierName,
        ]);
    }

    // ===== WAVE NIGHT-LISTINGS =====

    /**
     * Save a listing (add bookmark) for the current user.
     */
    public function saveListing(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('listings'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        // Verify the listing exists and belongs to this tenant (cross-tenant → 404).
        $listing = $this->listingService->getById($id, false, $userId);
        abort_if($listing === null, 404);

        // Cannot bookmark your own listing (same guard as the React UI).
        $ownerId = (int) ($listing['user_id'] ?? $listing['author_id'] ?? $listing['user']['id'] ?? 0);
        abort_if($ownerId === $userId, 403);

        try {
            app(\App\Services\BookmarkService::class)->toggle($userId, 'listing', $id);
        } catch (\Throwable $e) {
            report($e);
            return redirect()->route('govuk-alpha.listings.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'save-failed']);
        }

        return redirect()->route('govuk-alpha.listings.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'listing-saved']);
    }

    /**
     * Unsave a listing (remove bookmark) for the current user.
     */
    public function unsaveListing(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('listings'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        // Verify listing exists and is tenant-scoped.
        $listing = $this->listingService->getById($id, false, $userId);
        abort_if($listing === null, 404);

        try {
            app(\App\Services\BookmarkService::class)->toggle($userId, 'listing', $id);
        } catch (\Throwable $e) {
            report($e);
            return redirect()->route('govuk-alpha.listings.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'unsave-failed']);
        }

        return redirect()->route('govuk-alpha.listings.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'listing-unsaved']);
    }

    /**
     * Renew an expired listing (extend its expiry date).
     * Only the owner may renew their own listing.
     */
    public function renewListing(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('listings'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        // Use a raw DB query so expired listings are reachable for ownership check.
        // getById() hides non-active listings from non-owners, which would turn a
        // 403 (not your listing) into a 404 (not found) for the expired case.
        $raw = DB::table('listings')
            ->where('id', $id)
            ->where('tenant_id', TenantContext::getId())
            ->whereNull('deleted_at')
            ->select('id', 'user_id')
            ->first();
        abort_if($raw === null, 404);
        abort_unless((int) $raw->user_id === $userId, 403);

        $ok = false;
        try {
            $result = app(\App\Services\ListingExpiryService::class)->renewListing($id, $userId);
            $ok = (bool) ($result['success'] ?? false);
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.listings.show', [
            'tenantSlug' => $tenantSlug,
            'id' => $id,
            'status' => $ok ? 'listing-renewed' : 'renew-failed',
        ]);
    }

    /**
     * Show the report-a-listing form.
     * Cannot report your own listing.
     */
    public function listingReport(Request $request, string $tenantSlug, int $id): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('listings'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $listing = $this->listingService->getById($id, false, $userId);
        abort_if($listing === null, 404);

        // Cannot report your own listing.
        $ownerId = (int) ($listing['user_id'] ?? $listing['author_id'] ?? $listing['user']['id'] ?? 0);
        abort_if($ownerId === $userId, 403);

        return $this->view('accessible-frontend::listing-report', [
            'title' => __('govuk_alpha.polish_listings.report_form_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'listings',
            'listing' => $listing,
            'status' => self::asStr($request->query('status')) ?: null,
        ]);
    }

    /**
     * Submit a report against a listing.
     * Valid reasons: inappropriate, safety_concern, misleading, spam, not_timebank_service, other.
     */
    public function storeListingReport(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('listings'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $listing = $this->listingService->getById($id, false, $userId);
        abort_if($listing === null, 404);

        // Cannot report your own listing.
        $ownerId = (int) ($listing['user_id'] ?? $listing['author_id'] ?? $listing['user']['id'] ?? 0);
        abort_if($ownerId === $userId, 403);

        $validReasons = ['inappropriate', 'safety_concern', 'misleading', 'spam', 'not_timebank_service', 'other'];
        $reason = $this->allowed($request->input('reason'), $validReasons, '');
        if ($reason === '') {
            return redirect()
                ->route('govuk-alpha.listings.report', ['tenantSlug' => $tenantSlug, 'id' => $id])
                ->withErrors(['reason' => __('govuk_alpha.polish_listings.report_reason_required')])
                ->withInput();
        }

        $details = trim(self::asStr($request->input('details')));
        if (mb_strlen($details) > 500) {
            $details = mb_substr($details, 0, 500);
        }

        $tenantId = TenantContext::getId();

        // Duplicate check — one report per user per listing (mirrors ListingsController::report).
        $alreadyReported = \App\Models\ListingReport::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('listing_id', $id)
            ->where('reporter_id', $userId)
            ->exists();

        if ($alreadyReported) {
            return redirect()->route('govuk-alpha.listings.show', [
                'tenantSlug' => $tenantSlug,
                'id' => $id,
                'status' => 'already-reported',
            ]);
        }

        $ok = false;
        try {
            \App\Models\ListingReport::create([
                'tenant_id'   => $tenantId,
                'listing_id'  => $id,
                'reporter_id' => $userId,
                'reason'      => $reason,
                'details'     => $details !== '' ? $details : null,
                'status'      => 'pending',
            ]);
            $ok = true;
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.listings.show', [
            'tenantSlug' => $tenantSlug,
            'id' => $id,
            'status' => $ok ? 'listing-reported' : 'report-failed',
        ]);
    }

    /**
     * Dismiss a match so it no longer appears in the user's matches list.
     * Only listing-module matches are currently dismissible.
     */
    public function dismissMatch(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('listings'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $tenantId = TenantContext::getId();

        // Verify the listing exists and is tenant-scoped before inserting a dismissal.
        $exists = DB::table('listings')
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->exists();
        abort_unless($exists, 404);

        $reason = $this->allowed($request->input('reason'), ['not_relevant', 'already_done', 'not_interested'], 'not_relevant');

        try {
            // INSERT IGNORE equivalent — duplicate silently ignored via updateOrInsert.
            DB::table('match_dismissals')->updateOrInsert(
                ['tenant_id' => $tenantId, 'user_id' => $userId, 'listing_id' => $id],
                ['reason' => $reason, 'created_at' => now()]
            );
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.matches.index', [
            'tenantSlug' => $tenantSlug,
            'status' => 'match-dismissed',
        ]);
    }

    // ===== WAVE NIGHT-MEMBERS: messages/connections/members/profile parity + polish =====

    /**
     * Store a review written directly from a member's profile page.
     * Mirrors storeReview() but redirects back to the member's profile.
     */
    public function storeProfileReview(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('reviews'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        // Cross-tenant guard: member must belong to this tenant.
        $memberExists = DB::table('users')
            ->where('id', $id)
            ->where('tenant_id', TenantContext::getId())
            ->where('status', 'active')
            ->exists();
        if (!$memberExists) {
            abort(404);
        }

        // Block self-review.
        if ($id === $userId) {
            return redirect()->route('govuk-alpha.members.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'review-invalid']);
        }

        $receiverId = $id;
        $rating     = (int) $request->input('rating');
        $comment    = trim(self::asStr($request->input('comment')));

        $data = [
            'receiver_id' => $receiverId,
            'rating'      => $rating,
            'comment'     => $comment !== '' ? $comment : null,
        ];

        $status = 'review-submitted';
        try {
            $review = app(\App\Services\ReviewService::class)->create($userId, $data);

            try {
                \App\Services\GamificationService::awardXP($userId, \App\Services\GamificationService::XP_VALUES['leave_review'], 'leave_review', 'Left a review');
            } catch (\Throwable $e) {
                // Gamification is best-effort.
            }

            try {
                app(\App\Services\FeedActivityService::class)->recordActivity(
                    (int) TenantContext::getId(),
                    $userId,
                    'review',
                    (int) ($review['id'] ?? 0),
                    [
                        'content'  => $review['comment'] ?? null,
                        'metadata' => ['rating' => $review['rating'] ?? $rating, 'receiver_id' => $receiverId],
                    ]
                );
            } catch (\Throwable $e) {
                // Feed activity is best-effort.
            }
        } catch (\Illuminate\Validation\ValidationException $e) {
            $status = 'review-invalid';
        } catch (\App\Exceptions\SafeguardingPolicyException $e) {
            $status = $e->reasonCode === 'SAFEGUARDING_POLICY_UNAVAILABLE'
                ? 'review-safeguarding-unavailable'
                : 'review-safeguarding-restricted';
        } catch (\RuntimeException $e) {
            $status = str_contains($e->getMessage(), 'yourself') ? 'review-invalid' : 'review-duplicate';
        } catch (\Throwable $e) {
            report($e);
            $status = 'review-failed';
        }

        return redirect()->route('govuk-alpha.members.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => $status]);
    }

    /**
     * Transfer time credits directly from a member's profile page.
     * Mirrors transferCredits() but redirects back to the member's profile.
     */
    public function profileTransferCredits(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasModule('wallet'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $fail = fn (string $code): RedirectResponse => redirect()->route(
            'govuk-alpha.members.show',
            ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'transfer-' . $code]
        );

        // Block self-transfer.
        if ($id === $userId) {
            return $fail('self');
        }

        // Cross-tenant guard.
        $sameTenant = DB::table('users')
            ->where('id', $id)
            ->where('tenant_id', TenantContext::getId())
            ->exists();
        if (!$sameTenant) {
            abort(404);
        }

        $amount = (float) $request->input('amount');
        $note   = trim(self::asStr($request->input('note')));

        if ($amount <= 0 || floor($amount) !== $amount) {
            return $fail('failed');
        }

        try {
            app(\App\Services\WalletService::class)->transfer($userId, [
                'recipient'      => $id,
                'amount'         => $amount,
                'description'    => mb_substr($note, 0, 255),
                // Anti-double-submit: the form carries a per-render idempotency
                // token so a double-click collapses to one debit server-side.
                'idempotency_key' => self::asStr($request->input('idempotency_key')),
            ]);
        } catch (\App\Exceptions\SafeguardingPolicyException $e) {
            return $fail($e->reasonCode === 'SAFEGUARDING_POLICY_UNAVAILABLE'
                ? 'safeguarding-unavailable'
                : 'safeguarding');
        } catch (\Throwable $e) {
            $msg = $e->getMessage();
            return $fail(match (true) {
                str_contains($msg, 'Insufficient') => 'insufficient',
                str_contains($msg, 'yourself')     => 'self',
                default                            => 'failed',
            });
        }

        return redirect()->route('govuk-alpha.members.show', ['tenantSlug' => $tenantSlug, 'id' => $id, 'status' => 'transfer-sent']);
    }

    /**
     * Delete a review the current user wrote (given reviews).
     * Parity: React allows deleting reviews from the reviews page.
     */
    public function deleteReview(Request $request, string $tenantSlug, int $id): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('reviews'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $status = 'review-delete-failed';
        try {
            $reviewSvc = app(\App\Services\ReviewService::class);
            $review = $reviewSvc->getById($id);
            // Only the reviewer may delete their own review.
            if ($review && (int) ($review['reviewer_id'] ?? 0) === $userId) {
                $reviewSvc->delete($id);
                $status = 'review-deleted';
            }
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.reviews.index', ['tenantSlug' => $tenantSlug, 'status' => $status]);
    }

    // ===== WAVE NIGHT-EVENTS =====

    /**
     * POST /events/{id}/attendees/{attendeeId}/check-in
     *
     * Owner-only check-in: mark an RSVP'd attendee as having attended.
     * Cross-tenant → 404 (assertTenantSlug); non-owner → 403 (ownedEventOrAbort).
     * EventService::markAttended also validates canManageEventAttendance internally.
     */
    public function storeEventCheckin(Request $request, string $tenantSlug, int $id, int $attendeeId): RedirectResponse
    {
        [, $userId] = $this->ownedEventOrAbort($tenantSlug, $id);

        $ok = false;
        try {
            $result = $this->eventAttendanceService->record(
                $id,
                $attendeeId,
                $this->accessibleEventActor($userId),
                null,
                null,
                $this->accessibleEventMutationKey($request),
            );
            $ok = in_array($result->outcome, ['checked_in', 'already_checked_in'], true);
        } catch (EventAttendanceException|EventRegistrationException $e) {
            $ok = false;
        } catch (\Throwable $e) {
            report($e);
        }

        return redirect()->route('govuk-alpha.events.show', [
            'tenantSlug' => $tenantSlug,
            'id' => $id,
            'status' => $ok ? 'checkin-success' : 'checkin-failed',
        ]);
    }

    // ===== WAVE NIGHT-FED: federation groups browsing =====

    /**
     * FEDERATION GROUPS BROWSE — `/federation/groups` (GET, cursor pagination via ?cursor=, ?q=).
     * Mirrors FederationV2Controller::groups() — shows groups from partner communities
     * that have opened their groups to federation (federated_visibility or allow_federated_members).
     * Only shows groups from tenants where federation_optin + appear_in_federated_search apply
     * at the partnership level (groups_enabled = 1).
     */
    public function federationGroups(Request $request, string $tenantSlug): \Illuminate\Http\Response|\Illuminate\Http\RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('federation'), 403);
        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }
        if ($redirect = $this->federationOptInRedirectIfRequired($userId, $tenantSlug)) {
            return $redirect;
        }

        $tenantId = TenantContext::getId();
        $allowed = $this->federationOperationAllowed('groups', $tenantId);
        $q = trim(self::asStr($request->query('q')));
        $partnerId = (int) $request->query('partner_id');
        $groups = [];
        $nextCursor = null;
        $loadError = false;
        $partnerOptions = $allowed ? $this->federationInternalPartnerOptions($tenantId) : [];

        if ($allowed) {
            $perPage = 20;
            $cursorId = $this->decodeFederationCursor(self::asStr($request->query('cursor')));

            try {
                $sql = "
                    SELECT g.id, g.name, g.description, g.tenant_id, g.cached_member_count as member_count,
                        g.visibility, t.name as tenant_name
                    FROM groups g
                    JOIN tenants t ON t.id = g.tenant_id
                    JOIN federation_user_settings fus_owner ON fus_owner.user_id = g.owner_id
                    JOIN federation_partnerships fp ON (
                        (fp.tenant_id = :tid1 AND fp.partner_tenant_id = g.tenant_id)
                        OR (fp.partner_tenant_id = :tid2 AND fp.tenant_id = g.tenant_id)
                    )
                    WHERE fp.status = 'active' AND fp.groups_enabled = 1
                    AND g.tenant_id != :tid3
                    AND g.status = 'active'
                    AND fus_owner.federation_optin = 1
                    AND fus_owner.profile_visible_federated = 1
                    AND fus_owner.appear_in_federated_search = 1
                    AND (g.federated_visibility IN ('listed', 'joinable') OR g.allow_federated_members = 1)
                ";
                $params = [':tid1' => $tenantId, ':tid2' => $tenantId, ':tid3' => $tenantId];

                if ($q !== '') {
                    $sql .= " AND (g.name LIKE :q1 OR g.description LIKE :q2)";
                    $term = "%{$q}%";
                    $params[':q1'] = $term;
                    $params[':q2'] = $term;
                }
                if ($partnerId > 0) {
                    $sql .= " AND g.tenant_id = :partner_id";
                    $params[':partner_id'] = $partnerId;
                }
                if ($cursorId !== null) {
                    $sql .= " AND g.id < :cursor_id";
                    $params[':cursor_id'] = $cursorId;
                }
                $sql .= " ORDER BY g.id DESC LIMIT :lim";
                $params[':lim'] = $perPage + 1;

                $rows = $this->federationSelect($sql, $params);

                $hasMore = count($rows) > $perPage;
                if ($hasMore) {
                    $rows = array_slice($rows, 0, $perPage);
                }

                $groups = array_map(static function (array $g): array {
                    return [
                        'id' => (int) $g['id'],
                        'name' => (string) ($g['name'] ?? ''),
                        'description' => (string) ($g['description'] ?? ''),
                        'member_count' => (int) ($g['member_count'] ?? 0),
                        'privacy' => (string) ($g['visibility'] ?? 'public'),
                        'tenant_id' => (int) $g['tenant_id'],
                        'tenant_name' => (string) ($g['tenant_name'] ?? ''),
                    ];
                }, $rows);

                if ($hasMore && !empty($rows)) {
                    $last = end($rows);
                    $nextCursor = base64_encode((string) ((int) $last['id']));
                }
            } catch (\Throwable $e) {
                report($e);
                $loadError = true;
            }
        }

        return $this->view('accessible-frontend::federation-groups', [
            'title' => __('govuk_alpha.polish_federation.groups_title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'explore',
            'federationActiveTab' => 'groups',
            'allowed' => $allowed,
            'groups' => $groups,
            'query' => $q,
            'partnerId' => $partnerId,
            'partnerOptions' => $partnerOptions,
            'loadError' => $loadError,
            'nextCursor' => $nextCursor,
        ]);
    }
}
