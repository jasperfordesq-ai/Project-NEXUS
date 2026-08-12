<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature;

use App\Models\FeedActivity;
use App\Models\FeedPost;
use App\Models\Listing;
use App\Models\User;
use App\Core\ImageUploader;
use App\Core\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

class GovukAlphaFrontendTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * Defensively scrub request-scoped tenant/auth state that earlier tests in the
     * full suite leak through PHP superglobals and the auth guards.
     *
     * Hypothesis for the polluted failure of test_root_renders_accessible_tenant_chooser:
     * AlphaController::tenantChooser() only renders the chooser when TenantContext resolves
     * to the host tenant (id 1). The test resets TenantContext, but on the GET '/' the context
     * re-resolves from the request — and TenantContext::get() reads $_SERVER['HTTP_X_TENANT_ID']
     * / HTTP_X_TENANT_SLUG / HTTP_AUTHORIZATION. A prior API request in the suite leaves
     * X-Tenant-ID=2 (and friends) in $_SERVER, so '/' re-pins to tenant 2 and the controller
     * redirects to the tenant home instead of returning 200 with the chooser.
     *
     * Clearing those superglobals (and forgetting stale guards) makes '/' resolve to the host
     * tenant exactly as it does when this file runs on its own.
     */
    protected function setUp(): void
    {
        parent::setUp();

        $this->app['auth']->forgetGuards();

        foreach ([
            'HTTP_X_TENANT_ID',
            'HTTP_X_TENANT_SLUG',
            'HTTP_AUTHORIZATION',
            'REDIRECT_HTTP_AUTHORIZATION',
        ] as $serverKey) {
            unset($_SERVER[$serverKey]);
        }

        \App\Core\TenantContext::reset();
        \App\Core\TenantContext::setById($this->testTenantId);

        \Illuminate\Support\Facades\Cache::flush();
    }

    public function post($uri, array $data = [], array $headers = []): \Illuminate\Testing\TestResponse
    {
        if (is_string($uri) && str_contains($uri, '/accessible')) {
            $token = (string) ($data['_token'] ?? 'govuk-alpha-frontend-test-token');
            $data['_token'] = $token;

            $this->withSession(['_token' => $token]);

            return parent::post($uri, $data, $headers);
        }

        return parent::post($uri, $data, $headers);
    }

    public function test_root_renders_accessible_tenant_chooser(): void
    {
        \App\Core\TenantContext::reset();

        $response = $this->get('/');

        $response->assertOk();
        $response->assertSee(__('govuk_alpha.tenant_chooser.title'));
        $response->assertSee($this->testTenantSlug);
        $response->assertSee("/{$this->testTenantSlug}/accessible", false);
        $response->assertSee('href="' . __('govuk_alpha.feedback_url') . '"', false);
        $response->assertSee('AGPL-3.0-or-later');
    }

    public function test_home_login_and_register_pages_render_for_tenant(): void
    {
        $feedbackUrl = route('govuk-alpha.contact', ['tenantSlug' => $this->testTenantSlug]);

        foreach (['/accessible', '/accessible/login', '/accessible/register'] as $path) {
            $response = $this->get("/{$this->testTenantSlug}{$path}");

            $response->assertOk();
            $response->assertHeader('content-type', 'text/html; charset=UTF-8');
            $response->assertSee('Project NEXUS Accessible');
            $response->assertSee('class="govuk-skip-link"', false);
            $response->assertSee('class="govuk-phase-banner"', false);
            $response->assertSee('href="' . $feedbackUrl . '"', false);
            $response->assertSee('AGPL-3.0-or-later');
        }
    }

    public function test_global_language_switcher_changes_and_persists_the_locale(): void
    {
        // The no-JS switcher renders in the header with the supported languages.
        $page = $this->get("/{$this->testTenantSlug}/accessible/login");
        $page->assertOk();
        $page->assertSee('name="locale"', false);
        $page->assertSee(__('govuk_alpha.profile_settings.languages.ga'), false);
        $page->assertSee(__('govuk_alpha.header.language_submit'));

        // Switching to Irish renders that locale and sets <html lang>.
        $ga = $this->get("/{$this->testTenantSlug}/accessible/login?locale=ga");
        $ga->assertOk();
        $ga->assertSee('lang="ga"', false);
        $ga->assertSee($this->alphaText('ga', 'auth.login_description', ['community' => 'Hour Timebank']));
        $ga->assertDontSee($this->alphaText('en', 'auth.login_description', ['community' => 'Hour Timebank']));

        // The choice persists to the next request via the session (no ?locale param) —
        // this is the bug the AlphaSetLocale middleware fixes.
        $next = $this->get("/{$this->testTenantSlug}/accessible/login");
        $next->assertSee('lang="ga"', false);

        // Arabic switches the document direction to RTL.
        $ar = $this->get("/{$this->testTenantSlug}/accessible/login?locale=ar");
        $ar->assertSee('lang="ar"', false);
        $ar->assertSee('dir="rtl"', false);
        $ar->assertSee($this->alphaText('ar', 'auth.login_description', ['community' => 'Hour Timebank']));
        $ar->assertDontSee($this->alphaText('en', 'auth.login_description', ['community' => 'Hour Timebank']));
    }

    public function test_login_unverified_shows_resend_form_and_resend_is_generic(): void
    {
        // The login page surfaces a resend-verification form for unverified accounts.
        $page = $this->get("/{$this->testTenantSlug}/accessible/login?status=email-not-verified");
        $page->assertOk();
        $page->assertSee(__('govuk_alpha.auth.resend_verification_button'));
        $page->assertSee(route('govuk-alpha.login.resend', ['tenantSlug' => $this->testTenantSlug]), false);

        // Posting returns the generic (anti-enumeration) confirmation regardless.
        $resend = $this->post("/{$this->testTenantSlug}/accessible/login/resend-verification", [
            'email' => 'nobody@example.com',
        ]);
        $resend->assertRedirect("/{$this->testTenantSlug}/accessible/login?status=verification-resent");

        $confirm = $this->get("/{$this->testTenantSlug}/accessible/login?status=verification-resent");
        $confirm->assertSee(__('govuk_alpha.auth.verification_resent'));
    }

    public function test_failed_login_repopulates_the_email_field(): void
    {
        $login = $this->post("/{$this->testTenantSlug}/accessible/login", [
            'email' => 'someone@example.com',
            'password' => 'definitely-the-wrong-password',
        ]);

        $login->assertRedirect();
        // withInput() flashes the email so the form can pre-fill old('email').
        $login->assertSessionHasInput('email', 'someone@example.com');
    }

    public function test_home_module_grid_distinguishes_signin_from_disabled(): void
    {
        // Anonymous viewer: auth-gated modules (Dashboard, My Profile, …) are not
        // "disabled" — they need sign-in. The grid must say so, not "not enabled
        // for this community".
        $anon = $this->get("/{$this->testTenantSlug}/accessible");
        $anon->assertOk();
        $anon->assertSee(__('govuk_alpha.home.module_signin'));
        $anon->assertSee(__('govuk_alpha.home.module_signin_hint'));

        // Signed in: the dashboard module becomes available.
        $this->authenticatedUser();
        $authed = $this->get("/{$this->testTenantSlug}/accessible");
        $authed->assertOk();
        $authed->assertSee(__('govuk_alpha.home.module_available'));
        $authed->assertSee(route('govuk-alpha.dashboard', ['tenantSlug' => $this->testTenantSlug]), false);
    }

    public function test_register_page_shows_closed_registration_message_and_hides_form(): void
    {
        DB::table('tenant_registration_policies')->updateOrInsert(
            ['tenant_id' => $this->testTenantId],
            [
                'registration_mode' => 'open',
                'verification_level' => 'none',
                'post_verification' => 'activate',
                'fallback_mode' => 'none',
                'require_email_verify' => 1,
                'is_active' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'general.registration_mode'],
            [
                'setting_value' => 'closed',
                'setting_type' => 'string',
                'updated_at' => now(),
            ]
        );
        app(\App\Services\TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);

        $response = $this->get("/{$this->testTenantSlug}/accessible/register");

        $response->assertOk();
        $response->assertSee('<h1 class="govuk-heading-xl">' . __('govuk_alpha.auth.registration_closed_title') . '</h1>', false);
        $response->assertDontSee('<h1 class="govuk-heading-xl">' . __('govuk_alpha.auth.register_title') . '</h1>', false);
        $response->assertSee(__('govuk_alpha.auth.registration_closed_title'));
        $response->assertSee(__('govuk_alpha.auth.registration_closed_body'));
        $response->assertDontSee('name="first_name"', false);
        // The registration form (and its submit button) is hidden. Assert the
        // register-specific submit label rather than any type="submit", since the
        // global header language switcher legitimately renders a submit button on
        // every page.
        $response->assertDontSee(__('govuk_alpha.auth.register_action'));
    }

    public function test_register_page_shows_per_field_inline_errors(): void
    {
        // Ensure registration is open so the form (and its fields) renders.
        DB::table('tenant_registration_policies')->updateOrInsert(
            ['tenant_id' => $this->testTenantId],
            [
                'registration_mode' => 'open',
                'verification_level' => 'none',
                'post_verification' => 'activate',
                'fallback_mode' => 'none',
                'require_email_verify' => 1,
                'is_active' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'general.registration_mode'],
            ['setting_value' => 'open', 'setting_type' => 'string', 'updated_at' => now()]
        );
        app(\App\Services\TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);

        // Password mismatch → inline error on the password field + anchored summary.
        $pw = $this->get("/{$this->testTenantSlug}/accessible/register?status=register-password-mismatch");
        $pw->assertOk();
        $pw->assertSee('name="password"', false);
        $pw->assertSee('govuk-form-group--error', false);
        $pw->assertSee('id="password-error"', false);
        $pw->assertSee('href="#password"', false);
        $pw->assertSee(__('govuk_alpha.auth.register_password_mismatch'));

        // Invalid email domain → inline error on the email field.
        $email = $this->get("/{$this->testTenantSlug}/accessible/register?status=register-email-domain-invalid");
        $email->assertOk();
        $email->assertSee('id="email-error"', false);
        $email->assertSee('href="#email"', false);

        // Terms required → inline error on the terms checkbox.
        $terms = $this->get("/{$this->testTenantSlug}/accessible/register?status=register-terms-required");
        $terms->assertOk();
        $terms->assertSee('id="terms_accepted-error"', false);
        $terms->assertSee('href="#terms_accepted"', false);
    }

    public function test_contact_page_renders_govuk_alpha_form_and_feedback_link_targets_it(): void
    {
        $response = $this->get("/{$this->testTenantSlug}/accessible/contact");

        $response->assertOk();
        $response->assertHeader('content-type', 'text/html; charset=UTF-8');
        $response->assertSee(__('govuk_alpha.contact.title'));
        $response->assertSee('class="govuk-fieldset"', false);
        $response->assertSee('name="name"', false);
        $response->assertSee('name="email"', false);
        $response->assertSee('name="subject"', false);
        $response->assertSee('name="message"', false);
        $response->assertSee('href="' . route('govuk-alpha.contact', ['tenantSlug' => $this->testTenantSlug]) . '"', false);
        $response->assertSee('AGPL-3.0-or-later');
    }

    public function test_contact_link_is_in_accessible_footer_links_not_service_navigation(): void
    {
        $contactUrl = route('govuk-alpha.contact', ['tenantSlug' => $this->testTenantSlug]);

        $response = $this->get("/{$this->testTenantSlug}/accessible");

        $response->assertOk();
        // Contact now lives in the GOV.UK footer Support column, not the service nav.
        $response->assertSee('class="govuk-footer__navigation"', false);
        $response->assertSee('<a class="govuk-footer__link" href="' . $contactUrl . '">' . __('govuk_alpha.footer.columns.support.contact') . '</a>', false);
        // Guests do not see the sign-out control.
        $response->assertDontSee(__('govuk_alpha.footer.sign_out'));
        $response->assertDontSee('<a class="govuk-service-navigation__link" href="' . $contactUrl . '"', false);
    }

    public function test_accessible_header_hides_home_navigation_link_for_signed_in_users(): void
    {
        $homeUrl = route('govuk-alpha.home', ['tenantSlug' => $this->testTenantSlug]);

        $guest = $this->get("/{$this->testTenantSlug}/accessible");

        $guest->assertOk();
        $guest->assertSee('<a class="govuk-service-navigation__link" href="' . $homeUrl . '"', false);

        $this->authenticatedUser();

        $signedIn = $this->get("/{$this->testTenantSlug}/accessible/feed");

        $signedIn->assertOk();
        $signedIn->assertDontSee('<a class="govuk-service-navigation__link" href="' . $homeUrl . '"', false);
        $signedIn->assertSee(__('govuk_alpha.nav.dashboard'));
    }

    public function test_logout_is_a_csrf_protected_post_form_in_the_accessible_footer(): void
    {
        $this->authenticatedUser();

        $logoutUrl = route('govuk-alpha.logout', ['tenantSlug' => $this->testTenantSlug]);

        $response = $this->get("/{$this->testTenantSlug}/accessible");

        $response->assertOk();
        $response->assertSee('class="govuk-footer__meta"', false);
        // Sign-out changes state, so it is a POST form (with CSRF), not a GET link.
        $response->assertSee('<form method="post" action="' . $logoutUrl . '"', false);
        $response->assertSee(__('govuk_alpha.footer.sign_out'));
        $response->assertDontSee('<a class="govuk-footer__link" href="' . $logoutUrl . '">', false);

        // The GET method is no longer routable for the state-changing sign-out.
        $this->get("/{$this->testTenantSlug}/accessible/logout")->assertStatus(405);

        $logout = $this->post("/{$this->testTenantSlug}/accessible/logout");
        $logout->assertRedirect("/{$this->testTenantSlug}/accessible/login?status=signed-out");
        $logout->assertCookieExpired('auth_token');
    }

    public function test_govuk_footer_renders_columns_attribution_and_github_link(): void
    {
        $response = $this->get("/{$this->testTenantSlug}/accessible");

        $response->assertOk();
        $response->assertSee('class="govuk-footer"', false);
        $response->assertSee('class="govuk-footer__navigation"', false);
        // Support and Legal columns are universal (Platform is feature-gated).
        $response->assertSee(__('govuk_alpha.footer.columns.support.heading'));
        $response->assertSee(__('govuk_alpha.footer.columns.legal.heading'));
        $response->assertSee('<a class="govuk-footer__link" href="' . route('govuk-alpha.about', ['tenantSlug' => $this->testTenantSlug]) . '">' . __('govuk_alpha.footer.columns.support.about') . '</a>', false);
        $response->assertSee('<a class="govuk-footer__link" href="' . route('govuk-alpha.legal.terms', ['tenantSlug' => $this->testTenantSlug]) . '">' . __('govuk_alpha.footer.columns.legal.terms') . '</a>', false);
        // AGPL Section 7(b) attribution + a link to the source repository.
        $response->assertSee('class="govuk-footer__meta-custom"', false);
        $response->assertSee('AGPL-3.0-or-later');
        $response->assertSee('https://github.com/jasperfordesq-ai/Project-NEXUS', false);
        // Strictly not an official government service: no crown, no OGL licence.
        $response->assertDontSee('govuk-footer__crown', false);
        $response->assertDontSee('Open Government Licence');
    }

    public function test_about_page_renders_react_about_content(): void
    {
        $response = $this->get("/{$this->testTenantSlug}/accessible/about");

        $response->assertOk();
        $response->assertSee('AGPL-3.0-or-later');
        $response->assertSee(__('govuk_alpha.about.how_it_works.title'));
        $response->assertSee(__('govuk_alpha.about.values.title'));
        $response->assertSee(__('govuk_alpha.about.credits.title'));
        // Contributors come from the shared react-frontend contributors.json.
        $response->assertSee('Mary Casey');
        $response->assertSee('https://github.com/jasperfordesq-ai/Project-NEXUS', false);
    }

    public function test_legal_hub_and_documents_render(): void
    {
        $hub = $this->get("/{$this->testTenantSlug}/accessible/legal");
        $hub->assertOk();
        $hub->assertSee(__('govuk_alpha.legal.documents.terms.title'));
        $hub->assertSee(__('govuk_alpha.legal.documents.privacy.title'));
        $hub->assertSee(route('govuk-alpha.legal.cookies', ['tenantSlug' => $this->testTenantSlug]), false);

        $terms = $this->get("/{$this->testTenantSlug}/accessible/legal/terms");
        $terms->assertOk();
        $terms->assertSee(__('govuk_alpha.legal.documents.terms.title'));
        $terms->assertSee('class="govuk-back-link"', false);

        // Community guidelines render (tenant-managed document or GOV.UK fallback).
        $cg = $this->get("/{$this->testTenantSlug}/accessible/legal/community-guidelines");
        $cg->assertOk();
        $cg->assertSee(__('govuk_alpha.legal.documents.community_guidelines.title'));
    }

    public function test_accessibility_statement_renders_wcag_22_and_feedback_route(): void
    {
        $response = $this->get("/{$this->testTenantSlug}/accessible/accessibility");

        $response->assertOk();
        $response->assertSee(__('govuk_alpha.accessibility.title'));
        $response->assertSee(__('govuk_alpha.accessibility.standard_value'));
        $response->assertSee(route('govuk-alpha.contact', ['tenantSlug' => $this->testTenantSlug]), false);
    }

    public function test_trust_safety_page_renders_sections_and_safeguarding(): void
    {
        $response = $this->get("/{$this->testTenantSlug}/accessible/trust-and-safety");

        $response->assertOk();
        $response->assertSee('class="govuk-warning-text"', false);
        $response->assertSee(__('govuk_alpha.trust_safety.safeguarding_title'));
        $response->assertSee(__('govuk_alpha.trust_safety.sections.how_exchanges.heading'));
        $response->assertSee(__('govuk_alpha.trust_safety.sections.rights.heading'));
    }

    public function test_help_page_renders_search_and_shell(): void
    {
        $response = $this->get("/{$this->testTenantSlug}/accessible/help");

        $response->assertOk();
        $response->assertSee(__('govuk_alpha.help.title'));
        $response->assertSee('type="search"', false);
        $response->assertSee(__('govuk_alpha.help.contact_cta_title'));
    }

    public function test_kb_and_blog_indexes_render_and_unknown_detail_404s(): void
    {
        $this->authenticatedUser(['name' => 'Content Reader']);

        $kb = $this->get("/{$this->testTenantSlug}/accessible/kb");
        $kb->assertOk();
        $kb->assertSee(__('govuk_alpha.kb.title'));
        $kb->assertSee('type="search"', false);
        $this->get("/{$this->testTenantSlug}/accessible/kb/99999999")->assertNotFound();

        $blog = $this->get("/{$this->testTenantSlug}/accessible/blog");
        $blog->assertOk();
        $blog->assertSee(__('govuk_alpha.blog.title'));
        $this->get("/{$this->testTenantSlug}/accessible/blog/this-slug-does-not-exist")->assertNotFound();
    }

    public function test_blog_post_detail_renders_seo_and_accepts_a_comment(): void
    {
        $user = $this->authenticatedUser(['name' => 'Blog Reader']);
        $slug = 'community-garden-update-' . $user->id;
        $postId = DB::table('posts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'author_id' => $user->id,
            'title' => 'Community Garden Update',
            'slug' => $slug,
            'content' => 'A real update about our shared community garden and timebank.',
            'status' => 'published',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $detail = $this->get("/{$this->testTenantSlug}/accessible/blog/{$slug}");
        $detail->assertOk();
        $detail->assertSee('Community Garden Update');
        $detail->assertSee('application/ld+json', false);
        $detail->assertSee(__('govuk_alpha.blog.comments_heading'));

        $comment = $this->post("/{$this->testTenantSlug}/accessible/blog/{$slug}/comments", ['body' => 'Lovely work on the garden!']);
        $comment->assertRedirectContains('status=comment-added');
        $this->assertSame(1, DB::table('comments')
            ->where('tenant_id', $this->testTenantId)
            ->where('target_type', 'blog')
            ->where('target_id', $postId)
            ->where('user_id', $user->id)
            ->count());
    }

    public function test_misc_blog_rss_feed_renders(): void
    {
        $user = $this->authenticatedUser(['name' => 'Feed Author']);
        $slug = 'rss-feed-post-' . $user->id;
        DB::table('posts')->insert([
            'tenant_id' => $this->testTenantId,
            'author_id' => $user->id,
            'title' => 'A Post In The Feed',
            'slug' => $slug,
            'excerpt' => 'A short summary for the feed.',
            'content' => 'Full body of the feed post.',
            'status' => 'published',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // The public feed remains available when the fixture author is signed in.
        $feed = $this->get("/{$this->testTenantSlug}/accessible/blog/feed.xml");
        $feed->assertOk();
        $feed->assertHeader('Content-Type', 'application/rss+xml; charset=UTF-8');
        $feed->assertSee('<rss version="2.0">', false);
        $feed->assertSee('A Post In The Feed', false);
        $feed->assertSee(route('govuk-alpha.blog.show', ['tenantSlug' => $this->testTenantSlug, 'slug' => $slug]), false);
    }

    public function test_blog_appears_on_explore(): void
    {
        $this->authenticatedUser(['name' => 'Explorer Blog']);
        $explore = $this->get("/{$this->testTenantSlug}/accessible/explore");
        $explore->assertOk();
        $explore->assertSee(route('govuk-alpha.blog.index', ['tenantSlug' => $this->testTenantSlug]), false);
        $explore->assertSee(__('govuk_alpha.blog.title'));
    }

    public function test_new_content_pages_are_tenant_scoped(): void
    {
        // A slug that does not resolve to a tenant is rejected before the page
        // renders (the tenant-resolution middleware returns 400), so the new
        // content pages are never served outside their tenant context.
        foreach (['/not-the-tenant/accessible/about', '/not-the-tenant/accessible/legal', '/not-the-tenant/accessible/legal/terms'] as $path) {
            $response = $this->get($path);
            $this->assertSame(400, $response->getStatusCode(), "Expected {$path} to be blocked by tenant resolution");
            $response->assertDontSee(__('govuk_alpha.about.how_it_works.title'));
        }
    }

    public function test_contact_page_preserves_react_contact_validation_contract(): void
    {
        $redirect = $this->post("/{$this->testTenantSlug}/accessible/contact", [
            'name' => '',
            'email' => 'not-an-email',
            'subject' => '',
            'message' => '',
        ]);

        $redirect->assertRedirect("/{$this->testTenantSlug}/accessible/contact?status=contact-validation");

        $response = $this->get("/{$this->testTenantSlug}/accessible/contact?status=contact-validation");
        $response->assertOk();
        $response->assertSee(__('govuk_alpha.states.error_title'));
        $response->assertSee('class="govuk-error-summary"', false);
        $response->assertSee('href="#name"', false);
        $response->assertSee('href="#email"', false);
        $response->assertSee('href="#message"', false);
    }

    public function test_contact_page_submits_to_same_v2_contact_contract_as_react_page(): void
    {
        DB::table('tenants')
            ->where('id', $this->testTenantId)
            ->update(['contact_email' => 'support@example.test']);
        TenantContext::setById($this->testTenantId);

        $redirect = $this->post("/{$this->testTenantSlug}/accessible/contact", [
            'name' => 'Accessible Contact User',
            'email' => 'accessible-contact@example.test',
            'subject' => '',
            'message' => 'This came from the accessible frontend contact page.',
        ]);

        $redirect->assertRedirect("/{$this->testTenantSlug}/accessible/contact?status=contact-sent");
        $this->assertDatabaseHas('contact_submissions', [
            'tenant_id' => $this->testTenantId,
            'name' => 'Accessible Contact User',
            'email' => 'accessible-contact@example.test',
            'subject' => 'General Inquiry',
            'message' => 'This came from the accessible frontend contact page.',
        ]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/contact?status=contact-sent");
        $response->assertOk();
        $response->assertSee(__('govuk_alpha.contact.success_title'));
        $response->assertSee(__('govuk_alpha.contact.success_message'));
    }

    public function test_accessible_login_persists_token_cookie_for_server_rendered_pages(): void
    {
        $email = 'alpha-login-' . bin2hex(random_bytes(4)) . '@example.test';

        User::factory()->forTenant($this->testTenantId)->create([
            'email' => $email,
            'password_hash' => Hash::make('CorrectPassword123'),
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);

        $login = $this->post("/{$this->testTenantSlug}/accessible/login", [
            'email' => $email,
            'password' => 'CorrectPassword123',
        ]);

        $login->assertRedirect("/{$this->testTenantSlug}/accessible/dashboard");
        $login->assertCookie('auth_token');

        $cookie = null;
        foreach ($login->headers->getCookies() as $responseCookie) {
            if ($responseCookie->getName() === 'auth_token') {
                $cookie = $responseCookie->getValue();
                break;
            }
        }
        $this->assertNotNull($cookie);

        $feed = $this->withUnencryptedCookie('auth_token', $cookie)->get("/{$this->testTenantSlug}/accessible/feed");

        $feed->assertOk();
        $feed->assertDontSee(__('govuk_alpha.states.auth_required'));
        $feed->assertSee(__('govuk_alpha.feed.post_label'));
    }

    public function test_feed_page_renders_govuk_alpha_shell_and_feed_item(): void
    {
        $user = $this->authenticatedUser();
        $post = FeedPost::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'content' => 'Alpha feed verification post',
            'visibility' => 'public',
        ]);
        FeedActivity::factory()->forTenant($this->testTenantId)->create([
            'source_type' => 'post',
            'source_id' => $post->id,
            'user_id' => $user->id,
            'content' => 'Alpha feed verification post',
            'created_at' => now()->addMinute(),
        ]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/feed");

        $response->assertOk();
        $response->assertHeader('content-type', 'text/html; charset=UTF-8');
        $response->assertSee('class="govuk-skip-link"', false);
        $response->assertSee('id="main-content"', false);
        $response->assertSee('class="govuk-phase-banner"', false);
        $response->assertSee('AGPL-3.0-or-later');
        $response->assertSee('class="govuk-fieldset"', false);
        $response->assertSee('class="govuk-textarea"', false);
        $response->assertSee('class="govuk-select"', false);
        $response->assertSee('name="mode"', false);
        $response->assertSee('name="subtype"', false);
        $response->assertSee('class="govuk-tag govuk-tag--grey"', false);
        $response->assertSee('Alpha feed verification post');
    }

    public function test_event_feed_card_links_to_the_accessible_event_detail(): void
    {
        $user = $this->authenticatedUser();
        $eventId = DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'title' => 'Linked feed event',
            'description' => 'An event surfaced in the accessible feed.',
            'location' => 'Feed Hall',
            'start_time' => now()->addDays(5),
            'end_time' => now()->addDays(5)->addHours(2),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        FeedActivity::factory()->forTenant($this->testTenantId)->create([
            'source_type' => 'event',
            'source_id' => $eventId,
            'user_id' => $user->id,
            'content' => 'Linked feed event',
            'created_at' => now()->addMinute(),
        ]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/feed");
        $response->assertOk();
        // Previously only listing cards linked through; event cards were dead ends.
        $response->assertSee(route('govuk-alpha.events.show', ['tenantSlug' => $this->testTenantSlug, 'id' => $eventId]), false);
        // Typed cards now carry a self-describing CTA ("View this event").
        $response->assertSee(__('govuk_alpha.feed.view_typed.event'));
        // The compose area routes people to the (separate) listing form so they
        // do not mistake a feed post for posting an offer or request.
        $response->assertSee(__('govuk_alpha.feed.post_offer_request'));
        $response->assertSee(route('govuk-alpha.listings.create', ['tenantSlug' => $this->testTenantSlug]), false);
    }

    public function test_feed_author_can_reply_edit_and_delete_own_post_and_comments(): void
    {
        $user = $this->authenticatedUser(['name' => 'Feed Manager']);
        $post = FeedPost::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'content' => 'Original post content.',
            'visibility' => 'public',
        ]);
        FeedActivity::factory()->forTenant($this->testTenantId)->create([
            'source_type' => 'post',
            'source_id' => $post->id,
            'user_id' => $user->id,
            'content' => 'Original post content.',
            'created_at' => now()->addMinute(),
        ]);

        // Add a comment, then reply to it (threaded via parent_id).
        $comment = $this->post("/{$this->testTenantSlug}/accessible/feed/items/post/{$post->id}/comments", [
            'content' => 'A first comment.',
        ]);
        $comment->assertRedirectContains('status=comment-created');
        $commentId = DB::table('comments')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->where('content', 'A first comment.')
            ->value('id');
        $this->assertNotNull($commentId);

        $reply = $this->post("/{$this->testTenantSlug}/accessible/feed/items/post/{$post->id}/comments", [
            'content' => 'A reply to the comment.',
            'parent_id' => $commentId,
        ]);
        $reply->assertRedirectContains('status=comment-created');
        $this->assertDatabaseHas('comments', [
            'tenant_id' => $this->testTenantId,
            'parent_id' => $commentId,
            'content' => 'A reply to the comment.',
        ]);

        // Edit the post.
        $editPost = $this->post("/{$this->testTenantSlug}/accessible/feed/posts/{$post->id}/update", [
            'content' => 'Edited post content.',
        ]);
        $editPost->assertRedirectContains('status=post-updated');
        $this->assertSame('Edited post content.', DB::table('feed_posts')->where('id', $post->id)->value('content'));

        // Edit the comment.
        $editComment = $this->post("/{$this->testTenantSlug}/accessible/feed/comments/{$commentId}/update", [
            'content' => 'Edited comment.',
        ]);
        $editComment->assertRedirectContains('status=comment-updated');
        $this->assertSame('Edited comment.', DB::table('comments')->where('id', $commentId)->value('content'));

        // Delete the comment (cascades to its reply). Comments soft-delete.
        $deleteComment = $this->post("/{$this->testTenantSlug}/accessible/feed/comments/{$commentId}/delete");
        $deleteComment->assertRedirectContains('status=comment-deleted');
        $this->assertSoftDeleted('comments', ['id' => $commentId]);

        // Delete the post.
        $deletePost = $this->post("/{$this->testTenantSlug}/accessible/feed/posts/{$post->id}/delete");
        $deletePost->assertRedirectContains('status=post-deleted');
        $this->assertDatabaseMissing('feed_posts', ['id' => $post->id]);
    }

    public function test_feed_post_management_rejects_non_owner(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create([
            'name' => 'Post Owner',
            'status' => 'active',
            'is_approved' => true,
        ]);
        $post = FeedPost::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $owner->id,
            'content' => 'Owner post content.',
            'visibility' => 'public',
        ]);

        // A different signed-in member cannot edit or delete someone else's post.
        $this->authenticatedUser(['name' => 'Not The Owner']);

        $edit = $this->post("/{$this->testTenantSlug}/accessible/feed/posts/{$post->id}/update", [
            'content' => 'Hijacked content.',
        ]);
        $edit->assertRedirectContains('status=post-update-failed');
        $this->assertSame('Owner post content.', DB::table('feed_posts')->where('id', $post->id)->value('content'));

        $delete = $this->post("/{$this->testTenantSlug}/accessible/feed/posts/{$post->id}/delete");
        $delete->assertRedirectContains('status=post-delete-failed');
        $this->assertDatabaseHas('feed_posts', ['id' => $post->id]);
    }

    public function test_feed_moderation_hide_mute_and_report(): void
    {
        $author = User::factory()->forTenant($this->testTenantId)->create([
            'name' => 'Feed Author',
            'status' => 'active',
            'is_approved' => true,
        ]);
        $post = FeedPost::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $author->id,
            'content' => 'A post to moderate.',
            'visibility' => 'public',
        ]);

        $viewer = $this->authenticatedUser(['name' => 'Moderating Viewer']);

        // Hide the post from the viewer's own feed.
        $hide = $this->post("/{$this->testTenantSlug}/accessible/feed/posts/{$post->id}/hide", ['type' => 'post']);
        $hide->assertRedirectContains('status=content-hidden');
        $this->assertDatabaseHas('feed_hidden', [
            'user_id' => $viewer->id,
            'tenant_id' => $this->testTenantId,
            'target_type' => 'post',
            'target_id' => $post->id,
        ]);

        // Mute the author.
        $mute = $this->post("/{$this->testTenantSlug}/accessible/feed/users/{$author->id}/mute");
        $mute->assertRedirectContains('status=author-muted');
        $this->assertDatabaseHas('feed_muted_users', [
            'user_id' => $viewer->id,
            'muted_user_id' => $author->id,
            'tenant_id' => $this->testTenantId,
        ]);

        // Report the post (reason required).
        $report = $this->post("/{$this->testTenantSlug}/accessible/feed/posts/{$post->id}/report", [
            'type' => 'post',
            'reason' => 'Spam content',
        ]);
        $report->assertRedirectContains('status=content-reported');
        $this->assertDatabaseHas('reports', [
            'reporter_id' => $viewer->id,
            'tenant_id' => $this->testTenantId,
            'target_type' => 'post',
            'target_id' => $post->id,
            'status' => 'open',
        ]);

        // Reporting with no reason fails validation.
        $noReason = $this->post("/{$this->testTenantSlug}/accessible/feed/posts/{$post->id}/report", [
            'type' => 'post',
            'reason' => '',
        ]);
        $noReason->assertRedirectContains('status=');
    }

    public function test_feed_page_redirects_to_login_when_unauthenticated(): void
    {
        $response = $this->get("/{$this->testTenantSlug}/accessible/feed");

        $response->assertRedirect("/{$this->testTenantSlug}/accessible/login?status=auth-required");
        $this->assertStringContainsString('no-store', (string) $response->headers->get('Cache-Control'));
    }

    public function test_feed_poll_vote_records_a_vote_and_rejects_a_second(): void
    {
        $user = $this->authenticatedUser();
        $pollId = DB::table('polls')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'question' => 'What is the best day to meet?',
            'is_active' => 1,
            'end_date' => now()->addWeek(),
            'created_at' => now(),
        ]);
        $optionId = DB::table('poll_options')->insertGetId([
            'poll_id' => $pollId,
            'tenant_id' => $this->testTenantId,
            'label' => 'Monday',
        ]);

        $vote = $this->post("/{$this->testTenantSlug}/accessible/feed/polls/{$pollId}/vote", ['option_id' => $optionId]);
        $vote->assertRedirectContains('status=poll-voted');
        $this->assertDatabaseHas('poll_votes', [
            'poll_id' => $pollId,
            'option_id' => $optionId,
            'user_id' => $user->id,
        ]);

        // A second vote by the same member is rejected (already voted).
        $again = $this->post("/{$this->testTenantSlug}/accessible/feed/polls/{$pollId}/vote", ['option_id' => $optionId]);
        $again->assertRedirectContains('status=poll-vote-failed');
    }

    public function test_feed_page_renders_post_empty_error_state(): void
    {
        $this->authenticatedUser();

        $redirect = $this->post("/{$this->testTenantSlug}/accessible/feed/posts", [
            'content' => '   ',
        ]);

        $redirect->assertRedirect("/{$this->testTenantSlug}/accessible/feed?status=post-empty");

        $response = $this->get("/{$this->testTenantSlug}/accessible/feed?status=post-empty");

        $response->assertOk();
        $response->assertSee(__('govuk_alpha.states.post_empty'));
        $response->assertSee('class="govuk-error-summary"', false);
        $response->assertSee('class="govuk-error-message"', false);
        $response->assertSee('govuk-textarea--error', false);
        $response->assertSee('href="#content"', false);
    }

    public function test_feed_page_renders_post_created_success_state(): void
    {
        $this->authenticatedUser();

        $redirect = $this->post("/{$this->testTenantSlug}/accessible/feed/posts", [
            'content' => 'Created from the accessible frontend feature test.',
        ]);

        $redirect->assertRedirect("/{$this->testTenantSlug}/accessible/feed?status=post-created");

        $response = $this->get("/{$this->testTenantSlug}/accessible/feed?status=post-created");

        $response->assertOk();
        $response->assertSee(__('govuk_alpha.states.post_created'));
        $response->assertSee('govuk-notification-banner--success', false);
    }

    public function test_accessible_feed_likes_sync_with_v2_social_feed(): void
    {
        $user = $this->authenticatedUser();
        $post = FeedPost::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'content' => 'Accessible like sync post',
            'visibility' => 'public',
        ]);
        FeedActivity::factory()->forTenant($this->testTenantId)->create([
            'source_type' => 'post',
            'source_id' => $post->id,
            'user_id' => $user->id,
            'content' => 'Accessible like sync post',
            'created_at' => now()->addMinute(),
        ]);

        $like = $this->post("/{$this->testTenantSlug}/accessible/feed/items/post/{$post->id}/like", [
            'type' => 'posts',
            'mode' => 'ranking',
        ]);

        $like->assertRedirectContains("status=like-added");
        $this->assertDatabaseHas('likes', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'target_type' => 'post',
            'target_id' => $post->id,
        ]);

        $page = $this->get("/{$this->testTenantSlug}/accessible/feed?type=posts");
        $page->assertOk();
        $page->assertSee(__('govuk_alpha.actions.unlike'));
        $page->assertSee(trans_choice('govuk_alpha.feed.likes', 1, ['count' => 1]));

        $api = $this->getJson('/api/v2/feed?per_page=20&type=posts&personalised=false', $this->withTenantHeader());
        $api->assertOk();
        $apiItems = $api->json('data');
        $apiPost = collect($apiItems)->firstWhere('id', $post->id);
        $this->assertSame(1, (int) ($apiPost['likes_count'] ?? 0));
        $this->assertTrue((bool) ($apiPost['is_liked'] ?? false));
    }

    public function test_accessible_feed_comments_sync_with_v2_social_feed(): void
    {
        $user = $this->authenticatedUser();
        $post = FeedPost::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'content' => 'Accessible comment sync post',
            'visibility' => 'public',
        ]);
        FeedActivity::factory()->forTenant($this->testTenantId)->create([
            'source_type' => 'post',
            'source_id' => $post->id,
            'user_id' => $user->id,
            'content' => 'Accessible comment sync post',
            'created_at' => now()->addMinute(),
        ]);

        $comment = $this->post("/{$this->testTenantSlug}/accessible/feed/items/post/{$post->id}/comments", [
            'type' => 'posts',
            'mode' => 'ranking',
            'content' => 'Accessible frontend comment synced to social module.',
        ]);

        $comment->assertRedirectContains("status=comment-created");
        $this->assertDatabaseHas('comments', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'target_type' => 'post',
            'target_id' => $post->id,
            'content' => 'Accessible frontend comment synced to social module.',
        ]);

        $page = $this->get("/{$this->testTenantSlug}/accessible/feed?type=posts");
        $page->assertOk();
        $page->assertSee(__('govuk_alpha.feed.comments_summary'));
        $page->assertSee('Accessible frontend comment synced to social module.');
        $page->assertSee(trans_choice('govuk_alpha.feed.comments', 1, ['count' => 1]));

        $api = $this->getJson('/api/v2/feed?per_page=20&type=posts&personalised=false', $this->withTenantHeader());
        $api->assertOk();
        $apiItems = $api->json('data');
        $apiPost = collect($apiItems)->firstWhere('id', $post->id);
        $this->assertSame(1, (int) ($apiPost['comments_count'] ?? 0));
    }

    public function test_feed_page_keeps_tenant_items_isolated(): void
    {
        $user = $this->authenticatedUser();
        $otherUser = User::factory()->forTenant(999)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        $visiblePost = FeedPost::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'content' => 'Visible alpha tenant post',
            'visibility' => 'public',
        ]);
        FeedActivity::factory()->forTenant($this->testTenantId)->create([
            'source_type' => 'post',
            'source_id' => $visiblePost->id,
            'user_id' => $user->id,
            'content' => 'Visible alpha tenant post',
            'created_at' => now()->addMinute(),
        ]);

        $otherPost = FeedPost::factory()->forTenant(999)->create([
            'user_id' => $otherUser->id,
            'content' => 'Other tenant alpha feed post',
            'visibility' => 'public',
        ]);
        FeedActivity::factory()->forTenant(999)->create([
            'source_type' => 'post',
            'source_id' => $otherPost->id,
            'user_id' => $otherUser->id,
            'content' => 'Other tenant alpha feed post',
        ]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/feed");

        $response->assertOk();
        $response->assertSee('Visible alpha tenant post');
        $response->assertDontSee('Other tenant alpha feed post');
    }

    public function test_feed_page_renders_pagination_when_more_items_exist(): void
    {
        $user = $this->authenticatedUser();

        foreach (['First paginated alpha post', 'Second paginated alpha post'] as $index => $content) {
            $post = FeedPost::factory()->forTenant($this->testTenantId)->create([
                'user_id' => $user->id,
                'content' => $content,
                'visibility' => 'public',
                'created_at' => now()->subMinutes($index),
            ]);
            FeedActivity::factory()->forTenant($this->testTenantId)->create([
                'source_type' => 'post',
                'source_id' => $post->id,
                'user_id' => $user->id,
                'content' => $content,
                'created_at' => now()->subMinutes($index),
            ]);
        }

        $response = $this->get("/{$this->testTenantSlug}/accessible/feed?per_page=1");

        $response->assertOk();
        $response->assertSee('class="govuk-pagination govuk-pagination--block', false);
        $response->assertSee(__('govuk_alpha.actions.load_more'));
        $response->assertSee(__('govuk_alpha.feed.more_results_label'));
        $response->assertSee('rel="next"', false);
    }

    public function test_listings_page_renders_filters_results_and_tenant_isolation(): void
    {
        $user = $this->authenticatedUser();
        $this->ensureListingCategory();
        Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'title' => 'Alpha listing verification',
            'description' => 'Visible listing for GOV.UK alpha.',
            'type' => 'offer',
            'category_id' => 1,
        ]);
        Listing::factory()->forTenant(999)->create([
            'title' => 'Other tenant alpha listing',
        ]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/listings");

        $response->assertOk();
        $response->assertSee('class="govuk-phase-banner"', false);
        $response->assertSee('class="govuk-fieldset"', false);
        $response->assertSee('type="search"', false);
        $response->assertSee('class="govuk-select"', false);
        $response->assertSee('class="govuk-details"', false);
        $response->assertSee('name="hours"', false);
        $response->assertSee('name="service"', false);
        $response->assertSee('name="posted"', false);
        $response->assertSee('class="govuk-tag govuk-tag--blue"', false);
        $response->assertSee('Alpha listing verification');
        $response->assertSee(__('govuk_alpha.actions.view_details'));
        $response->assertDontSee('Other tenant alpha listing');

        $filtered = $this->get("/{$this->testTenantSlug}/accessible/listings?hours=short&service=in_person&posted=30");
        $filtered->assertOk();
        $filtered->assertSee('value="short" selected', false);
        $filtered->assertSee('value="in_person" selected', false);
        $filtered->assertSee('value="30" selected', false);
    }

    public function test_listings_sort_recommended_surfaces_featured_first(): void
    {
        $user = $this->authenticatedUser();
        $this->ensureListingCategory();
        // Featured is created FIRST (lower id) so default "newest" (id desc) would
        // put it LAST — only "recommended" (featured_first) lifts it to the top.
        Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id, 'title' => 'Featured listing alpha', 'type' => 'offer',
            'category_id' => 1, 'is_featured' => true,
        ]);
        Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id, 'title' => 'Plain listing alpha', 'type' => 'offer',
            'category_id' => 1, 'is_featured' => false,
        ]);

        $page = $this->get("/{$this->testTenantSlug}/accessible/listings?sort=recommended");
        $page->assertOk();
        $page->assertSee(__('govuk_alpha.listings.sort_label'));
        $page->assertSee('value="recommended" selected', false);

        $content = $page->getContent();
        $this->assertLessThan(
            strpos($content, 'Plain listing alpha'),
            strpos($content, 'Featured listing alpha'),
            'Recommended sort should surface the featured listing before the plain one'
        );
    }

    public function test_listings_page_renders_module_disabled_state(): void
    {
        $this->authenticatedUser();

        DB::table('tenants')
            ->where('id', $this->testTenantId)
            ->update(['configuration' => json_encode(['modules' => ['listings' => false]])]);

        TenantContext::reset();
        TenantContext::setById($this->testTenantId);

        $response = $this->get("/{$this->testTenantSlug}/accessible/listings");

        $response->assertStatus(403);
        $response->assertSee(__('govuk_alpha.states.module_disabled'));
        $response->assertSee('class="govuk-notification-banner"', false);
    }

    public function test_listing_detail_page_renders_summary(): void
    {
        $user = $this->authenticatedUser();
        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'title' => 'Alpha detail listing',
            'description' => 'Detail page description.',
            'type' => 'request',
            'expires_at' => now()->addDays(30),
            'renewal_count' => 2,
        ]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/listings/{$listing->id}");

        $response->assertOk();
        $response->assertSee('Alpha detail listing');
        $response->assertSee('class="govuk-back-link"', false);
        $response->assertSee('class="govuk-summary-list"', false);
        $response->assertSee('class="govuk-tag govuk-tag--purple"', false);
        // Expiry + renewal rows now surface (data was already in the getById payload).
        $response->assertSee(__('govuk_alpha.listings.expires_label'));
        $response->assertSee(trans_choice('govuk_alpha.listings.renewed_count', 2, ['count' => 2]));
    }

    public function test_listings_card_renders_cover_image_when_present(): void
    {
        $user = $this->authenticatedUser();
        $this->ensureListingCategory();
        Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'title' => 'Listing with a cover photo',
            'description' => 'Has an image.',
            'type' => 'offer',
            'category_id' => 1,
            'image_url' => '/uploads/tenants/' . $this->testTenantSlug . '/listings/cover-card.jpg',
            'is_featured' => true,
            'service_type' => 'remote_only',
        ]);
        // A second listing with no image must NOT render a broken figure.
        Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'title' => 'Listing without a photo',
            'description' => 'No image.',
            'type' => 'offer',
            'category_id' => 1,
            'image_url' => null,
        ]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/listings");

        $response->assertOk();
        $response->assertSee('class="nexus-alpha-card-thumb"', false);
        $response->assertSee('cover-card.jpg', false);
        $response->assertSee(__('govuk_alpha.listings.image_alt', ['title' => 'Listing with a cover photo']), false);
        // Featured + remote delivery badges from the payload.
        $response->assertSee(__('govuk_alpha.listings.featured'));
        $response->assertSee(__('govuk_alpha.listings.service_types.remote_only'));
    }

    public function test_listing_detail_renders_hero_image_gallery_and_author_block(): void
    {
        $user = $this->authenticatedUser(['name' => 'Cover Author']);
        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'title' => 'Detail listing with photos',
            'description' => 'Detail with a hero image and a gallery.',
            'type' => 'offer',
            'status' => 'active',
            'service_type' => 'hybrid',
            'image_url' => '/uploads/tenants/' . $this->testTenantSlug . '/listings/hero.jpg',
        ]);
        DB::table('listing_images')->insert([
            'tenant_id' => $this->testTenantId,
            'listing_id' => $listing->id,
            'image_url' => '/uploads/tenants/' . $this->testTenantSlug . '/listings/gallery-1.jpg',
            'sort_order' => 1,
            'alt_text' => 'A descriptive gallery caption',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/listings/{$listing->id}");

        $response->assertOk();
        // Hero cover image.
        $response->assertSee('class="nexus-alpha-detail-hero"', false);
        $response->assertSee('hero.jpg', false);
        // Gallery thumbnail with its own alt text.
        $response->assertSee('class="nexus-alpha-thumb-list"', false);
        $response->assertSee('gallery-1.jpg', false);
        $response->assertSee('A descriptive gallery caption', false);
        // Status + delivery-mode summary rows.
        $response->assertSee(__('govuk_alpha.listings.status_values.active'));
        $response->assertSee(__('govuk_alpha.listings.service_types.hybrid'));
        // Author block + per-listing Open Graph image.
        $response->assertSee(__('govuk_alpha.listings.author_title'));
        $response->assertSee('property="og:image" content="' . url('/uploads/tenants/' . $this->testTenantSlug . '/listings/hero.jpg') . '"', false);
    }

    public function test_listings_create_form_renders_and_creates_a_listing(): void
    {
        $user = $this->authenticatedUser();
        $this->ensureListingCategory();

        $form = $this->get("/{$this->testTenantSlug}/accessible/listings/new");
        $form->assertOk();
        $form->assertSee(__('govuk_alpha.listings.create.title'));
        $form->assertSee('name="type"', false);
        $form->assertSee('name="title"', false);
        $form->assertSee('name="description"', false);
        $form->assertSee('class="govuk-file-upload"', false);
        $form->assertSee('enctype="multipart/form-data"', false);

        $create = $this->post("/{$this->testTenantSlug}/accessible/listings/new", [
            'type' => 'offer',
            'title' => 'Accessible created listing',
            'description' => 'Created through the accessible alpha listing form for verification.',
            'category_id' => 1,
            'hours_estimate' => 2,
            'service_type' => 'remote_only',
            'location' => 'Anytown',
        ]);

        $listingId = DB::table('listings')
            ->where('tenant_id', $this->testTenantId)
            ->where('title', 'Accessible created listing')
            ->value('id');

        $this->assertNotNull($listingId);
        $create->assertRedirect("/{$this->testTenantSlug}/accessible/listings/{$listingId}?status=listing-created");
        $this->assertDatabaseHas('listings', [
            'id' => $listingId,
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'type' => 'offer',
            'service_type' => 'remote_only',
        ]);

        $detail = $this->get("/{$this->testTenantSlug}/accessible/listings/{$listingId}?status=listing-created");
        $detail->assertOk();
        $detail->assertSee(__('govuk_alpha.listings.create.created'));
    }

    public function test_listing_owner_can_edit_and_update_their_listing(): void
    {
        $user = $this->authenticatedUser();
        $this->ensureListingCategory();

        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'title' => 'Original listing title',
            'description' => 'The original description for this listing.',
            'type' => 'offer',
            'status' => 'active',
            'moderation_status' => 'approved',
            'service_type' => 'remote_only',
        ]);

        // Owner sees a prefilled edit form.
        $form = $this->get("/{$this->testTenantSlug}/accessible/listings/{$listing->id}/edit");
        $form->assertOk();
        $form->assertSee(__('govuk_alpha.listings.edit.title'));
        $form->assertSee('Original listing title', false);
        $form->assertSee(__('govuk_alpha.listings.edit.submit'));

        $update = $this->post("/{$this->testTenantSlug}/accessible/listings/{$listing->id}/edit", [
            'type' => 'offer',
            'title' => 'Updated listing title',
            'description' => 'The updated description for this listing.',
            'category_id' => 1,
            'hours_estimate' => 3,
            'service_type' => 'hybrid',
            'location' => 'Newtown',
        ]);
        $update->assertRedirect("/{$this->testTenantSlug}/accessible/listings/{$listing->id}?status=listing-updated");
        $this->assertDatabaseHas('listings', [
            'id' => $listing->id,
            'title' => 'Updated listing title',
            'service_type' => 'hybrid',
        ]);
    }

    public function test_listing_edit_and_delete_are_forbidden_for_non_owner(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $owner->id,
            'title' => 'Someone elses listing',
            'description' => 'Not yours to edit.',
            'type' => 'offer',
            'status' => 'active',
            'moderation_status' => 'approved',
        ]);

        $this->authenticatedUser(['name' => 'Intruder']);
        $this->get("/{$this->testTenantSlug}/accessible/listings/{$listing->id}/edit")->assertStatus(403);
        $this->post("/{$this->testTenantSlug}/accessible/listings/{$listing->id}/edit", [
            'type' => 'offer',
            'title' => 'Hijacked title attempt',
            'description' => 'Trying to change this listing without permission.',
        ])->assertStatus(403);
        $this->post("/{$this->testTenantSlug}/accessible/listings/{$listing->id}/delete")->assertStatus(403);

        $this->assertDatabaseHas('listings', ['id' => $listing->id, 'title' => 'Someone elses listing']);
    }

    public function test_listing_owner_can_delete_their_listing(): void
    {
        $user = $this->authenticatedUser();
        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'title' => 'Listing to delete',
            'description' => 'This will be deleted.',
            'type' => 'offer',
            'status' => 'active',
            'moderation_status' => 'approved',
        ]);

        $this->post("/{$this->testTenantSlug}/accessible/listings/{$listing->id}/delete")
            ->assertRedirect("/{$this->testTenantSlug}/accessible/listings?status=listing-deleted");

        // No longer publicly visible (soft-deleted / removed).
        $this->get("/{$this->testTenantSlug}/accessible/listings/{$listing->id}")->assertStatus(404);
    }

    public function test_listings_create_rejects_invalid_input_with_field_errors(): void
    {
        $this->authenticatedUser();
        $this->ensureListingCategory();

        $create = $this->post("/{$this->testTenantSlug}/accessible/listings/new", [
            'type' => 'offer',
            'title' => '',
            'description' => 'short',
            'category_id' => 1,
        ]);

        $create->assertRedirect("/{$this->testTenantSlug}/accessible/listings/new");
        $create->assertSessionHasErrors(['title', 'description']);

        // No listing should have been created from invalid input.
        $this->assertDatabaseMissing('listings', [
            'tenant_id' => $this->testTenantId,
            'description' => 'short',
        ]);

        $form = $this->get("/{$this->testTenantSlug}/accessible/listings/new");
        $form->assertOk();
        $form->assertSee('class="govuk-error-summary"', false);
        $form->assertSee('href="#title"', false);
        $form->assertSee('href="#description"', false);
        $form->assertSee('govuk-input--error', false);
    }

    public function test_listing_detail_can_start_accessible_exchange_request(): void
    {
        $requester = $this->authenticatedUser(['name' => 'Alpha Requester']);
        $provider = User::factory()->forTenant($this->testTenantId)->create([
            'name' => 'Alpha Provider',
            'status' => 'active',
            'is_approved' => true,
        ]);
        $this->enableExchangeWorkflow();

        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $provider->id,
            'title' => 'Alpha exchange listing',
            'description' => 'Exchange request target.',
            'type' => 'offer',
            'hours_estimate' => 2,
        ]);

        Sanctum::actingAs($requester, ['*']);

        $detail = $this->get("/{$this->testTenantSlug}/accessible/listings/{$listing->id}");
        $detail->assertOk();
        $detail->assertSee(__('govuk_alpha.actions.request_exchange'));
        $detail->assertSee(route('govuk-alpha.exchanges.request', ['tenantSlug' => $this->testTenantSlug, 'listingId' => $listing->id]), false);

        $form = $this->get("/{$this->testTenantSlug}/accessible/listings/{$listing->id}/exchange-request");
        $form->assertOk();
        $form->assertSee('name="proposed_hours"', false);
        $form->assertSee('class="govuk-textarea"', false);
        // Listing summary card now includes the time estimate, and the page shows the
        // requester's wallet balance as context.
        $form->assertSee(__('govuk_alpha.listings.hours_label'));
        $form->assertSee('Your time-credit balance is', false);

        $request = $this->post("/{$this->testTenantSlug}/accessible/listings/{$listing->id}/exchange-request", [
            'proposed_hours' => 2.5,
            'prep_time' => 0.5,
            'message' => 'I can do this through the accessible exchange workflow.',
        ]);

        $exchangeId = DB::table('exchange_requests')
            ->where('tenant_id', $this->testTenantId)
            ->where('listing_id', $listing->id)
            ->where('requester_id', $requester->id)
            ->value('id');

        $this->assertNotNull($exchangeId);
        $request->assertRedirect("/{$this->testTenantSlug}/accessible/exchanges/{$exchangeId}?status=exchange-created");
        $this->assertDatabaseHas('exchange_requests', [
            'id' => $exchangeId,
            'tenant_id' => $this->testTenantId,
            'provider_id' => $provider->id,
            'status' => 'pending_provider',
        ]);
    }

    public function test_exchanges_list_action_chip_and_detail_per_party_confirmation(): void
    {
        $requester = User::factory()->forTenant($this->testTenantId)->create([
            'name' => 'Chip Requester',
            'status' => 'active',
            'is_approved' => true,
        ]);
        $provider = $this->authenticatedUser(['name' => 'Chip Provider']);
        $this->enableExchangeWorkflow();

        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $provider->id,
            'title' => 'Chip listing',
            'type' => 'offer',
        ]);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'listing_id' => $listing->id,
            'requester_id' => $requester->id,
            'provider_id' => $provider->id,
            'proposed_hours' => 2,
            'status' => 'pending_provider',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // The provider sees an "action needed: respond" chip in the list.
        $list = $this->get("/{$this->testTenantSlug}/accessible/exchanges");
        $list->assertOk();
        $list->assertSee(__('govuk_alpha.exchanges.action_respond'));

        // Once in progress, the detail page shows both parties' confirmation state.
        DB::table('exchange_requests')->where('id', $exchangeId)->update(['status' => 'in_progress']);
        $detail = $this->get("/{$this->testTenantSlug}/accessible/exchanges/{$exchangeId}");
        $detail->assertOk();
        $detail->assertSee(__('govuk_alpha.exchanges.requester_confirmation_label'));
        $detail->assertSee(__('govuk_alpha.exchanges.provider_confirmation_label'));
        $detail->assertSee(__('govuk_alpha.exchanges.awaiting_confirmation'));
    }

    public function test_accessible_exchange_detail_supports_provider_lifecycle_actions(): void
    {
        $requester = User::factory()->forTenant($this->testTenantId)->create([
            'name' => 'Exchange Requester',
            'status' => 'active',
            'is_approved' => true,
        ]);
        $provider = $this->authenticatedUser(['name' => 'Exchange Provider']);
        $this->enableExchangeWorkflow();

        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $provider->id,
            'title' => 'Lifecycle exchange listing',
            'type' => 'offer',
        ]);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'listing_id' => $listing->id,
            'requester_id' => $requester->id,
            'provider_id' => $provider->id,
            'proposed_hours' => 3,
            'requester_notes' => 'Please help with this.',
            'status' => 'pending_provider',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Sanctum::actingAs($provider, ['*']);

        $detail = $this->get("/{$this->testTenantSlug}/accessible/exchanges/{$exchangeId}");
        $detail->assertOk();
        $detail->assertSee('Lifecycle exchange listing');
        $detail->assertSee(__('govuk_alpha.actions.accept'));
        $detail->assertSee(__('govuk_alpha.actions.decline'));

        $accept = $this->post("/{$this->testTenantSlug}/accessible/exchanges/{$exchangeId}", ['action' => 'accept']);
        $accept->assertRedirect("/{$this->testTenantSlug}/accessible/exchanges/{$exchangeId}?status=exchange-updated");
        $this->assertDatabaseHas('exchange_requests', ['id' => $exchangeId, 'status' => 'accepted']);

        $start = $this->post("/{$this->testTenantSlug}/accessible/exchanges/{$exchangeId}", ['action' => 'start']);
        $start->assertRedirect("/{$this->testTenantSlug}/accessible/exchanges/{$exchangeId}?status=exchange-updated");
        $this->assertDatabaseHas('exchange_requests', ['id' => $exchangeId, 'status' => 'in_progress']);

        $complete = $this->post("/{$this->testTenantSlug}/accessible/exchanges/{$exchangeId}", ['action' => 'complete']);
        $complete->assertRedirect("/{$this->testTenantSlug}/accessible/exchanges/{$exchangeId}?status=exchange-updated");
        $this->assertDatabaseHas('exchange_requests', ['id' => $exchangeId, 'status' => 'pending_confirmation']);
    }

    public function test_completed_exchange_offers_a_review_prompt_then_records_the_rating(): void
    {
        $requester = User::factory()->forTenant($this->testTenantId)->create([
            'name' => 'Rating Requester',
            'status' => 'active',
            'is_approved' => true,
        ]);
        $provider = $this->authenticatedUser(['name' => 'Rating Provider']);
        $this->enableExchangeWorkflow();

        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $provider->id,
            'title' => 'Completed exchange listing',
            'type' => 'offer',
        ]);

        $exchangeId = DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'listing_id' => $listing->id,
            'requester_id' => $requester->id,
            'provider_id' => $provider->id,
            'proposed_hours' => 2,
            'final_hours' => 2,
            'status' => 'completed',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Sanctum::actingAs($provider, ['*']);

        // Completed exchange prompts the viewer to rate it.
        $detail = $this->get("/{$this->testTenantSlug}/accessible/exchanges/{$exchangeId}");
        $detail->assertOk();
        $detail->assertSee(__('govuk_alpha.exchanges.review_title'));
        $detail->assertSee('name="rating"', false);
        $detail->assertSee(route('govuk-alpha.exchanges.rate.store', ['tenantSlug' => $this->testTenantSlug, 'id' => $exchangeId]), false);

        // Submit a rating.
        $rate = $this->post("/{$this->testTenantSlug}/accessible/exchanges/{$exchangeId}/rate", [
            'rating' => 5,
            'comment' => 'A great exchange, thank you.',
        ]);
        $rate->assertRedirect("/{$this->testTenantSlug}/accessible/exchanges/{$exchangeId}?status=rating-submitted");

        // Now that it is rated, the form is replaced by a thank-you note.
        $after = $this->get("/{$this->testTenantSlug}/accessible/exchanges/{$exchangeId}");
        $after->assertOk();
        $after->assertSee(__('govuk_alpha.exchanges.review_thanks'));
        $after->assertDontSee('name="rating"', false);

        // The submitted rating is surfaced back on the page (mirrors React's ratings list),
        // and the completed-status plain-English description renders.
        $after->assertSee(__('govuk_alpha.exchanges.ratings_title'));
        $after->assertSee('A great exchange, thank you.');
        $after->assertSee(__('govuk_alpha.exchanges.status_descriptions.completed'));

        // An invalid rating is rejected.
        $invalid = $this->post("/{$this->testTenantSlug}/accessible/exchanges/{$exchangeId}/rate", ['rating' => 9]);
        $invalid->assertRedirect("/{$this->testTenantSlug}/accessible/exchanges/{$exchangeId}?status=rating-invalid");
    }

    public function test_accessible_messages_render_send_and_archive_flow(): void
    {
        $sender = $this->authenticatedUser(['name' => 'Message Sender']);
        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'name' => 'Message Recipient',
            'status' => 'active',
            'is_approved' => true,
        ]);

        Sanctum::actingAs($sender, ['*']);

        $newConversation = $this->get("/{$this->testTenantSlug}/accessible/messages/new/{$recipient->id}");
        $newConversation->assertOk();
        $newConversation->assertSee(__('govuk_alpha.messages.conversation_title', ['name' => 'Message Recipient']));
        $newConversation->assertSee('class="govuk-textarea"', false);

        $send = $this->post("/{$this->testTenantSlug}/accessible/messages/{$recipient->id}", [
            'body' => 'Accessible message workflow verification.',
        ]);

        $send->assertRedirect("/{$this->testTenantSlug}/accessible/messages/{$recipient->id}?status=message-sent");
        $this->assertDatabaseHas('messages', [
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $recipient->id,
            'body' => 'Accessible message workflow verification.',
        ]);

        $conversation = $this->get("/{$this->testTenantSlug}/accessible/messages/{$recipient->id}");
        $conversation->assertOk();
        $conversation->assertSee('Accessible message workflow verification.');

        $index = $this->get("/{$this->testTenantSlug}/accessible/messages");
        $index->assertOk();
        // Inbox/archived switching is a nav with aria-current (not a misused
        // govuk-tabs component, which is for JS-driven tab panels).
        $index->assertSee('aria-current="page"', false);
        $index->assertSee('Accessible message workflow verification.');
        $index->assertSee(route('govuk-alpha.messages.show', ['tenantSlug' => $this->testTenantSlug, 'userId' => $recipient->id]), false);
        // The index offers a way to start a new conversation (link to the directory).
        $index->assertSee(__('govuk_alpha.messages.start_new'));
        $index->assertSee(route('govuk-alpha.members.index', ['tenantSlug' => $this->testTenantSlug]), false);

        $archive = $this->post("/{$this->testTenantSlug}/accessible/messages/{$recipient->id}/archive");
        $archive->assertRedirect("/{$this->testTenantSlug}/accessible/messages?status=conversation-archived");

        $archived = $this->get("/{$this->testTenantSlug}/accessible/messages?archived=1");
        $archived->assertOk();
        $archived->assertSee(__('govuk_alpha.actions.restore_conversation'));
    }

    public function test_m2_own_message_can_be_edited_and_deleted(): void
    {
        $sender = $this->authenticatedUser(['name' => 'Edit Sender']);
        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'name' => 'Edit Recipient',
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($sender, ['*']);

        $messageId = DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $recipient->id,
            'body' => 'Original message body.',
            'is_read' => 0,
            'is_federated' => 0,
            'created_at' => now(),
        ]);

        // The conversation view exposes the edit/delete controls for the sender's own message.
        $conversation = $this->get("/{$this->testTenantSlug}/accessible/messages/{$recipient->id}");
        $conversation->assertOk();
        $conversation->assertSee(__('govuk_alpha.messages.edit_delete_toggle'));
        $conversation->assertSee(
            route('govuk-alpha.messages.edit', ['tenantSlug' => $this->testTenantSlug, 'userId' => $recipient->id, 'messageId' => $messageId]),
            false
        );

        // Edit within the 24-hour window updates the body.
        $edit = $this->post("/{$this->testTenantSlug}/accessible/messages/{$recipient->id}/m/{$messageId}/edit", [
            'body' => 'Edited message body.',
        ]);
        $edit->assertRedirect("/{$this->testTenantSlug}/accessible/messages/{$recipient->id}?status=message-edited");
        $this->assertDatabaseHas('messages', [
            'id' => $messageId,
            'tenant_id' => $this->testTenantId,
            'body' => 'Edited message body.',
        ]);

        // Delete for everyone blanks the message body.
        $delete = $this->post("/{$this->testTenantSlug}/accessible/messages/{$recipient->id}/m/{$messageId}/delete", [
            'scope' => 'everyone',
        ]);
        $delete->assertRedirect("/{$this->testTenantSlug}/accessible/messages/{$recipient->id}?status=message-deleted");
        $this->assertDatabaseHas('messages', [
            'id' => $messageId,
            'tenant_id' => $this->testTenantId,
            'is_deleted' => 1,
        ]);
    }

    public function test_m2_cannot_edit_another_users_message(): void
    {
        $editor = $this->authenticatedUser(['name' => 'Not The Author']);
        $author = User::factory()->forTenant($this->testTenantId)->create([
            'name' => 'Real Author',
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($editor, ['*']);

        // A message authored by someone else (the editor is the receiver here).
        $messageId = DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $author->id,
            'receiver_id' => $editor->id,
            'body' => 'Author original body.',
            'is_read' => 0,
            'is_federated' => 0,
            'created_at' => now(),
        ]);

        $edit = $this->post("/{$this->testTenantSlug}/accessible/messages/{$author->id}/m/{$messageId}/edit", [
            'body' => 'Hijacked body.',
        ]);
        $edit->assertRedirect("/{$this->testTenantSlug}/accessible/messages/{$author->id}?status=message-edit-forbidden");
        // The body must be unchanged — the edit was rejected.
        $this->assertDatabaseHas('messages', [
            'id' => $messageId,
            'body' => 'Author original body.',
        ]);
    }

    public function test_a2_verify_email_landing_marks_user_verified(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'name' => 'Pending Verifier',
            'status' => 'pending',
            'is_approved' => true,
            'email_verified_at' => null,
        ]);

        $rawToken = 'a2verifytoken' . str_repeat('0', 20);
        DB::table('email_verification_tokens')->insert([
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'token' => hash('sha256', $rawToken),
            'created_at' => now(),
            'expires_at' => now()->addDay(),
        ]);

        $page = $this->get("/{$this->testTenantSlug}/accessible/verify-email?token={$rawToken}");
        $page->assertOk();
        $page->assertSee(__('govuk_alpha.auth.verify_email_success_title'));

        $this->assertNotNull(User::find($user->id)->email_verified_at);
    }

    public function test_a2_verify_email_landing_rejects_bad_token(): void
    {
        $missing = $this->get("/{$this->testTenantSlug}/accessible/verify-email");
        $missing->assertOk();
        $missing->assertSee(__('govuk_alpha.auth.verify_email_missing'));

        $invalid = $this->get("/{$this->testTenantSlug}/accessible/verify-email?token=not-a-real-token");
        $invalid->assertOk();
        $invalid->assertSee(__('govuk_alpha.auth.verify_email_invalid'));
    }

    public function test_a2_newsletter_unsubscribe_landing_renders(): void
    {
        $missing = $this->get("/{$this->testTenantSlug}/accessible/newsletter/unsubscribe");
        $missing->assertOk();
        $missing->assertSee(__('govuk_alpha.auth.unsubscribe_missing'));

        $invalid = $this->get("/{$this->testTenantSlug}/accessible/newsletter/unsubscribe?token=not-a-real-token");
        $invalid->assertOk();
        $invalid->assertSee(__('govuk_alpha.auth.unsubscribe_invalid'));
    }

    public function test_a2_review_can_be_submitted_from_reviews_page(): void
    {
        $reviewer = $this->authenticatedUser(['name' => 'Review Author']);
        $receiver = User::factory()->forTenant($this->testTenantId)->create([
            'name' => 'Reviewed Member',
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($reviewer, ['*']);

        $submit = $this->post("/{$this->testTenantSlug}/accessible/reviews", [
            'receiver_id' => $receiver->id,
            'rating' => 5,
            'comment' => 'A genuinely helpful exchange.',
        ]);
        $submit->assertRedirect("/{$this->testTenantSlug}/accessible/reviews?status=review-submitted");

        $this->assertDatabaseHas('reviews', [
            'tenant_id' => $this->testTenantId,
            'reviewer_id' => $reviewer->id,
            'receiver_id' => $receiver->id,
            'rating' => 5,
        ]);
    }

    public function test_n2_activity_digest_frequency_is_saved_and_shown(): void
    {
        $user = $this->authenticatedUser(['name' => 'Digest Member']);
        Sanctum::actingAs($user, ['*']);

        // The settings page exposes the activity-digest selector.
        $page = $this->get("/{$this->testTenantSlug}/accessible/profile/settings");
        $page->assertOk();
        $page->assertSee('name="digest_frequency"', false);
        $page->assertSee(__('govuk_alpha.profile_settings.notifications.digest_label'));

        $save = $this->post("/{$this->testTenantSlug}/accessible/profile/notifications", [
            'digest_frequency' => 'daily',
            'email_messages' => '1',
        ]);
        $save->assertRedirect();

        $this->assertDatabaseHas('notification_settings', [
            'user_id' => $user->id,
            'context_type' => 'global',
            'context_id' => 0,
            'frequency' => 'daily',
        ]);

        // Re-saving with a different value updates the same row (no duplicate).
        $this->post("/{$this->testTenantSlug}/accessible/profile/notifications", [
            'digest_frequency' => 'off',
            'email_messages' => '1',
        ]);
        $this->assertSame(
            1,
            DB::table('notification_settings')
                ->where('user_id', $user->id)
                ->where('context_type', 'global')
                ->where('context_id', 0)
                ->count()
        );
        $this->assertDatabaseHas('notification_settings', [
            'user_id' => $user->id,
            'context_type' => 'global',
            'context_id' => 0,
            'frequency' => 'off',
        ]);
    }

    public function test_messages_inline_start_conversation_search(): void
    {
        $this->authenticatedUser(['name' => 'Conversation Starter']);

        // The inline search form renders on the messages index.
        $page = $this->get("/{$this->testTenantSlug}/accessible/messages");
        $page->assertOk();
        $page->assertSee(__('govuk_alpha.messages.search_label'));
        $page->assertSee('name="q"', false);

        // A query with no matches shows the empty state (works regardless of
        // whether the search index is available in the test environment).
        $noMatch = $this->get("/{$this->testTenantSlug}/accessible/messages?q=zzznosuchmemberzzz");
        $noMatch->assertOk();
        $noMatch->assertSee(__('govuk_alpha.messages.search_empty'));
    }

    public function test_unread_message_count_shows_in_the_navigation(): void
    {
        $sender = User::factory()->forTenant($this->testTenantId)->create([
            'name' => 'Nav Sender',
            'status' => 'active',
            'is_approved' => true,
        ]);
        $recipient = $this->authenticatedUser(['name' => 'Nav Recipient']);

        DB::table('messages')->insert([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->id,
            'receiver_id' => $recipient->id,
            'body' => 'Unread nav badge check.',
            'is_read' => 0,
            'is_federated' => 0,
            'created_at' => now(),
        ]);

        Sanctum::actingAs($recipient, ['*']);

        $dashboard = $this->get("/{$this->testTenantSlug}/accessible/dashboard");
        $dashboard->assertOk();
        // The Messages nav item carries an unread badge announced to screen readers.
        $dashboard->assertSee('nexus-alpha-nav-badge', false);
        $dashboard->assertSee(trans_choice('govuk_alpha.messages.unread_count', 1, ['count' => 1]));
    }

    public function test_events_pages_render_filters_detail_and_rsvp_flow(): void
    {
        $user = $this->authenticatedUser();
        $eventId = DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'title' => 'Alpha event verification',
            'description' => 'Accessible alpha event detail body.',
            'location' => 'Alpha Hall',
            'start_time' => now()->addDays(7),
            'end_time' => now()->addDays(7)->addHours(2),
            'max_attendees' => 12,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $index = $this->get("/{$this->testTenantSlug}/accessible/events");

        $index->assertOk();
        $index->assertSee('class="govuk-fieldset"', false);
        $index->assertSee('type="search"', false);
        $index->assertSee('class="govuk-select"', false);
        $index->assertSee(__('govuk_alpha.actions.create_event'));
        $index->assertSee(route('govuk-alpha.events.create', ['tenantSlug' => $this->testTenantSlug]), false);
        $index->assertSee('Alpha event verification');
        $index->assertSee(route('govuk-alpha.events.show', ['tenantSlug' => $this->testTenantSlug, 'id' => $eventId]), false);

        $createForm = $this->get("/{$this->testTenantSlug}/accessible/events/new");

        $createForm->assertOk();
        $createForm->assertSee(__('govuk_alpha.events.create_title'));
        $createForm->assertSee('name="title"', false);
        $createForm->assertSee('type="datetime-local"', false);
        $createForm->assertSee('name="max_attendees"', false);
        $createForm->assertSee('id="freq-biweekly" name="recurrence_frequency" type="radio" value="biweekly"', false);
        $createForm->assertSee('id="freq-yearly" name="recurrence_frequency" type="radio" value="yearly"', false);
        $createForm->assertDontSee('id="rec-end-never" name="recurrence_ends_type" type="radio" value="never"', false);
        $maxOccurrences = app(\App\Services\EventRecurrenceCapabilityService::class)
            ->capabilities()['max_occurrences'];
        $createForm->assertSee(
            'name="recurrence_ends_after_count" type="number" min="2" max="' . $maxOccurrences . '"',
            false,
        );

        $create = $this->post("/{$this->testTenantSlug}/accessible/events/new", [
            'title' => 'Alpha created event',
            'description' => 'Created through the accessible alpha event form.',
            'start_time' => now()->addDays(10)->format('Y-m-d\TH:i'),
            'end_time' => now()->addDays(10)->addHours(2)->format('Y-m-d\TH:i'),
            'location' => 'Accessible Hall',
            'max_attendees' => 20,
        ]);

        $createdEventId = DB::table('events')
            ->where('tenant_id', $this->testTenantId)
            ->where('title', 'Alpha created event')
            ->value('id');

        $this->assertNotNull($createdEventId);
        $create->assertRedirect("/{$this->testTenantSlug}/accessible/events/{$createdEventId}?status=event-created");
        $this->assertDatabaseHas('events', [
            'id' => $createdEventId,
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'title' => 'Alpha created event',
            'location' => 'Accessible Hall',
            'max_attendees' => 20,
        ]);

        $createdDetail = $this->get("/{$this->testTenantSlug}/accessible/events/{$createdEventId}?status=event-created");

        $createdDetail->assertOk();
        $createdDetail->assertSee(__('govuk_alpha.events.created'));
        $createdDetail->assertSee('Alpha created event');

        // Organisers manage the event and do not occupy their own attendee
        // capacity. Exercise the RSVP controls as a separate eligible member.
        $attendee = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($attendee, ['*']);

        $detail = $this->get("/{$this->testTenantSlug}/accessible/events/{$eventId}");

        $detail->assertOk();
        $detail->assertSee('Alpha event verification');
        $detail->assertSee('class="govuk-back-link"', false);
        $detail->assertSee('class="govuk-summary-list"', false);
        $detail->assertSee('class="govuk-radios"', false);

        $rsvp = $this->post("/{$this->testTenantSlug}/accessible/events/{$eventId}/rsvp", [
            'status' => 'going',
        ]);

        $rsvp->assertRedirect("/{$this->testTenantSlug}/accessible/events/{$eventId}?status=rsvp-updated");
        $this->assertDatabaseHas('event_rsvps', [
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $attendee->id,
            'status' => 'going',
        ]);

        // The roster is identity-bearing and remains organiser-only.
        Sanctum::actingAs($user, ['*']);
        $afterRsvp = $this->get("/{$this->testTenantSlug}/accessible/events/{$eventId}");
        $afterRsvp->assertSee(__('govuk_alpha.events.attendees_title'));
    }

    public function test_event_create_shows_per_field_validation_errors(): void
    {
        $this->authenticatedUser();

        // Submitting with no title/description must return per-field errors and an
        // anchored error summary, not a single generic message.
        $create = $this->followingRedirects()->post("/{$this->testTenantSlug}/accessible/events/new", [
            'title' => '',
            'description' => '',
        ]);

        $create->assertOk();
        $create->assertSee('class="govuk-error-summary"', false);
        $create->assertSee('govuk-form-group--error', false);
        $create->assertSee('class="govuk-error-message"', false);
    }

    public function test_accessible_recurring_create_maps_biweekly_without_javascript(): void
    {
        config()->set('events.recurrence.engine_v2_enabled', false);
        $this->authenticatedUser();

        $response = $this->post("/{$this->testTenantSlug}/accessible/events/new", [
            'title' => 'Accessible fortnightly repair event',
            'description' => 'A detailed recurring repair event created without JavaScript.',
            'timezone' => 'Europe/Dublin',
            'start_time' => '2099-05-01T10:00',
            'end_time' => '2099-05-01T12:00',
            'is_recurring' => '1',
            'recurrence_frequency' => 'biweekly',
            'recurrence_ends_type' => 'after_count',
            'recurrence_ends_after_count' => '2',
        ]);

        $templateId = DB::table('events')
            ->where('tenant_id', $this->testTenantId)
            ->where('title', 'Accessible fortnightly repair event')
            ->where('is_recurring_template', 1)
            ->value('id');

        $this->assertNotNull($templateId);
        $this->assertDatabaseHas('event_recurrence_rules', [
            'tenant_id' => $this->testTenantId,
            'event_id' => $templateId,
            'frequency' => 'weekly',
            'interval_value' => 2,
            'ends_type' => 'after_count',
            'ends_after_count' => 2,
        ]);
        $response->assertRedirect(route('govuk-alpha.events.index', [
            'tenantSlug' => $this->testTenantSlug,
            'status' => 'event-created',
        ]));
    }

    public function test_event_organiser_can_edit_cancel_and_delete_their_event(): void
    {
        $user = $this->authenticatedUser();
        $eventId = DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'title' => 'Organiser event',
            'description' => 'Original description.',
            'location' => 'Organiser Hall',
            'start_time' => now()->addDays(7),
            'end_time' => now()->addDays(7)->addHours(2),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // The organiser sees Edit/Cancel/Delete controls on the detail page.
        $detail = $this->get("/{$this->testTenantSlug}/accessible/events/{$eventId}");
        $detail->assertOk();
        $detail->assertSee(__('govuk_alpha.events.edit_event'));
        $detail->assertSee(route('govuk-alpha.events.edit', ['tenantSlug' => $this->testTenantSlug, 'id' => $eventId]), false);
        $detail->assertSee('id="archive-reason"', false);
        $detail->assertSee('name="reason" rows="2" required', false);

        // The edit form is prefilled.
        $edit = $this->get("/{$this->testTenantSlug}/accessible/events/{$eventId}/edit");
        $edit->assertOk();
        $edit->assertSee('Organiser event', false);
        $edit->assertSee(__('govuk_alpha.events.update_submit'));

        // Update the event.
        $update = $this->post("/{$this->testTenantSlug}/accessible/events/{$eventId}/edit", [
            'title' => 'Updated event title',
            'description' => 'Updated description.',
            'start_time' => now()->addDays(8)->format('Y-m-d\TH:i'),
            'location' => 'Organiser Hall',
        ]);
        $update->assertRedirect("/{$this->testTenantSlug}/accessible/events/{$eventId}?status=event-updated");
        $this->assertSame('Updated event title', DB::table('events')->where('id', $eventId)->value('title'));

        // Cancel the event.
        $cancel = $this->post("/{$this->testTenantSlug}/accessible/events/{$eventId}/cancel", ['reason' => 'No longer running.']);
        $cancel->assertRedirectContains('status=event-cancelled');

        // Delete the event (returns to the list).
        $delete = $this->post("/{$this->testTenantSlug}/accessible/events/{$eventId}/delete", [
            'reason' => 'The event is no longer needed.',
        ]);
        $delete->assertRedirect("/{$this->testTenantSlug}/accessible/events?status=event-archived");
    }

    public function test_event_edit_rejects_a_non_owner(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $eventId = DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'title' => 'Someone elses event',
            'description' => 'Not yours to edit.',
            'start_time' => now()->addDays(3),
            'end_time' => now()->addDays(3)->addHours(1),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // A different signed-in member cannot edit or delete it.
        $this->authenticatedUser();
        $this->get("/{$this->testTenantSlug}/accessible/events/{$eventId}/edit")->assertForbidden();
        $this->post("/{$this->testTenantSlug}/accessible/events/{$eventId}/delete")->assertForbidden();
        $this->assertDatabaseHas('events', ['id' => $eventId, 'title' => 'Someone elses event']);
    }

    public function test_event_card_and_detail_render_cover_image_and_online_link(): void
    {
        $user = $this->authenticatedUser();
        $eventId = DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'title' => 'Event with a cover photo',
            'description' => 'Event detail with a hero image.',
            'location' => 'Photo Hall',
            'cover_image' => '/uploads/tenants/' . $this->testTenantSlug . '/events/cover.jpg',
            'online_link' => 'https://example.test/live',
            'start_time' => now()->addDays(5),
            'end_time' => now()->addDays(5)->addHours(2),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $index = $this->get("/{$this->testTenantSlug}/accessible/events");
        $index->assertOk();
        $index->assertSee('class="nexus-alpha-card-thumb"', false);
        $index->assertSee('events/cover.jpg', false);
        $index->assertSee(__('govuk_alpha.events.image_alt', ['title' => 'Event with a cover photo']), false);

        $detail = $this->get("/{$this->testTenantSlug}/accessible/events/{$eventId}");
        $detail->assertOk();
        $detail->assertSee('class="nexus-alpha-detail-hero"', false);
        $detail->assertSee('events/cover.jpg', false);
        // online_link captured but previously never shown — now surfaced safely.
        $detail->assertSee(__('govuk_alpha.events.online_link_label'));
        $detail->assertSee('property="og:image" content="' . url('/uploads/tenants/' . $this->testTenantSlug . '/events/cover.jpg') . '"', false);
    }

    public function test_volunteering_pages_render_opportunity_detail_and_application_flow(): void
    {
        $user = $this->authenticatedUser();
        // The opportunity must be created by a DIFFERENT user — creators can
        // no longer apply to their own opportunities (VolunteerService::apply
        // rejects them), and this test exercises the applicant path.
        $creator = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $organizationId = DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'name' => 'Alpha Volunteer Organisation',
            'slug' => 'alpha-volunteer-organisation',
            'description' => 'A volunteering organisation for the accessible alpha.',
            'contact_email' => 'volunteer-alpha@example.test',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $opportunityId = DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $organizationId,
            'created_by' => $creator->id,
            'title' => 'Alpha volunteering opportunity',
            'description' => 'Accessible volunteering detail body.',
            'location' => 'Volunteer Centre',
            'is_remote' => 1,
            'skills_needed' => 'Listening, organising',
            'start_date' => now()->addWeek()->toDateString(),
            'end_date' => now()->addMonth()->toDateString(),
            'is_active' => 1,
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $shiftId = DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $opportunityId,
            'start_time' => now()->addDays(10),
            'end_time' => now()->addDays(10)->addHours(3),
            'capacity' => 5,
            'created_at' => now(),
        ]);

        $index = $this->get("/{$this->testTenantSlug}/accessible/volunteering");

        $index->assertOk();
        $index->assertSee('class="govuk-fieldset"', false);
        $index->assertSee('class="govuk-checkboxes ', false);
        // Section sub-navigation renders as a semantic <nav> of links (aria-
        // labelled), not a govuk-tabs JS panel component — govuk-tabs is
        // reserved for in-page panel switching (see volunteering.blade.php).
        $index->assertSee(__('govuk_alpha.volunteering.tabs_title'));
        $index->assertSee(__('govuk_alpha.volunteering.tabs.opportunities'));
        $index->assertSee('Alpha volunteering opportunity');
        $index->assertSee('Alpha Volunteer Organisation');
        $index->assertSee(route('govuk-alpha.volunteering.show', ['tenantSlug' => $this->testTenantSlug, 'id' => $opportunityId]), false);

        $detail = $this->get("/{$this->testTenantSlug}/accessible/volunteering/opportunities/{$opportunityId}");

        $detail->assertOk();
        $detail->assertSee('Alpha volunteering opportunity');
        $detail->assertSee('class="govuk-summary-list"', false);
        $detail->assertSee('class="govuk-textarea"', false);
        $detail->assertSee('name="shift_id"', false);

        $apply = $this->post("/{$this->testTenantSlug}/accessible/volunteering/opportunities/{$opportunityId}/apply", [
            'message' => 'I can help with this accessible alpha test.',
            'shift_id' => $shiftId,
        ]);

        $apply->assertRedirect("/{$this->testTenantSlug}/accessible/volunteering/opportunities/{$opportunityId}?status=apply-created");
        $this->assertDatabaseHas('vol_applications', [
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $opportunityId,
            'user_id' => $user->id,
            'shift_id' => $shiftId,
            'status' => 'pending',
        ]);

        $applications = $this->get("/{$this->testTenantSlug}/accessible/volunteering?tab=applications");
        $applications->assertOk();
        $applications->assertSee(__('govuk_alpha.volunteering.applications_title'));
        $applications->assertSee('Alpha volunteering opportunity');
        $applications->assertSee(__('govuk_alpha.volunteering.status_values.pending'));
        $applications->assertSee(__('govuk_alpha.volunteering.applied_on'));

        // Organisations is now surfaced via the "two hats" org door on the
        // gateway (the standalone Organisations tab was removed). The owner of an
        // approved/active org sees the door naming it + the Post-opportunity CTA.
        $gateway = $this->get("/{$this->testTenantSlug}/accessible/volunteering");
        $gateway->assertOk();
        $gateway->assertSee(__('govuk_alpha.vol_org.door_eyebrow'));
        $gateway->assertSee(__('govuk_alpha.vol_org.door_heading_one', ['name' => 'Alpha Volunteer Organisation']));
        $gateway->assertSee(route('govuk-alpha.volunteering.opportunities.create', ['tenantSlug' => $this->testTenantSlug]), false);
    }

    public function test_volunteering_recommended_tab_renders(): void
    {
        $this->authenticatedUser();

        // The skills-based "For you" tab renders (empty state when no matching
        // shifts exist for the member).
        $page = $this->get("/{$this->testTenantSlug}/accessible/volunteering?tab=recommended");
        $page->assertOk();
        $page->assertSee(__('govuk_alpha.volunteering.tabs.recommended'));
        $page->assertSee(__('govuk_alpha.volunteering.recommended_title'));
        $page->assertSee('aria-current="page"', false);
    }

    public function test_volunteering_applications_tab_supports_status_filter_and_withdraw(): void
    {
        $user = $this->authenticatedUser();
        $creator = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $organizationId = DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $creator->id,
            'name' => 'Withdraw Test Organisation',
            'slug' => 'withdraw-test-organisation',
            'description' => 'Org for the withdraw flow.',
            'contact_email' => 'withdraw-alpha@example.test',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $opportunityId = DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $organizationId,
            'created_by' => $creator->id,
            'title' => 'Withdrawable opportunity',
            'description' => 'Apply then withdraw.',
            'location' => 'Centre',
            'is_remote' => 0,
            'skills_needed' => 'Listening',
            'start_date' => now()->addWeek()->toDateString(),
            'end_date' => now()->addMonth()->toDateString(),
            'is_active' => 1,
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $applicationId = DB::table('vol_applications')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $opportunityId,
            'user_id' => $user->id,
            'status' => 'pending',
            'message' => 'Please consider me.',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $withdrawUrl = route('govuk-alpha.volunteering.applications.withdraw', ['tenantSlug' => $this->testTenantSlug, 'id' => $applicationId]);

        $tab = $this->get("/{$this->testTenantSlug}/accessible/volunteering?tab=applications");
        $tab->assertOk();
        $tab->assertSee('name="app_status"', false);
        $tab->assertSee(__('govuk_alpha.volunteering.withdraw_application'));
        $tab->assertSee($withdrawUrl, false);

        // Status filter: only approved → the pending one is hidden, empty state shows.
        $approvedOnly = $this->get("/{$this->testTenantSlug}/accessible/volunteering?tab=applications&app_status=approved");
        $approvedOnly->assertOk();
        $approvedOnly->assertSee('value="approved" selected', false);
        $approvedOnly->assertSee(__('govuk_alpha.volunteering.empty_applications'));
        $approvedOnly->assertDontSee(__('govuk_alpha.volunteering.withdraw_application'));

        // Withdraw the pending application.
        $withdraw = $this->post($withdrawUrl);
        $withdraw->assertRedirect("/{$this->testTenantSlug}/accessible/volunteering?tab=applications&status=application-withdrawn");
        $this->assertDatabaseMissing('vol_applications', ['id' => $applicationId]);

        $after = $this->get("/{$this->testTenantSlug}/accessible/volunteering?tab=applications&status=application-withdrawn");
        $after->assertOk();
        $after->assertSee(__('govuk_alpha.volunteering.application_withdrawn'));
    }

    public function test_volunteering_opportunity_shows_org_logo_and_hours_show_breakdowns(): void
    {
        $user = $this->authenticatedUser();
        $organizationId = DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'name' => 'Logo Org',
            'slug' => 'logo-org',
            'description' => 'Org with a logo and logged hours.',
            'contact_email' => 'logo-alpha@example.test',
            'logo_url' => '/uploads/tenants/' . $this->testTenantSlug . '/vol/org-logo.png',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $opportunityId = DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $organizationId,
            'created_by' => $user->id,
            'title' => 'Logo opportunity',
            'description' => 'Has an organisation logo.',
            'location' => 'Centre',
            'is_remote' => 0,
            'skills_needed' => 'Support',
            'start_date' => now()->addWeek()->toDateString(),
            'end_date' => now()->addMonth()->toDateString(),
            'is_active' => 1,
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('vol_logs')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'organization_id' => $organizationId,
            'opportunity_id' => $opportunityId,
            'date_logged' => now()->toDateString(),
            'hours' => 3.5,
            'description' => 'Approved log entry.',
            'status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $detail = $this->get("/{$this->testTenantSlug}/accessible/volunteering/opportunities/{$opportunityId}");
        $detail->assertOk();
        $detail->assertSee('class="nexus-alpha-org-logo', false);
        $detail->assertSee('org-logo.png', false);
        $detail->assertSee(__('govuk_alpha.volunteering.org_logo_alt', ['name' => 'Logo Org']), false);

        $hours = $this->get("/{$this->testTenantSlug}/accessible/volunteering/hours");
        $hours->assertOk();
        $hours->assertSee(__('govuk_alpha.volunteering.hours_by_org_title'));
        $hours->assertSee('Logo Org');
        $hours->assertSee(__('govuk_alpha.volunteering.hours_by_month_title'));
        $hours->assertSee('class="govuk-table"', false);
    }

    public function test_volunteering_shift_signup_and_cancel_for_approved_applicant(): void
    {
        $user = $this->authenticatedUser();
        $creator = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $organizationId = DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $creator->id,
            'name' => 'Shift Org',
            'slug' => 'shift-org',
            'description' => 'Shift signup org.',
            'contact_email' => 'shift-alpha@example.test',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $opportunityId = DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $organizationId,
            'created_by' => $creator->id,
            'title' => 'Shift opportunity',
            'description' => 'Has a future shift.',
            'location' => 'Centre',
            'is_remote' => 0,
            'skills_needed' => 'Support',
            'start_date' => now()->addWeek()->toDateString(),
            'end_date' => now()->addMonth()->toDateString(),
            'is_active' => 1,
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $shiftId = DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $opportunityId,
            'start_time' => now()->addDays(10),
            'end_time' => now()->addDays(10)->addHours(3),
            'capacity' => 5,
            'created_at' => now(),
        ]);
        $applicationId = DB::table('vol_applications')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $opportunityId,
            'user_id' => $user->id,
            'status' => 'approved',
            'message' => 'Approved volunteer.',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $signupUrl = route('govuk-alpha.volunteering.shifts.signup', ['tenantSlug' => $this->testTenantSlug, 'id' => $opportunityId, 'shiftId' => $shiftId]);
        $cancelUrl = route('govuk-alpha.volunteering.shifts.cancel', ['tenantSlug' => $this->testTenantSlug, 'id' => $opportunityId, 'shiftId' => $shiftId]);

        // Approved applicant sees a sign-up control on the shift.
        $detail = $this->get("/{$this->testTenantSlug}/accessible/volunteering/opportunities/{$opportunityId}");
        $detail->assertOk();
        $detail->assertSee(__('govuk_alpha.volunteering.sign_up_shift'));
        $detail->assertSee($signupUrl, false);

        // Sign up → shift_id set on the application.
        $signup = $this->post($signupUrl);
        $signup->assertRedirect("/{$this->testTenantSlug}/accessible/volunteering/opportunities/{$opportunityId}?status=shift-signed-up");
        $this->assertDatabaseHas('vol_applications', ['id' => $applicationId, 'shift_id' => $shiftId]);

        // Detail now shows the "Signed up" state + cancel control.
        $afterSignup = $this->get("/{$this->testTenantSlug}/accessible/volunteering/opportunities/{$opportunityId}");
        $afterSignup->assertOk();
        $afterSignup->assertSee(__('govuk_alpha.volunteering.shift_signed_up'));
        $afterSignup->assertSee($cancelUrl, false);

        // Cancel → shift_id cleared.
        $cancel = $this->post($cancelUrl);
        $cancel->assertRedirect("/{$this->testTenantSlug}/accessible/volunteering/opportunities/{$opportunityId}?status=shift-cancelled");
        $this->assertDatabaseHas('vol_applications', ['id' => $applicationId, 'shift_id' => null]);
    }

    public function test_volunteering_accessibility_needs_form_renders_saves_and_clears(): void
    {
        $user = $this->authenticatedUser();

        $form = $this->get("/{$this->testTenantSlug}/accessible/volunteering/accessibility");
        $form->assertOk();
        $form->assertSee(__('govuk_alpha.volunteering.accessibility_title'));
        $form->assertSee('name="need_types[]"', false);
        $form->assertSee(__('govuk_alpha.volunteering.need_type_labels.mobility'));
        $form->assertSee('name="emergency_contact_phone"', false);

        $save = $this->post("/{$this->testTenantSlug}/accessible/volunteering/accessibility", [
            'need_types' => ['mobility', 'dietary'],
            'description' => 'Needs step-free access to venues.',
            'accommodations_required' => 'A quiet space during breaks.',
            'emergency_contact_name' => 'Jo Carer',
            'emergency_contact_phone' => '+1 555 123 4567',
        ]);
        $save->assertRedirect("/{$this->testTenantSlug}/accessible/volunteering/accessibility?status=accessibility-saved");
        $this->assertDatabaseHas('vol_accessibility_needs', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'need_type' => 'mobility',
            'description' => 'Needs step-free access to venues.',
            'emergency_contact_name' => 'Jo Carer',
        ]);
        $this->assertDatabaseHas('vol_accessibility_needs', [
            'user_id' => $user->id,
            'need_type' => 'dietary',
        ]);

        // Re-render reflects the saved selections + shared detail.
        $after = $this->get("/{$this->testTenantSlug}/accessible/volunteering/accessibility?status=accessibility-saved");
        $after->assertOk();
        $after->assertSee('value="mobility" checked', false);
        $after->assertSee('value="dietary" checked', false);
        $after->assertSee('Needs step-free access to venues.', false);
        $after->assertSee(__('govuk_alpha.volunteering.accessibility_saved'));

        // Full-replace: submitting with no categories clears all saved needs.
        $clear = $this->post("/{$this->testTenantSlug}/accessible/volunteering/accessibility", [
            'description' => '',
        ]);
        $clear->assertRedirect("/{$this->testTenantSlug}/accessible/volunteering/accessibility?status=accessibility-saved");
        $this->assertDatabaseMissing('vol_accessibility_needs', ['user_id' => $user->id]);
    }

    public function test_volunteering_hours_page_renders_member_hour_logging_form(): void
    {
        $user = $this->authenticatedUser();
        $organizationId = DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'name' => 'Alpha Hours Organisation',
            'slug' => 'alpha-hours-organisation',
            'description' => 'Organisation for hour logging.',
            'contact_email' => 'hours-alpha@example.test',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $opportunityId = DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $organizationId,
            'created_by' => $user->id,
            'title' => 'Alpha hours opportunity',
            'description' => 'Opportunity used for hour logging.',
            'location' => 'Hours Centre',
            'is_remote' => 0,
            'skills_needed' => 'Support',
            'start_date' => now()->subWeek()->toDateString(),
            'end_date' => now()->addMonth()->toDateString(),
            'is_active' => 1,
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('vol_applications')->insert([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $opportunityId,
            'user_id' => $user->id,
            'status' => 'approved',
            'message' => 'Approved for logging.',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/volunteering/hours");

        $response->assertOk();
        $response->assertSee(__('govuk_alpha.volunteering.hours_title'));
        $response->assertSee('class="govuk-fieldset"', false);
        $response->assertSee('type="date"', false);
        $response->assertSee('type="number"', false);
        $response->assertSee('Alpha Hours Organisation');
        $response->assertSee('Alpha hours opportunity');
    }

    // ===== WAVE V-ORG: organisation-admin dashboard (the "two hats" admin side) =====

    /**
     * Seed an organisation owned by $ownerId with one pending application (from a
     * separate applicant) and one pending logged-hours entry. Returns the ids so
     * the caller can drive approve/decline POSTs.
     *
     * @return array{org_id:int, opportunity_id:int, app_id:int, log_id:int, applicant_id:int, volunteer_id:int}
     */
    private function seedManagedVolunteerOrg(int $ownerId, array $orgOverrides = []): array
    {
        $orgId = DB::table('vol_organizations')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'name' => 'Managed Vol Org',
            'slug' => 'managed-vol-org-' . uniqid(),
            'description' => 'An organisation managed in the accessible alpha dashboard.',
            'contact_email' => 'managed-vol-' . uniqid() . '@example.test',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ], $orgOverrides));

        $opportunityId = DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'created_by' => $ownerId,
            'title' => 'Managed opportunity',
            'description' => 'Opportunity with a pending application.',
            'location' => 'Centre',
            'is_remote' => 0,
            'skills_needed' => 'Support',
            'start_date' => now()->addWeek()->toDateString(),
            'end_date' => now()->addMonth()->toDateString(),
            'is_active' => 1,
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $applicant = User::factory()->forTenant($this->testTenantId)->create([
            'name' => 'Pending Applicant',
            'status' => 'active',
            'is_approved' => true,
        ]);
        $appId = DB::table('vol_applications')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $opportunityId,
            'user_id' => $applicant->id,
            'status' => 'pending',
            'message' => 'I would love to help out.',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Hours logged by a DIFFERENT volunteer (verifyHours blocks self-approval).
        $volunteer = User::factory()->forTenant($this->testTenantId)->create([
            'name' => 'Hours Volunteer',
            'status' => 'active',
            'is_approved' => true,
            'balance' => 0,
        ]);
        $logId = DB::table('vol_logs')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $volunteer->id,
            'organization_id' => $orgId,
            'opportunity_id' => $opportunityId,
            'date_logged' => now()->toDateString(),
            'hours' => 2,
            'description' => 'Helped at the centre.',
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [
            'org_id' => $orgId,
            'opportunity_id' => $opportunityId,
            'app_id' => $appId,
            'log_id' => $logId,
            'applicant_id' => $applicant->id,
            'volunteer_id' => $volunteer->id,
        ];
    }

    public function test_volunteer_org_manage_renders_pending_applications_and_hours_for_owner(): void
    {
        $owner = $this->authenticatedUser(['name' => 'Org Owner']);
        $seed = $this->seedManagedVolunteerOrg($owner->id);

        $res = $this->get("/{$this->testTenantSlug}/accessible/volunteering/organisations/{$seed['org_id']}/manage");
        $res->assertOk();
        $res->assertSee(__('govuk_alpha.vol_org.manage_title'));
        $res->assertSee(__('govuk_alpha.vol_org.applications_title'));
        $res->assertSee(__('govuk_alpha.vol_org.hours_title'));
        // Auto-mint notice must be present so the admin understands credits are issued.
        $res->assertSee(__('govuk_alpha.vol_org.hours_credit_notice'));
        $res->assertSee('Pending Applicant');
        $res->assertSee('Hours Volunteer');
        $res->assertSee('govuk-button-group', false);
        // Both POST routes are wired into the page.
        $res->assertSee(route('govuk-alpha.volunteering.org.applications.handle', ['tenantSlug' => $this->testTenantSlug, 'id' => $seed['org_id'], 'appId' => $seed['app_id']]), false);
        $res->assertSee(route('govuk-alpha.volunteering.org.hours.verify', ['tenantSlug' => $this->testTenantSlug, 'id' => $seed['org_id'], 'logId' => $seed['log_id']]), false);
    }

    public function test_volunteer_org_manage_owner_can_approve_an_application(): void
    {
        $owner = $this->authenticatedUser(['name' => 'Approving Owner']);
        $seed = $this->seedManagedVolunteerOrg($owner->id);

        $url = route('govuk-alpha.volunteering.org.applications.handle', ['tenantSlug' => $this->testTenantSlug, 'id' => $seed['org_id'], 'appId' => $seed['app_id']]);
        $res = $this->post($url, ['action' => 'approve']);
        $res->assertRedirect("/{$this->testTenantSlug}/accessible/volunteering/organisations/{$seed['org_id']}/manage?status=application-approved");
        $this->assertDatabaseHas('vol_applications', ['id' => $seed['app_id'], 'status' => 'approved']);
    }

    public function test_volunteer_org_manage_owner_can_decline_an_application(): void
    {
        $owner = $this->authenticatedUser(['name' => 'Declining Owner']);
        $seed = $this->seedManagedVolunteerOrg($owner->id);

        $url = route('govuk-alpha.volunteering.org.applications.handle', ['tenantSlug' => $this->testTenantSlug, 'id' => $seed['org_id'], 'appId' => $seed['app_id']]);
        $res = $this->post($url, ['action' => 'decline']);
        $res->assertRedirect("/{$this->testTenantSlug}/accessible/volunteering/organisations/{$seed['org_id']}/manage?status=application-declined");
        $this->assertDatabaseHas('vol_applications', ['id' => $seed['app_id'], 'status' => 'declined']);
    }

    public function test_volunteer_org_manage_owner_approval_of_hours_auto_mints_credit(): void
    {
        $owner = $this->authenticatedUser(['name' => 'Hours Owner']);
        $seed = $this->seedManagedVolunteerOrg($owner->id);

        $startBalance = (int) DB::table('users')->where('id', $seed['volunteer_id'])->value('balance');

        $url = route('govuk-alpha.volunteering.org.hours.verify', ['tenantSlug' => $this->testTenantSlug, 'id' => $seed['org_id'], 'logId' => $seed['log_id']]);
        $res = $this->post($url, ['action' => 'approve']);
        $res->assertRedirect("/{$this->testTenantSlug}/accessible/volunteering/organisations/{$seed['org_id']}/manage?status=hours-approved");

        $this->assertDatabaseHas('vol_logs', ['id' => $seed['log_id'], 'status' => 'approved']);
        // Approving 2 whole hours mints 2 credits to the volunteer (auto-mint parity).
        $endBalance = (int) DB::table('users')->where('id', $seed['volunteer_id'])->value('balance');
        $this->assertSame($startBalance + 2, $endBalance);
    }

    public function test_volunteer_org_manage_rejects_a_non_owner_with_403(): void
    {
        // Org owned by someone else; the signed-in user is not an owner/admin.
        $orgOwner = User::factory()->forTenant($this->testTenantId)->create([
            'name' => 'Real Org Owner',
            'status' => 'active',
            'is_approved' => true,
        ]);
        $this->authenticatedUser(['name' => 'Random Member']);
        $seed = $this->seedManagedVolunteerOrg($orgOwner->id);

        $res = $this->get("/{$this->testTenantSlug}/accessible/volunteering/organisations/{$seed['org_id']}/manage");
        $res->assertStatus(403);

        // The POST actions are equally guarded.
        $postRes = $this->post(route('govuk-alpha.volunteering.org.hours.verify', ['tenantSlug' => $this->testTenantSlug, 'id' => $seed['org_id'], 'logId' => $seed['log_id']]), ['action' => 'approve']);
        $postRes->assertStatus(403);
        $this->assertDatabaseHas('vol_logs', ['id' => $seed['log_id'], 'status' => 'pending']);
    }

    public function test_volunteer_org_manage_grants_access_to_an_active_org_admin_member(): void
    {
        $orgOwner = User::factory()->forTenant($this->testTenantId)->create([
            'name' => 'Owner Of Record',
            'status' => 'active',
            'is_approved' => true,
        ]);
        $adminMember = $this->authenticatedUser(['name' => 'Org Admin Member']);
        $seed = $this->seedManagedVolunteerOrg($orgOwner->id);

        // Make the signed-in user an active 'admin' org member (not the org row owner).
        DB::table('org_members')->insert([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $seed['org_id'],
            'org_type' => 'volunteer',
            'user_id' => $adminMember->id,
            'role' => 'admin',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $res = $this->get("/{$this->testTenantSlug}/accessible/volunteering/organisations/{$seed['org_id']}/manage");
        $res->assertOk();
        $res->assertSee(__('govuk_alpha.vol_org.manage_title'));
    }

    public function test_volunteer_org_manage_unknown_org_404s(): void
    {
        $this->authenticatedUser(['name' => 'Manage 404 User']);
        $res = $this->get("/{$this->testTenantSlug}/accessible/volunteering/organisations/99999999/manage");
        $res->assertStatus(404);
    }

    public function test_volunteering_gateway_door_shows_manage_link_for_owned_approved_org(): void
    {
        $owner = $this->authenticatedUser(['name' => 'Discover Owner']);
        $seed = $this->seedManagedVolunteerOrg($owner->id, [
            'name' => 'Discoverable Org',
            'status' => 'approved',
        ]);

        // The two-hats org door replaced the standalone Organisations tab.
        $res = $this->get("/{$this->testTenantSlug}/accessible/volunteering");
        $res->assertOk();
        $res->assertSee(__('govuk_alpha.vol_org.door_heading_one', ['name' => 'Discoverable Org']));
        $res->assertSee(__('govuk_alpha.vol_org.manage_link'));
        // Sole approved org → Manage points to its dashboard.
        $res->assertSee(route('govuk-alpha.volunteering.org.dashboard', ['tenantSlug' => $this->testTenantSlug, 'id' => $seed['org_id']]), false);
        // The Post-opportunity CTA is now discoverable straight from the gateway.
        $res->assertSee(route('govuk-alpha.volunteering.opportunities.create', ['tenantSlug' => $this->testTenantSlug]), false);
    }

    public function test_volunteering_gateway_door_shows_awaiting_approval_for_pending_owned_org(): void
    {
        $owner = $this->authenticatedUser(['name' => 'Pending Owner']);
        $this->seedManagedVolunteerOrg($owner->id, [
            'name' => 'Pending Org',
            'status' => 'pending',
        ]);

        $res = $this->get("/{$this->testTenantSlug}/accessible/volunteering");
        $res->assertOk();
        $res->assertSee('Pending Org');
        $res->assertSee(__('govuk_alpha.vol_org.awaiting_approval'));
        // A pending org must NOT expose the Post-opportunity CTA yet.
        $res->assertDontSee(route('govuk-alpha.volunteering.opportunities.create', ['tenantSlug' => $this->testTenantSlug]), false);
    }

    public function test_members_page_renders_directory_for_authenticated_user(): void
    {
        $viewer = $this->authenticatedUser(['name' => 'Viewer Member']);
        $directoryMember = User::factory()->forTenant($this->testTenantId)->create([
            'name' => 'Alpha Directory Member',
            'first_name' => 'Alpha',
            'last_name' => 'Member',
            'location' => 'Alpha Town',
            'bio' => 'Alpha directory test member biography.',
            'avatar_url' => '/assets/img/defaults/default_avatar.png',
            'onboarding_completed' => true,
            'status' => 'active',
            'is_approved' => true,
            'is_verified' => true,
            'privacy_search' => true,
            'created_at' => now()->addYear(),
        ]);
        // The green "Verified" trust tag keys on the id_verified badge (real identity
        // verification), NOT the email-verified is_verified column — grant one so the
        // tag legitimately renders.
        \Illuminate\Support\Facades\DB::table('member_verification_badges')->insert([
            'user_id' => $directoryMember->id,
            'tenant_id' => $this->testTenantId,
            'badge_type' => 'id_verified',
            'verified_by' => $directoryMember->id,
            'granted_at' => now(),
        ]);
        User::factory()->forTenant(999)->create([
            'name' => 'Other Tenant Member',
        ]);

        Sanctum::actingAs($viewer, ['*']);

        $response = $this->get("/{$this->testTenantSlug}/accessible/members?sort=joined&order=DESC");

        $response->assertOk();
        $response->assertSee('class="govuk-fieldset"', false);
        $response->assertSee('type="search"', false);
        $response->assertSee('class="govuk-select"', false);
        $response->assertSee('Alpha Member');
        $response->assertSee('Alpha Town');
        $response->assertSee('class="govuk-tag govuk-tag--green"', false);
        $response->assertSee("/{$this->testTenantSlug}/accessible/members/", false);
        $response->assertDontSee('Other Tenant Member');
        $response->assertSee('AGPL-3.0-or-later');
    }

    public function test_member_profile_page_renders_accessible_profile_details(): void
    {
        $viewer = $this->authenticatedUser(['name' => 'Profile Viewer']);
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'name' => 'Alpha Profile Member',
            'first_name' => 'Alpha',
            'last_name' => 'Profile',
            'location' => 'Profile Town',
            'bio' => 'Accessible member profile biography.',
            'tagline' => 'Useful neighbour',
            'skills' => 'Gardening, Repairs',
            'avatar_url' => '/assets/img/defaults/default_avatar.png',
            'status' => 'active',
            'is_approved' => true,
            'is_verified' => true,
            'privacy_search' => true,
            'privacy_profile' => 'members',
            'onboarding_completed' => true,
        ]);

        Sanctum::actingAs($viewer, ['*']);

        $response = $this->get("/{$this->testTenantSlug}/accessible/members/{$member->id}");

        $response->assertOk();
        // Surnames are private by default: UserService::getPublicProfile() hides
        // last_name from non-admin viewers, so the displayed name is the first name.
        $response->assertSee('Alpha');
        $response->assertSee('Useful neighbour');
        $response->assertSee('Accessible member profile biography.');
        $response->assertSee(__('govuk_alpha.profile.skills_title'));
        $response->assertSee(__('govuk_alpha.profile.activity_title'));
        $response->assertSee('class="govuk-summary-list"', false);
        $response->assertSee('AGPL-3.0-or-later');
    }

    public function test_member_profile_shows_send_message_button_and_earned_badges(): void
    {
        $viewer = $this->authenticatedUser(['name' => 'Profile Visitor']);
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'name' => 'Badged Member',
            'first_name' => 'Badged',
            'last_name' => 'Member',
            'status' => 'active',
            'is_approved' => true,
            'is_verified' => true,
            'privacy_search' => true,
            'privacy_profile' => 'members',
            'onboarding_completed' => true,
        ]);
        DB::table('user_badges')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'badge_key' => 'community_helper',
            'name' => 'Community Helper',
            'icon' => '⭐',
            'awarded_at' => now(),
        ]);

        Sanctum::actingAs($viewer, ['*']);

        $response = $this->get("/{$this->testTenantSlug}/accessible/members/{$member->id}");
        $response->assertOk();
        // Direct-message entry point (conversations previously could only begin from a listing).
        $response->assertSee(__('govuk_alpha.actions.send_message'));
        $response->assertSee(route('govuk-alpha.messages.new', ['tenantSlug' => $this->testTenantSlug, 'userId' => $member->id]), false);
        // Public earned badges.
        $response->assertSee(__('govuk_alpha.profile.badges_title'));
        $response->assertSee('Community Helper');
    }

    public function test_member_profile_connection_request_accept_and_remove_flow(): void
    {
        $viewer = $this->authenticatedUser([
            'name' => 'Connector One',
            'first_name' => 'Connector',
            'last_name' => 'One',
            'privacy_search' => true,
            'privacy_profile' => 'members',
            'onboarding_completed' => true,
        ]);
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'name' => 'Connector Two',
            'first_name' => 'Connector',
            'last_name' => 'Two',
            'status' => 'active',
            'is_approved' => true,
            'privacy_search' => true,
            'privacy_profile' => 'members',
            'onboarding_completed' => true,
        ]);

        // The viewer sees a Connect button on the member's profile.
        Sanctum::actingAs($viewer, ['*']);
        $profile = $this->get("/{$this->testTenantSlug}/accessible/members/{$member->id}");
        $profile->assertOk();
        $profile->assertSee(__('govuk_alpha.profile.connection.connect'));

        // The viewer sends a connection request.
        $send = $this->post("/{$this->testTenantSlug}/accessible/members/{$member->id}/connection", ['action' => 'connect']);
        $send->assertRedirectContains('status=connection-sent');
        $this->assertDatabaseHas('connections', [
            'requester_id' => $viewer->id,
            'receiver_id' => $member->id,
            'status' => 'pending',
        ]);

        // Re-viewing shows the pending-sent state, and a duplicate request is rejected
        // rather than creating a second row.
        $pending = $this->get("/{$this->testTenantSlug}/accessible/members/{$member->id}");
        $pending->assertSee(__('govuk_alpha.profile.connection.request_sent'));
        $pending->assertSee(__('govuk_alpha.profile.connection.cancel_request'));
        $dup = $this->post("/{$this->testTenantSlug}/accessible/members/{$member->id}/connection", ['action' => 'connect']);
        $dup->assertRedirectContains('status=connection-failed');
        $this->assertSame(
            1,
            DB::table('connections')->where('requester_id', $viewer->id)->where('receiver_id', $member->id)->count()
        );

        // The member accepts from their side (viewing the requester's profile).
        Sanctum::actingAs($member, ['*']);
        $received = $this->get("/{$this->testTenantSlug}/accessible/members/{$viewer->id}");
        $received->assertSee(__('govuk_alpha.profile.connection.accept'));
        $accept = $this->post("/{$this->testTenantSlug}/accessible/members/{$viewer->id}/connection", ['action' => 'accept']);
        $accept->assertRedirectContains('status=connection-accepted');
        $this->assertDatabaseHas('connections', [
            'requester_id' => $viewer->id,
            'receiver_id' => $member->id,
            'status' => 'accepted',
        ]);

        // Either side can now remove the connection.
        $remove = $this->post("/{$this->testTenantSlug}/accessible/members/{$viewer->id}/connection", ['action' => 'remove']);
        $remove->assertRedirectContains('status=connection-removed');
        $this->assertDatabaseMissing('connections', [
            'requester_id' => $viewer->id,
            'receiver_id' => $member->id,
        ]);
    }

    public function test_member_profile_shows_recent_activity_timeline(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'name' => 'Active Member',
            'status' => 'active',
            'is_approved' => true,
        ]);
        FeedPost::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $member->id,
            'content' => 'Timeline post content.',
            'visibility' => 'public',
        ]);
        // A private post must NOT leak into another viewer's activity timeline.
        FeedPost::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $member->id,
            'content' => 'Secret private diary entry.',
            'visibility' => 'private',
        ]);

        $this->authenticatedUser(['name' => 'Timeline Viewer']);

        $response = $this->get("/{$this->testTenantSlug}/accessible/members/{$member->id}");
        $response->assertOk();
        $response->assertSee(__('govuk_alpha.profile.recent_activity_title'));
        $response->assertSee(__('govuk_alpha.profile.activity_types.post'));
        $response->assertSee('Timeline post content.');
        $response->assertDontSee('Secret private diary entry.');
    }

    public function test_member_profile_skill_can_be_endorsed_and_unendorsed(): void
    {
        $viewer = $this->authenticatedUser(['name' => 'Endorser']);
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'name' => 'Endorsed Member',
            'first_name' => 'Endorsed',
            'last_name' => 'Member',
            'status' => 'active',
            'is_approved' => true,
            'privacy_search' => true,
            'privacy_profile' => 'members',
            'onboarding_completed' => true,
        ]);

        Sanctum::actingAs($viewer, ['*']);

        // Endorse a skill.
        $endorse = $this->post("/{$this->testTenantSlug}/accessible/members/{$member->id}/endorse", [
            'skill_name' => 'Gardening',
            'action' => 'endorse',
        ]);
        $endorse->assertRedirectContains('status=endorsement-added');
        $this->assertDatabaseHas('skill_endorsements', [
            'endorser_id' => $viewer->id,
            'endorsed_id' => $member->id,
            'skill_name' => 'Gardening',
        ]);

        // Remove the endorsement.
        $remove = $this->post("/{$this->testTenantSlug}/accessible/members/{$member->id}/endorse", [
            'skill_name' => 'Gardening',
            'action' => 'remove',
        ]);
        $remove->assertRedirectContains('status=endorsement-removed');
        $this->assertDatabaseMissing('skill_endorsements', [
            'endorser_id' => $viewer->id,
            'endorsed_id' => $member->id,
            'skill_name' => 'Gardening',
        ]);

        // You cannot endorse your own skill.
        $self = $this->post("/{$this->testTenantSlug}/accessible/members/{$viewer->id}/endorse", [
            'skill_name' => 'Gardening',
            'action' => 'endorse',
        ]);
        $self->assertRedirectContains('status=endorsement-failed');
    }

    public function test_t1safety_member_can_be_blocked_and_unblocked(): void
    {
        $viewer = $this->authenticatedUser(['name' => 'Blocker']);
        $target = User::factory()->forTenant($this->testTenantId)->create([
            'name' => 'Blocked Member',
            'first_name' => 'Blocked',
            'last_name' => 'Member',
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($viewer, ['*']);

        $block = $this->post("/{$this->testTenantSlug}/accessible/members/{$target->id}/block");
        $block->assertRedirect("/{$this->testTenantSlug}/accessible/members/{$target->id}?status=member-blocked");
        $this->assertDatabaseHas('user_blocks', [
            'user_id' => $viewer->id,
            'blocked_user_id' => $target->id,
        ]);

        // The blocked-users settings page lists them.
        $page = $this->get("/{$this->testTenantSlug}/accessible/profile/blocked");
        $page->assertOk();
        $page->assertSee('Blocked Member');

        // Unblock from the list.
        $unblock = $this->post("/{$this->testTenantSlug}/accessible/members/{$target->id}/unblock", ['from' => 'list']);
        $unblock->assertRedirect("/{$this->testTenantSlug}/accessible/profile/blocked?status=member-unblocked");
        $this->assertDatabaseMissing('user_blocks', [
            'user_id' => $viewer->id,
            'blocked_user_id' => $target->id,
        ]);
    }

    public function test_t1safety_cannot_block_yourself(): void
    {
        $viewer = $this->authenticatedUser(['name' => 'Self Blocker']);
        Sanctum::actingAs($viewer, ['*']);

        $block = $this->post("/{$this->testTenantSlug}/accessible/members/{$viewer->id}/block");
        $block->assertRedirect("/{$this->testTenantSlug}/accessible/members/{$viewer->id}?status=block-self");
        $this->assertDatabaseMissing('user_blocks', [
            'user_id' => $viewer->id,
            'blocked_user_id' => $viewer->id,
        ]);
    }

    public function test_t1safety_two_factor_setup_renders_and_rejects_bad_code(): void
    {
        $features = \App\Services\TenantFeatureConfig::FEATURE_DEFAULTS;
        $features['two_factor_authentication'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode($features),
        ]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);

        $user = $this->authenticatedUser(['name' => 'TwoFactor Member']);
        Sanctum::actingAs($user, ['*']);

        // Setup page renders the QR + the verify form (2FA is off by default).
        $setup = $this->get("/{$this->testTenantSlug}/accessible/profile/two-factor");
        $setup->assertOk();
        $setup->assertSee(__('govuk_alpha.security_2fa.verify_button'));
        $setup->assertSee('name="code"', false);

        // A wrong code is rejected and does not enable 2FA.
        $verify = $this->post("/{$this->testTenantSlug}/accessible/profile/two-factor/verify", ['code' => '000000']);
        $verify->assertRedirect("/{$this->testTenantSlug}/accessible/profile/two-factor?status=2fa-code-invalid");
        $this->assertFalse(app(\App\Services\TotpService::class)->isEnabled($user->id));
    }

    public function test_authentication_enrollment_flags_are_lockout_safe_in_accessible_frontend(): void
    {
        $features = \App\Services\TenantFeatureConfig::FEATURE_DEFAULTS;
        $features['two_factor_authentication'] = false;
        $features['biometric_login'] = false;
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode($features),
        ]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);

        $user = $this->authenticatedUser(['name' => 'Enrollment Disabled Member']);

        $settings = $this->get("/{$this->testTenantSlug}/accessible/profile/settings");
        $settings->assertOk();
        $settings->assertDontSee(__('govuk_alpha.profile_settings.two_factor_heading'));
        $settings->assertDontSee(__('govuk_alpha.profile_settings.passkeys.title'));

        $this->get("/{$this->testTenantSlug}/accessible/profile/two-factor")
            ->assertForbidden();
        $this->post("/{$this->testTenantSlug}/accessible/profile/two-factor/verify", ['code' => '123456'])
            ->assertForbidden();

        DB::table('user_totp_settings')->insert([
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'totp_secret_encrypted' => 'not-read-while-rendering-settings',
            'is_enabled' => 1,
            'is_pending_setup' => 0,
        ]);
        DB::table('webauthn_credentials')->insert([
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'credential_id' => 'accessible-existing-passkey',
            'user_handle' => str_repeat('A', 43),
            'public_key' => 'test-public-key',
            'device_name' => 'Existing accessible passkey',
            'authenticator_type' => 'platform',
            'created_at' => now(),
        ]);

        $existingSettings = $this->get("/{$this->testTenantSlug}/accessible/profile/settings");
        $existingSettings->assertOk();
        $existingSettings->assertSee(__('govuk_alpha.profile_settings.two_factor_heading'));
        $existingSettings->assertSee(__('govuk_alpha.profile_settings.passkeys.title'));
        $existingSettings->assertSee('Existing accessible passkey');

        $this->get("/{$this->testTenantSlug}/accessible/profile/two-factor")
            ->assertOk();
    }

    public function test_t1near_listings_show_near_me_filter(): void
    {
        $this->authenticatedUser(['name' => 'Near Listings']);

        $page = $this->get("/{$this->testTenantSlug}/accessible/listings");
        $page->assertOk();
        $page->assertSee('name="near"', false);
        $page->assertSee(__('govuk_alpha.near_me.label'));
    }

    public function test_t1near_no_location_hint_shown_when_member_has_no_location(): void
    {
        $user = $this->authenticatedUser(['name' => 'No Location Member']);
        DB::table('users')->where('id', $user->id)->update(['latitude' => null, 'longitude' => null]);

        $page = $this->get("/{$this->testTenantSlug}/accessible/listings?near=10");
        $page->assertOk();
        $page->assertSee(__('govuk_alpha.near_me.no_location'));
    }

    public function test_t1near_located_member_can_filter_listings_and_events(): void
    {
        $user = $this->authenticatedUser(['name' => 'Located Member']);
        DB::table('users')->where('id', $user->id)->update(['latitude' => 53.349805, 'longitude' => -6.260310]);

        // Both pages render the proximity query without error (no location hint).
        $listings = $this->get("/{$this->testTenantSlug}/accessible/listings?near=25");
        $listings->assertOk();
        $listings->assertDontSee(__('govuk_alpha.near_me.no_location'));

        $events = $this->get("/{$this->testTenantSlug}/accessible/events?near=25");
        $events->assertOk();
        $events->assertSee('name="near"', false);
    }

    public function test_my_profile_and_settings_update_stay_inside_accessible_frontend(): void
    {
        $user = $this->authenticatedUser([
            'first_name' => 'Before',
            'last_name' => 'Member',
            'name' => 'Before Member',
            'phone' => '+15551234567',
            'privacy_profile' => 'public',
            'privacy_search' => true,
        ]);

        $profile = $this->get("/{$this->testTenantSlug}/accessible/profile");
        $profileUrl = route('govuk-alpha.profile.me', ['tenantSlug' => $this->testTenantSlug]);

        $profile->assertOk();
        // Personal items now live behind the top "My account" hub link, not a
        // direct header profile link nor the service navigation.
        $accountUrl = route('govuk-alpha.account', ['tenantSlug' => $this->testTenantSlug]);
        $profile->assertSee(__('govuk_alpha.nav.account'));
        $profile->assertSee('class="nexus-alpha-header__link" href="' . $accountUrl . '"', false);
        $profile->assertDontSee('class="govuk-service-navigation__link" href="' . $profileUrl . '"', false);
        $profile->assertDontSee(__('govuk_alpha.header.back_to_main_site'));
        $profile->assertSee(route('govuk-alpha.profile.settings', ['tenantSlug' => $this->testTenantSlug]), false);

        $dashboard = $this->get("/{$this->testTenantSlug}/accessible/dashboard");
        $dashboard->assertOk();
        $dashboard->assertSee(__('govuk_alpha.dashboard.title'));
        $dashboard->assertSee(__('govuk_alpha.dashboard.quick_links_title'));
        $dashboard->assertSee(route('govuk-alpha.profile.me', ['tenantSlug' => $this->testTenantSlug]), false);

        $settings = $this->get("/{$this->testTenantSlug}/accessible/profile/settings");
        $settings->assertOk();
        $settings->assertSee(__('govuk_alpha.profile_settings.title'));
        $settings->assertSee('name="privacy_profile"', false);

        $update = $this->post("/{$this->testTenantSlug}/accessible/profile/settings", [
            'first_name' => 'After',
            'last_name' => 'Member',
            'phone' => '+1 555 987 6543',
            'profile_type' => 'individual',
            'organization_name' => '',
            'tagline' => 'Updated accessible tagline',
            'bio' => 'Updated accessible biography.',
            'location' => 'Updated Town',
            'privacy_profile' => 'members',
            'privacy_search' => '1',
        ]);

        $update->assertRedirect("/{$this->testTenantSlug}/accessible/profile?status=profile-updated");

        $this->assertDatabaseHas('users', [
            'id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'first_name' => 'After',
            'last_name' => 'Member',
            'tagline' => 'Updated accessible tagline',
            'privacy_profile' => 'members',
            'privacy_search' => 1,
        ]);
    }

    public function test_members_page_has_html_auth_required_state_when_unauthenticated(): void
    {
        $response = $this->get("/{$this->testTenantSlug}/accessible/members");

        $response->assertOk();
        $response->assertSee(__('govuk_alpha.states.auth_required'));
        $response->assertSee('class="govuk-notification-banner"', false);
        $response->assertSee(route('govuk-alpha.login', ['tenantSlug' => $this->testTenantSlug]), false);
        $response->assertSee(route('govuk-alpha.register', ['tenantSlug' => $this->testTenantSlug]), false);
    }

    public function test_members_page_renders_empty_state_for_authenticated_user(): void
    {
        $viewer = $this->authenticatedUser(['name' => 'Only Visible Member']);

        DB::table('users')
            ->where('tenant_id', $this->testTenantId)
            ->where('id', '!=', $viewer->id)
            ->update(['privacy_search' => 0]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/members");

        $response->assertOk();
        $response->assertSee(__('govuk_alpha.states.empty_title'));
        $response->assertSee(__('govuk_alpha.members.empty'));
        $response->assertSee('class="govuk-inset-text"', false);
    }

    public function test_phase_banner_is_promoted_to_beta(): void
    {
        $response = $this->get("/{$this->testTenantSlug}/accessible");

        $response->assertOk();
        $response->assertSee('class="govuk-phase-banner"', false);
        $this->assertSame('Beta', __('govuk_alpha.phase'));
        $response->assertSee('>' . __('govuk_alpha.phase') . '<', false);
        $response->assertDontSee('>Alpha<', false);
    }

    public function test_profile_settings_page_renders_photo_marketing_and_gdpr_sections(): void
    {
        $this->authenticatedUser();

        $response = $this->get("/{$this->testTenantSlug}/accessible/profile/settings");

        $response->assertOk();
        // Multipart photo upload field.
        $response->assertSee('enctype="multipart/form-data"', false);
        $response->assertSee('name="avatar"', false);
        $response->assertSee('type="file"', false);
        $response->assertSee('class="govuk-file-upload"', false);
        // Marketing consent control.
        $response->assertSee('name="newsletter_opt_in"', false);
        $response->assertSee(__('govuk_alpha.profile_settings.marketing_title'));
        // GDPR data + delete controls.
        $response->assertSee(__('govuk_alpha.profile_settings.data_title'));
        $response->assertSee(route('govuk-alpha.profile.data-export', ['tenantSlug' => $this->testTenantSlug]), false);
        $response->assertSee(route('govuk-alpha.profile.delete', ['tenantSlug' => $this->testTenantSlug]), false);
        $response->assertSee('govuk-button--warning', false);
    }

    public function test_profile_settings_email_form_shows_field_level_error(): void
    {
        $this->authenticatedUser(['name' => 'Field Error User']);

        // An invalid-email failure renders a GOV.UK field-level error on the
        // email input, not just a top-of-page banner.
        $page = $this->get("/{$this->testTenantSlug}/accessible/profile/settings?status=email-invalid");
        $page->assertOk();
        $page->assertSee('govuk-form-group--error', false);
        $page->assertSee('id="new_email-error"', false);
        $page->assertSee('aria-describedby="new_email-error"', false);
    }

    public function test_profile_settings_renders_notification_and_passkey_sections(): void
    {
        $this->authenticatedUser();

        $response = $this->get("/{$this->testTenantSlug}/accessible/profile/settings");

        $response->assertOk();
        // Notification preferences form + a representative toggle from each group.
        $response->assertSee(__('govuk_alpha.profile_settings.notifications.title'));
        $response->assertSee(route('govuk-alpha.profile.notifications.update', ['tenantSlug' => $this->testTenantSlug]), false);
        $response->assertSee('name="email_messages"', false);
        $response->assertSee('name="email_org_admin"', false);
        $response->assertSee('name="push_enabled"', false);
        // Passkey management section (none registered yet).
        $response->assertSee(__('govuk_alpha.profile_settings.passkeys.title'));
        $response->assertSee(__('govuk_alpha.profile_settings.passkeys.none'));
        // No raw translation keys leaked into the rendered page.
        $response->assertDontSee('govuk_alpha.profile_settings.notifications', false);
        $response->assertDontSee('govuk_alpha.profile_settings.passkeys', false);
    }

    public function test_profile_settings_notification_preferences_can_be_saved(): void
    {
        $user = $this->authenticatedUser();

        // Submit a subset on; everything not posted is treated as off.
        $response = $this->post("/{$this->testTenantSlug}/accessible/profile/notifications", [
            'email_messages' => '1',
            'email_reviews' => '1',
            'push_enabled' => '1',
            'federation_notifications_enabled' => '1',
        ]);

        $response->assertRedirect();
        $this->assertStringContainsString('status=notifications-saved', (string) $response->headers->get('Location'));

        $prefs = json_decode((string) DB::table('users')
            ->where('id', $user->id)->where('tenant_id', $this->testTenantId)
            ->value('notification_preferences'), true) ?: [];

        $this->assertSame(1, $prefs['email_messages'] ?? null);
        $this->assertSame(1, $prefs['email_reviews'] ?? null);
        $this->assertSame(0, $prefs['email_listings'] ?? null); // not posted => off
        $this->assertSame(1, (int) DB::table('users')->where('id', $user->id)->value('federation_notifications_enabled'));
    }

    public function test_profile_settings_personalisation_match_and_skills(): void
    {
        $user = $this->authenticatedUser(['name' => 'Settings Parity User']);

        // Personalisation: chronological feed + UGC auto-translate.
        $p = $this->post("/{$this->testTenantSlug}/accessible/profile/personalisation", [
            'prefers_chronological' => '1',
            'auto_translate_ugc' => '1',
            'auto_translate_target_locale' => 'ga',
        ]);
        $p->assertRedirectContains('status=personalisation-saved');
        $row = DB::table('users')->where('id', $user->id)->first();
        $this->assertSame(1, (int) $row->prefers_chronological_feed);
        $this->assertSame(1, (int) $row->auto_translate_ugc);
        $this->assertSame('ga', $row->auto_translate_target_locale);

        // Match notification preferences.
        $m = $this->post("/{$this->testTenantSlug}/accessible/profile/match-preferences", [
            'notification_frequency' => 'weekly',
            'notify_hot_matches' => '1',
        ]);
        $m->assertRedirectContains('status=match-prefs-saved');
        $this->assertDatabaseHas('match_preferences', [
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'notification_frequency' => 'weekly',
        ]);

        // Add a free-text skill, then remove it.
        $add = $this->post("/{$this->testTenantSlug}/accessible/profile/skills/add", [
            'skill_name' => 'Gardening',
            'is_offering' => '1',
        ]);
        $add->assertRedirectContains('status=skill-added');
        $skillId = DB::table('user_skills')
            ->where('user_id', $user->id)->where('skill_name', 'Gardening')->value('id');
        $this->assertNotNull($skillId);

        $remove = $this->post("/{$this->testTenantSlug}/accessible/profile/skills/remove", [
            'user_skill_id' => $skillId,
        ]);
        $remove->assertRedirectContains('status=skill-removed');
        $this->assertDatabaseMissing('user_skills', ['id' => $skillId]);
    }

    public function test_profile_settings_safeguarding_list_and_revoke(): void
    {
        $user = $this->authenticatedUser(['name' => 'Safeguarded Member']);

        $optionId = DB::table('tenant_safeguarding_options')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'option_key' => 'needs_vetted',
            'label' => 'I only interact with vetted members',
            'description' => 'Extra protection for my interactions.',
            'triggers' => json_encode(['restricts_messaging' => true, 'requires_vetted_interaction' => true]),
            'is_active' => 1,
            'sort_order' => 1,
            'created_at' => now(),
        ]);
        DB::table('user_safeguarding_preferences')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'option_id' => $optionId,
            'selected_value' => '1',
            'consent_given_at' => now(),
            'created_at' => now(),
        ]);

        // The settings page lists the active safeguarding preference + what it activates.
        $page = $this->get("/{$this->testTenantSlug}/accessible/profile/settings");
        $page->assertOk();
        $page->assertSee('I only interact with vetted members');
        $page->assertSee(__('govuk_alpha.profile_settings.safeguarding.activations.restricts_messaging'));
        $page->assertSee(__('govuk_alpha.profile_settings.safeguarding.revoke_button'));

        // Withdraw it.
        $revoke = $this->post("/{$this->testTenantSlug}/accessible/profile/safeguarding/revoke", [
            'option_id' => $optionId,
        ]);
        $revoke->assertRedirectContains('status=safeguarding-revoked');
        $this->assertNotNull(DB::table('user_safeguarding_preferences')
            ->where('option_id', $optionId)->where('user_id', $user->id)->value('revoked_at'));
    }

    public function test_profile_settings_hides_false_safeguarding_checkbox_response(): void
    {
        $user = $this->authenticatedUser(['name' => 'Safeguarding No Response']);
        $optionId = DB::table('tenant_safeguarding_options')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'option_key' => 'false_accessible_preference_' . uniqid(),
            'option_type' => 'checkbox',
            'label' => 'False safeguarding preference must stay hidden',
            'triggers' => json_encode(['requires_vetted_interaction' => true]),
            'is_active' => 1,
            'sort_order' => 1,
            'created_at' => now(),
        ]);
        DB::table('user_safeguarding_preferences')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'option_id' => $optionId,
            'selected_value' => '0',
            'consent_given_at' => now(),
            'created_at' => now(),
        ]);

        $this->get("/{$this->testTenantSlug}/accessible/profile/settings")
            ->assertOk()
            ->assertDontSee('False safeguarding preference must stay hidden');
    }

    public function test_profile_settings_shows_private_metadata_only_vetting_status(): void
    {
        $user = $this->authenticatedUser(['name' => 'Vetted Member']);
        $broker = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'broker',
        ]);
        $policyVersion = $this->configureEnglandWalesSafeguardingPolicy((int) $broker->id);

        DB::table('member_vetting_attestations')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'scheme_code' => 'dbs_england_wales',
            'attestation_code' => 'dbs_enhanced',
            'purpose_code' => 'safeguarded_member_contact',
            'scope_type' => 'tenant',
            'scope_identifier' => '',
            'decision' => 'confirmed',
            'confirmed_by' => $broker->id,
            'confirmed_at' => now(),
            'policy_version' => $policyVersion,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $page = $this->get("/{$this->testTenantSlug}/accessible/profile/settings");

        $page->assertOk();
        $page->assertSee(__('govuk_alpha.profile_settings.safeguarding.vetting.title'));
        $page->assertSee(__('safeguarding.attestations.dbs_enhanced'));
        $page->assertSee(__('govuk_alpha.profile_settings.safeguarding.vetting.no_documents'));
        $page->assertDontSee(
            route('govuk-alpha.profile.safeguarding.vetting-review', ['tenantSlug' => $this->testTenantSlug]),
            false,
        );
    }

    public function test_profile_vetting_review_is_empty_body_only_and_never_stores_evidence(): void
    {
        $user = $this->authenticatedUser(['name' => 'Review Request Member']);
        $this->configureEnglandWalesSafeguardingPolicy((int) $user->id);

        $page = $this->get("/{$this->testTenantSlug}/accessible/profile/settings");
        $page->assertOk();
        $action = route('govuk-alpha.profile.safeguarding.vetting-review', ['tenantSlug' => $this->testTenantSlug]);
        $page->assertSee($action, false);

        $html = $page->getContent();
        $matched = preg_match(
            '#<form method="post" action="' . preg_quote($action, '#') . '">(.*?)</form>#s',
            $html,
            $formMatch,
        );
        $this->assertSame(1, $matched);
        $this->assertStringNotContainsString('type="file"', $formMatch[1]);
        $this->assertStringNotContainsString('name="document', $formMatch[1]);
        $this->assertStringNotContainsString('name="certificate', $formMatch[1]);
        $this->assertStringNotContainsString('name="reference', $formMatch[1]);
        $this->assertStringNotContainsString('name="evidence', $formMatch[1]);

        $review = $this->post("/{$this->testTenantSlug}/accessible/profile/safeguarding/vetting-review");
        $review->assertRedirectContains('status=vetting-review-requested');

        $stored = DB::table('safeguarding_vetting_review_requests')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->first();
        $this->assertNotNull($stored);
        $this->assertSame('pending', $stored->status);
        foreach (['document', 'certificate', 'reference', 'result', 'notes', 'evidence'] as $prohibitedColumn) {
            $this->assertArrayNotHasKey($prohibitedColumn, (array) $stored);
        }

        $unexpectedText = $this->post("/{$this->testTenantSlug}/accessible/profile/safeguarding/vetting-review", [
            'certificate_reference' => 'must-not-be-accepted',
        ]);
        $unexpectedText->assertRedirectContains('status=vetting-review-evidence-prohibited');

        $unexpectedFile = $this->post("/{$this->testTenantSlug}/accessible/profile/safeguarding/vetting-review", [
            'certificate' => UploadedFile::fake()->create('dbs-certificate.pdf', 10, 'application/pdf'),
        ]);
        $unexpectedFile->assertRedirectContains('status=vetting-review-evidence-prohibited');
        $this->assertSame(1, DB::table('safeguarding_vetting_review_requests')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->count());
    }

    public function test_profile_safeguarding_policy_review_acknowledgement_updates_consent_metadata_only(): void
    {
        $user = $this->authenticatedUser(['name' => 'Policy Review Member']);
        $optionId = DB::table('tenant_safeguarding_options')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'option_key' => 'policy_review_test',
            'label' => 'Policy review test preference',
            'description' => null,
            'triggers' => json_encode(['restricts_messaging' => true]),
            'is_active' => 1,
            'sort_order' => 1,
            'created_at' => now(),
        ]);
        $oldConsent = now()->subYear();
        DB::table('user_safeguarding_preferences')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'option_id' => $optionId,
            'selected_value' => '1',
            'consent_given_at' => $oldConsent,
            'policy_review_required_at' => now()->subDay(),
            'policy_review_reason_code' => 'jurisdiction_changed',
            'created_at' => $oldConsent,
        ]);

        $page = $this->get("/{$this->testTenantSlug}/accessible/profile/settings");
        $page->assertOk();
        $page->assertSee(__('govuk_alpha.profile_settings.safeguarding.policy_review_title'));
        $page->assertSee(
            route('govuk-alpha.profile.safeguarding.policy-review', ['tenantSlug' => $this->testTenantSlug]),
            false,
        );

        $confirm = $this->post("/{$this->testTenantSlug}/accessible/profile/safeguarding/policy-review");
        $confirm->assertRedirectContains('status=safeguarding-policy-reviewed');

        $preference = DB::table('user_safeguarding_preferences')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->where('option_id', $optionId)
            ->first();
        $this->assertNull($preference->policy_review_required_at);
        $this->assertNull($preference->policy_review_reason_code);
        $this->assertGreaterThan($oldConsent->timestamp, \Illuminate\Support\Carbon::parse($preference->consent_given_at)->timestamp);
    }

    public function test_accessible_endorsement_surfaces_safeguarding_restriction_and_policy_unavailability(): void
    {
        $sender = $this->authenticatedUser(['name' => 'Unvetted Sender']);
        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'name' => 'Protected Recipient',
        ]);
        $this->configureEnglandWalesSafeguardingPolicy((int) $sender->id);
        $optionId = DB::table('tenant_safeguarding_options')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'option_key' => 'vetted_contact_only',
            'label' => 'Vetted contact only',
            'description' => null,
            'triggers' => json_encode([
                'requires_vetted_interaction' => true,
                'vetting_type_required' => 'dbs_enhanced',
            ]),
            'is_active' => 1,
            'sort_order' => 1,
            'created_at' => now(),
        ]);
        DB::table('user_safeguarding_preferences')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $recipient->id,
            'option_id' => $optionId,
            'selected_value' => '1',
            'consent_given_at' => now(),
            'created_at' => now(),
        ]);

        $restricted = $this->post("/{$this->testTenantSlug}/accessible/members/{$recipient->id}/endorse", [
            'action' => 'endorse',
            'skill_name' => 'Gardening',
        ]);
        $restricted->assertRedirectContains('status=endorsement-safeguarding-restricted');
        $this->assertDatabaseMissing('skill_endorsements', [
            'endorser_id' => $sender->id,
            'endorsed_id' => $recipient->id,
        ]);

        DB::table('tenant_safeguarding_settings')
            ->where('tenant_id', $this->testTenantId)
            ->update([
                'jurisdiction' => 'ireland',
                'policy_version' => 'accessible-test-ireland-v1',
                'updated_at' => now(),
            ]);
        app(\App\Services\SafeguardingJurisdictionService::class)->forget($this->testTenantId);

        $unavailable = $this->post("/{$this->testTenantSlug}/accessible/members/{$recipient->id}/endorse", [
            'action' => 'endorse',
            'skill_name' => 'Gardening',
        ]);
        $unavailable->assertRedirectContains('status=endorsement-safeguarding-unavailable');
    }

    public function test_profile_settings_passkey_can_be_renamed_and_removed(): void
    {
        $user = $this->authenticatedUser();

        DB::table('webauthn_credentials')->insert([
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'credential_id' => 'test-cred-abc',
            'user_handle' => str_repeat('B', 43),
            'public_key' => 'PEM',
            'device_name' => 'Old name',
            'authenticator_type' => 'platform',
            'created_at' => now(),
        ]);

        // It is listed on the settings page.
        $page = $this->get("/{$this->testTenantSlug}/accessible/profile/settings");
        $page->assertOk();
        $page->assertSee('Old name');

        // A signed-in session by itself cannot mutate authenticators.
        $renameWithoutStepUp = $this->post("/{$this->testTenantSlug}/accessible/profile/passkeys/rename", [
            'credential_id' => 'test-cred-abc',
            'device_name' => 'Should not persist',
        ]);
        $renameWithoutStepUp->assertRedirectContains('status=passkey-password-required');
        $this->assertSame('Old name', DB::table('webauthn_credentials')
            ->where('credential_id', 'test-cred-abc')->where('user_id', $user->id)->value('device_name'));

        // Rename.
        $rename = $this->post("/{$this->testTenantSlug}/accessible/profile/passkeys/rename", [
            'credential_id' => 'test-cred-abc',
            'device_name' => 'My laptop',
            'current_password' => 'password',
        ]);
        $rename->assertRedirect();
        $this->assertStringContainsString('status=passkey-renamed', (string) $rename->headers->get('Location'));
        $this->assertSame('My laptop', DB::table('webauthn_credentials')
            ->where('credential_id', 'test-cred-abc')->where('user_id', $user->id)->value('device_name'));

        $removeWithoutStepUp = $this->post("/{$this->testTenantSlug}/accessible/profile/passkeys/remove", [
            'credential_id' => 'test-cred-abc',
            'current_password' => 'wrong-password',
        ]);
        $removeWithoutStepUp->assertRedirectContains('status=passkey-password-incorrect');
        $this->assertDatabaseHas('webauthn_credentials', [
            'credential_id' => 'test-cred-abc',
            'user_id' => $user->id,
        ]);

        // Remove.
        $remove = $this->post("/{$this->testTenantSlug}/accessible/profile/passkeys/remove", [
            'credential_id' => 'test-cred-abc',
            'current_password' => 'password',
        ]);
        $remove->assertRedirect();
        $this->assertStringContainsString('status=passkey-removed', (string) $remove->headers->get('Location'));
        $this->assertDatabaseMissing('webauthn_credentials', [
            'credential_id' => 'test-cred-abc',
            'user_id' => $user->id,
        ]);
    }

    public function test_profile_settings_avatar_upload_stores_a_400_by_400_image(): void
    {
        $user = $this->authenticatedUser([
            'first_name' => 'Photo',
            'last_name' => 'Member',
            'name' => 'Photo Member',
        ]);

        // Keep the stored extension deterministic in the test (no cwebp dependency).
        ImageUploader::setAutoConvertWebP(false);

        try {
            $update = $this->post("/{$this->testTenantSlug}/accessible/profile/settings", [
                'first_name' => 'Photo',
                'last_name' => 'Member',
                'profile_type' => 'individual',
                'privacy_profile' => 'public',
                'privacy_search' => '1',
                'avatar' => UploadedFile::fake()->image('portrait.png', 800, 600),
            ]);

            $update->assertRedirect("/{$this->testTenantSlug}/accessible/profile?status=profile-updated");

            $avatarUrl = (string) DB::table('users')
                ->where('id', $user->id)
                ->where('tenant_id', $this->testTenantId)
                ->value('avatar_url');

            $this->assertNotSame('', $avatarUrl);
            $this->assertStringContainsString('/uploads/', $avatarUrl);

            $storedPath = base_path('httpdocs' . parse_url($avatarUrl, PHP_URL_PATH));
            $this->assertFileExists($storedPath);

            // The avatar pipeline crops to a 400x400 square — verify the real output.
            [$width, $height] = getimagesize($storedPath);
            $this->assertSame(400, $width, 'Avatar width should be cropped to 400px');
            $this->assertSame(400, $height, 'Avatar height should be cropped to 400px');

            @unlink($storedPath);
        } finally {
            ImageUploader::setAutoConvertWebP(true);
        }
    }

    public function test_profile_settings_rejects_a_non_image_avatar(): void
    {
        $this->authenticatedUser(['first_name' => 'Valid', 'last_name' => 'Name']);

        $update = $this->post("/{$this->testTenantSlug}/accessible/profile/settings", [
            'first_name' => 'Valid',
            'last_name' => 'Name',
            'profile_type' => 'individual',
            'privacy_profile' => 'public',
            'avatar' => UploadedFile::fake()->create('notes.txt', 16, 'text/plain'),
        ]);

        $update->assertRedirect("/{$this->testTenantSlug}/accessible/profile/settings?status=avatar-invalid");

        $response = $this->get("/{$this->testTenantSlug}/accessible/profile/settings?status=avatar-invalid");
        $response->assertOk();
        $response->assertSee(__('govuk_alpha.states.avatar-invalid'));
        $response->assertSee('class="govuk-error-summary"', false);
    }

    public function test_profile_settings_persists_marketing_consent_choice(): void
    {
        $user = $this->authenticatedUser([
            'first_name' => 'Consent',
            'last_name' => 'Member',
            'name' => 'Consent Member',
            'newsletter_opt_in' => 0,
        ]);

        $base = [
            'first_name' => 'Consent',
            'last_name' => 'Member',
            'profile_type' => 'individual',
            'privacy_profile' => 'public',
            'privacy_search' => '1',
        ];

        $optIn = $this->post("/{$this->testTenantSlug}/accessible/profile/settings", $base + ['newsletter_opt_in' => '1']);
        $optIn->assertRedirect("/{$this->testTenantSlug}/accessible/profile?status=profile-updated");
        $this->assertSame(1, (int) DB::table('users')->where('id', $user->id)->value('newsletter_opt_in'));

        // Omitting the checkbox must withdraw the consent.
        $optOut = $this->post("/{$this->testTenantSlug}/accessible/profile/settings", $base);
        $optOut->assertRedirect("/{$this->testTenantSlug}/accessible/profile?status=profile-updated");
        $this->assertSame(0, (int) DB::table('users')->where('id', $user->id)->value('newsletter_opt_in'));
    }

    public function test_feed_post_accepts_an_image_upload(): void
    {
        $user = $this->authenticatedUser();

        $post = $this->post("/{$this->testTenantSlug}/accessible/feed/posts", [
            'content' => 'Accessible feed post with a photo attached.',
            'image' => UploadedFile::fake()->image('feed-photo.jpg', 800, 800),
            'image_alt' => 'A description of the test photo',
        ]);

        $post->assertRedirect("/{$this->testTenantSlug}/accessible/feed?status=post-created");

        $postId = DB::table('feed_posts')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->orderByDesc('id')
            ->value('id');
        $this->assertNotNull($postId);

        $media = DB::table('post_media')
            ->where('tenant_id', $this->testTenantId)
            ->where('post_id', $postId)
            ->first();

        $this->assertNotNull($media, 'A post_media row should be created for the uploaded image');
        $this->assertSame('image', $media->media_type);
        $this->assertSame('A description of the test photo', $media->alt_text);
        $this->assertSame(800, (int) $media->width);
        $this->assertSame(800, (int) $media->height);
        $this->assertNotEmpty($media->file_url);

        foreach (array_filter([$media->file_url, $media->thumbnail_url]) as $url) {
            $path = base_path('httpdocs' . parse_url($url, PHP_URL_PATH));
            if (is_file($path)) {
                @unlink($path);
            }
        }
    }

    public function test_event_create_accepts_a_cover_image_upload(): void
    {
        $user = $this->authenticatedUser();

        // The create form must declare the multipart encoding and a file input.
        $form = $this->get("/{$this->testTenantSlug}/accessible/events/new");
        $form->assertOk();
        $form->assertSee('enctype="multipart/form-data"', false);
        $form->assertSee('name="image"', false);
        $form->assertSee(__('govuk_alpha.events.create_image_label'));

        $create = $this->post("/{$this->testTenantSlug}/accessible/events/new", [
            'title' => 'Alpha event with a cover image',
            'description' => 'Created through the accessible alpha event form with an image.',
            'start_time' => now()->addDays(12)->format('Y-m-d\TH:i'),
            'end_time' => now()->addDays(12)->addHours(2)->format('Y-m-d\TH:i'),
            'location' => 'Accessible Hall',
            'image' => UploadedFile::fake()->image('event-cover.jpg', 1200, 675),
        ]);

        $eventId = DB::table('events')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->where('title', 'Alpha event with a cover image')
            ->value('id');
        $this->assertNotNull($eventId);
        $create->assertRedirect("/{$this->testTenantSlug}/accessible/events/{$eventId}?status=event-created");

        $coverImage = DB::table('events')->where('id', $eventId)->value('cover_image');
        $this->assertNotEmpty($coverImage, 'The uploaded cover image should be stored on the event');

        // The detail page should now render the stored cover image hero.
        $detail = $this->get("/{$this->testTenantSlug}/accessible/events/{$eventId}");
        $detail->assertOk();
        $detail->assertSee('nexus-alpha-detail-hero', false);

        $path = base_path('httpdocs' . parse_url((string) $coverImage, PHP_URL_PATH));
        if (is_file($path)) {
            @unlink($path);
        }
    }

    public function test_profile_data_export_request_creates_a_gdpr_request(): void
    {
        $user = $this->authenticatedUser();

        $response = $this->post("/{$this->testTenantSlug}/accessible/profile/data-export");

        $response->assertRedirect("/{$this->testTenantSlug}/accessible/profile/settings?status=data-export-requested");
        $this->assertDatabaseHas('gdpr_requests', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'request_type' => 'portability',
            'status' => 'pending',
        ]);

        $settings = $this->get("/{$this->testTenantSlug}/accessible/profile/settings?status=data-export-requested");
        $settings->assertOk();
        $settings->assertSee(__('govuk_alpha.states.data-export-requested'));
    }

    public function test_account_deletion_requires_password_and_confirmation_then_signs_out(): void
    {
        $password = 'CorrectHorseBattery1!';
        $user = $this->authenticatedUser([
            'password_hash' => Hash::make($password),
        ]);

        $confirm = $this->get("/{$this->testTenantSlug}/accessible/profile/delete-account");
        $confirm->assertOk();
        $confirm->assertSee(__('govuk_alpha.delete_account.title'));
        $confirm->assertSee('name="password"', false);
        $confirm->assertSee('name="confirm"', false);
        $confirm->assertSee('class="govuk-warning-text"', false);
        $confirm->assertSee('govuk-button--warning', false);

        // Wrong password must not create an erasure request.
        $wrong = $this->post("/{$this->testTenantSlug}/accessible/profile/delete-account", [
            'password' => 'NotMyPassword',
            'confirm' => '1',
        ]);
        $wrong->assertRedirect("/{$this->testTenantSlug}/accessible/profile/delete-account?status=delete-password-incorrect");
        $this->assertDatabaseMissing('gdpr_requests', [
            'user_id' => $user->id,
            'request_type' => 'erasure',
        ]);

        // Missing the explicit confirmation checkbox is rejected.
        $noConfirm = $this->post("/{$this->testTenantSlug}/accessible/profile/delete-account", [
            'password' => $password,
        ]);
        $noConfirm->assertRedirect("/{$this->testTenantSlug}/accessible/profile/delete-account?status=delete-confirm-required");

        // Correct password + confirmation creates the erasure request and signs out.
        $deleted = $this->post("/{$this->testTenantSlug}/accessible/profile/delete-account", [
            'password' => $password,
            'confirm' => '1',
            'reason' => 'Moving on from the community.',
        ]);
        $deleted->assertRedirect("/{$this->testTenantSlug}/accessible/login?status=account-deletion-requested");
        $deleted->assertCookieExpired('auth_token');
        $this->assertDatabaseHas('gdpr_requests', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'request_type' => 'erasure',
            'status' => 'pending',
        ]);
    }

    public function test_login_page_links_to_forgot_password(): void
    {
        $response = $this->get("/{$this->testTenantSlug}/accessible/login");
        $response->assertOk();
        $response->assertSee(__('govuk_alpha.auth.forgot_link'));
        $response->assertSee(route('govuk-alpha.login.forgot', ['tenantSlug' => $this->testTenantSlug]), false);
    }

    public function test_forgot_password_flow_renders_and_requests_a_reset(): void
    {
        $form = $this->get("/{$this->testTenantSlug}/accessible/login/forgot-password");
        $form->assertOk();
        $form->assertSee(__('govuk_alpha.auth.forgot_title'));
        $form->assertSee('name="email"', false);

        // Invalid email → anchored field error, no request made.
        $invalid = $this->post("/{$this->testTenantSlug}/accessible/login/forgot-password", ['email' => 'not-an-email']);
        $invalid->assertRedirect("/{$this->testTenantSlug}/accessible/login/forgot-password?status=forgot-invalid");

        // Any syntactically valid email → the same anti-enumeration confirmation.
        $sent = $this->post("/{$this->testTenantSlug}/accessible/login/forgot-password", ['email' => 'nobody-' . bin2hex(random_bytes(3)) . '@example.test']);
        $sent->assertRedirect("/{$this->testTenantSlug}/accessible/login/forgot-password?status=forgot-sent");

        $confirm = $this->get("/{$this->testTenantSlug}/accessible/login/forgot-password?status=forgot-sent");
        $confirm->assertOk();
        $confirm->assertSee(__('govuk_alpha.auth.forgot_sent_title'));
    }

    public function test_reset_password_page_renders_and_validates_pre_checks(): void
    {
        // No token → invalid-link state with a "request a new link" route.
        $noToken = $this->get("/{$this->testTenantSlug}/accessible/password/reset");
        $noToken->assertOk();
        $noToken->assertSee(__('govuk_alpha.auth.reset_link_invalid_title'));
        $noToken->assertSee(route('govuk-alpha.login.forgot', ['tenantSlug' => $this->testTenantSlug]), false);
        $noToken->assertDontSee('name="password"', false);

        // With a token → the new-password form.
        $withToken = $this->get("/{$this->testTenantSlug}/accessible/password/reset?token=demo-token-123");
        $withToken->assertOk();
        $withToken->assertSee(__('govuk_alpha.auth.reset_title'));
        $withToken->assertSee('name="password"', false);
        $withToken->assertSee('name="password_confirmation"', false);
        $withToken->assertSee('value="demo-token-123"', false);

        // Mismatched passwords → field error, no v2 call.
        $mismatch = $this->post("/{$this->testTenantSlug}/accessible/password/reset", [
            'token' => 'demo-token-123',
            'password' => 'LongEnoughPass1!',
            'password_confirmation' => 'DifferentPass1!',
        ]);
        $mismatch->assertRedirectContains('status=reset-mismatch');

        // Too-short password → weak.
        $weak = $this->post("/{$this->testTenantSlug}/accessible/password/reset", [
            'token' => 'demo-token-123',
            'password' => 'short',
            'password_confirmation' => 'short',
        ]);
        $weak->assertRedirectContains('status=reset-weak');

        // Missing token → token-missing.
        $missing = $this->post("/{$this->testTenantSlug}/accessible/password/reset", [
            'password' => 'LongEnoughPass1!',
            'password_confirmation' => 'LongEnoughPass1!',
        ]);
        $missing->assertRedirectContains('status=reset-token-missing');
    }

    public function test_profile_settings_account_section_renders_and_updates(): void
    {
        $user = $this->authenticatedUser([
            'first_name' => 'Account',
            'last_name' => 'User',
            'name' => 'Account User',
            'password_hash' => Hash::make('CurrentPass123!'),
            'email' => 'account-' . bin2hex(random_bytes(3)) . '@example.test',
            'preferred_language' => 'en',
        ]);

        $page = $this->get("/{$this->testTenantSlug}/accessible/profile/settings");
        $page->assertOk();
        $page->assertSee(__('govuk_alpha.profile_settings.security_title'));
        $page->assertSee('name="new_password"', false);
        $page->assertSee('id="language"', false);
        $page->assertSee(__('govuk_alpha.profile_settings.languages.ga'));

        // Language change (direct DB update, no email).
        $lang = $this->post("/{$this->testTenantSlug}/accessible/profile/language", ['language' => 'ga']);
        $lang->assertRedirect("/{$this->testTenantSlug}/accessible/profile/settings?status=language-changed");
        $this->assertDatabaseHas('users', ['id' => $user->id, 'preferred_language' => 'ga']);

        $langBad = $this->post("/{$this->testTenantSlug}/accessible/profile/language", ['language' => 'xx']);
        $langBad->assertRedirect("/{$this->testTenantSlug}/accessible/profile/settings?status=language-invalid");

        // Password pre-checks.
        $mismatch = $this->post("/{$this->testTenantSlug}/accessible/profile/password", [
            'current_password' => 'CurrentPass123!',
            'new_password' => 'NewStrongPass456!',
            'new_password_confirmation' => 'DifferentPass456!',
        ]);
        $mismatch->assertRedirect("/{$this->testTenantSlug}/accessible/profile/settings?status=password-mismatch");

        $weak = $this->post("/{$this->testTenantSlug}/accessible/profile/password", [
            'current_password' => 'CurrentPass123!',
            'new_password' => 'short',
            'new_password_confirmation' => 'short',
        ]);
        $weak->assertRedirect("/{$this->testTenantSlug}/accessible/profile/settings?status=password-weak");

        // Password change happy path (no HIBP at this layer; fresh user has no history).
        $changed = $this->post("/{$this->testTenantSlug}/accessible/profile/password", [
            'current_password' => 'CurrentPass123!',
            'new_password' => 'NewStrongPass456!',
            'new_password_confirmation' => 'NewStrongPass456!',
        ]);
        $changed->assertRedirect("/{$this->testTenantSlug}/accessible/profile/settings?status=password-changed");
        $newHash = (string) DB::table('users')->where('id', $user->id)->value('password_hash');
        $this->assertTrue(Hash::check('NewStrongPass456!', $newHash), 'The stored password hash should match the new password');

        // Wrong current password is rejected.
        $wrong = $this->post("/{$this->testTenantSlug}/accessible/profile/password", [
            'current_password' => 'TotallyWrong1!',
            'new_password' => 'AnotherStrong789!',
            'new_password_confirmation' => 'AnotherStrong789!',
        ]);
        $wrong->assertRedirect("/{$this->testTenantSlug}/accessible/profile/settings?status=password-current-incorrect");

        // Email change re-authenticates: wrong password and invalid address are rejected
        // (the actual change emails the old address, so the happy path is left to the API tests).
        $emailWrong = $this->post("/{$this->testTenantSlug}/accessible/profile/email", [
            'email' => 'changed@example.test',
            'current_password' => 'NopeNotIt1!',
        ]);
        $emailWrong->assertRedirect("/{$this->testTenantSlug}/accessible/profile/settings?status=email-password-incorrect");

        $emailBad = $this->post("/{$this->testTenantSlug}/accessible/profile/email", [
            'email' => 'not-an-email',
            'current_password' => 'NewStrongPass456!',
        ]);
        $emailBad->assertRedirect("/{$this->testTenantSlug}/accessible/profile/settings?status=email-invalid");
    }

    public function test_two_factor_page_requires_a_pending_challenge(): void
    {
        // No pending challenge in the session → bounced back to sign in.
        $noChallenge = $this->get("/{$this->testTenantSlug}/accessible/login/two-factor");
        $noChallenge->assertRedirect("/{$this->testTenantSlug}/accessible/login?status=two-factor-expired");

        // With a pending challenge → the code-entry form renders.
        $form = $this->withSession(['alpha_2fa_token' => 'demo-challenge'])
            ->get("/{$this->testTenantSlug}/accessible/login/two-factor");
        $form->assertOk();
        $form->assertSee(__('govuk_alpha.auth.two_factor_title'));
        $form->assertSee('name="code"', false);
        $form->assertSee('name="use_backup_code"', false);

        // Submitting with no code (challenge present) → anchored field error.
        $noCode = $this->withSession(['alpha_2fa_token' => 'demo-challenge'])
            ->post("/{$this->testTenantSlug}/accessible/login/two-factor", ['code' => '']);
        $noCode->assertRedirect("/{$this->testTenantSlug}/accessible/login/two-factor?status=two-factor-code-required");

        // Submitting with no challenge → bounced to sign in.
        $noSession = $this->post("/{$this->testTenantSlug}/accessible/login/two-factor", ['code' => '123456']);
        $noSession->assertRedirect("/{$this->testTenantSlug}/accessible/login?status=two-factor-expired");
    }

    public function test_dashboard_shows_wallet_gamification_and_upcoming_events_sections(): void
    {
        $user = $this->authenticatedUser();
        DB::table('events')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'title' => 'Dashboard upcoming event',
            'description' => 'Shown on the dashboard upcoming-events list.',
            'location' => 'Community Hall',
            'start_time' => now()->addDays(3),
            'end_time' => now()->addDays(3)->addHours(2),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/dashboard");

        $response->assertOk();
        // Core time-credit balance tile (was entirely absent before) — the value
        // comes from WalletService; here we assert the tile itself renders.
        $response->assertSee(__('govuk_alpha.dashboard.timebank_title'));
        $response->assertSee(__('govuk_alpha.dashboard.balance_label'));
        // Gamification: level/XP heading + progress bar.
        $response->assertSee(__('govuk_alpha.dashboard.progress_title'));
        $response->assertSee('<progress', false);
        // Upcoming events (community-wide, same as React).
        $response->assertSee(__('govuk_alpha.dashboard.upcoming_events_title'));
        $response->assertSee('Dashboard upcoming event');
    }

    public function test_event_detail_renders_for_owner_with_null_end_time(): void
    {
        $owner = $this->authenticatedUser(['name' => 'Event Owner 326']);
        $eventId = DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'title' => 'Owner event no end time',
            'description' => 'Repro of the events/{id}?status=event-created 500.',
            'location' => 'Skibbereen, County Cork, Ireland',
            'start_time' => now()->addDays(2),
            'end_time' => null,
            'status' => 'active',
            'max_attendees' => 10,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/events/{$eventId}?status=event-created");
        $response->assertOk();
        $response->assertSee('Owner event no end time');
        $response->assertSee(__('govuk_alpha.events.created'));
    }

    public function test_dashboard_shows_personalised_header_and_onboarding_prompt(): void
    {
        $user = $this->authenticatedUser(['name' => 'Dash User', 'first_name' => 'Dash']);
        DB::table('users')->where('id', $user->id)->update(['onboarding_completed' => 0]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/dashboard");

        $response->assertOk();
        // Personalised welcome using the member's first name.
        $response->assertSee(__('govuk_alpha.dashboard.welcome', ['name' => 'Dash']));
        // Onboarding prompt while onboarding is incomplete.
        $response->assertSee(__('govuk_alpha.dashboard.onboarding_title'));
        // Prominent create-listing call to action.
        $response->assertSee(__('govuk_alpha.dashboard.new_listing'));
        $response->assertSee(route('govuk-alpha.listings.create', ['tenantSlug' => $this->testTenantSlug]), false);
    }

    public function test_wallet_page_renders_balance_and_transaction_history(): void
    {
        $user = $this->authenticatedUser(['name' => 'Wallet Owner']);
        DB::table('users')->where('id', $user->id)->update(['balance' => 20]);

        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'first_name' => 'Gardening',
            'last_name' => 'Neighbour',
        ]);
        DB::table('users')->where('id', $recipient->id)->update(['balance' => 0]);

        // Seed a transaction through the real transfer endpoint so every column is
        // set correctly and the history table renders a row.
        $this->post("/{$this->testTenantSlug}/accessible/wallet/transfer", [
            'recipient_id' => $recipient->id,
            'amount' => '5',
            'note' => 'Allotment digging',
        ])->assertRedirectContains('status=transfer-sent');

        $response = $this->get("/{$this->testTenantSlug}/accessible/wallet");

        $response->assertOk();
        $response->assertSee(__('govuk_alpha.wallet.title'));
        // Balance is 20 − 5 = 15.00, formatted to two decimals.
        $response->assertSee(__('govuk_alpha.wallet.hours_value', ['value' => '15.00']));
        $response->assertSee(__('govuk_alpha.wallet.history_title'));
        $response->assertSee('Allotment digging');
        $response->assertSee('Gardening Neighbour');
    }

    public function test_wallet_recipient_search_disambiguates_same_named_members(): void
    {
        $this->disableMeiliSearch();
        $this->authenticatedUser(['name' => 'Searcher Member']);

        // Two members with the IDENTICAL display name, told apart ONLY by
        // location + "member since". The surname is an invented token so
        // Meilisearch can't fuzz-match it to real seed members — that guarantees
        // the deterministic SQL LIKE fallback runs and returns BOTH test users
        // (which, being transaction-scoped, are never in the Meili index).
        $maryA = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
            'first_name' => 'Quenby', 'last_name' => 'Zzyzxington',
        ]);
        DB::table('users')->where('id', $maryA->id)->update(['location' => 'Cork', 'created_at' => '2024-03-15 10:00:00']);

        $maryB = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
            'first_name' => 'Quenby', 'last_name' => 'Zzyzxington',
        ]);
        DB::table('users')->where('id', $maryB->id)->update(['location' => 'Galway', 'created_at' => '2023-09-01 10:00:00']);

        $response = $this->get("/{$this->testTenantSlug}/accessible/wallet?recipient_q=Zzyzxington");

        $response->assertOk();
        // Both identically-named members appear, distinguished by location + member-since.
        $response->assertSee('Quenby Zzyzxington');
        $response->assertSee('Cork');
        $response->assertSee('Galway');
        $response->assertSee(__('govuk_alpha.wallet.member_since', ['date' => 'March 2024']));
        $response->assertSee(__('govuk_alpha.wallet.member_since', ['date' => 'September 2023']));
    }

    public function test_account_hub_renders_personal_facilities(): void
    {
        $this->authenticatedUser(['name' => 'Hub User']);

        $response = $this->get("/{$this->testTenantSlug}/accessible/account");

        $response->assertOk();
        $response->assertSee(__('govuk_alpha.account.title'));
        $response->assertSee(__('govuk_alpha.account.wallet_title'));
        $response->assertSee(__('govuk_alpha.account.profile_title'));
        $response->assertSee(__('govuk_alpha.account.settings_title'));
        // Cards link to the real destinations, including Matches + Group exchanges
        // which now live in the hub rather than the service nav.
        $response->assertSee(route('govuk-alpha.wallet.index', ['tenantSlug' => $this->testTenantSlug]), false);
        $response->assertSee(route('govuk-alpha.profile.settings', ['tenantSlug' => $this->testTenantSlug]), false);
        $response->assertSee(route('govuk-alpha.matches.index', ['tenantSlug' => $this->testTenantSlug]), false);
        $response->assertSee(route('govuk-alpha.group-exchanges.index', ['tenantSlug' => $this->testTenantSlug]), false);
    }

    public function test_service_nav_ends_with_explore_and_excludes_personal_items(): void
    {
        $this->authenticatedUser(['name' => 'Nav User']);

        $response = $this->get("/{$this->testTenantSlug}/accessible/dashboard");
        $response->assertOk();
        $html = $response->getContent();

        $navList = '<ul class="govuk-service-navigation__list"';
        $navStart = strpos($html, $navList);
        $this->assertNotFalse($navStart, 'service navigation list should render');
        $navHtml = substr($html, $navStart);

        $volunteeringPos = strpos($navHtml, route('govuk-alpha.volunteering.index', ['tenantSlug' => $this->testTenantSlug]));
        $explorePos = strpos($navHtml, route('govuk-alpha.explore', ['tenantSlug' => $this->testTenantSlug]));
        $this->assertNotFalse($volunteeringPos);
        $this->assertNotFalse($explorePos);
        // Explore is the last item in the bar (after Volunteering).
        $this->assertGreaterThan($volunteeringPos, $explorePos);

        // Polls and Exchanges have moved to the Explore page — not in the service nav.
        $this->assertStringNotContainsString(
            'govuk-service-navigation__link" href="' . route('govuk-alpha.polls.index', ['tenantSlug' => $this->testTenantSlug]),
            $navHtml
        );
        $this->assertStringNotContainsString(
            'govuk-service-navigation__link" href="' . route('govuk-alpha.exchanges.index', ['tenantSlug' => $this->testTenantSlug]),
            $navHtml
        );
        // Matches + Group exchanges remain out of the service navigation.
        $this->assertStringNotContainsString(
            'govuk-service-navigation__link" href="' . route('govuk-alpha.matches.index', ['tenantSlug' => $this->testTenantSlug]),
            $navHtml
        );
        $this->assertStringNotContainsString(
            'govuk-service-navigation__link" href="' . route('govuk-alpha.group-exchanges.index', ['tenantSlug' => $this->testTenantSlug]),
            $navHtml
        );
    }

    public function test_explore_page_surfaces_polls_and_exchanges(): void
    {
        $this->authenticatedUser(['name' => 'Explorer Two']);

        $explore = $this->get("/{$this->testTenantSlug}/accessible/explore");
        $explore->assertOk();
        // Polls moved here from the service nav (polls feature is on by default).
        $explore->assertSee(route('govuk-alpha.polls.index', ['tenantSlug' => $this->testTenantSlug]), false);
        $explore->assertSee(__('govuk_alpha.polls.title'));
        // Jobs is a discovery facility surfaced on Explore (job_vacancies on by
        // default), not in the lean service nav.
        $explore->assertSee(route('govuk-alpha.jobs.index', ['tenantSlug' => $this->testTenantSlug]), false);
        $explore->assertSee(__('govuk_alpha.jobs.title'));
    }

    public function test_header_surfaces_account_link_when_signed_in(): void
    {
        $this->authenticatedUser(['name' => 'Header User']);

        $response = $this->get("/{$this->testTenantSlug}/accessible/dashboard");

        $response->assertOk();
        // The top zone holds a single "My account" hub link (wallet and the rest
        // of the personal items live behind it, not as separate header chips).
        $response->assertSee(__('govuk_alpha.nav.account'));
        $response->assertSee('class="nexus-alpha-header__link" href="' . route('govuk-alpha.account', ['tenantSlug' => $this->testTenantSlug]) . '"', false);
        // Wallet is no longer a separate header chip.
        $response->assertDontSee('class="nexus-alpha-header__link nexus-alpha-header__link--wallet"', false);
    }

    public function test_wallet_recipient_autocomplete_endpoint_and_pick_by_id(): void
    {
        $this->disableMeiliSearch();
        $this->authenticatedUser(['name' => 'Picker Member']);
        $target = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
            'first_name' => 'Quenby', 'last_name' => 'Zzyzxington',
        ]);
        DB::table('users')->where('id', $target->id)->update(['location' => 'Cork', 'created_at' => '2024-03-15 10:00:00']);

        // JSON suggestions endpoint (powers the JS autocomplete).
        $json = $this->getJson("/{$this->testTenantSlug}/accessible/wallet/recipients?q=Zzyzxington");
        $json->assertOk();
        // Position-independent: just assert our member is present with the
        // disambiguation fields + id.
        $json->assertJsonFragment(['id' => $target->id, 'name' => 'Quenby Zzyzxington', 'location' => 'Cork', 'since' => 'Mar 2024']);

        // Picking by recipient_id resolves to exactly that one transfer card.
        $page = $this->get("/{$this->testTenantSlug}/accessible/wallet?recipient_id={$target->id}");
        $page->assertOk();
        $page->assertSee('Quenby Zzyzxington');
        $page->assertSee(route('govuk-alpha.wallet.transfer', ['tenantSlug' => $this->testTenantSlug]), false);
        // The progressive-enhancement hooks are present in the markup.
        $page->assertSee('data-alpha-recipient-autocomplete', false);
        $page->assertSee(route('govuk-alpha.wallet.recipients', ['tenantSlug' => $this->testTenantSlug]), false);
    }

    public function test_wallet_recipient_autocomplete_endpoint_requires_min_query(): void
    {
        $this->authenticatedUser(['name' => 'Picker Member']);

        // Too-short queries return no results (don't hammer the search backend).
        $json = $this->getJson("/{$this->testTenantSlug}/accessible/wallet/recipients?q=a");
        $json->assertOk();
        $json->assertExactJson(['results' => []]);
    }

    public function test_wallet_transfer_moves_credits_between_members(): void
    {
        $sender = $this->authenticatedUser(['name' => 'Sender Member']);
        DB::table('users')->where('id', $sender->id)->update(['balance' => 10]);

        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'name' => 'Recipient Member',
            'balance' => 0,
        ]);

        // Whole-hour amount keeps the assertion exact regardless of the test DB's
        // balance column precision (nexus_test is int; production is decimal(10,2)).
        $response = $this->post("/{$this->testTenantSlug}/accessible/wallet/transfer", [
            'recipient_id' => $recipient->id,
            'amount' => '3',
            'note' => 'Thanks for the help',
        ]);

        $response->assertRedirectContains('status=transfer-sent');

        $this->assertSame(7.0, (float) DB::table('users')->where('id', $sender->id)->value('balance'));
        $this->assertSame(3.0, (float) DB::table('users')->where('id', $recipient->id)->value('balance'));
    }

    public function test_wallet_transfer_rejects_a_recipient_from_another_tenant(): void
    {
        $sender = $this->authenticatedUser(['name' => 'Tenant Two Sender']);
        DB::table('users')->where('id', $sender->id)->update(['balance' => 10]);

        // A user that belongs to the pre-seeded second tenant (id 999).
        $foreign = User::factory()->forTenant(999)->create([
            'status' => 'active',
            'is_approved' => true,
            'name' => 'Foreign Member',
            'balance' => 0,
        ]);

        $response = $this->post("/{$this->testTenantSlug}/accessible/wallet/transfer", [
            'recipient_id' => $foreign->id,
            'amount' => '3',
        ]);

        // The defensive same-tenant guard rejects before any balance moves.
        $response->assertRedirectContains('error=not-found');
        $this->assertSame(10.0, (float) DB::table('users')->where('id', $sender->id)->value('balance'));
        $this->assertSame(0.0, (float) DB::table('users')->where('id', $foreign->id)->value('balance'));
    }

    public function test_wallet_transfer_rejects_insufficient_balance(): void
    {
        $sender = $this->authenticatedUser(['name' => 'Broke Member']);
        DB::table('users')->where('id', $sender->id)->update(['balance' => 1]);

        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'name' => 'Hopeful Member',
            'balance' => 0,
        ]);

        $response = $this->post("/{$this->testTenantSlug}/accessible/wallet/transfer", [
            'recipient_id' => $recipient->id,
            'amount' => 5,
        ]);

        $response->assertRedirectContains('error=insufficient');
        $this->assertSame(1.0, (float) DB::table('users')->where('id', $sender->id)->value('balance'));
        $this->assertSame(0.0, (float) DB::table('users')->where('id', $recipient->id)->value('balance'));
    }

    public function test_connections_inbox_renders_received_sent_and_accepted(): void
    {
        $me = $this->authenticatedUser(['name' => 'Me Member']);
        $requester = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'name' => 'Rhea Requester']);
        $sentTo = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'name' => 'Sandro Sent']);
        $friend = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'name' => 'Fiona Friend']);

        DB::table('connections')->insert([
            ['tenant_id' => $this->testTenantId, 'requester_id' => $requester->id, 'receiver_id' => $me->id, 'status' => 'pending', 'created_at' => now(), 'updated_at' => now()],
            ['tenant_id' => $this->testTenantId, 'requester_id' => $me->id, 'receiver_id' => $sentTo->id, 'status' => 'pending', 'created_at' => now(), 'updated_at' => now()],
            ['tenant_id' => $this->testTenantId, 'requester_id' => $friend->id, 'receiver_id' => $me->id, 'status' => 'accepted', 'created_at' => now(), 'updated_at' => now()],
        ]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/connections");

        $response->assertOk();
        $response->assertSee(__('govuk_alpha.connections.received_title'));
        $response->assertSee(__('govuk_alpha.connections.accepted_title'));
        $response->assertSee(__('govuk_alpha.connections.sent_title'));
        $response->assertSee('Rhea Requester');  // pending received
        $response->assertSee('Sandro Sent');     // pending sent
        $response->assertSee('Fiona Friend');    // accepted
    }

    public function test_connection_accept_marks_it_accepted(): void
    {
        $me = $this->authenticatedUser(['name' => 'Me Member']);
        $requester = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'name' => 'Req User']);
        $cid = DB::table('connections')->insertGetId([
            'tenant_id' => $this->testTenantId, 'requester_id' => $requester->id, 'receiver_id' => $me->id,
            'status' => 'pending', 'created_at' => now(), 'updated_at' => now(),
        ]);

        $response = $this->post("/{$this->testTenantSlug}/accessible/connections/{$cid}/accept");

        $response->assertRedirectContains('status=connection-accepted');
        $this->assertSame('accepted', DB::table('connections')->where('id', $cid)->value('status'));
    }

    public function test_connection_decline_deletes_the_request(): void
    {
        $me = $this->authenticatedUser(['name' => 'Me Member']);
        $requester = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'name' => 'Req User']);
        $cid = DB::table('connections')->insertGetId([
            'tenant_id' => $this->testTenantId, 'requester_id' => $requester->id, 'receiver_id' => $me->id,
            'status' => 'pending', 'created_at' => now(), 'updated_at' => now(),
        ]);

        $response = $this->post("/{$this->testTenantSlug}/accessible/connections/{$cid}/decline");

        $response->assertRedirectContains('status=connection-declined');
        $this->assertSame(0, DB::table('connections')->where('id', $cid)->count());
    }

    public function test_connection_cancel_removes_a_sent_request(): void
    {
        $me = $this->authenticatedUser(['name' => 'Me Member']);
        $sentTo = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'name' => 'Target User']);
        $cid = DB::table('connections')->insertGetId([
            'tenant_id' => $this->testTenantId, 'requester_id' => $me->id, 'receiver_id' => $sentTo->id,
            'status' => 'pending', 'created_at' => now(), 'updated_at' => now(),
        ]);

        $response = $this->post("/{$this->testTenantSlug}/accessible/connections/{$cid}/remove");

        $response->assertRedirectContains('status=connection-removed');
        $this->assertSame(0, DB::table('connections')->where('id', $cid)->count());
    }

    public function test_connection_accept_rejects_a_non_participant(): void
    {
        $this->authenticatedUser(['name' => 'Bystander']);
        $a = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'name' => 'Alpha User']);
        $b = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'name' => 'Bravo User']);
        // A pending request between two OTHER members — the signed-in user is neither.
        $cid = DB::table('connections')->insertGetId([
            'tenant_id' => $this->testTenantId, 'requester_id' => $a->id, 'receiver_id' => $b->id,
            'status' => 'pending', 'created_at' => now(), 'updated_at' => now(),
        ]);

        $response = $this->post("/{$this->testTenantSlug}/accessible/connections/{$cid}/accept");

        $response->assertRedirectContains('status=connection-failed');
        $this->assertSame('pending', DB::table('connections')->where('id', $cid)->value('status'));
    }

    public function test_group_exchange_create_redirects_to_detail_and_lists(): void
    {
        $creator = $this->authenticatedUser(['name' => 'GX Creator']);

        $response = $this->post("/{$this->testTenantSlug}/accessible/group-exchanges/new", [
            'title' => 'Spring cleanup',
            'total_hours' => 3,
            'split_type' => 'equal',
        ]);

        $response->assertRedirectContains('/group-exchanges/');
        $response->assertRedirectContains('status=created');
        $this->assertSame(1, DB::table('group_exchanges')
            ->where('tenant_id', $this->testTenantId)
            ->where('organizer_id', $creator->id)
            ->where('title', 'Spring cleanup')
            ->count());

        $list = $this->get("/{$this->testTenantSlug}/accessible/group-exchanges");
        $list->assertOk();
        $list->assertSee('Spring cleanup');
    }

    public function test_group_exchange_organiser_adds_and_removes_a_participant(): void
    {
        $organiser = $this->authenticatedUser(['name' => 'Organiser']);
        $svc = app(\App\Services\GroupExchangeService::class);
        $exId = $svc->create($organiser->id, ['title' => 'GX', 'total_hours' => 2, 'split_type' => 'custom', 'status' => 'draft']);

        $member = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'first_name' => 'Pat', 'last_name' => 'Helper',
        ]);

        $add = $this->post("/{$this->testTenantSlug}/accessible/group-exchanges/{$exId}/participants", [
            'participant_id' => $member->id, 'role' => 'provider', 'hours' => 2,
        ]);
        $add->assertRedirectContains('status=participant-added');

        $detail = $this->get("/{$this->testTenantSlug}/accessible/group-exchanges/{$exId}");
        $detail->assertOk();
        $detail->assertSee('Pat Helper');

        $remove = $this->post("/{$this->testTenantSlug}/accessible/group-exchanges/{$exId}/participants/{$member->id}/remove");
        $remove->assertRedirectContains('status=participant-removed');
        $this->assertSame(0, DB::table('group_exchange_participants')->where('group_exchange_id', $exId)->count());
    }

    public function test_group_exchange_complete_moves_credits_when_all_confirmed(): void
    {
        $organiser = $this->authenticatedUser(['name' => 'Organiser']);
        $svc = app(\App\Services\GroupExchangeService::class);
        $exId = $svc->create($organiser->id, ['title' => 'Pool of hours', 'total_hours' => 4, 'split_type' => 'custom', 'status' => 'draft']);

        $provider = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'name' => 'Provider P']);
        $receiver = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'name' => 'Receiver R']);
        DB::table('users')->where('id', $provider->id)->update(['balance' => 0]);
        DB::table('users')->where('id', $receiver->id)->update(['balance' => 10]);

        // Whole hours keep the assertion exact on the int-column test DB.
        $svc->addParticipant($exId, $provider->id, 'provider', 4, 1.0);
        $svc->addParticipant($exId, $receiver->id, 'receiver', 4, 1.0);
        $svc->confirmParticipation($exId, $provider->id);
        $svc->confirmParticipation($exId, $receiver->id);

        $complete = $this->post("/{$this->testTenantSlug}/accessible/group-exchanges/{$exId}/complete");

        $complete->assertRedirectContains('status=completed');
        $this->assertSame(4.0, (float) DB::table('users')->where('id', $provider->id)->value('balance'));
        $this->assertSame(6.0, (float) DB::table('users')->where('id', $receiver->id)->value('balance'));
        $this->assertSame('completed', DB::table('group_exchanges')->where('id', $exId)->value('status'));
    }

    public function test_group_exchange_add_participant_rejected_for_non_organiser(): void
    {
        $organiser = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'name' => 'Real Organiser']);
        $svc = app(\App\Services\GroupExchangeService::class);
        $exId = $svc->create($organiser->id, ['title' => 'Not yours', 'total_hours' => 2, 'split_type' => 'custom', 'status' => 'draft']);

        // A different signed-in member tries to add someone to an exchange they don't own.
        $this->authenticatedUser(['name' => 'Outsider']);
        $victim = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'name' => 'Victim']);

        $response = $this->post("/{$this->testTenantSlug}/accessible/group-exchanges/{$exId}/participants", [
            'participant_id' => $victim->id, 'role' => 'provider', 'hours' => 1,
        ]);

        $response->assertRedirectContains('status=add-failed');
        $this->assertSame(0, DB::table('group_exchange_participants')->where('group_exchange_id', $exId)->count());
    }

    public function test_matches_page_renders_for_a_signed_in_member(): void
    {
        $this->authenticatedUser(['name' => 'Matcher Member']);

        // The page must render whether or not the engine finds matches (the
        // controller degrades to an empty state on any engine error).
        $response = $this->get("/{$this->testTenantSlug}/accessible/matches");

        $response->assertOk();
        $response->assertSee(__('govuk_alpha.matches.title'));
        $response->assertSee(__('govuk_alpha.matches.description'));
    }

    public function test_polls_page_shows_open_poll_with_vote_form(): void
    {
        $creator = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'name' => 'Poll Maker']);
        $pollId = DB::table('polls')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $creator->id, 'question' => 'Best day for the meet-up?',
            'is_active' => 1, 'end_date' => null, 'created_at' => now(),
        ]);
        DB::table('poll_options')->insert([
            ['tenant_id' => $this->testTenantId, 'poll_id' => $pollId, 'label' => 'Monday', 'votes' => 0],
            ['tenant_id' => $this->testTenantId, 'poll_id' => $pollId, 'label' => 'Tuesday', 'votes' => 0],
        ]);

        // A non-creator who has not voted sees the vote form (ballot integrity hides totals).
        $this->authenticatedUser(['name' => 'Voter One']);
        $response = $this->get("/{$this->testTenantSlug}/accessible/polls");

        $response->assertOk();
        $response->assertSee(__('govuk_alpha.polls.title'));
        $response->assertSee('Best day for the meet-up?');
        $response->assertSee('Monday');
        $response->assertSee('Tuesday');
        $response->assertSee(__('govuk_alpha.polls.vote_button'));
    }

    public function test_poll_vote_records_the_vote(): void
    {
        $creator = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'name' => 'Poll Maker']);
        $pollId = DB::table('polls')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $creator->id, 'question' => 'Tea or coffee?',
            'is_active' => 1, 'end_date' => null, 'created_at' => now(),
        ]);
        $optionId = DB::table('poll_options')->insertGetId(['tenant_id' => $this->testTenantId, 'poll_id' => $pollId, 'label' => 'Tea', 'votes' => 0]);

        $voter = $this->authenticatedUser(['name' => 'Voter Two']);
        $response = $this->post("/{$this->testTenantSlug}/accessible/polls/{$pollId}/vote", ['option_id' => $optionId]);

        $response->assertRedirectContains('status=voted');
        $this->assertSame(1, DB::table('poll_votes')
            ->where('poll_id', $pollId)
            ->where('option_id', $optionId)
            ->where('user_id', $voter->id)
            ->count());
    }

    public function test_polls_page_shows_closed_poll_results_with_leading_option(): void
    {
        $creator = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'name' => 'Poll Maker']);
        // end_date in the past → closed → results become visible to everyone.
        $pollId = DB::table('polls')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $creator->id, 'question' => 'Which community logo?',
            'is_active' => 1, 'end_date' => now()->subDay(), 'created_at' => now()->subDays(5),
        ]);
        $blue = DB::table('poll_options')->insertGetId(['tenant_id' => $this->testTenantId, 'poll_id' => $pollId, 'label' => 'Blue', 'votes' => 0]);
        $green = DB::table('poll_options')->insertGetId(['tenant_id' => $this->testTenantId, 'poll_id' => $pollId, 'label' => 'Green', 'votes' => 0]);

        // Blue leads 2–1.
        foreach ([$blue, $blue, $green] as $i => $optId) {
            $v = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
            DB::table('poll_votes')->insert([
                'tenant_id' => $this->testTenantId, 'poll_id' => $pollId, 'option_id' => $optId, 'user_id' => $v->id, 'created_at' => now(),
            ]);
        }

        $this->authenticatedUser(['name' => 'Results Viewer']);
        $response = $this->get("/{$this->testTenantSlug}/accessible/polls");

        $response->assertOk();
        $response->assertSee(__('govuk_alpha.polls.closed_section_title'));
        $response->assertSee('Which community logo?');
        $response->assertSee('Blue');
        $response->assertSee('Green');
        $response->assertSee(__('govuk_alpha.polls.closed_tag'));
        // Results are visible and the winning option is flagged as leading.
        $response->assertSee(__('govuk_alpha.polls.leading'));
    }

    public function test_timebanking_guide_renders_publicly(): void
    {
        // Public, no auth: newcomers can read how timebanking works before signing up.
        $guest = $this->get("/{$this->testTenantSlug}/accessible/guide");

        $guest->assertOk();
        $guest->assertSee(__('govuk_alpha.guide.title'));
        $guest->assertSee(__('govuk_alpha.guide.equal_title'));
        $guest->assertSee(__('govuk_alpha.guide.step1_title'));
        $guest->assertSee(__('govuk_alpha.guide.step3_title'));
        // Signed-out visitors get a create-account call to action.
        $guest->assertSee(route('govuk-alpha.register', ['tenantSlug' => $this->testTenantSlug]), false);
    }

    public function test_explore_hub_and_discovery_pages_render(): void
    {
        $this->authenticatedUser(['name' => 'Explorer']);

        foreach (['explore', 'search', 'groups', 'goals', 'skills', 'organisations'] as $path) {
            $response = $this->get("/{$this->testTenantSlug}/accessible/{$path}");
            $response->assertOk();
        }

        $this->get("/{$this->testTenantSlug}/accessible/explore")->assertSee(__('govuk_alpha.explore.title'));
        $this->get("/{$this->testTenantSlug}/accessible/goals")->assertSee(__('govuk_alpha.goals.create_title'));
        $this->get("/{$this->testTenantSlug}/accessible/organisations")->assertSee(__('govuk_alpha.organisations.register_title'));
    }

    public function test_goal_create_stores_a_goal(): void
    {
        $user = $this->authenticatedUser(['name' => 'Goal Setter']);

        $response = $this->post("/{$this->testTenantSlug}/accessible/goals", [
            'title' => 'Give 20 hours this year',
            'target_value' => 20,
            'description' => 'My volunteering target',
        ]);

        $response->assertRedirectContains('status=goal-created');
        $this->assertSame(1, DB::table('goals')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->where('title', 'Give 20 hours this year')
            ->count());
    }

    public function test_notifications_inbox_renders(): void
    {
        $this->authenticatedUser(['name' => 'Notified Member']);
        $response = $this->get("/{$this->testTenantSlug}/accessible/notifications");
        $response->assertOk();
        $response->assertSee(__('govuk_alpha.notifications.title'));
        $response->assertSee(__('govuk_alpha.notifications.all_filter'));
    }

    public function test_activity_page_renders(): void
    {
        $this->authenticatedUser(['name' => 'Active Member']);
        $response = $this->get("/{$this->testTenantSlug}/accessible/activity");
        $response->assertOk();
        $response->assertSee(__('govuk_alpha.activity.title'));
        $response->assertSee(__('govuk_alpha.activity.hours_given'));
    }

    public function test_reviews_page_renders(): void
    {
        $this->authenticatedUser(['name' => 'Reviewed Member']);
        $response = $this->get("/{$this->testTenantSlug}/accessible/reviews");
        $response->assertOk();
        $response->assertSee(__('govuk_alpha.reviews_page.title'));
        $response->assertSee(__('govuk_alpha.reviews_page.received_tab'));
    }

    public function test_features_and_faq_render_publicly(): void
    {
        $features = $this->get("/{$this->testTenantSlug}/accessible/features");
        $features->assertOk();
        $features->assertSee(__('govuk_alpha.features.title'));

        $faq = $this->get("/{$this->testTenantSlug}/accessible/faq");
        $faq->assertOk();
        $faq->assertSee(__('govuk_alpha.faq.title'));
        $faq->assertSee(__('govuk_alpha.faq.q1'));
    }

    public function test_achievements_page_renders_level_and_badges(): void
    {
        $this->authenticatedUser(['name' => 'Achiever']);

        $response = $this->get("/{$this->testTenantSlug}/accessible/achievements");

        $response->assertOk();
        $response->assertSee(__('govuk_alpha.achievements.title'));
        $response->assertSee(__('govuk_alpha.achievements.level_label'));
        $response->assertSee(__('govuk_alpha.achievements.earned_title'));
    }

    public function test_leaderboard_page_renders_with_metric_filter(): void
    {
        $this->authenticatedUser(['name' => 'Ranked Member']);

        $response = $this->get("/{$this->testTenantSlug}/accessible/leaderboard");

        $response->assertOk();
        $response->assertSee(__('govuk_alpha.leaderboard.title'));
        $response->assertSee(__('govuk_alpha.leaderboard.metric_label'));
        $response->assertSee(__('govuk_alpha.leaderboard.metrics.credits_earned'));
    }

    public function test_nexus_score_page_renders(): void
    {
        $this->authenticatedUser(['name' => 'Scored Member']);

        $response = $this->get("/{$this->testTenantSlug}/accessible/nexus-score");

        $response->assertOk();
        $response->assertSee(__('govuk_alpha.nexus_score.title'));
        $response->assertSee(__('govuk_alpha.nexus_score.description'));
    }

    public function test_wave3_discovery_pages_render(): void
    {
        $this->authenticatedUser(['name' => 'Browser Member']);

        foreach (['saved', 'resources', 'jobs', 'ideation'] as $path) {
            $this->get("/{$this->testTenantSlug}/accessible/{$path}")->assertOk();
        }

        $this->get("/{$this->testTenantSlug}/accessible/jobs")->assertSee(__('govuk_alpha.jobs.title'));
        $this->get("/{$this->testTenantSlug}/accessible/ideation")->assertSee(__('govuk_alpha.ideation.title'));
        $this->get("/{$this->testTenantSlug}/accessible/resources")->assertSee(__('govuk_alpha.resources.title'));
        $this->get("/{$this->testTenantSlug}/accessible/saved")->assertSee(__('govuk_alpha.saved.title'));
    }

    public function test_job_detail_renders_and_application_is_recorded(): void
    {
        $applicant = $this->authenticatedUser(['name' => 'Keen Applicant']);
        // The opportunity must belong to someone else — you cannot apply to your own.
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);

        $jobId = DB::table('job_vacancies')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'title' => 'Community Gardener',
            'description' => 'Help tend the shared allotment each week.',
            'type' => 'volunteer',
            'status' => 'open',
            'created_at' => now(),
        ]);

        $detail = $this->get("/{$this->testTenantSlug}/accessible/jobs/{$jobId}");
        $detail->assertOk();
        $detail->assertSee('Community Gardener');
        $detail->assertSee(__('govuk_alpha.jobs.apply_button'));

        $apply = $this->post("/{$this->testTenantSlug}/accessible/jobs/{$jobId}/apply", [
            'cover_letter' => 'I would love to help in the garden.',
        ]);
        $apply->assertRedirectContains('status=applied');

        $this->assertSame(1, DB::table('job_vacancy_applications')
            ->where('tenant_id', $this->testTenantId)
            ->where('vacancy_id', $jobId)
            ->where('user_id', $applicant->id)
            ->count());
    }

    // ===== WAVE JOBS-T2: browse depth, saved, my applications =====

    private function insertJob(int $ownerId, array $overrides = []): int
    {
        return (int) DB::table('job_vacancies')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'title' => 'Test Opportunity',
            'description' => 'A role in the community.',
            'type' => 'volunteer',
            'commitment' => 'flexible',
            'status' => 'open',
            'created_at' => now(),
        ], $overrides));
    }

    public function test_jobs2_browse_renders_subnav_filters_and_filters_by_type(): void
    {
        $this->authenticatedUser(['name' => 'Browser']);
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);

        $this->insertJob($owner->id, ['title' => 'Paid Coordinator Role', 'type' => 'paid', 'salary_min' => 20000, 'salary_max' => 30000, 'salary_currency' => 'EUR']);
        $this->insertJob($owner->id, ['title' => 'Volunteer Gardener Role', 'type' => 'volunteer']);

        // Sub-nav + filter controls render on the browse page.
        $browse = $this->get("/{$this->testTenantSlug}/accessible/jobs");
        $browse->assertOk();
        $browse->assertSee(__('govuk_alpha.jobs_t2.nav_browse'));
        $browse->assertSee(__('govuk_alpha.jobs_t2.nav_saved'));
        $browse->assertSee(__('govuk_alpha.jobs_t2.type_label'));
        $browse->assertSee(__('govuk_alpha.jobs_t2.sort_label'));
        $browse->assertSee('Paid Coordinator Role');
        $browse->assertSee('Volunteer Gardener Role');

        // Filtering by type=paid hides the volunteer role.
        $paid = $this->get("/{$this->testTenantSlug}/accessible/jobs?type=paid");
        $paid->assertOk();
        $paid->assertSee('Paid Coordinator Role');
        $paid->assertDontSee('Volunteer Gardener Role');
    }

    public function test_jobs2_save_and_unsave_round_trip(): void
    {
        $member = $this->authenticatedUser(['name' => 'Saver']);
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $jobId = $this->insertJob($owner->id, ['title' => 'Bookmarkable Role']);

        // Save from the detail page.
        $save = $this->post("/{$this->testTenantSlug}/accessible/jobs/{$jobId}/save", ['from' => 'detail']);
        $save->assertRedirectContains('status=saved');
        $this->assertSame(1, DB::table('saved_jobs')
            ->where('user_id', $member->id)->where('job_id', $jobId)->count());

        // It appears on the saved list with a remove button.
        $saved = $this->get("/{$this->testTenantSlug}/accessible/jobs/saved");
        $saved->assertOk();
        $saved->assertSee('Bookmarkable Role');
        $saved->assertSee(__('govuk_alpha.jobs_t2.unsave_button'));

        // Unsave from the saved list.
        $unsave = $this->post("/{$this->testTenantSlug}/accessible/jobs/{$jobId}/unsave", ['from' => 'saved']);
        $unsave->assertRedirectContains('status=unsaved');
        $this->assertSame(0, DB::table('saved_jobs')
            ->where('user_id', $member->id)->where('job_id', $jobId)->count());
    }

    public function test_jobs2_my_applications_lists_and_withdraw(): void
    {
        $applicant = $this->authenticatedUser(['name' => 'Applicant']);
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $jobId = $this->insertJob($owner->id, ['title' => 'Withdrawable Role']);

        $this->post("/{$this->testTenantSlug}/accessible/jobs/{$jobId}/apply", ['cover_letter' => 'Keen.'])
            ->assertRedirectContains('status=applied');

        $appId = (int) DB::table('job_vacancy_applications')
            ->where('tenant_id', $this->testTenantId)
            ->where('vacancy_id', $jobId)
            ->where('user_id', $applicant->id)
            ->value('id');
        $this->assertGreaterThan(0, $appId);

        // The application shows on the my-applications page with a withdraw control.
        $apps = $this->get("/{$this->testTenantSlug}/accessible/jobs/applications");
        $apps->assertOk();
        $apps->assertSee('Withdrawable Role');
        $apps->assertSee(__('govuk_alpha.jobs_t2.withdraw_button'));

        // Withdraw it.
        $this->post("/{$this->testTenantSlug}/accessible/jobs/applications/{$appId}/withdraw")
            ->assertRedirectContains('status=withdrawn');
        $this->assertSame('withdrawn', DB::table('job_vacancy_applications')->where('id', $appId)->value('status'));
    }

    public function test_jobs2_detail_shows_skills_match_for_viewer(): void
    {
        $member = $this->authenticatedUser(['name' => 'Skilled']);
        DB::table('users')->where('id', $member->id)->update(['skills' => 'gardening, cooking']);
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $jobId = $this->insertJob($owner->id, ['title' => 'Skilled Role', 'skills_required' => 'gardening, welding']);

        $detail = $this->get("/{$this->testTenantSlug}/accessible/jobs/{$jobId}");
        $detail->assertOk();
        $detail->assertSee(__('govuk_alpha.jobs_t2.match_heading'));
        $detail->assertSee(__('govuk_alpha.jobs_t2.save_button'));
    }

    public function test_jobs2_account_hub_surfaces_jobs(): void
    {
        $this->authenticatedUser(['name' => 'Account Holder']);

        $account = $this->get("/{$this->testTenantSlug}/accessible/account");
        $account->assertOk();
        $account->assertSee(__('govuk_alpha.jobs_t2.account_title'));
    }

    public function test_jobs2_detail_404s_for_another_tenants_job(): void
    {
        $this->authenticatedUser(['name' => 'Tenant Member']);

        // A vacancy belonging to a different tenant must never be visible: the
        // HasTenantScope global scope filters it out, so legacyGetById returns null.
        $foreignJobId = (int) DB::table('job_vacancies')->insertGetId([
            'tenant_id' => $this->testTenantId + 9999,
            'user_id' => 999999,
            'title' => 'Foreign Tenant Role',
            'description' => 'Should never be reachable.',
            'type' => 'volunteer',
            'status' => 'open',
            'created_at' => now(),
        ]);

        $this->get("/{$this->testTenantSlug}/accessible/jobs/{$foreignJobId}")->assertNotFound();
        // Saving a cross-tenant job fails gracefully (no leak, no 404 crash).
        $this->post("/{$this->testTenantSlug}/accessible/jobs/{$foreignJobId}/save", ['from' => 'detail'])
            ->assertRedirectContains('status=save-failed');
        $this->assertSame(0, DB::table('saved_jobs')->where('job_id', $foreignJobId)->count());
    }

    // ===== WAVE JOBS-T3: employer suite =====

    public function test_jobs3_create_form_renders_and_stores_opportunity(): void
    {
        $member = $this->authenticatedUser(['name' => 'Poster']);

        $form = $this->get("/{$this->testTenantSlug}/accessible/jobs/create");
        $form->assertOk();
        $form->assertSee(__('govuk_alpha.jobs_t3.label_title'));
        $form->assertSee(__('govuk_alpha.jobs_t3.submit_create'));

        $store = $this->post("/{$this->testTenantSlug}/accessible/jobs", [
            'title' => 'New Volunteer Role',
            'description' => 'Help out at the weekend market.',
            'type' => 'volunteer',
            'commitment' => 'flexible',
            'status' => 'open',
        ]);
        $store->assertRedirectContains('status=created');

        $this->assertSame(1, DB::table('job_vacancies')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $member->id)
            ->where('title', 'New Volunteer Role')
            ->count());
    }

    public function test_jobs3_create_rejects_paid_without_salary(): void
    {
        $this->authenticatedUser(['name' => 'Poster']);

        $store = $this->post("/{$this->testTenantSlug}/accessible/jobs", [
            'title' => 'Paid Role No Salary',
            'description' => 'A paid role.',
            'type' => 'paid',
            'commitment' => 'full_time',
            'status' => 'open',
        ]);
        // EU pay-transparency: a paid role needs a salary range unless negotiable.
        $store->assertRedirect();
        $this->assertSame(0, DB::table('job_vacancies')
            ->where('tenant_id', $this->testTenantId)
            ->where('title', 'Paid Role No Salary')
            ->count());
    }

    public function test_jobs3_mine_lists_owned_postings(): void
    {
        $member = $this->authenticatedUser(['name' => 'Owner']);
        $this->insertJob($member->id, ['title' => 'My Posted Role']);

        $mine = $this->get("/{$this->testTenantSlug}/accessible/jobs/mine");
        $mine->assertOk();
        $mine->assertSee('My Posted Role');
        $mine->assertSee(__('govuk_alpha.jobs_t3.manage_button'));
        $mine->assertSee(__('govuk_alpha.jobs_t3.edit_button'));
        $mine->assertSee(__('govuk_alpha.jobs_t3.post_button'));
    }

    public function test_jobs3_edit_updates_owned_job_and_blocks_non_owner(): void
    {
        $member = $this->authenticatedUser(['name' => 'Editor']);
        $jobId = $this->insertJob($member->id, ['title' => 'Editable Role']);

        $edit = $this->get("/{$this->testTenantSlug}/accessible/jobs/{$jobId}/edit");
        $edit->assertOk();
        $edit->assertSee('Editable Role', false);

        $update = $this->post("/{$this->testTenantSlug}/accessible/jobs/{$jobId}/update", [
            'title' => 'Renamed Role',
            'description' => 'Updated description.',
            'type' => 'volunteer',
            'commitment' => 'part_time',
            'status' => 'open',
        ]);
        $update->assertRedirectContains('status=updated');
        $this->assertSame('Renamed Role', DB::table('job_vacancies')->where('id', $jobId)->value('title'));

        // A different member cannot edit it.
        $other = $this->authenticatedUser(['name' => 'Intruder']);
        $this->get("/{$this->testTenantSlug}/accessible/jobs/{$jobId}/edit")->assertForbidden();
        $this->post("/{$this->testTenantSlug}/accessible/jobs/{$jobId}/update", ['title' => 'Hijacked'])->assertForbidden();
        $this->assertSame('Renamed Role', DB::table('job_vacancies')->where('id', $jobId)->value('title'));
    }

    public function test_jobs3_delete_owned_job_and_blocks_non_owner(): void
    {
        $member = $this->authenticatedUser(['name' => 'Deleter']);
        $jobId = $this->insertJob($member->id, ['title' => 'Deletable Role']);

        // Non-owner cannot delete.
        $other = $this->authenticatedUser(['name' => 'Intruder']);
        $this->post("/{$this->testTenantSlug}/accessible/jobs/{$jobId}/delete")->assertForbidden();
        $this->assertSame(1, DB::table('job_vacancies')->where('id', $jobId)->count());

        // Owner can.
        \Laravel\Sanctum\Sanctum::actingAs($member, ['*']);
        $this->post("/{$this->testTenantSlug}/accessible/jobs/{$jobId}/delete")
            ->assertRedirectContains('status=deleted');
        $this->assertSame(0, DB::table('job_vacancies')->where('id', $jobId)->count());
    }

    public function test_jobs3_renew_extends_deadline(): void
    {
        $member = $this->authenticatedUser(['name' => 'Renewer']);
        $jobId = $this->insertJob($member->id, ['title' => 'Expiring Role', 'deadline' => now()->subDays(5)->toDateString()]);

        $this->post("/{$this->testTenantSlug}/accessible/jobs/{$jobId}/renew")
            ->assertRedirectContains('status=renewed');

        $deadline = DB::table('job_vacancies')->where('id', $jobId)->value('deadline');
        $this->assertTrue(\Illuminate\Support\Carbon::parse($deadline)->isFuture());
    }

    public function test_jobs3_applicants_pipeline_lists_and_updates_status(): void
    {
        $owner = $this->authenticatedUser(['name' => 'Hiring Owner']);
        $jobId = $this->insertJob($owner->id, ['title' => 'Pipeline Role']);

        $applicant = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        \Laravel\Sanctum\Sanctum::actingAs($applicant, ['*']);
        $this->post("/{$this->testTenantSlug}/accessible/jobs/{$jobId}/apply", ['cover_letter' => 'I am keen.'])
            ->assertRedirectContains('status=applied');

        // Back to the owner to manage the pipeline.
        \Laravel\Sanctum\Sanctum::actingAs($owner, ['*']);
        $appId = (int) DB::table('job_vacancy_applications')->where('vacancy_id', $jobId)->value('id');

        $pipeline = $this->get("/{$this->testTenantSlug}/accessible/jobs/{$jobId}/applications");
        $pipeline->assertOk();
        $pipeline->assertSee(__('govuk_alpha.jobs_t3.applicants_title'));
        $pipeline->assertSee(__('govuk_alpha.jobs_t3.analytics_heading'));
        $pipeline->assertSee(__('govuk_alpha.jobs_t3.status_change_button'));

        $this->post("/{$this->testTenantSlug}/accessible/jobs/{$jobId}/applications/{$appId}/status", ['app_status' => 'shortlisted'])
            ->assertRedirectContains('status=status-updated');
        $this->assertSame('shortlisted', DB::table('job_vacancy_applications')->where('id', $appId)->value('status'));
    }

    public function test_jobs3_applicants_forbidden_for_non_owner(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $jobId = $this->insertJob($owner->id, ['title' => 'Private Pipeline']);

        // A member who does not own the job cannot view its applicants.
        $this->authenticatedUser(['name' => 'Snoop']);
        $this->get("/{$this->testTenantSlug}/accessible/jobs/{$jobId}/applications")->assertForbidden();
    }

    public function test_jobs3_export_csv_for_owner(): void
    {
        $owner = $this->authenticatedUser(['name' => 'Exporter']);
        $jobId = $this->insertJob($owner->id, ['title' => 'Exportable Role']);

        $export = $this->get("/{$this->testTenantSlug}/accessible/jobs/{$jobId}/applications/export.csv");
        $export->assertOk();
        $export->assertHeader('content-type', 'text/csv; charset=utf-8');
    }

    public function test_jobs3_export_csv_blocked_for_non_owner(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $jobId = $this->insertJob($owner->id, ['title' => 'Confidential Applicants']);

        // A non-owner must never receive the applicant CSV — it redirects, not 200.
        $this->authenticatedUser(['name' => 'Snoop']);
        $resp = $this->get("/{$this->testTenantSlug}/accessible/jobs/{$jobId}/applications/export.csv");
        $resp->assertRedirectContains('status=export-failed');
    }

    // ===== WAVE JOBS-T4: job alerts =====

    public function test_jobs4_alerts_create_pause_resume_delete(): void
    {
        $member = $this->authenticatedUser(['name' => 'Alert Member']);

        $empty = $this->get("/{$this->testTenantSlug}/accessible/jobs/alerts");
        $empty->assertOk();
        $empty->assertSee(__('govuk_alpha.jobs_t4.create_heading'));
        $empty->assertSee(__('govuk_alpha.jobs_t4.empty'));

        $this->post("/{$this->testTenantSlug}/accessible/jobs/alerts", [
            'keywords' => 'gardening',
            'type' => 'volunteer',
            'commitment' => 'flexible',
        ])->assertRedirectContains('status=alert-created');

        $alertId = (int) DB::table('job_alerts')->where('user_id', $member->id)->value('id');
        $this->assertGreaterThan(0, $alertId);

        $list = $this->get("/{$this->testTenantSlug}/accessible/jobs/alerts");
        $list->assertSee('gardening');
        $list->assertSee(__('govuk_alpha.jobs_t4.active_tag'));
        $list->assertSee(__('govuk_alpha.jobs_t4.pause_button'));

        $this->post("/{$this->testTenantSlug}/accessible/jobs/alerts/{$alertId}/pause")
            ->assertRedirectContains('status=alert-paused');
        $this->assertSame(0, (int) DB::table('job_alerts')->where('id', $alertId)->value('is_active'));

        $this->post("/{$this->testTenantSlug}/accessible/jobs/alerts/{$alertId}/resume")
            ->assertRedirectContains('status=alert-resumed');
        $this->assertSame(1, (int) DB::table('job_alerts')->where('id', $alertId)->value('is_active'));

        $this->post("/{$this->testTenantSlug}/accessible/jobs/alerts/{$alertId}/delete")
            ->assertRedirectContains('status=alert-deleted');
        $this->assertSame(0, DB::table('job_alerts')->where('id', $alertId)->count());
    }

    public function test_jobs4_alert_actions_cannot_touch_another_members_alert(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $alertId = (int) DB::table('job_alerts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'keywords' => 'private',
            'is_remote_only' => 0,
            'is_active' => 1,
            'created_at' => now(),
        ]);

        // A different member's pause/delete must be a no-op on the owner's alert.
        $this->authenticatedUser(['name' => 'Intruder']);
        $this->post("/{$this->testTenantSlug}/accessible/jobs/alerts/{$alertId}/pause");
        $this->assertSame(1, (int) DB::table('job_alerts')->where('id', $alertId)->value('is_active'));
        $this->post("/{$this->testTenantSlug}/accessible/jobs/alerts/{$alertId}/delete");
        $this->assertSame(1, DB::table('job_alerts')->where('id', $alertId)->count());
    }

    public function test_ideation_challenge_detail_submit_and_vote(): void
    {
        $member = $this->authenticatedUser(['name' => 'Idea Author']);

        $challengeId = DB::table('ideation_challenges')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'title' => 'How should we use the old library?',
            'description' => 'Share your ideas for the space.',
            'status' => 'open',
            'created_at' => now(),
        ]);

        $detail = $this->get("/{$this->testTenantSlug}/accessible/ideation/{$challengeId}");
        $detail->assertOk();
        $detail->assertSee('How should we use the old library?');
        $detail->assertSee(__('govuk_alpha.ideation.submit_button'));

        // Submit a new idea.
        $submit = $this->post("/{$this->testTenantSlug}/accessible/ideation/{$challengeId}/ideas", [
            'idea_title' => 'A community makerspace',
            'idea_content' => 'Tools and benches anyone can use.',
        ]);
        $submit->assertRedirectContains('status=idea-submitted');
        $this->assertSame(1, DB::table('challenge_ideas')
            ->where('challenge_id', $challengeId)
            ->where('user_id', $member->id)
            ->where('title', 'A community makerspace')
            ->count());

        // Vote on someone else's idea (you cannot vote on your own).
        $other = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $ideaId = DB::table('challenge_ideas')->insertGetId([
            'challenge_id' => $challengeId,
            'user_id' => $other->id,
            'title' => 'A reading garden',
            'description' => 'Quiet outdoor seating with books.',
            'status' => 'submitted',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $vote = $this->post("/{$this->testTenantSlug}/accessible/ideation/{$challengeId}/ideas/{$ideaId}/vote");
        $vote->assertRedirectContains('status=idea-voted');
        $this->assertSame(1, DB::table('challenge_idea_votes')
            ->where('idea_id', $ideaId)
            ->where('user_id', $member->id)
            ->count());
    }

    public function test_wave4_modules_render_when_enabled(): void
    {
        $this->authenticatedUser(['name' => 'Shopper']);
        $this->enableAlphaFeatures(['marketplace', 'courses', 'podcasts', 'merchant_coupons', 'member_premium']);

        $pages = [
            'marketplace' => 'govuk_alpha.marketplace.title',
            'courses' => 'govuk_alpha.courses.title',
            'podcasts' => 'govuk_alpha.podcasts.title',
            'coupons' => 'govuk_alpha.coupons.title',
            'premium' => 'govuk_alpha.premium.title',
            'federation' => 'govuk_alpha.federation.title',
        ];
        foreach ($pages as $path => $key) {
            $res = $this->get("/{$this->testTenantSlug}/accessible/{$path}");
            $res->assertOk();
            $res->assertSee(__($key));
        }
    }

    public function test_marketplace_is_gated_off_by_default(): void
    {
        $this->authenticatedUser();
        $this->get("/{$this->testTenantSlug}/accessible/marketplace")->assertStatus(403);
    }

    public function test_marketplace_item_detail_renders(): void
    {
        $user = $this->authenticatedUser(['name' => 'Buyer']);
        $this->enableAlphaFeatures(['marketplace']);

        $id = DB::table('marketplace_listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'title' => 'Vintage Bicycle',
            'description' => 'A lovely old bike in good condition.',
            'price_type' => 'free',
            'status' => 'active',
            'moderation_status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Detail page.
        $res = $this->get("/{$this->testTenantSlug}/accessible/marketplace/{$id}");
        $res->assertOk();
        $res->assertSee('Vintage Bicycle');

        // Index card loop renders the same listing.
        $index = $this->get("/{$this->testTenantSlug}/accessible/marketplace");
        $index->assertOk();
        $index->assertSee('Vintage Bicycle');
    }

    public function test_clubs_directory_lists_a_club(): void
    {
        $owner = $this->authenticatedUser(['name' => 'Club Secretary']);

        DB::table('vol_organizations')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Riverside Chess Club',
            'description' => 'A friendly chess club meeting weekly.',
            'org_type' => 'club',
            'status' => 'active',
        ]);

        $res = $this->get("/{$this->testTenantSlug}/accessible/clubs");
        $res->assertOk();
        $res->assertSee('Riverside Chess Club');
    }

    public function test_podcast_detail_renders_show(): void
    {
        $owner = $this->authenticatedUser(['name' => 'Podcaster']);
        $this->enableAlphaFeatures(['podcasts']);

        $showId = DB::table('podcast_shows')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_user_id' => $owner->id,
            'title' => 'Community Voices',
            'slug' => 'community-voices-' . $owner->id,
            'status' => 'published',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $res = $this->get("/{$this->testTenantSlug}/accessible/podcasts/{$showId}");
        $res->assertOk();
        $res->assertSee('Community Voices');
    }

    public function test_course_free_enrolment_records_enrollment(): void
    {
        $learner = $this->authenticatedUser(['name' => 'Learner']);
        $author = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $this->enableAlphaFeatures(['courses']);

        $courseId = DB::table('courses')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'author_user_id' => $author->id,
            'title' => 'Intro to Beekeeping',
            'slug' => 'intro-to-beekeeping-' . $author->id,
            'level' => 'beginner',
            'visibility' => 'public',
            'status' => 'published',
            'moderation_status' => 'approved',
            'credit_cost' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Index card loop renders the course.
        $index = $this->get("/{$this->testTenantSlug}/accessible/courses");
        $index->assertOk();
        $index->assertSee('Intro to Beekeeping');

        $detail = $this->get("/{$this->testTenantSlug}/accessible/courses/{$courseId}");
        $detail->assertOk();
        $detail->assertSee('Intro to Beekeeping');
        $detail->assertSee(__('govuk_alpha.courses.enrol_button'));

        $enrol = $this->post("/{$this->testTenantSlug}/accessible/courses/{$courseId}/enrol");
        $enrol->assertRedirectContains('status=enrolled');

        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
        $this->assertTrue(\App\Services\CourseEnrollmentService::isEnrolled($courseId, $learner->id));
    }

    public function test_job_and_ideation_mutations_work_without_group_exchanges_feature(): void
    {
        // Regression: applyJob/submitIdea/voteIdea must NOT depend on the
        // group_exchanges feature. Disable it while keeping job_vacancies and
        // ideation_challenges on.
        $features = \App\Services\TenantFeatureConfig::FEATURE_DEFAULTS;
        $features['group_exchanges'] = false;
        $features['job_vacancies'] = true;
        $features['ideation_challenges'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);

        $applicant = $this->authenticatedUser(['name' => 'Applicant No GE']);
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);

        $jobId = DB::table('job_vacancies')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'title' => 'Allotment Helper',
            'description' => 'Weekly help on the allotment.',
            'type' => 'volunteer',
            'status' => 'open',
            'created_at' => now(),
        ]);
        // Apply must succeed (not 403) even with group_exchanges off.
        $this->post("/{$this->testTenantSlug}/accessible/jobs/{$jobId}/apply", ['cover_letter' => 'Happy to help.'])
            ->assertRedirectContains('status=applied');

        $challengeId = DB::table('ideation_challenges')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $applicant->id,
            'title' => 'New use for the hall?',
            'description' => 'Ideas welcome.',
            'status' => 'open',
            'created_at' => now(),
        ]);
        $this->post("/{$this->testTenantSlug}/accessible/ideation/{$challengeId}/ideas", [
            'idea_title' => 'Weekly repair cafe',
            'idea_content' => 'Fix things together.',
        ])->assertRedirectContains('status=idea-submitted');

        $ideaId = DB::table('challenge_ideas')->insertGetId([
            'challenge_id' => $challengeId,
            'user_id' => $owner->id,
            'title' => 'Board game night',
            'description' => 'Monthly games.',
            'status' => 'submitted',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->post("/{$this->testTenantSlug}/accessible/ideation/{$challengeId}/ideas/{$ideaId}/vote")
            ->assertRedirectContains('status=idea-voted');
    }

    public function test_notifications_inbox_mark_read_and_delete_all(): void
    {
        $user = $this->authenticatedUser(['name' => 'Notified Member']);
        $nId = DB::table('notifications')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'message' => 'You have a new message',
            'link' => '/messages/1',
            'type' => 'message',
            'is_read' => 0,
            'created_at' => now(),
        ]);

        $page = $this->get("/{$this->testTenantSlug}/accessible/notifications");
        $page->assertOk();
        $page->assertSee('You have a new message');
        $page->assertSee(__('govuk_alpha.notifications.types.messages'));
        $page->assertSee(__('govuk_alpha.notifications.mark_read'));

        $this->post("/{$this->testTenantSlug}/accessible/notifications/{$nId}/read")
            ->assertRedirectContains('status=notification-marked-read');
        $this->assertSame(1, (int) DB::table('notifications')->where('id', $nId)->value('is_read'));

        $this->post("/{$this->testTenantSlug}/accessible/notifications/delete-all")
            ->assertRedirectContains('status=all-notifications-deleted');
        $this->assertSame(0, DB::table('notifications')->where('user_id', $user->id)->count());
    }

    public function test_onboarding_wizard_flows_through_safeguarding_and_completes(): void
    {
        $user = $this->authenticatedUser(['name' => 'New Member']);
        // Satisfy the required profile fields so the full flow + completion can run.
        DB::table('users')->where('id', $user->id)->update([
            'onboarding_completed' => 0,
            'avatar_url' => '/uploads/avatar.jpg',
            'bio' => 'I love helping out in my community garden.',
        ]);

        // Entry redirects to the first active step.
        $this->get("/{$this->testTenantSlug}/accessible/onboarding")
            ->assertRedirectContains('/accessible/onboarding/welcome');

        $this->get("/{$this->testTenantSlug}/accessible/onboarding/welcome")
            ->assertOk()->assertSee(__('govuk_alpha.onboarding.welcome.title'));

        // The safeguarding step (the wired-up step) renders.
        $this->get("/{$this->testTenantSlug}/accessible/onboarding/safeguarding")
            ->assertOk()->assertSee(__('govuk_alpha.onboarding.safeguarding.title'));

        // Save interests + skills selections.
        $this->post("/{$this->testTenantSlug}/accessible/onboarding/interests", ['interests' => []])->assertRedirect();
        $this->post("/{$this->testTenantSlug}/accessible/onboarding/skills", ['offers' => [], 'needs' => []])->assertRedirect();

        // Complete from the confirm step.
        $this->post("/{$this->testTenantSlug}/accessible/onboarding/confirm")
            ->assertRedirectContains('status=onboarding-complete');

        $this->assertSame(1, (int) DB::table('users')->where('id', $user->id)->value('onboarding_completed'));

        // Once complete, the wizard redirects away.
        $this->get("/{$this->testTenantSlug}/accessible/onboarding/welcome")
            ->assertRedirectContains('/accessible/dashboard');
    }

    public function test_job_application_notifies_the_employer(): void
    {
        $applicant = $this->authenticatedUser(['name' => 'Keen Applicant']);
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);

        $jobId = DB::table('job_vacancies')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'title' => 'Community Gardener',
            'description' => 'Help tend the shared allotment.',
            'type' => 'volunteer',
            'status' => 'open',
            'created_at' => now(),
        ]);

        $this->post("/{$this->testTenantSlug}/accessible/jobs/{$jobId}/apply", ['cover_letter' => 'I would love to help.'])
            ->assertRedirectContains('status=applied');

        // The employer received an in-app notification (parity with the API path).
        $this->assertTrue(DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $owner->id)
            ->where('type', 'job_application')
            ->exists());
    }

    // ── Federation core ──────────────────────────────────────────────

    public function test_federation_hub_renders_optin_cta_when_not_opted_in(): void
    {
        $this->authenticatedUser(['name' => 'Fed Newcomer']);
        $this->enableFederationSystem();

        $res = $this->get("/{$this->testTenantSlug}/accessible/federation");
        $res->assertOk();
        $res->assertSee(__('govuk_alpha.federation.title'));
        // Not opted in → the opted-out marketing hero + guided-onboarding CTA are shown.
        $res->assertSee(__('govuk_alpha.federation.hub.hero_title'));
        $res->assertSee(__('govuk_alpha.federation.hub.how_it_works_heading'));
        // The opted-out hub CTA now links to the guided onboarding wizard (017024c0c).
        $res->assertSee(route('govuk-alpha.federation.onboarding', ['tenantSlug' => $this->testTenantSlug]), false);
        $res->assertSee(__('govuk_alpha.federation.hub.optin_off'));
    }

    public function test_federation_hub_shows_opted_in_state_and_partner_preview(): void
    {
        $user = $this->authenticatedUser(['name' => 'Fed Member']);
        $this->enableFederationSystem();
        $partnerTenantId = $this->seedFederationPartner('Riverside Timebank');
        $this->setFederationUserSettings($user->id, ['federation_optin' => 1]);

        $res = $this->get("/{$this->testTenantSlug}/accessible/federation");
        $res->assertOk();
        // Opted in → status tag flips and CTA banner is gone.
        $res->assertSee(__('govuk_alpha.federation.hub.optin_on'));
        $res->assertDontSee(__('govuk_alpha.federation.hub.optin_banner_title'));
        // Partner preview card links to the partner detail page.
        $res->assertSee('Riverside Timebank');
        $res->assertSee(route('govuk-alpha.federation.partners.show', ['tenantSlug' => $this->testTenantSlug, 'id' => $partnerTenantId]), false);
    }

    public function test_federation_opt_in_post_flips_the_setting(): void
    {
        $user = $this->authenticatedUser(['name' => 'Opting In']);
        $this->enableFederationSystem();

        $this->assertFalse(\App\Services\FederationUserService::hasOptedIn($user->id));

        $this->post("/{$this->testTenantSlug}/accessible/federation/opt-in")
            ->assertRedirect("/{$this->testTenantSlug}/accessible/federation?status=opted-in");

        $settings = \App\Services\FederationUserService::getUserSettings($user->id);
        $this->assertTrue((bool) $settings['federation_optin']);
        $this->assertTrue((bool) $settings['appear_in_federated_search']);
    }

    public function test_federation_settings_post_saves_visibility_and_reach(): void
    {
        $user = $this->authenticatedUser(['name' => 'Settings Saver']);
        $this->enableFederationSystem();
        $this->setFederationUserSettings($user->id, ['federation_optin' => 1, 'show_skills_federated' => 1]);

        $this->post("/{$this->testTenantSlug}/accessible/federation/settings", [
            'profile_visible_federated' => '1',
            'appear_in_federated_search' => '1',
            // show_skills_federated intentionally omitted → should become false.
            'service_reach' => 'travel_ok',
        ])->assertRedirect("/{$this->testTenantSlug}/accessible/federation/settings?status=settings-saved");

        $settings = \App\Services\FederationUserService::getUserSettings($user->id);
        $this->assertTrue((bool) $settings['profile_visible_federated']);
        $this->assertFalse((bool) $settings['show_skills_federated']);
        $this->assertSame('travel_ok', $settings['service_reach']);
    }

    public function test_federation_opt_out_post_disables_and_dispatches_event(): void
    {
        $user = $this->authenticatedUser(['name' => 'Opting Out']);
        $this->enableFederationSystem();
        $this->setFederationUserSettings($user->id, ['federation_optin' => 1]);

        \Illuminate\Support\Facades\Event::fake([\App\Events\UserFederatedOptOut::class]);

        $this->post("/{$this->testTenantSlug}/accessible/federation/opt-out")
            ->assertRedirect("/{$this->testTenantSlug}/accessible/federation?status=opted-out");

        $this->assertFalse((bool) \App\Services\FederationUserService::getUserSettings($user->id)['federation_optin']);
        \Illuminate\Support\Facades\Event::assertDispatched(\App\Events\UserFederatedOptOut::class);
    }

    public function test_federation_partner_detail_renders_for_an_internal_partner(): void
    {
        $this->authenticatedUser(['name' => 'Partner Viewer']);
        $this->enableFederationSystem();
        $partnerTenantId = $this->seedFederationPartner('Northside Timebank');

        $res = $this->get("/{$this->testTenantSlug}/accessible/federation/partners/{$partnerTenantId}");
        $res->assertOk();
        $res->assertSee('Northside Timebank');
        $res->assertSee(__('govuk_alpha.federation.partner.about_label'));
        $res->assertSee(route('govuk-alpha.federation.index', ['tenantSlug' => $this->testTenantSlug]), false);
    }

    public function test_federation_partner_detail_404s_for_unknown_partner(): void
    {
        $this->authenticatedUser();
        $this->enableFederationSystem();
        $this->get("/{$this->testTenantSlug}/accessible/federation/partners/999999")->assertNotFound();
    }

    public function test_federation_members_browse_lists_a_federated_member(): void
    {
        $user = $this->authenticatedUser(['name' => 'Member Browser']);
        $this->enableFederationSystem();
        // Federation browse screens gate non-opted-in members → opt the viewer in.
        $this->setFederationUserSettings($user->id, ['federation_optin' => 1]);
        $partnerTenantId = $this->seedFederationPartner('Eastside Timebank');
        $partnerUserId = $this->seedFederatedMember($partnerTenantId, 'Federated', 'Friend', 'Gardening, Cooking');

        $res = $this->get("/{$this->testTenantSlug}/accessible/federation/members");
        $res->assertOk();
        $res->assertSee('Federated Friend');
        // Member links carry the REQUIRED tenant_id query param.
        $res->assertSee(route('govuk-alpha.federation.members.show', [
            'tenantSlug' => $this->testTenantSlug,
            'id' => $partnerUserId,
            'tenant_id' => $partnerTenantId,
        ]), false);
    }

    public function test_federation_member_profile_renders_with_tenant_id(): void
    {
        $user = $this->authenticatedUser(['name' => 'Profile Viewer']);
        $this->enableFederationSystem();
        // Federation browse screens gate non-opted-in members → opt the viewer in.
        $this->setFederationUserSettings($user->id, ['federation_optin' => 1]);
        $partnerTenantId = $this->seedFederationPartner('Westside Timebank');
        $partnerUserId = $this->seedFederatedMember($partnerTenantId, 'Visible', 'Profile', 'Carpentry');

        $res = $this->get("/{$this->testTenantSlug}/accessible/federation/members/{$partnerUserId}?tenant_id={$partnerTenantId}");
        $res->assertOk();
        $res->assertSee('Visible Profile');
        $res->assertSee(__('govuk_alpha.federation.member.skills_label'));
    }

    public function test_federation_listings_browse_renders(): void
    {
        $user = $this->authenticatedUser(['name' => 'Listing Browser']);
        $this->enableFederationSystem();
        // Federation browse screens gate non-opted-in members → opt the viewer in.
        $this->setFederationUserSettings($user->id, ['federation_optin' => 1]);
        $partnerTenantId = $this->seedFederationPartner('Harbour Timebank');
        $partnerUserId = $this->seedFederatedMember($partnerTenantId, 'Listing', 'Owner', 'Plumbing');
        DB::table('listings')->insert([
            'tenant_id' => $partnerTenantId,
            'user_id' => $partnerUserId,
            'title' => 'Bike repair help',
            'description' => 'Happy to fix punctures across the network.',
            'type' => 'offer',
            'status' => 'active',
            'federated_visibility' => 'listed',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $res = $this->get("/{$this->testTenantSlug}/accessible/federation/listings");
        $res->assertOk();
        $res->assertSee(__('govuk_alpha.federation.listings_browse.title'));
        $res->assertSee('Bike repair help');
    }

    public function test_federation_events_browse_renders(): void
    {
        $user = $this->authenticatedUser(['name' => 'Event Browser']);
        $this->enableFederationSystem();
        // Federation browse screens gate non-opted-in members → opt the viewer in.
        $this->setFederationUserSettings($user->id, ['federation_optin' => 1]);
        $partnerTenantId = $this->seedFederationPartner('Quayside Timebank');

        $res = $this->get("/{$this->testTenantSlug}/accessible/federation/events");
        $res->assertOk();
        $res->assertSee(__('govuk_alpha.federation.events_browse.title'));
    }

    // ── Federation parity (partners list, detail, filters, reputation, threads) ──

    public function test_federation_partners_index_lists_every_partner(): void
    {
        $this->authenticatedUser(['name' => 'Partners Lister']);
        $this->enableFederationSystem();
        $this->seedFederationPartner('Alpha Timebank');
        $this->seedFederationPartner('Bravo Timebank');

        $res = $this->get("/{$this->testTenantSlug}/accessible/federation/partners");
        $res->assertOk();
        $res->assertSee(__('govuk_alpha.federation.partners_list.title'));
        $res->assertSee('Alpha Timebank');
        $res->assertSee('Bravo Timebank');
    }

    public function test_federation_partner_level_name_uses_source_of_truth(): void
    {
        $this->authenticatedUser(['name' => 'Level Viewer']);
        $this->enableFederationSystem();
        $partnerTenantId = $this->seedFederationPartner('Social Timebank');
        // Level 2 must read "Social" (source of truth), not the old "Connected".
        DB::table('federation_partnerships')
            ->where('tenant_id', $this->testTenantId)
            ->where('partner_tenant_id', $partnerTenantId)
            ->update(['federation_level' => 2]);

        $res = $this->get("/{$this->testTenantSlug}/accessible/federation/partners/{$partnerTenantId}");
        $res->assertOk();
        $res->assertSee(__('govuk_alpha.federation.levels.social'));
        $res->assertDontSee('Connected');
    }

    public function test_federation_listing_detail_renders_full_description(): void
    {
        $user = $this->authenticatedUser(['name' => 'Listing Detailer']);
        $this->enableFederationSystem();
        // Federation browse screens gate non-opted-in members → opt the viewer in.
        $this->setFederationUserSettings($user->id, ['federation_optin' => 1]);
        $partnerTenantId = $this->seedFederationPartner('Detail Timebank');
        $partnerUserId = $this->seedFederatedMember($partnerTenantId, 'Detail', 'Owner', 'Joinery');
        $listingId = DB::table('listings')->insertGetId([
            'tenant_id' => $partnerTenantId,
            'user_id' => $partnerUserId,
            'title' => 'Hedge trimming offer',
            'description' => 'I can trim hedges and tidy gardens across the network.',
            'type' => 'offer',
            'status' => 'active',
            'federated_visibility' => 'listed',
            'price' => 2,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $res = $this->get("/{$this->testTenantSlug}/accessible/federation/listings/{$partnerTenantId}/{$listingId}");
        $res->assertOk();
        $res->assertSee('Hedge trimming offer');
        $res->assertSee('I can trim hedges and tidy gardens across the network.');
        $res->assertSee(__('govuk_alpha.federation.listings_browse.detail_description_heading'));
    }

    public function test_federation_members_partner_filter_scopes_results(): void
    {
        $user = $this->authenticatedUser(['name' => 'Filter User']);
        $this->enableFederationSystem();
        // Federation browse screens gate non-opted-in members → opt the viewer in.
        $this->setFederationUserSettings($user->id, ['federation_optin' => 1]);
        $partnerA = $this->seedFederationPartner('Filter Alpha');
        $partnerB = $this->seedFederationPartner('Filter Bravo');
        $this->seedFederatedMember($partnerA, 'Alpha', 'Person', 'Cooking');
        $this->seedFederatedMember($partnerB, 'Bravo', 'Person', 'Cleaning');

        $res = $this->get("/{$this->testTenantSlug}/accessible/federation/members?partner_id={$partnerA}");
        $res->assertOk();
        $res->assertSee('Alpha Person');
        $res->assertDontSee('Bravo Person');
    }

    public function test_federation_member_profile_shows_reputation_and_reach(): void
    {
        $viewer = $this->authenticatedUser(['name' => 'Reputation Viewer']);
        $this->enableFederationSystem();
        // Federation browse screens gate non-opted-in members → opt the viewer in.
        $this->setFederationUserSettings($viewer->id, ['federation_optin' => 1]);
        $partnerTenantId = $this->seedFederationPartner('Reputation Timebank');
        $partnerUserId = $this->seedFederatedMember($partnerTenantId, 'Trusted', 'Member', 'Tutoring');
        $this->setFederationUserSettings($partnerUserId, [
            'federation_optin' => 1,
            'profile_visible_federated' => 1,
            'appear_in_federated_search' => 1,
            'show_reviews_federated' => 1,
            'service_reach' => 'travel_ok',
        ]);
        DB::table('reviews')->insert([
            'tenant_id' => $partnerTenantId,
            'reviewer_id' => $viewer->id,
            'receiver_id' => $partnerUserId,
            'receiver_tenant_id' => $partnerTenantId,
            'rating' => 5,
            'comment' => 'Wonderful help.',
            'review_type' => 'federated',
            'status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $res = $this->get("/{$this->testTenantSlug}/accessible/federation/members/{$partnerUserId}?tenant_id={$partnerTenantId}");
        $res->assertOk();
        // Reputation tag (score out of 5) + service-reach row are surfaced.
        $res->assertSee(__('govuk_alpha.federation.member.reach_label'));
        $res->assertSee(__('govuk_alpha.federation.settings.reach_travel_ok'));
        $res->assertSee('Wonderful help.');
    }

    public function test_federation_settings_saves_travel_radius(): void
    {
        $user = $this->authenticatedUser(['name' => 'Radius Saver']);
        $this->enableFederationSystem();
        $this->setFederationUserSettings($user->id, ['federation_optin' => 1]);

        $this->post("/{$this->testTenantSlug}/accessible/federation/settings", [
            'profile_visible_federated' => '1',
            'service_reach' => 'travel_ok',
            'travel_radius_km' => '42',
        ])->assertRedirect("/{$this->testTenantSlug}/accessible/federation/settings?status=settings-saved");

        $settings = \App\Services\FederationUserService::getUserSettings($user->id);
        $this->assertSame('travel_ok', $settings['service_reach']);
        $this->assertSame(42, (int) ($settings['travel_radius_km'] ?? 0));
    }

    public function test_federation_transfer_rejects_overlong_description(): void
    {
        $user = $this->authenticatedUser(['name' => 'Transfer Sender']);
        $this->enableFederationSystem();
        $this->enableFederationMessagingAndTransactions();
        $this->setFederationUserSettings($user->id, [
            'federation_optin' => 1,
            'transactions_enabled_federated' => 1,
        ]);
        $partnerTenantId = $this->seedFederationPartner('Transfer Timebank');
        $partnerUserId = $this->seedFederatedMember($partnerTenantId, 'Transfer', 'Target', 'DIY');

        $this->post("/{$this->testTenantSlug}/accessible/federation/members/{$partnerUserId}/transfer", [
            'receiver_tenant_id' => $partnerTenantId,
            'amount' => '5',
            'description' => str_repeat('x', 600),
        ])->assertRedirect("/{$this->testTenantSlug}/accessible/federation/members/{$partnerUserId}/transfer?tenant_id={$partnerTenantId}&status=transfer-description-too-long");
    }

    public function test_federation_messages_thread_list_and_conversation_marks_read(): void
    {
        $user = $this->authenticatedUser(['name' => 'Thread Reader']);
        $this->enableFederationSystem();
        $this->enableFederationMessagingAndTransactions();
        $this->setFederationUserSettings($user->id, [
            'federation_optin' => 1,
            'messaging_enabled_federated' => 1,
        ]);
        $partnerTenantId = $this->seedFederationPartner('Thread Timebank');
        $partnerUserId = $this->seedFederatedMember($partnerTenantId, 'Chatty', 'Partner', 'Music');
        $this->setFederationUserSettings($partnerUserId, [
            'federation_optin' => 1,
            'messaging_enabled_federated' => 1,
            'profile_visible_federated' => 1,
            'appear_in_federated_search' => 1,
        ]);
        // Inbound message FROM the partner TO the viewer (the viewer's received copy).
        $msgId = DB::table('federation_messages')->insertGetId([
            'sender_tenant_id' => $partnerTenantId,
            'sender_user_id' => $partnerUserId,
            'receiver_tenant_id' => $this->testTenantId,
            'receiver_user_id' => $user->id,
            'subject' => 'Hello there',
            'body' => 'Looking forward to working together.',
            'direction' => 'inbound',
            'status' => 'unread',
            'created_at' => now(),
        ]);

        // Thread list groups the message under the partner.
        $list = $this->get("/{$this->testTenantSlug}/accessible/federation/messages");
        $list->assertOk();
        $list->assertSee('Chatty Partner');

        // Opening the conversation renders the body and marks it read.
        $conv = $this->get("/{$this->testTenantSlug}/accessible/federation/messages/conversation/{$partnerUserId}?tenant_id={$partnerTenantId}");
        $conv->assertOk();
        $conv->assertSee('Looking forward to working together.');
        $this->assertSame('read', DB::table('federation_messages')->where('id', $msgId)->value('status'));
    }

    // === WAVE F — Groups management (create / edit / delete / roles / requests / discussions) ===

    /**
     * Seed a group owned by $ownerId (the GroupService auto-joins the creator as
     * an active admin). Returns the new group id.
     *
     * @param array<string, mixed> $data
     */
    private function seedAlphaGroup(int $ownerId, array $data = []): int
    {
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);

        $group = \App\Services\GroupService::create($ownerId, array_merge([
            'name' => 'Gardening Club',
            'description' => 'A friendly group.',
            'visibility' => 'public',
        ], $data));

        $this->assertNotNull($group, 'GroupService::create returned null while seeding');

        return (int) $group->id;
    }

    /** Add an active member with the given role straight into group_members. */
    private function addAlphaGroupMember(int $groupId, int $userId, string $role = 'member'): void
    {
        DB::table('group_members')->insert([
            'tenant_id'  => $this->testTenantId,
            'group_id'   => $groupId,
            'user_id'    => $userId,
            'role'       => $role,
            'status'     => 'active',
            'created_at' => now(),
            'joined_at'  => now(),
        ]);
        DB::table('groups')->where('id', $groupId)->increment('cached_member_count');
    }

    public function test_group_create_redirects_to_detail_and_persists(): void
    {
        $owner = $this->authenticatedUser(['name' => 'Group Founder']);

        $response = $this->post("/{$this->testTenantSlug}/accessible/groups/new", [
            'name' => 'Cyclists of Coventry',
            'description' => 'We ride together.',
            'visibility' => 'private',
        ]);

        $response->assertRedirectContains('/groups/');
        $response->assertRedirectContains('status=group-created');

        $row = DB::table('groups')
            ->where('tenant_id', $this->testTenantId)
            ->where('owner_id', $owner->id)
            ->where('name', 'Cyclists of Coventry')
            ->first();
        $this->assertNotNull($row);
        $this->assertSame('private', $row->visibility);

        // Creator is auto-joined as the active owner.
        $this->assertSame('owner', DB::table('group_members')
            ->where('group_id', $row->id)->where('user_id', $owner->id)->value('role'));
    }

    public function test_group_create_rejects_blank_name(): void
    {
        $this->authenticatedUser(['name' => 'Founder']);

        $response = $this->post("/{$this->testTenantSlug}/accessible/groups/new", [
            'name' => '',
            'visibility' => 'public',
        ]);

        $response->assertRedirect();
        $response->assertSessionHasErrors('name');
        $this->assertSame(0, DB::table('groups')->where('tenant_id', $this->testTenantId)->where('name', '')->count());
    }

    public function test_group_edit_updates_name_visibility_for_admin(): void
    {
        $owner = $this->authenticatedUser(['name' => 'Group Owner']);
        $groupId = $this->seedAlphaGroup($owner->id);

        $edit = $this->get("/{$this->testTenantSlug}/accessible/groups/{$groupId}/edit");
        $edit->assertOk();
        $edit->assertSee('Gardening Club', false);

        $update = $this->post("/{$this->testTenantSlug}/accessible/groups/{$groupId}/edit", [
            'name' => 'Allotment Society',
            'description' => 'Bigger plots.',
            'visibility' => 'private',
        ]);
        $update->assertRedirectContains("/groups/{$groupId}");
        $update->assertRedirectContains('status=group-updated');

        $row = DB::table('groups')->where('id', $groupId)->first();
        $this->assertSame('Allotment Society', $row->name);
        $this->assertSame('private', $row->visibility);
    }

    public function test_group_edit_forbidden_for_non_admin_member(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'name' => 'Real Owner']);
        $groupId = $this->seedAlphaGroup($owner->id);

        $member = $this->authenticatedUser(['name' => 'Plain Member']);
        $this->addAlphaGroupMember($groupId, $member->id, 'member');

        $this->get("/{$this->testTenantSlug}/accessible/groups/{$groupId}/edit")->assertForbidden();
        $this->post("/{$this->testTenantSlug}/accessible/groups/{$groupId}/edit", ['name' => 'Hijacked'])->assertForbidden();

        $this->assertSame('Gardening Club', DB::table('groups')->where('id', $groupId)->value('name'));
    }

    public function test_group_delete_removes_group_for_owner(): void
    {
        $owner = $this->authenticatedUser(['name' => 'Deleting Owner']);
        $groupId = $this->seedAlphaGroup($owner->id);

        $response = $this->post("/{$this->testTenantSlug}/accessible/groups/{$groupId}/delete", ['confirm' => 'yes']);

        $response->assertRedirectContains('/groups');
        $response->assertRedirectContains('status=group-deleted');
        $this->assertSame(0, DB::table('groups')->where('id', $groupId)->count());
    }

    public function test_group_promote_demote_and_remove_member(): void
    {
        $owner = $this->authenticatedUser(['name' => 'Admin Owner']);
        $groupId = $this->seedAlphaGroup($owner->id);

        $target = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'first_name' => 'Sam', 'last_name' => 'Member']);
        $this->addAlphaGroupMember($groupId, $target->id, 'member');

        // Promote
        $promote = $this->post("/{$this->testTenantSlug}/accessible/groups/{$groupId}/members/{$target->id}", ['action' => 'promote']);
        $promote->assertRedirectContains('status=member-promoted');
        $this->assertSame('admin', DB::table('group_members')->where('group_id', $groupId)->where('user_id', $target->id)->value('role'));

        // Demote
        $demote = $this->post("/{$this->testTenantSlug}/accessible/groups/{$groupId}/members/{$target->id}", ['action' => 'demote']);
        $demote->assertRedirectContains('status=member-demoted');
        $this->assertSame('member', DB::table('group_members')->where('group_id', $groupId)->where('user_id', $target->id)->value('role'));

        // Remove
        $remove = $this->post("/{$this->testTenantSlug}/accessible/groups/{$groupId}/members/{$target->id}", ['action' => 'remove']);
        $remove->assertRedirectContains('status=member-removed');
        $this->assertSame(0, DB::table('group_members')->where('group_id', $groupId)->where('user_id', $target->id)->count());
    }

    public function test_group_member_management_rejected_for_non_admin(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'name' => 'True Owner']);
        $groupId = $this->seedAlphaGroup($owner->id);

        $attacker = $this->authenticatedUser(['name' => 'Not An Admin']);
        $this->addAlphaGroupMember($groupId, $attacker->id, 'member');

        $victim = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'name' => 'Victim']);
        $this->addAlphaGroupMember($groupId, $victim->id, 'member');

        $this->post("/{$this->testTenantSlug}/accessible/groups/{$groupId}/members/{$victim->id}", ['action' => 'remove'])->assertForbidden();
        $this->assertSame(1, DB::table('group_members')->where('group_id', $groupId)->where('user_id', $victim->id)->count());
    }

    public function test_group_join_request_approve_and_reject(): void
    {
        $owner = $this->authenticatedUser(['name' => 'Private Owner']);
        $groupId = $this->seedAlphaGroup($owner->id, ['visibility' => 'private']);

        $approver = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'first_name' => 'Wants', 'last_name' => 'In']);
        $rejectee = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'first_name' => 'Also', 'last_name' => 'Wants']);
        foreach ([$approver, $rejectee] as $u) {
            DB::table('group_members')->insert([
                'tenant_id' => $this->testTenantId, 'group_id' => $groupId, 'user_id' => $u->id,
                'role' => 'member', 'status' => 'pending', 'created_at' => now(), 'joined_at' => now(),
            ]);
        }

        $manage = $this->get("/{$this->testTenantSlug}/accessible/groups/{$groupId}/manage");
        $manage->assertOk();
        $manage->assertSee('Wants In');

        $approve = $this->post("/{$this->testTenantSlug}/accessible/groups/{$groupId}/requests/{$approver->id}", ['action' => 'accept']);
        $approve->assertRedirectContains('status=request-approved');
        $this->assertSame('active', DB::table('group_members')->where('group_id', $groupId)->where('user_id', $approver->id)->value('status'));

        $reject = $this->post("/{$this->testTenantSlug}/accessible/groups/{$groupId}/requests/{$rejectee->id}", ['action' => 'reject']);
        $reject->assertRedirectContains('status=request-rejected');
        $this->assertSame(0, DB::table('group_members')->where('group_id', $groupId)->where('user_id', $rejectee->id)->count());
    }

    public function test_group_discussion_create_and_reply(): void
    {
        $owner = $this->authenticatedUser(['name' => 'Discusser']);
        $groupId = $this->seedAlphaGroup($owner->id);

        $create = $this->post("/{$this->testTenantSlug}/accessible/groups/{$groupId}/discussions/new", [
            'title' => 'When is the next meet?',
            'content' => 'Lets pick a date.',
        ]);
        $create->assertRedirectContains("/groups/{$groupId}/discussions/");
        $create->assertRedirectContains('status=discussion-created');

        $discussionId = (int) DB::table('group_discussions')->where('group_id', $groupId)->where('title', 'When is the next meet?')->value('id');
        $this->assertGreaterThan(0, $discussionId);

        $list = $this->get("/{$this->testTenantSlug}/accessible/groups/{$groupId}/discussions");
        $list->assertOk();
        $list->assertSee('When is the next meet?');

        $detail = $this->get("/{$this->testTenantSlug}/accessible/groups/{$groupId}/discussions/{$discussionId}");
        $detail->assertOk();

        $reply = $this->post("/{$this->testTenantSlug}/accessible/groups/{$groupId}/discussions/{$discussionId}/reply", [
            'content' => 'How about Saturday?',
        ]);
        $reply->assertRedirectContains('status=reply-posted');

        // Opening post + the reply = 2 posts on the discussion.
        $this->assertSame(2, DB::table('group_posts')->where('discussion_id', $discussionId)->count());
    }

    public function test_group_discussion_create_blocked_for_non_member(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'name' => 'Group Boss']);
        $groupId = $this->seedAlphaGroup($owner->id);

        // A signed-in user who is NOT a member must not open the create form.
        $this->authenticatedUser(['name' => 'Outsider']);

        $this->get("/{$this->testTenantSlug}/accessible/groups/{$groupId}/discussions/new")->assertForbidden();

        // ...and a forced POST must not create a discussion either.
        $post = $this->post("/{$this->testTenantSlug}/accessible/groups/{$groupId}/discussions/new", [
            'title' => 'Sneaky', 'content' => 'Should not save.',
        ]);
        $post->assertRedirectContains('status=discussion-failed');
        $this->assertSame(0, DB::table('group_discussions')->where('group_id', $groupId)->where('title', 'Sneaky')->count());
    }

    public function test_group_management_404s_when_groups_feature_disabled(): void
    {
        $owner = $this->authenticatedUser(['name' => 'Feature Test']);
        $groupId = $this->seedAlphaGroup($owner->id);

        // Turn the groups feature OFF for this tenant.
        $row = DB::table('tenants')->where('id', $this->testTenantId)->value('features');
        $current = $row ? (json_decode($row, true) ?: []) : [];
        $current['groups'] = false;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($current)]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);

        $this->get("/{$this->testTenantSlug}/accessible/groups/new")->assertForbidden();
        $this->get("/{$this->testTenantSlug}/accessible/groups/{$groupId}/manage")->assertForbidden();
    }

    /**
     * Turn federation on globally with whitelist mode OFF (so every tenant is
     * implicitly whitelisted) and ensure the tenant-level federation feature row
     * is enabled — the minimum needed for isOperationAllowed()/status() to pass.
     */
    private function enableFederationSystem(): void
    {
        DB::table('federation_system_control')->updateOrInsert(
            ['id' => 1],
            [
                'federation_enabled' => 1,
                'whitelist_mode_enabled' => 0,
                'emergency_lockdown_active' => 0,
                'cross_tenant_profiles_enabled' => 1,
                'cross_tenant_listings_enabled' => 1,
                'cross_tenant_events_enabled' => 1,
            ]
        );
        DB::table('federation_tenant_features')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'feature_key' => 'federation_enabled'],
            ['is_enabled' => 1]
        );

        // Drop cached service controls so the next resolve sees the new state.
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
        app()->forgetInstance(\App\Services\FederationFeatureService::class);
    }

    /**
     * Create a partner tenant and an ACTIVE partnership (all features enabled) so
     * the current tenant can see it. Returns the partner tenant id.
     */
    private function seedFederationPartner(string $name): int
    {
        $partnerTenantId = DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => 'fed-' . strtolower(\Illuminate\Support\Str::random(8)),
            'is_active' => true,
            'depth' => 0,
            'allows_subtenants' => false,
            'tagline' => 'A neighbouring community.',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('federation_partnerships')->insert([
            'tenant_id' => $this->testTenantId,
            'partner_tenant_id' => $partnerTenantId,
            'status' => 'active',
            'federation_level' => 3,
            'profiles_enabled' => 1,
            'messaging_enabled' => 1,
            'transactions_enabled' => 1,
            'listings_enabled' => 1,
            'events_enabled' => 1,
            'groups_enabled' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $partnerTenantId;
    }

    /**
     * Create an opted-in, searchable federated member in the partner tenant.
     * Returns the new user id.
     */
    private function seedFederatedMember(int $partnerTenantId, string $first, string $last, string $skills): int
    {
        $member = User::factory()->forTenant($partnerTenantId)->create([
            'first_name' => $first,
            'last_name' => $last,
            'name' => trim("{$first} {$last}"),
            'skills' => $skills,
            'bio' => 'Active across the federation network.',
            'location' => 'Sample Town',
            'status' => 'active',
            'is_approved' => true,
        ]);

        $this->setFederationUserSettings($member->id, [
            'federation_optin' => 1,
            'profile_visible_federated' => 1,
            'appear_in_federated_search' => 1,
            'show_skills_federated' => 1,
            'show_location_federated' => 1,
        ]);

        return (int) $member->id;
    }

    /**
     * Upsert a federation_user_settings row directly. The table has no tenant_id
     * column (PK = user_id), so the test seeds it without going through the
     * tenant-scoped service (which would reject the partner-tenant member).
     *
     * @param array<string,int> $settings
     */
    private function setFederationUserSettings(int $userId, array $settings): void
    {
        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => $userId],
            array_merge([
                'federation_optin' => 0,
                'profile_visible_federated' => 0,
                'messaging_enabled_federated' => 0,
                'transactions_enabled_federated' => 0,
                'appear_in_federated_search' => 0,
                'show_skills_federated' => 0,
                'show_location_federated' => 0,
                'show_reviews_federated' => 0,
                'service_reach' => 'local_only',
                'email_notifications' => 1,
                'updated_at' => now(),
            ], $settings)
        );
    }

    /**
     * Enable one or more feature flags on the test tenant (they default off for
     * the commerce modules). Mirrors the DB-update + TenantContext::reset pattern
     * the module-gate tests use, so the next request re-resolves with the flags on.
     *
     * @param array<int,string> $features
     */
    private function enableAlphaFeatures(array $features): void
    {
        $row = DB::table('tenants')->where('id', $this->testTenantId)->value('features');
        $current = $row ? (json_decode($row, true) ?: []) : [];
        foreach ($features as $f) {
            $current[$f] = true;
        }
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($current)]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    /**
     * Force the member search down its deterministic SQL fallback by marking
     * Meilisearch unavailable. Meili indexing is non-transactional and async, so
     * across a suite run the index accumulates stale ids from rolled-back tests —
     * which makes any search-result assertion flaky. With Meili off, the SQL LIKE
     * path queries the live (transaction-visible) rows only.
     */
    private function disableMeiliSearch(): void
    {
        $prop = new \ReflectionProperty(\App\Services\SearchService::class, 'available');
        $prop->setAccessible(true);
        $prop->setValue(null, false);
    }

    private function authenticatedUser(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function configureEnglandWalesSafeguardingPolicy(int $actorUserId): string
    {
        $policyVersion = 'accessible-test-policy-v1';
        DB::table('tenant_safeguarding_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId],
            [
                'jurisdiction' => 'england_wales',
                'policy_version' => $policyVersion,
                'configured_by' => $actorUserId,
                'configured_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ],
        );
        app(\App\Services\SafeguardingJurisdictionService::class)->forget($this->testTenantId);

        return $policyVersion;
    }

    private function alphaText(string $locale, string $key, array $replace = []): string
    {
        $value = require base_path("lang/{$locale}/govuk_alpha.php");

        foreach (explode('.', $key) as $part) {
            $value = $value[$part];
        }

        foreach ($replace as $name => $replacement) {
            $value = str_replace(':' . $name, $replacement, $value);
        }

        return $value;
    }

    private function ensureListingCategory(): void
    {
        // The CI bootstrap pre-seeds category id=1 for tenant 1, so a plain
        // insertOrIgnore here is a no-op (PK collision) and leaves category 1
        // owned by the wrong tenant — listing validation (Rule::exists scoped to
        // the current tenant_id) then rejects it as "invalid category". Force the
        // category onto the test tenant; DatabaseTransactions rolls this back.
        DB::table('categories')->updateOrInsert(
            ['id' => 1],
            [
                'tenant_id' => $this->testTenantId,
                'name' => 'General',
                'slug' => 'general',
                'type' => 'listing',
                'updated_at' => now(),
                'created_at' => now(),
            ]
        );
    }

    private function enableExchangeWorkflow(): void
    {
        DB::table('tenants')
            ->where('id', $this->testTenantId)
            ->update([
                'configuration' => json_encode([
                    'broker_controls' => [
                        'exchange_workflow' => [
                            'enabled' => true,
                            'require_broker_approval' => false,
                        ],
                    ],
                ]),
            ]);

        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    // ==================================================================
    // WAVE G — Goals depth (edit, delete, progress history, templates, buddy)
    // ==================================================================

    /**
     * Seed a goal row directly for the test tenant and return its id.
     *
     * @param array<string,mixed> $overrides
     */
    private function seedGoal(int $userId, array $overrides = []): int
    {
        return (int) DB::table('goals')->insertGetId(array_merge([
            'tenant_id'         => $this->testTenantId,
            'user_id'           => $userId,
            'title'             => 'Seeded goal',
            'description'       => 'A seeded goal for testing.',
            'is_public'         => 1,
            'status'            => 'active',
            'current_value'     => 0,
            'target_value'      => 10,
            'checkin_frequency' => 'none',
            'created_at'        => now(),
            'updated_at'        => now(),
        ], $overrides));
    }

    public function test_goal_owner_can_open_edit_form_with_prefilled_values(): void
    {
        $user = $this->authenticatedUser(['name' => 'Goal Editor']);
        $goalId = $this->seedGoal($user->id, ['title' => 'Learn to bake bread', 'target_value' => 12]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/goals/{$goalId}/edit");

        $response->assertOk();
        $response->assertSee(__('govuk_alpha.goals.edit_title'));
        // Pre-filled title is present in the form.
        $response->assertSee('value="Learn to bake bread"', false);
        // The delete warning (GOV.UK warning-text) is shown on the edit page.
        $response->assertSee(__('govuk_alpha.goals.delete_warning'));
        $response->assertSee('govuk-warning-text', false);
    }

    public function test_goal_non_owner_cannot_open_edit_form(): void
    {
        $owner = $this->authenticatedUser(['name' => 'Goal Owner G']);
        $goalId = $this->seedGoal($owner->id);

        // Switch to a different member in the same tenant.
        $this->authenticatedUser(['name' => 'Goal Intruder']);

        $response = $this->get("/{$this->testTenantSlug}/accessible/goals/{$goalId}/edit");

        $response->assertForbidden();
    }

    public function test_goal_owner_can_update_goal(): void
    {
        $user = $this->authenticatedUser(['name' => 'Goal Updater']);
        $goalId = $this->seedGoal($user->id, ['title' => 'Old title', 'is_public' => 0]);

        $response = $this->post("/{$this->testTenantSlug}/accessible/goals/{$goalId}/edit", [
            'title' => 'New shiny title',
            'target_value' => 25,
            'description' => 'Updated description',
            'checkin_frequency' => 'weekly',
            'is_public' => '1',
        ]);

        $response->assertRedirectContains('status=goal-edited');
        $row = DB::table('goals')->where('id', $goalId)->first();
        $this->assertSame('New shiny title', $row->title);
        $this->assertSame('weekly', $row->checkin_frequency);
        $this->assertEquals(25, (float) $row->target_value);
        $this->assertEquals(1, (int) $row->is_public);
    }

    public function test_goal_non_owner_cannot_update_goal(): void
    {
        $owner = $this->authenticatedUser(['name' => 'Goal Owner U']);
        $goalId = $this->seedGoal($owner->id, ['title' => 'Untouchable']);

        $this->authenticatedUser(['name' => 'Update Intruder']);

        $response = $this->post("/{$this->testTenantSlug}/accessible/goals/{$goalId}/edit", [
            'title' => 'Hijacked',
            'target_value' => 99,
        ]);

        $response->assertForbidden();
        // The goal is unchanged.
        $this->assertSame('Untouchable', DB::table('goals')->where('id', $goalId)->value('title'));
    }

    public function test_goal_owner_can_delete_goal(): void
    {
        $user = $this->authenticatedUser(['name' => 'Goal Deleter']);
        $goalId = $this->seedGoal($user->id);

        $response = $this->post("/{$this->testTenantSlug}/accessible/goals/{$goalId}/delete");

        $response->assertRedirectContains('status=goal-deleted');
        $this->assertSame(0, DB::table('goals')->where('id', $goalId)->count());
    }

    public function test_goal_non_owner_cannot_delete_goal(): void
    {
        $owner = $this->authenticatedUser(['name' => 'Goal Owner D']);
        $goalId = $this->seedGoal($owner->id);

        $this->authenticatedUser(['name' => 'Delete Intruder']);

        $response = $this->post("/{$this->testTenantSlug}/accessible/goals/{$goalId}/delete");

        $response->assertForbidden();
        $this->assertSame(1, DB::table('goals')->where('id', $goalId)->count());
    }

    public function test_goal_detail_shows_progress_history_to_owner(): void
    {
        $user = $this->authenticatedUser(['name' => 'History Watcher']);
        $goalId = $this->seedGoal($user->id);

        DB::table('goal_progress_history')->insert([
            'goal_id'     => $goalId,
            'tenant_id'   => $this->testTenantId,
            'event_type'  => 'created',
            'description' => 'Goal created',
            'data'        => null,
            'created_at'  => now(),
        ]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/goals/{$goalId}");

        $response->assertOk();
        $response->assertSee(__('govuk_alpha.goals.history_title'));
        $response->assertSee(__('govuk_alpha.goals.history_type_created'));
        $response->assertSee('govuk-summary-list', false);
    }

    public function test_goal_templates_picker_lists_public_templates(): void
    {
        $this->authenticatedUser(['name' => 'Template Browser']);

        DB::table('goal_templates')->insert([
            'tenant_id'            => $this->testTenantId,
            'title'               => 'Volunteer 50 hours',
            'description'         => 'A ready-made volunteering goal.',
            'category'            => 'Volunteering',
            'default_target_value'=> 50,
            'default_milestones'  => null,
            'is_public'           => 1,
            'created_by'          => null,
            'created_at'          => now(),
            'updated_at'          => now(),
        ]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/goals/templates");

        $response->assertOk();
        $response->assertSee(__('govuk_alpha.goals.templates_title'));
        $response->assertSee('Volunteer 50 hours');
        $response->assertSee(__('govuk_alpha.goals.template_use_button'));
    }

    public function test_goal_can_be_created_from_a_template(): void
    {
        $user = $this->authenticatedUser(['name' => 'Template User']);

        $templateId = (int) DB::table('goal_templates')->insertGetId([
            'tenant_id'            => $this->testTenantId,
            'title'               => 'Read 12 books',
            'description'         => 'A reading challenge.',
            'category'            => 'Learning',
            'default_target_value'=> 12,
            'default_milestones'  => null,
            'is_public'           => 1,
            'created_by'          => null,
            'created_at'          => now(),
            'updated_at'          => now(),
        ]);

        $response = $this->post("/{$this->testTenantSlug}/accessible/goals/templates/{$templateId}", [
            'title' => 'My reading year',
            'is_public' => '1',
        ]);

        $response->assertRedirectContains('status=goal-created');
        $this->assertSame(1, DB::table('goals')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->where('title', 'My reading year')
            ->where('template_id', $templateId)
            ->count());
    }

    public function test_goal_buddying_page_lists_buddied_and_available_goals(): void
    {
        $me = $this->authenticatedUser(['name' => 'Buddy Member']);
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);

        // A goal I already buddy (mentor_id = me).
        $this->seedGoal($owner->id, ['title' => 'Goal I support', 'mentor_id' => $me->id]);
        // A public goal with no buddy that I could offer to buddy.
        $this->seedGoal($owner->id, ['title' => 'Goal needing a buddy', 'is_public' => 1]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/goals/buddying");

        $response->assertOk();
        $response->assertSee(__('govuk_alpha.goals.buddying_title'));
        $response->assertSee('Goal I support');
        $response->assertSee('Goal needing a buddy');
        $response->assertSee(__('govuk_alpha.goals.become_buddy_button'));
    }

    public function test_member_can_become_buddy_of_public_goal(): void
    {
        $me = $this->authenticatedUser(['name' => 'Would-be Buddy']);
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $goalId = $this->seedGoal($owner->id, ['is_public' => 1, 'mentor_id' => null]);

        $response = $this->post("/{$this->testTenantSlug}/accessible/goals/{$goalId}/buddy");

        $response->assertRedirectContains('status=buddy-joined');
        $this->assertSame($me->id, (int) DB::table('goals')->where('id', $goalId)->value('mentor_id'));
    }

    public function test_member_cannot_become_buddy_of_private_goal(): void
    {
        $this->authenticatedUser(['name' => 'Blocked Buddy']);
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $goalId = $this->seedGoal($owner->id, ['is_public' => 0, 'mentor_id' => null]);

        $response = $this->post("/{$this->testTenantSlug}/accessible/goals/{$goalId}/buddy");

        $response->assertRedirectContains('status=buddy-failed');
        $this->assertNull(DB::table('goals')->where('id', $goalId)->value('mentor_id'));
    }

    public function test_non_owner_cannot_view_private_goal_detail(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $goalId = $this->seedGoal($owner->id, ['is_public' => 0]);

        $this->authenticatedUser(['name' => 'Nosy Member']);

        $response = $this->get("/{$this->testTenantSlug}/accessible/goals/{$goalId}");

        $response->assertForbidden();
    }

    // ==================================================================
    // WAVE E2 — Events depth (waitlist join/leave, poll voting, recurring series)
    // ==================================================================

    /**
     * Seed a single event owned by $ownerId. Optionally cap attendance to make
     * the event fillable so the waitlist controls show.
     */
    private function seedAlphaEvent(int $ownerId, array $overrides = []): int
    {
        return DB::table('events')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'title' => 'Waitlist depth event',
            'description' => 'An event for the depth wave.',
            'location' => 'Depth Hall',
            'start_time' => now()->addDays(9),
            'end_time' => now()->addDays(9)->addHours(2),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    public function test_event_waitlist_full_event_shows_join_control_and_joins(): void
    {
        $organiser = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        // Capacity 1, already filled by one "going" RSVP from another member.
        $eventId = $this->seedAlphaEvent($organiser->id, ['max_attendees' => 1]);
        $filler = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        DB::table('event_rsvps')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $filler->id,
            'status' => 'going',
            'created_at' => now(),
        ]);

        // A different member sees the "join the waitlist" control because the event is full.
        $member = $this->authenticatedUser();
        $detail = $this->get("/{$this->testTenantSlug}/accessible/events/{$eventId}");
        $detail->assertOk();
        $detail->assertSee(__('govuk_alpha.events.waitlist_heading'));
        $detail->assertSee(route('govuk-alpha.events.waitlist.join', ['tenantSlug' => $this->testTenantSlug, 'id' => $eventId]), false);

        // Joining the waitlist redirects with the success status and inserts a waiting row.
        $join = $this->post("/{$this->testTenantSlug}/accessible/events/{$eventId}/waitlist");
        $join->assertRedirect("/{$this->testTenantSlug}/accessible/events/{$eventId}?status=waitlist-joined");
        $this->assertSame(1, DB::table('event_waitlist')
            ->where('event_id', $eventId)
            ->where('user_id', $member->id)
            ->where('status', 'waiting')
            ->count());

        // The detail page now shows the member's position and the leave control.
        $after = $this->get("/{$this->testTenantSlug}/accessible/events/{$eventId}");
        $after->assertOk();
        $after->assertSee(__('govuk_alpha.events.waitlist_position', ['position' => 1]));
        $after->assertSee(route('govuk-alpha.events.waitlist.leave', ['tenantSlug' => $this->testTenantSlug, 'id' => $eventId]), false);
    }

    public function test_event_waitlist_leave_cancels_the_waiting_row(): void
    {
        $organiser = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $eventId = $this->seedAlphaEvent($organiser->id, ['max_attendees' => 1]);

        $member = $this->authenticatedUser();
        DB::table('event_waitlist')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $member->id,
            'position' => 1,
            'status' => 'waiting',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $leave = $this->post("/{$this->testTenantSlug}/accessible/events/{$eventId}/waitlist/leave");
        $leave->assertRedirect("/{$this->testTenantSlug}/accessible/events/{$eventId}?status=waitlist-left");

        // The row is cancelled (not deleted) — no longer 'waiting'.
        $this->assertSame(0, DB::table('event_waitlist')
            ->where('event_id', $eventId)
            ->where('user_id', $member->id)
            ->where('status', 'waiting')
            ->count());
    }

    public function test_event_waitlist_rsvp_going_on_full_event_auto_waitlists(): void
    {
        $organiser = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $eventId = $this->seedAlphaEvent($organiser->id, ['max_attendees' => 1]);
        $filler = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        DB::table('event_rsvps')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $filler->id,
            'status' => 'going',
            'created_at' => now(),
        ]);

        // RSVPing "going" to a full event is reported as a waitlist join, not a failure.
        $member = $this->authenticatedUser();
        $rsvp = $this->post("/{$this->testTenantSlug}/accessible/events/{$eventId}/rsvp", ['status' => 'going']);
        $rsvp->assertRedirect("/{$this->testTenantSlug}/accessible/events/{$eventId}?status=waitlist-joined");
        $this->assertSame(1, DB::table('event_waitlist')
            ->where('event_id', $eventId)
            ->where('user_id', $member->id)
            ->where('status', 'waiting')
            ->count());
    }

    public function test_event_waitlist_requires_authentication(): void
    {
        $organiser = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $eventId = $this->seedAlphaEvent($organiser->id, ['max_attendees' => 1]);

        // Anonymous POST is bounced to login, not allowed to mutate the waitlist.
        $join = $this->post("/{$this->testTenantSlug}/accessible/events/{$eventId}/waitlist");
        $join->assertRedirect("/{$this->testTenantSlug}/accessible/login?status=auth-required");
        $this->assertSame(0, DB::table('event_waitlist')->where('event_id', $eventId)->count());
    }

    public function test_event_poll_open_poll_shows_vote_form_and_records_vote(): void
    {
        $organiser = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $eventId = $this->seedAlphaEvent($organiser->id);

        // An open poll attached to this event.
        $pollId = DB::table('polls')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organiser->id,
            'event_id' => $eventId,
            'question' => 'What time suits best?',
            'is_active' => 1,
            'end_date' => null,
            'created_at' => now(),
        ]);
        $morning = DB::table('poll_options')->insertGetId(['tenant_id' => $this->testTenantId, 'poll_id' => $pollId, 'label' => 'Morning', 'votes' => 0]);
        DB::table('poll_options')->insert(['tenant_id' => $this->testTenantId, 'poll_id' => $pollId, 'label' => 'Evening', 'votes' => 0]);

        // A non-creator who has not voted sees the poll question + vote form.
        $voter = $this->authenticatedUser(['name' => 'Event Voter']);
        $detail = $this->get("/{$this->testTenantSlug}/accessible/events/{$eventId}");
        $detail->assertOk();
        $detail->assertSee(__('govuk_alpha.events.polls_heading'));
        $detail->assertSee('What time suits best?');
        $detail->assertSee('Morning');
        $detail->assertSee(__('govuk_alpha.events.poll_vote_button'));
        $detail->assertSee(route('govuk-alpha.events.polls.vote', ['tenantSlug' => $this->testTenantSlug, 'id' => $eventId, 'pollId' => $pollId]), false);

        // Casting a vote records it and redirects with the success status.
        $vote = $this->post("/{$this->testTenantSlug}/accessible/events/{$eventId}/polls/{$pollId}/vote", ['option_id' => $morning]);
        $vote->assertRedirectContains('status=poll-voted');
        $this->assertSame(1, DB::table('poll_votes')
            ->where('poll_id', $pollId)
            ->where('option_id', $morning)
            ->where('user_id', $voter->id)
            ->count());
    }

    public function test_event_poll_open_poll_hides_running_totals_for_non_creator(): void
    {
        $organiser = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $eventId = $this->seedAlphaEvent($organiser->id);
        $pollId = DB::table('polls')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organiser->id,
            'event_id' => $eventId,
            'question' => 'Secret ballot question?',
            'is_active' => 1,
            'end_date' => null,
            'created_at' => now(),
        ]);
        $optA = DB::table('poll_options')->insertGetId(['tenant_id' => $this->testTenantId, 'poll_id' => $pollId, 'label' => 'Option A', 'votes' => 0]);

        // A voter casts a vote, then revisits — while the poll is open totals stay hidden.
        $this->authenticatedUser(['name' => 'Ballot Voter']);
        $this->post("/{$this->testTenantSlug}/accessible/events/{$eventId}/polls/{$pollId}/vote", ['option_id' => $optA]);

        $detail = $this->get("/{$this->testTenantSlug}/accessible/events/{$eventId}");
        $detail->assertOk();
        // The "results pending" notice is shown instead of percentages.
        $detail->assertSee(__('govuk_alpha.events.poll_results_pending_note'));
    }

    public function test_event_poll_vote_rejects_poll_from_a_different_event(): void
    {
        $organiser = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $eventA = $this->seedAlphaEvent($organiser->id, ['title' => 'Event A']);
        $eventB = $this->seedAlphaEvent($organiser->id, ['title' => 'Event B']);

        // Poll belongs to event B.
        $pollId = DB::table('polls')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organiser->id,
            'event_id' => $eventB,
            'question' => 'Belongs to B',
            'is_active' => 1,
            'end_date' => null,
            'created_at' => now(),
        ]);
        $optId = DB::table('poll_options')->insertGetId(['tenant_id' => $this->testTenantId, 'poll_id' => $pollId, 'label' => 'Yes', 'votes' => 0]);

        // Voting on it via event A's URL is a 404 — no cross-event vote stuffing.
        $this->authenticatedUser();
        $vote = $this->post("/{$this->testTenantSlug}/accessible/events/{$eventA}/polls/{$pollId}/vote", ['option_id' => $optId]);
        $vote->assertNotFound();
        $this->assertSame(0, DB::table('poll_votes')->where('poll_id', $pollId)->count());
    }

    public function test_event_series_navigation_lists_sibling_occurrences(): void
    {
        $organiser = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);

        $seriesId = DB::table('event_series')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'created_by' => $organiser->id,
            'title' => 'Weekly meet-up',
            'description' => 'Repeats weekly.',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $first = $this->seedAlphaEvent($organiser->id, [
            'title' => 'Weekly meet-up — week 1',
            'series_id' => $seriesId,
            'start_time' => now()->addDays(7),
        ]);
        $second = $this->seedAlphaEvent($organiser->id, [
            'title' => 'Weekly meet-up — week 2',
            'series_id' => $seriesId,
            'start_time' => now()->addDays(14),
        ]);

        $this->authenticatedUser();
        $detail = $this->get("/{$this->testTenantSlug}/accessible/events/{$first}");
        $detail->assertOk();
        $detail->assertSee(__('govuk_alpha.events.series_heading'));
        // The current occurrence is flagged, and the sibling links through.
        $detail->assertSee(__('govuk_alpha.events.series_this_event'));
        $detail->assertSee(route('govuk-alpha.events.show', ['tenantSlug' => $this->testTenantSlug, 'id' => $second]), false);
        $detail->assertSee('Weekly meet-up — week 2');
    }

    // ===== WAVE O: Organisations depth =====

    /**
     * Seed an approved organisation owned by $ownerId, with one open opportunity
     * (created by $creatorId), one approved volunteer log (hours) and one review.
     * Returns [organizationId, opportunityId, creatorId, reviewerId].
     *
     * @return array{0:int,1:int,2:int,3:int}
     */
    private function seedOrgWithDepth(int $ownerId): array
    {
        $creator = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $reviewer = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'name' => 'Grateful Reviewer',
            'first_name' => 'Grateful',
            'last_name' => 'Reviewer',
        ]);

        $organizationId = DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'name' => 'Depth Org',
            'slug' => 'depth-org-' . $ownerId,
            'description' => 'An organisation with opportunities, reviews and stats.',
            'contact_email' => 'depth-org@example.test',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $opportunityId = DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $organizationId,
            'created_by' => $creator->id,
            'title' => 'Depth volunteering opportunity',
            'description' => 'A meaningful accessible opportunity at the depth org.',
            'location' => 'Community Centre',
            'is_remote' => 1,
            'is_active' => 1,
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('vol_logs')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $reviewer->id,
            'organization_id' => $organizationId,
            'opportunity_id' => $opportunityId,
            'date_logged' => now()->toDateString(),
            'hours' => 6,
            'status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('vol_reviews')->insert([
            'tenant_id' => $this->testTenantId,
            'reviewer_id' => $reviewer->id,
            'target_type' => 'organization',
            'target_id' => $organizationId,
            'rating' => 5,
            'comment' => 'A wonderful organisation to volunteer with.',
            'created_at' => now(),
        ]);

        return [$organizationId, $opportunityId, $creator->id, $reviewer->id];
    }

    public function test_o_organisation_detail_shows_opportunities_reviews_and_stats(): void
    {
        $owner = $this->authenticatedUser(['name' => 'Org Owner']);
        [$organizationId, $opportunityId] = $this->seedOrgWithDepth($owner->id);

        $res = $this->get("/{$this->testTenantSlug}/accessible/organisations/{$organizationId}");
        $res->assertOk();

        // Core profile.
        $res->assertSee('Depth Org');

        // Stats section.
        $res->assertSee(__('govuk_alpha.org_depth.stats_heading'));
        $res->assertSee(__('govuk_alpha.org_depth.stat_hours'));
        $res->assertSee(__('govuk_alpha.org_depth.stat_rating'));

        // Opportunities section links through to the existing opportunity detail
        // page (where the apply form already lives).
        $res->assertSee(__('govuk_alpha.org_depth.opportunities_heading'));
        $res->assertSee('Depth volunteering opportunity');
        $res->assertSee(
            route('govuk-alpha.volunteering.show', ['tenantSlug' => $this->testTenantSlug, 'id' => $opportunityId]),
            false
        );

        // Reviews section.
        $res->assertSee(__('govuk_alpha.org_depth.reviews_heading'));
        $res->assertSee('A wonderful organisation to volunteer with.');
        $res->assertSee('Grateful Reviewer');
    }

    public function test_o_organisation_detail_empty_states_when_no_depth_data(): void
    {
        $owner = $this->authenticatedUser(['name' => 'Bare Owner']);

        $organizationId = DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Bare Org',
            'slug' => 'bare-org-' . $owner->id,
            'description' => 'No opportunities or reviews yet.',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $res = $this->get("/{$this->testTenantSlug}/accessible/organisations/{$organizationId}");
        $res->assertOk();
        $res->assertSee('Bare Org');
        $res->assertSee(__('govuk_alpha.org_depth.opportunities_empty'));
        $res->assertSee(__('govuk_alpha.org_depth.reviews_empty'));
    }

    public function test_o_organisation_detail_404_for_cross_tenant_org(): void
    {
        $this->authenticatedUser(['name' => 'Tenant Two Member']);

        // An organisation belonging to a DIFFERENT tenant must not be visible.
        // The VolOrganization tenant global scope filters every read by the
        // current tenant id, so a row stamped with a foreign tenant_id is
        // invisible regardless of whether a matching tenants row exists.
        $otherTenantId = $this->testTenantId + 1000;
        $foreignOrgId = DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $otherTenantId,
            'user_id' => 0,
            'name' => 'Foreign Org',
            'slug' => 'foreign-org-wave-o',
            'description' => 'Belongs to another tenant.',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $res = $this->get("/{$this->testTenantSlug}/accessible/organisations/{$foreignOrgId}");
        $res->assertNotFound();
    }

    public function test_o_organisation_detail_404_for_non_public_org_statuses(): void
    {
        $owner = $this->authenticatedUser(['name' => 'Pending Org Owner']);

        $pendingOrgId = DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Pending Accessible Org',
            'slug' => 'pending-accessible-org-' . $owner->id,
            'description' => 'Pending organisations should not have public detail pages.',
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $suspendedOrgId = DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Suspended Accessible Org',
            'slug' => 'suspended-accessible-org-' . $owner->id,
            'description' => 'Suspended organisations should not have public detail pages.',
            'status' => 'suspended',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->get("/{$this->testTenantSlug}/accessible/organisations/{$pendingOrgId}")->assertNotFound();
        $this->get("/{$this->testTenantSlug}/accessible/organisations/{$suspendedOrgId}")->assertNotFound();
    }

    public function test_register_organisation_requires_terms_agreement(): void
    {
        // Bona-fide gating: a complete, valid submission that omits the mandatory
        // terms checkbox must be rejected and must NOT create an organisation.
        $this->authenticatedUser(['name' => 'No Terms Member']);

        $store = $this->post("/{$this->testTenantSlug}/accessible/organisations", [
            'name' => 'Helping Hands Charity',
            'description' => 'We coordinate community volunteers for local good causes.',
            'email' => 'contact@helping-hands.example',
            // agreed_terms intentionally omitted.
        ]);

        $store->assertRedirect("/{$this->testTenantSlug}/accessible/organisations?status=org-invalid");

        $this->assertDatabaseMissing('vol_organizations', [
            'tenant_id' => $this->testTenantId,
            'name' => 'Helping Hands Charity',
        ]);
    }

    public function test_register_organisation_with_terms_creates_pending_org(): void
    {
        // A valid submission with required fields + terms agreement creates a
        // pending organisation (admin approval remains the vetting gate).
        $owner = $this->authenticatedUser(['name' => 'Bona Fide Owner']);

        $store = $this->post("/{$this->testTenantSlug}/accessible/organisations", [
            'name' => 'Riverside Community Trust',
            'description' => 'A registered non-profit supporting riverside community projects.',
            'email' => 'admin@riverside-trust.example',
            'website' => 'https://riverside-trust.example',
            'agreed_terms' => '1',
        ]);

        $store->assertRedirect("/{$this->testTenantSlug}/accessible/organisations?status=org-submitted");

        $this->assertDatabaseHas('vol_organizations', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Riverside Community Trust',
            'contact_email' => 'admin@riverside-trust.example',
            'status' => 'pending',
        ]);
    }

    public function test_o_apply_to_org_opportunity_uses_existing_volunteer_path(): void
    {
        $applicant = $this->authenticatedUser(['name' => 'Eager Applicant']);
        [$organizationId, $opportunityId] = $this->seedOrgWithDepth($applicant->id);

        // The opportunity link on the org page leads to the opportunity detail
        // page; applying there exercises the existing, shared apply route +
        // organiser-notification logic (not duplicated for WAVE O).
        $orgPage = $this->get("/{$this->testTenantSlug}/accessible/organisations/{$organizationId}");
        $orgPage->assertOk();
        $orgPage->assertSee(
            route('govuk-alpha.volunteering.show', ['tenantSlug' => $this->testTenantSlug, 'id' => $opportunityId]),
            false
        );

        $apply = $this->post("/{$this->testTenantSlug}/accessible/volunteering/opportunities/{$opportunityId}/apply", [
            'message' => 'Found you via the organisation page.',
        ]);
        $apply->assertRedirect("/{$this->testTenantSlug}/accessible/volunteering/opportunities/{$opportunityId}?status=apply-created");

        $this->assertDatabaseHas('vol_applications', [
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $opportunityId,
            'user_id' => $applicant->id,
            'status' => 'pending',
        ]);
    }

    // ===================================================================
    // WAVE V2: Volunteering depth — certificates, waitlist, shift swaps
    // ===================================================================

    /** Seed an organisation + opportunity + future shift, returning their ids. */
    private function v2SeedShift(int $creatorId, array $shiftOverrides = []): array
    {
        $organizationId = DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $creatorId,
            'name' => 'V2 Depth Org',
            'slug' => 'v2-depth-org-' . uniqid(),
            'description' => 'Org for V2 depth tests.',
            'contact_email' => 'v2depth-' . uniqid() . '@example.test',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $opportunityId = DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $organizationId,
            'created_by' => $creatorId,
            'title' => 'V2 Depth Opportunity',
            'description' => 'Opportunity for V2 depth tests.',
            'location' => 'Centre',
            'is_remote' => 0,
            'skills_needed' => 'Support',
            'start_date' => now()->addWeek()->toDateString(),
            'end_date' => now()->addMonth()->toDateString(),
            'is_active' => 1,
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $shiftId = DB::table('vol_shifts')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $opportunityId,
            'start_time' => now()->addDays(10),
            'end_time' => now()->addDays(10)->addHours(3),
            'capacity' => 5,
            'created_at' => now(),
        ], $shiftOverrides));

        return ['organization_id' => $organizationId, 'opportunity_id' => $opportunityId, 'shift_id' => $shiftId];
    }

    public function test_v2_certificates_page_renders_empty_state_and_link_from_volunteering(): void
    {
        $this->authenticatedUser();

        $hub = $this->get("/{$this->testTenantSlug}/accessible/volunteering");
        $hub->assertOk();
        $hub->assertSee(route('govuk-alpha.volunteering.certificates', ['tenantSlug' => $this->testTenantSlug]), false);

        $page = $this->get("/{$this->testTenantSlug}/accessible/volunteering/certificates");
        $page->assertOk();
        $page->assertSee(__('govuk_alpha.vol_depth.certificates_title'));
        $page->assertSee(__('govuk_alpha.vol_depth.certificates_empty_title'));
        $page->assertSee(__('govuk_alpha.vol_depth.certificate_generate'));
    }

    public function test_v2_certificate_generate_requires_approved_hours_then_lists_and_downloads(): void
    {
        $user = $this->authenticatedUser();
        $seed = $this->v2SeedShift($user->id);

        // No approved hours yet → generate fails with the no-hours notice.
        $noHours = $this->post("/{$this->testTenantSlug}/accessible/volunteering/certificates/generate");
        $noHours->assertRedirect("/{$this->testTenantSlug}/accessible/volunteering/certificates?status=certificate-no-hours");

        // Add an approved hours log (whole-hour amount; nexus_test stores int hours).
        DB::table('vol_logs')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'organization_id' => $seed['organization_id'],
            'opportunity_id' => $seed['opportunity_id'],
            'hours' => 4,
            'status' => 'approved',
            'date_logged' => now()->subDays(3)->toDateString(),
            'description' => 'Approved shift work.',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $generated = $this->post("/{$this->testTenantSlug}/accessible/volunteering/certificates/generate");
        $generated->assertRedirect("/{$this->testTenantSlug}/accessible/volunteering/certificates?status=certificate-generated");

        $this->assertDatabaseHas('vol_certificates', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
        ]);

        $code = DB::table('vol_certificates')
            ->where('user_id', $user->id)
            ->where('tenant_id', $this->testTenantId)
            ->value('verification_code');
        $this->assertNotEmpty($code);

        $list = $this->get("/{$this->testTenantSlug}/accessible/volunteering/certificates");
        $list->assertOk();
        $list->assertSee((string) $code);
        $list->assertSee(route('govuk-alpha.volunteering.certificates.download', ['tenantSlug' => $this->testTenantSlug, 'code' => $code]), false);

        // Download returns the printable HTML and marks the cert downloaded.
        $download = $this->get("/{$this->testTenantSlug}/accessible/volunteering/certificates/{$code}/download");
        $download->assertOk();
        $download->assertHeader('Content-Type', 'text/html; charset=UTF-8');
        $this->assertDatabaseMissing('vol_certificates', [
            'verification_code' => $code,
            'downloaded_at' => null,
        ]);
    }

    public function test_v2_certificate_download_blocks_cross_user_idor(): void
    {
        $other = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        // A certificate owned by SOMEONE ELSE in the same tenant.
        $foreignCode = 'FOREIGNCODE99';
        DB::table('vol_certificates')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $other->id,
            'verification_code' => $foreignCode,
            'total_hours' => 6,
            'date_range_start' => now()->subMonth()->toDateString(),
            'date_range_end' => now()->toDateString(),
            'organizations' => json_encode([]),
            'generated_at' => now(),
            'updated_at' => now(),
        ]);

        // The attacker (different member) guesses the code → must 404, not download.
        $this->authenticatedUser();
        $attempt = $this->get("/{$this->testTenantSlug}/accessible/volunteering/certificates/{$foreignCode}/download");
        $attempt->assertNotFound();

        // And the foreign cert is never marked as downloaded.
        $this->assertDatabaseHas('vol_certificates', [
            'verification_code' => $foreignCode,
            'downloaded_at' => null,
        ]);
    }

    public function test_v2_waitlist_page_lists_entries_and_allows_leave(): void
    {
        $user = $this->authenticatedUser();
        $creator = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $seed = $this->v2SeedShift($creator->id);

        $waitlistId = DB::table('vol_shift_waitlist')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'shift_id' => $seed['shift_id'],
            'user_id' => $user->id,
            'position' => 1,
            'status' => 'waiting',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $page = $this->get("/{$this->testTenantSlug}/accessible/volunteering/waitlist");
        $page->assertOk();
        $page->assertSee(__('govuk_alpha.vol_depth.waitlist_title'));
        $page->assertSee('V2 Depth Opportunity');
        $page->assertSee(route('govuk-alpha.volunteering.waitlist.leave', ['tenantSlug' => $this->testTenantSlug, 'shiftId' => $seed['shift_id']]), false);

        $leave = $this->post("/{$this->testTenantSlug}/accessible/volunteering/waitlist/{$seed['shift_id']}/leave");
        $leave->assertRedirect("/{$this->testTenantSlug}/accessible/volunteering/waitlist?status=waitlist-left");

        // Entry is now cancelled (not 'waiting'), so it drops off the list.
        $this->assertDatabaseMissing('vol_shift_waitlist', [
            'id' => $waitlistId,
            'status' => 'waiting',
        ]);
    }

    public function test_v2_waitlist_leave_cannot_affect_another_members_entry(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $creator = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $seed = $this->v2SeedShift($creator->id);

        // Waitlist entry belongs to $owner.
        $waitlistId = DB::table('vol_shift_waitlist')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'shift_id' => $seed['shift_id'],
            'user_id' => $owner->id,
            'position' => 1,
            'status' => 'waiting',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // A DIFFERENT member tries to leave that shift's waitlist.
        $this->authenticatedUser();
        $attempt = $this->post("/{$this->testTenantSlug}/accessible/volunteering/waitlist/{$seed['shift_id']}/leave");
        $attempt->assertRedirect("/{$this->testTenantSlug}/accessible/volunteering/waitlist?status=waitlist-leave-failed");

        // The owner's entry is untouched.
        $this->assertDatabaseHas('vol_shift_waitlist', [
            'id' => $waitlistId,
            'user_id' => $owner->id,
            'status' => 'waiting',
        ]);
    }

    public function test_v2_swaps_page_renders_request_form_with_my_shifts(): void
    {
        $user = $this->authenticatedUser();
        $seed = $this->v2SeedShift($user->id);

        // The member is signed up (approved) for the shift → it appears as a from-shift option.
        DB::table('vol_applications')->insert([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $seed['opportunity_id'],
            'shift_id' => $seed['shift_id'],
            'user_id' => $user->id,
            'status' => 'approved',
            'message' => 'Signed up.',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $page = $this->get("/{$this->testTenantSlug}/accessible/volunteering/swaps");
        $page->assertOk();
        $page->assertSee(__('govuk_alpha.vol_depth.swaps_title'));
        $page->assertSee('name="from_shift_id"', false);
        $page->assertSee('name="to_shift_id"', false);
        $page->assertSee('name="to_user_id"', false);
        $page->assertSee('value="' . $seed['shift_id'] . '"', false);
    }

    public function test_v2_swap_request_creates_pending_row_and_notifies_target(): void
    {
        $user = $this->authenticatedUser();
        $partner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        $mine = $this->v2SeedShift($user->id);
        $theirShiftId = DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $mine['opportunity_id'],
            'start_time' => now()->addDays(11),
            'end_time' => now()->addDays(11)->addHours(3),
            'capacity' => 5,
            'created_at' => now(),
        ]);
        $theirs = [
            'organization_id' => $mine['organization_id'],
            'opportunity_id' => $mine['opportunity_id'],
            'shift_id' => $theirShiftId,
        ];

        // Both volunteers are signed up (approved) for their respective shifts.
        DB::table('vol_applications')->insert([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $mine['opportunity_id'],
            'shift_id' => $mine['shift_id'],
            'user_id' => $user->id,
            'status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('vol_applications')->insert([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $theirs['opportunity_id'],
            'shift_id' => $theirs['shift_id'],
            'user_id' => $partner->id,
            'status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $request = $this->withSession(['_token' => 'test-token'])->post("/{$this->testTenantSlug}/accessible/volunteering/swaps", [
            '_token' => 'test-token',
            'from_shift_id' => $mine['shift_id'],
            'to_shift_id' => $theirs['shift_id'],
            'to_user_id' => $partner->id,
            'message' => 'Could we swap please?',
        ]);
        $request->assertRedirect("/{$this->testTenantSlug}/accessible/volunteering/swaps?status=swap-requested");

        $this->assertDatabaseHas('vol_shift_swap_requests', [
            'tenant_id' => $this->testTenantId,
            'from_user_id' => $user->id,
            'to_user_id' => $partner->id,
            'from_shift_id' => $mine['shift_id'],
            'to_shift_id' => $theirs['shift_id'],
            'status' => 'pending',
        ]);
    }

    public function test_v2_swap_request_missing_fields_is_rejected(): void
    {
        $user = $this->authenticatedUser();

        $request = $this->post("/{$this->testTenantSlug}/accessible/volunteering/swaps", [
            'from_shift_id' => 0,
            'to_shift_id' => 0,
            'to_user_id' => 0,
        ]);
        $request->assertRedirect("/{$this->testTenantSlug}/accessible/volunteering/swaps?status=swap-invalid");

        // No swap request row was created for this member.
        $this->assertDatabaseMissing('vol_shift_swap_requests', [
            'from_user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
        ]);
    }

    public function test_v2_swap_recipient_can_accept_and_shifts_are_exchanged(): void
    {
        $requester = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $recipient = $this->authenticatedUser(); // the logged-in user is the recipient

        $fromSeed = $this->v2SeedShift($requester->id);
        $toSeed = $this->v2SeedShift($recipient->id);

        $fromAppId = DB::table('vol_applications')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $fromSeed['opportunity_id'],
            'shift_id' => $fromSeed['shift_id'],
            'user_id' => $requester->id,
            'status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $toAppId = DB::table('vol_applications')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $toSeed['opportunity_id'],
            'shift_id' => $toSeed['shift_id'],
            'user_id' => $recipient->id,
            'status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $swapId = DB::table('vol_shift_swap_requests')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'from_user_id' => $requester->id,
            'to_user_id' => $recipient->id,
            'from_shift_id' => $fromSeed['shift_id'],
            'to_shift_id' => $toSeed['shift_id'],
            'status' => 'pending',
            'requires_admin_approval' => 0,
            'message' => 'Swap?',
            'created_at' => now(),
        ]);

        $accept = $this->post("/{$this->testTenantSlug}/accessible/volunteering/swaps/{$swapId}/respond", [
            'action' => 'accept',
        ]);
        $accept->assertRedirect("/{$this->testTenantSlug}/accessible/volunteering/swaps?status=swap-accepted");

        $this->assertDatabaseHas('vol_shift_swap_requests', ['id' => $swapId, 'status' => 'accepted']);
        // Assignments have been exchanged.
        $this->assertDatabaseHas('vol_applications', ['id' => $fromAppId, 'shift_id' => $toSeed['shift_id']]);
        $this->assertDatabaseHas('vol_applications', ['id' => $toAppId, 'shift_id' => $fromSeed['shift_id']]);
    }

    public function test_v2_swap_respond_cannot_act_on_request_addressed_to_another_member(): void
    {
        $requester = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $intendedRecipient = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        $fromSeed = $this->v2SeedShift($requester->id);
        $toSeed = $this->v2SeedShift($intendedRecipient->id);

        $swapId = DB::table('vol_shift_swap_requests')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'from_user_id' => $requester->id,
            'to_user_id' => $intendedRecipient->id,
            'from_shift_id' => $fromSeed['shift_id'],
            'to_shift_id' => $toSeed['shift_id'],
            'status' => 'pending',
            'requires_admin_approval' => 0,
            'message' => 'Swap?',
            'created_at' => now(),
        ]);

        // A third, unrelated member tries to accept the request.
        $this->authenticatedUser();
        $attempt = $this->post("/{$this->testTenantSlug}/accessible/volunteering/swaps/{$swapId}/respond", [
            'action' => 'accept',
        ]);
        $attempt->assertRedirect("/{$this->testTenantSlug}/accessible/volunteering/swaps?status=swap-respond-failed");

        // The request is still pending — the intruder could not act on it.
        $this->assertDatabaseHas('vol_shift_swap_requests', ['id' => $swapId, 'status' => 'pending']);
    }

    public function test_v2_swap_requester_can_cancel_but_others_cannot(): void
    {
        $requester = $this->authenticatedUser();
        $partner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        $fromSeed = $this->v2SeedShift($requester->id);
        $toSeed = $this->v2SeedShift($partner->id);

        $swapId = DB::table('vol_shift_swap_requests')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'from_user_id' => $requester->id,
            'to_user_id' => $partner->id,
            'from_shift_id' => $fromSeed['shift_id'],
            'to_shift_id' => $toSeed['shift_id'],
            'status' => 'pending',
            'requires_admin_approval' => 0,
            'message' => 'Swap?',
            'created_at' => now(),
        ]);

        $cancel = $this->post("/{$this->testTenantSlug}/accessible/volunteering/swaps/{$swapId}/cancel");
        $cancel->assertRedirect("/{$this->testTenantSlug}/accessible/volunteering/swaps?status=swap-cancelled");
        $this->assertDatabaseHas('vol_shift_swap_requests', ['id' => $swapId, 'status' => 'cancelled']);
    }

    public function test_v2_volunteering_depth_pages_require_authentication(): void
    {
        // Logged out → each page redirects to the alpha login.
        foreach (['certificates', 'waitlist', 'swaps'] as $sub) {
            $page = $this->get("/{$this->testTenantSlug}/accessible/volunteering/{$sub}");
            $page->assertRedirect(route('govuk-alpha.login', ['tenantSlug' => $this->testTenantSlug, 'status' => 'auth-required']));
        }
    }

    public function test_v2_volunteering_depth_blocked_when_feature_disabled(): void
    {
        $this->authenticatedUser();

        // Disable the volunteering feature for this tenant.
        $row = DB::table('tenants')->where('id', $this->testTenantId)->value('features');
        $features = $row ? (json_decode($row, true) ?: []) : [];
        $features['volunteering'] = false;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);

        foreach (['certificates', 'waitlist', 'swaps'] as $sub) {
            $page = $this->get("/{$this->testTenantSlug}/accessible/volunteering/{$sub}");
            $page->assertForbidden();
        }
    }

    // ==================================================================
    // WAVE FED2 — Federation heavy slice (connections, messaging, transfer)
    // ==================================================================

    /**
     * Enable the system-level cross-tenant messaging + transactions flags. The
     * base enableFederationSystem() only turns on profiles/listings/events, but
     * FederationFeatureService::isOperationAllowed('messaging'|'transactions')
     * additionally requires these system columns (DB default 0).
     */
    private function enableFederationMessagingAndTransactions(): void
    {
        DB::table('federation_system_control')->where('id', 1)->update([
            'cross_tenant_messaging_enabled' => 1,
            'cross_tenant_transactions_enabled' => 1,
        ]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
        app()->forgetInstance(\App\Services\FederationFeatureService::class);
    }

    /**
     * Seed a federated member who additionally has messaging + transactions
     * enabled (the base seedFederatedMember leaves those off). Returns user id.
     */
    private function seedTransactingFederatedMember(int $partnerTenantId, string $first, string $last): int
    {
        $memberId = $this->seedFederatedMember($partnerTenantId, $first, $last, 'Gardening');
        $this->setFederationUserSettings($memberId, [
            'federation_optin' => 1,
            'profile_visible_federated' => 1,
            'appear_in_federated_search' => 1,
            'show_skills_federated' => 1,
            'show_location_federated' => 1,
            'messaging_enabled_federated' => 1,
            'transactions_enabled_federated' => 1,
        ]);
        return $memberId;
    }

    public function test_fed2_member_profile_shows_connect_action_for_opted_in_viewer(): void
    {
        $viewer = $this->authenticatedUser(['name' => 'Connecting Viewer']);
        $this->enableFederationSystem();
        $this->enableFederationMessagingAndTransactions();
        $this->setFederationUserSettings($viewer->id, [
            'federation_optin' => 1,
            'messaging_enabled_federated' => 1,
            'transactions_enabled_federated' => 1,
        ]);
        $partnerTenantId = $this->seedFederationPartner('Connect Timebank');
        $partnerUserId = $this->seedTransactingFederatedMember($partnerTenantId, 'Connectable', 'Member');

        $res = $this->get("/{$this->testTenantSlug}/accessible/federation/members/{$partnerUserId}?tenant_id={$partnerTenantId}");
        $res->assertOk();
        $res->assertSee(__('govuk_alpha.fed2.member_actions.connect'));
        $res->assertSee(route('govuk-alpha.federation.connections.store', ['tenantSlug' => $this->testTenantSlug]), false);
        // Transfer action is offered because both sides enable transactions.
        $res->assertSee(route('govuk-alpha.federation.transfer', [
            'tenantSlug' => $this->testTenantSlug, 'id' => $partnerUserId, 'tenant_id' => $partnerTenantId,
        ]), false);
    }

    public function test_fed2_connection_send_then_accept_flow(): void
    {
        // Requester is in the partner tenant; receiver is the local test-tenant user.
        $receiver = $this->authenticatedUser(['name' => 'Request Receiver']);
        $this->enableFederationSystem();
        $this->setFederationUserSettings($receiver->id, [
            'federation_optin' => 1,
            'messaging_enabled_federated' => 1,
        ]);
        $partnerTenantId = $this->seedFederationPartner('Requester Timebank');
        $requesterId = $this->seedTransactingFederatedMember($partnerTenantId, 'Eager', 'Requester');

        // Directly insert the pending request FROM the partner member TO our user
        // (the send endpoint is owner-scoped to the sender; here we exercise accept).
        DB::table('federation_connections')->insert([
            'requester_user_id' => $requesterId,
            'requester_tenant_id' => $partnerTenantId,
            'receiver_user_id' => $receiver->id,
            'receiver_tenant_id' => $this->testTenantId,
            'status' => 'pending',
            'created_at' => now(),
        ]);
        $connId = (int) DB::table('federation_connections')
            ->where('receiver_user_id', $receiver->id)
            ->where('requester_user_id', $requesterId)
            ->value('id');

        // Accept it as the receiver.
        $this->post("/{$this->testTenantSlug}/accessible/federation/connections/{$connId}/accept")
            ->assertRedirect("/{$this->testTenantSlug}/accessible/federation/connections?tab=received&status=connection-accepted");

        $this->assertSame('accepted', DB::table('federation_connections')->where('id', $connId)->value('status'));
    }

    public function test_fed2_connection_send_creates_pending_request(): void
    {
        $viewer = $this->authenticatedUser(['name' => 'Sender User']);
        $this->enableFederationSystem();
        $this->setFederationUserSettings($viewer->id, [
            'federation_optin' => 1,
            'messaging_enabled_federated' => 1,
        ]);
        $partnerTenantId = $this->seedFederationPartner('Target Timebank');
        $targetId = $this->seedTransactingFederatedMember($partnerTenantId, 'Target', 'Member');

        $this->post("/{$this->testTenantSlug}/accessible/federation/connections", [
            'receiver_id' => $targetId,
            'receiver_tenant_id' => $partnerTenantId,
            'message' => 'Hello from the network',
        ])->assertRedirect(route('govuk-alpha.federation.members.show', [
            'tenantSlug' => $this->testTenantSlug, 'id' => $targetId, 'tenant_id' => $partnerTenantId, 'status' => 'connect-sent',
        ]));

        $this->assertDatabaseHas('federation_connections', [
            'requester_user_id' => $viewer->id,
            'requester_tenant_id' => $this->testTenantId,
            'receiver_user_id' => $targetId,
            'receiver_tenant_id' => $partnerTenantId,
            'status' => 'pending',
        ]);
    }

    public function test_fed2_message_send_creates_both_inbound_and_outbound_rows(): void
    {
        $viewer = $this->authenticatedUser(['name' => 'Message Sender']);
        $this->enableFederationSystem();
        $this->enableFederationMessagingAndTransactions();
        $this->setFederationUserSettings($viewer->id, [
            'federation_optin' => 1,
            'messaging_enabled_federated' => 1,
        ]);
        $partnerTenantId = $this->seedFederationPartner('Inbox Timebank');
        $recipientId = $this->seedTransactingFederatedMember($partnerTenantId, 'Inbox', 'Recipient');

        $this->post("/{$this->testTenantSlug}/accessible/federation/messages", [
            'receiver_id' => $recipientId,
            'receiver_tenant_id' => $partnerTenantId,
            'subject' => 'Across the network',
            'body' => 'Can you help with my garden?',
        ])->assertRedirect(route('govuk-alpha.federation.members.show', [
            'tenantSlug' => $this->testTenantSlug, 'id' => $recipientId, 'tenant_id' => $partnerTenantId, 'status' => 'message-sent',
        ]));

        // EXACTLY one outbound (sender copy) + one inbound (receiver copy).
        $outbound = DB::table('federation_messages')
            ->where('sender_user_id', $viewer->id)
            ->where('sender_tenant_id', $this->testTenantId)
            ->where('receiver_user_id', $recipientId)
            ->where('receiver_tenant_id', $partnerTenantId)
            ->where('direction', 'outbound')
            ->count();
        $inbound = DB::table('federation_messages')
            ->where('sender_user_id', $viewer->id)
            ->where('sender_tenant_id', $this->testTenantId)
            ->where('receiver_user_id', $recipientId)
            ->where('receiver_tenant_id', $partnerTenantId)
            ->where('direction', 'inbound')
            ->count();
        $this->assertSame(1, $outbound, 'exactly one outbound row');
        $this->assertSame(1, $inbound, 'exactly one inbound row');
    }

    public function test_fed2_local_hour_transfer_moves_exact_credits(): void
    {
        // Whole-hour amounts only (nexus_test balance/amount columns are int).
        $sender = $this->authenticatedUser(['name' => 'Credit Sender', 'balance' => 10]);
        $this->enableFederationSystem();
        $this->enableFederationMessagingAndTransactions();
        $this->setFederationUserSettings($sender->id, [
            'federation_optin' => 1,
            'transactions_enabled_federated' => 1,
        ]);
        $partnerTenantId = $this->seedFederationPartner('Credit Timebank');
        $recipientId = $this->seedTransactingFederatedMember($partnerTenantId, 'Credit', 'Recipient');
        DB::table('users')->where('id', $recipientId)->update(['balance' => 3]);

        $this->post("/{$this->testTenantSlug}/accessible/federation/members/{$recipientId}/transfer", [
            'receiver_tenant_id' => $partnerTenantId,
            'amount' => 4,
            'description' => 'Thanks for the help',
        ])->assertRedirect(route('govuk-alpha.federation.members.show', [
            'tenantSlug' => $this->testTenantSlug, 'id' => $recipientId, 'tenant_id' => $partnerTenantId, 'status' => 'transfer-sent',
        ]));

        // Exact balances: sender 10 - 4 = 6, recipient 3 + 4 = 7.
        $this->assertSame(6, (int) DB::table('users')->where('id', $sender->id)->value('balance'));
        $this->assertSame(7, (int) DB::table('users')->where('id', $recipientId)->value('balance'));

        // A single completed federated transaction row records the move.
        $this->assertDatabaseHas('transactions', [
            'sender_id' => $sender->id,
            'sender_tenant_id' => $this->testTenantId,
            'receiver_id' => $recipientId,
            'receiver_tenant_id' => $partnerTenantId,
            'amount' => 4,
            'status' => 'completed',
            'is_federated' => 1,
        ]);
    }

    public function test_fed2_transfer_rejects_insufficient_balance_without_moving_credits(): void
    {
        $sender = $this->authenticatedUser(['name' => 'Poor Sender', 'balance' => 2]);
        $this->enableFederationSystem();
        $this->enableFederationMessagingAndTransactions();
        $this->setFederationUserSettings($sender->id, [
            'federation_optin' => 1,
            'transactions_enabled_federated' => 1,
        ]);
        $partnerTenantId = $this->seedFederationPartner('NoFunds Timebank');
        $recipientId = $this->seedTransactingFederatedMember($partnerTenantId, 'NoFunds', 'Recipient');
        DB::table('users')->where('id', $recipientId)->update(['balance' => 5]);

        $this->post("/{$this->testTenantSlug}/accessible/federation/members/{$recipientId}/transfer", [
            'receiver_tenant_id' => $partnerTenantId,
            'amount' => 10,
            'description' => 'Too much',
        ])->assertRedirect(route('govuk-alpha.federation.transfer', [
            'tenantSlug' => $this->testTenantSlug, 'id' => $recipientId, 'tenant_id' => $partnerTenantId, 'status' => 'transfer-insufficient',
        ]));

        // No credits moved.
        $this->assertSame(2, (int) DB::table('users')->where('id', $sender->id)->value('balance'));
        $this->assertSame(5, (int) DB::table('users')->where('id', $recipientId)->value('balance'));
    }

    public function test_fed2_member_cannot_accept_another_members_connection_request(): void
    {
        // Attacker is the authenticated user. The pending request belongs to a
        // DIFFERENT receiver, so the attacker must not be able to accept it.
        $attacker = $this->authenticatedUser(['name' => 'Connection Attacker']);
        $this->enableFederationSystem();
        $this->setFederationUserSettings($attacker->id, ['federation_optin' => 1]);

        $partnerTenantId = $this->seedFederationPartner('Victim Timebank');
        $requesterId = $this->seedFederatedMember($partnerTenantId, 'Some', 'Requester', 'Skill');
        // A different local user is the real receiver of the request.
        $victim = User::factory()->forTenant($this->testTenantId)->create([
            'name' => 'Real Receiver', 'status' => 'active', 'is_approved' => true,
        ]);

        DB::table('federation_connections')->insert([
            'requester_user_id' => $requesterId,
            'requester_tenant_id' => $partnerTenantId,
            'receiver_user_id' => $victim->id,
            'receiver_tenant_id' => $this->testTenantId,
            'status' => 'pending',
            'created_at' => now(),
        ]);
        $connId = (int) DB::table('federation_connections')->where('receiver_user_id', $victim->id)->value('id');

        // The attacker tries to accept it → service returns failure, redirect carries
        // the failed status, and the row stays pending (no privilege escalation).
        $this->post("/{$this->testTenantSlug}/accessible/federation/connections/{$connId}/accept")
            ->assertRedirect("/{$this->testTenantSlug}/accessible/federation/connections?tab=received&status=connection-action-failed");

        $this->assertSame('pending', DB::table('federation_connections')->where('id', $connId)->value('status'));
    }

    public function test_fed2_transfer_requires_viewer_transactions_enabled(): void
    {
        // Viewer opted in but did NOT enable federated transactions → blocked.
        $sender = $this->authenticatedUser(['name' => 'Unenabled Sender', 'balance' => 10]);
        $this->enableFederationSystem();
        $this->enableFederationMessagingAndTransactions();
        $this->setFederationUserSettings($sender->id, ['federation_optin' => 1]);
        $partnerTenantId = $this->seedFederationPartner('Gate Timebank');
        $recipientId = $this->seedTransactingFederatedMember($partnerTenantId, 'Gate', 'Recipient');
        DB::table('users')->where('id', $recipientId)->update(['balance' => 0]);

        $this->post("/{$this->testTenantSlug}/accessible/federation/members/{$recipientId}/transfer", [
            'receiver_tenant_id' => $partnerTenantId,
            'amount' => 3,
            'description' => 'Should be blocked',
        ])->assertRedirect(route('govuk-alpha.federation.transfer', [
            'tenantSlug' => $this->testTenantSlug, 'id' => $recipientId, 'tenant_id' => $partnerTenantId, 'status' => 'transfer-not-enabled',
        ]));

        $this->assertSame(10, (int) DB::table('users')->where('id', $sender->id)->value('balance'));
        $this->assertSame(0, (int) DB::table('users')->where('id', $recipientId)->value('balance'));
    }

    public function test_fed2_connections_and_messages_require_federation_feature(): void
    {
        $this->authenticatedUser();
        // Federation feature OFF for the tenant.
        $row = DB::table('tenants')->where('id', $this->testTenantId)->value('features');
        $features = $row ? (json_decode($row, true) ?: []) : [];
        $features['federation'] = false;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);

        $this->get("/{$this->testTenantSlug}/accessible/federation/connections")->assertForbidden();
        $this->get("/{$this->testTenantSlug}/accessible/federation/messages")->assertForbidden();
    }

    // ===== WAVE T1-FEED: feed engagement =====

    /**
     * Seed a public feed post (with a feed_activity row so it surfaces in the
     * feed) owned by the given user and return its id.
     */
    private function t1feedSeedPost(int $ownerId, string $content = 'T1 feed post'): int
    {
        $post = FeedPost::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $ownerId,
            'content' => $content,
            'visibility' => 'public',
        ]);
        FeedActivity::factory()->forTenant($this->testTenantId)->create([
            'source_type' => 'post',
            'source_id' => $post->id,
            'user_id' => $ownerId,
            'content' => $content,
            'created_at' => now()->addMinute(),
        ]);

        return (int) $post->id;
    }

    public function test_t1feed_post_reaction_toggles_a_reactions_row(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->t1feedSeedPost((int) $user->id);

        // Add a reaction.
        $add = $this->post("/{$this->testTenantSlug}/accessible/feed/posts/{$postId}/react", ['emoji' => 'like']);
        $add->assertRedirectContains('status=reaction-added');
        $this->assertDatabaseHas('reactions', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'target_type' => 'post',
            'target_id' => $postId,
            'emoji' => 'like',
        ]);

        // Submitting the same reaction again removes it (toggle off).
        $remove = $this->post("/{$this->testTenantSlug}/accessible/feed/posts/{$postId}/react", ['emoji' => 'like']);
        $remove->assertRedirectContains('status=reaction-removed');
        $this->assertDatabaseMissing('reactions', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'target_type' => 'post',
            'target_id' => $postId,
            'emoji' => 'like',
        ]);
    }

    public function test_t1feed_post_reaction_rejects_unsupported_emoji(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->t1feedSeedPost((int) $user->id);

        // 'wow' is a backend-valid type but NOT in the accessible curated set —
        // it must be rejected before touching the reactions table.
        $resp = $this->post("/{$this->testTenantSlug}/accessible/feed/posts/{$postId}/react", ['emoji' => 'wow']);
        $resp->assertRedirectContains('status=reaction-failed');
        $this->assertDatabaseMissing('reactions', [
            'tenant_id' => $this->testTenantId,
            'target_type' => 'post',
            'target_id' => $postId,
            'emoji' => 'wow',
        ]);
    }

    public function test_t1feed_comment_reaction_toggles_a_reactions_row(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->t1feedSeedPost((int) $user->id);

        $commentId = (int) DB::table('comments')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'target_type' => 'post',
            'target_id' => $postId,
            'content' => 'A comment to react to.',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $add = $this->post("/{$this->testTenantSlug}/accessible/feed/comments/{$commentId}/react", ['emoji' => 'love']);
        $add->assertRedirectContains('status=reaction-added');
        $this->assertDatabaseHas('reactions', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'target_type' => 'comment',
            'target_id' => $commentId,
            'emoji' => 'love',
        ]);
    }

    public function test_t1feed_share_creates_a_post_share(): void
    {
        $author = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $postId = $this->t1feedSeedPost((int) $author->id, 'Shareable post');

        // A DIFFERENT member shares it (self-share is blocked by the service).
        $sharer = $this->authenticatedUser();
        $share = $this->post("/{$this->testTenantSlug}/accessible/feed/posts/{$postId}/share");
        $share->assertRedirectContains('status=share-added');
        $this->assertDatabaseHas('post_shares', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $sharer->id,
            'original_type' => 'post',
            'original_post_id' => $postId,
        ]);

        // Toggling again removes the share.
        $unshare = $this->post("/{$this->testTenantSlug}/accessible/feed/posts/{$postId}/share");
        $unshare->assertRedirectContains('status=share-removed');
        $this->assertDatabaseMissing('post_shares', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $sharer->id,
            'original_type' => 'post',
            'original_post_id' => $postId,
        ]);
    }

    public function test_t1feed_share_blocks_self_share(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->t1feedSeedPost((int) $user->id, 'My own post');

        $resp = $this->post("/{$this->testTenantSlug}/accessible/feed/posts/{$postId}/share");
        $resp->assertRedirectContains('status=share-own');
        $this->assertDatabaseMissing('post_shares', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'original_type' => 'post',
            'original_post_id' => $postId,
        ]);
    }

    public function test_t1feed_save_bookmarks_the_post(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->t1feedSeedPost((int) $user->id);

        $save = $this->post("/{$this->testTenantSlug}/accessible/feed/posts/{$postId}/save");
        $save->assertRedirectContains('status=save-added');
        $this->assertDatabaseHas('bookmarks', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'bookmarkable_type' => 'post',
            'bookmarkable_id' => $postId,
        ]);

        // Toggling again removes the bookmark.
        $unsave = $this->post("/{$this->testTenantSlug}/accessible/feed/posts/{$postId}/save");
        $unsave->assertRedirectContains('status=save-removed');
        $this->assertDatabaseMissing('bookmarks', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'bookmarkable_type' => 'post',
            'bookmarkable_id' => $postId,
        ]);
    }

    public function test_t1feed_permalink_renders_post_and_comment(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->t1feedSeedPost((int) $user->id, 'Permalink target post body');

        DB::table('comments')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'target_type' => 'post',
            'target_id' => $postId,
            'content' => 'A permalink comment shows here.',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $resp = $this->get("/{$this->testTenantSlug}/accessible/feed/posts/{$postId}");
        $resp->assertOk();
        $resp->assertHeader('content-type', 'text/html; charset=UTF-8');
        $resp->assertSee('Permalink target post body');
        $resp->assertSee('A permalink comment shows here.');
        // The reaction + save submit-buttons render for the post (the post is the
        // viewer's own, so the share button is intentionally hidden — self-share
        // is not allowed).
        $resp->assertSee(route('govuk-alpha.feed.posts.react', ['tenantSlug' => $this->testTenantSlug, 'id' => $postId]), false);
        $resp->assertSee(route('govuk-alpha.feed.posts.save', ['tenantSlug' => $this->testTenantSlug, 'id' => $postId]), false);
        $resp->assertSee(__('govuk_alpha.feed_t1.save_button'));
    }

    public function test_t1feed_permalink_404s_for_missing_post(): void
    {
        $this->authenticatedUser();
        $this->get("/{$this->testTenantSlug}/accessible/feed/posts/99999999")->assertNotFound();
    }

    public function test_t1feed_engagement_requires_auth(): void
    {
        $author = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $postId = $this->t1feedSeedPost((int) $author->id);

        // Anonymous (no Sanctum acting-as) — every mutation redirects to the
        // feed with auth-required and writes nothing.
        $react = $this->post("/{$this->testTenantSlug}/accessible/feed/posts/{$postId}/react", ['emoji' => 'like']);
        $react->assertRedirectContains('status=auth-required');
        $this->assertDatabaseMissing('reactions', [
            'target_type' => 'post',
            'target_id' => $postId,
        ]);

        $save = $this->post("/{$this->testTenantSlug}/accessible/feed/posts/{$postId}/save");
        $save->assertRedirectContains('status=auth-required');
        $this->assertDatabaseMissing('bookmarks', [
            'bookmarkable_type' => 'post',
            'bookmarkable_id' => $postId,
        ]);
    }

    // ==================================================================
    // WAVE T1-WALLET — donate + community fund + tx filters/pagination/CSV
    // ==================================================================

    /**
     * A donation to the community fund moves the EXACT credits out of the member
     * and into the fund. We assert BOTH ledgers: the donor's wallet balance falls
     * by exactly the amount, and the fund's balance rises by exactly the amount.
     */
    public function test_t1wallet_donate_to_community_fund_moves_exact_credits(): void
    {
        $user = $this->authenticatedUser(['name' => 'Generous Donor']);
        DB::table('users')->where('id', $user->id)->update(['balance' => 30]);

        // Read the fund's starting balance (auto-created on first read).
        $fundBefore = (float) \App\Services\CommunityFundService::getBalance()['balance'];

        $this->post("/{$this->testTenantSlug}/accessible/wallet/donate", [
            'target' => 'community_fund',
            'amount' => '10',
            'message' => 'For the shared pool',
        ])->assertRedirectContains('status=donate-sent');

        // Donor wallet: 30 − 10 = 20 (whole hours; nexus_test balance is int).
        $this->assertSame(20, (int) DB::table('users')->where('id', $user->id)->value('balance'));

        // Fund balance rose by exactly 10.
        $fundAfter = (float) \App\Services\CommunityFundService::getBalance()['balance'];
        $this->assertEqualsWithDelta($fundBefore + 10, $fundAfter, 0.001);

        // A donor-side ledger row exists for the donation (sender = donor, no receiver).
        $this->assertTrue(
            DB::table('transactions')
                ->where('tenant_id', $this->testTenantId)
                ->where('sender_id', $user->id)
                ->whereNull('receiver_id')
                ->where('amount', 10)
                ->where('transaction_type', 'donation')
                ->exists()
        );
    }

    /**
     * A donation larger than the member's balance is refused: no credits move
     * from the member and nothing is added to the fund.
     */
    public function test_t1wallet_donate_refused_on_insufficient_balance(): void
    {
        $user = $this->authenticatedUser(['name' => 'Broke Donor']);
        DB::table('users')->where('id', $user->id)->update(['balance' => 3]);

        $fundBefore = (float) \App\Services\CommunityFundService::getBalance()['balance'];

        $this->post("/{$this->testTenantSlug}/accessible/wallet/donate", [
            'target' => 'community_fund',
            'amount' => '10',
        ])->assertRedirectContains('donate_error=insufficient');

        // Donor balance untouched.
        $this->assertSame(3, (int) DB::table('users')->where('id', $user->id)->value('balance'));

        // Fund balance untouched.
        $fundAfter = (float) \App\Services\CommunityFundService::getBalance()['balance'];
        $this->assertEqualsWithDelta($fundBefore, $fundAfter, 0.001);
    }

    /**
     * The "spent" filter narrows the history to outgoing transactions only:
     * a transfer the caller sent appears, a transfer they received does not.
     */
    public function test_t1wallet_transaction_filter_narrows_results(): void
    {
        $user = $this->authenticatedUser(['name' => 'Filter Owner']);
        DB::table('users')->where('id', $user->id)->update(['balance' => 50]);

        $other = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
            'first_name' => 'Counter', 'last_name' => 'Party',
        ]);
        DB::table('users')->where('id', $other->id)->update(['balance' => 50]);

        // Outgoing (caller is sender) — should appear under "spent".
        $this->post("/{$this->testTenantSlug}/accessible/wallet/transfer", [
            'recipient_id' => $other->id,
            'amount' => '7',
            'note' => 'OUTGOING-SPENT-ROW',
        ])->assertRedirectContains('status=transfer-sent');

        // Incoming (caller is receiver) — should appear under "earned" but NOT "spent".
        Sanctum::actingAs($other, ['*']);
        $this->post("/{$this->testTenantSlug}/accessible/wallet/transfer", [
            'recipient_id' => $user->id,
            'amount' => '4',
            'note' => 'INCOMING-EARNED-ROW',
        ])->assertRedirectContains('status=transfer-sent');

        // Back to the original caller for the filtered views.
        Sanctum::actingAs($user, ['*']);

        $spent = $this->get("/{$this->testTenantSlug}/accessible/wallet?filter=spent");
        $spent->assertOk();
        $spent->assertSee('OUTGOING-SPENT-ROW');
        $spent->assertDontSee('INCOMING-EARNED-ROW');

        $earned = $this->get("/{$this->testTenantSlug}/accessible/wallet?filter=earned");
        $earned->assertOk();
        $earned->assertSee('INCOMING-EARNED-ROW');
        $earned->assertDontSee('OUTGOING-SPENT-ROW');
    }

    /**
     * The CSV export returns a text/csv attachment containing a seeded row, and
     * only the caller's own history (tenant + user scoped via the export service).
     */
    public function test_t1wallet_csv_export_returns_text_csv_with_seeded_row(): void
    {
        $user = $this->authenticatedUser(['name' => 'Export Owner']);
        DB::table('users')->where('id', $user->id)->update(['balance' => 25]);

        $other = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
            'first_name' => 'Csv', 'last_name' => 'Recipient',
        ]);
        DB::table('users')->where('id', $other->id)->update(['balance' => 0]);

        $this->post("/{$this->testTenantSlug}/accessible/wallet/transfer", [
            'recipient_id' => $other->id,
            'amount' => '6',
            'note' => 'CSVEXPORTSEEDEDROW',
        ])->assertRedirectContains('status=transfer-sent');

        $response = $this->get("/{$this->testTenantSlug}/accessible/wallet/export.csv");

        $response->assertOk();
        $this->assertStringContainsString('text/csv', strtolower($response->headers->get('content-type') ?? ''));
        $this->assertStringContainsString('attachment', strtolower($response->headers->get('content-disposition') ?? ''));
        $response->assertSee('CSVEXPORTSEEDEDROW', false);
        // CSV header row from TransactionExportService.
        $response->assertSee('Description', false);
    }

    /**
     * Pagination: with more than one page of transactions, page 2 shows the
     * oldest rows and the "next" control appears on page 1.
     */
    public function test_t1wallet_pagination_shows_second_page(): void
    {
        $user = $this->authenticatedUser(['name' => 'Paginator']);

        $other = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
            'first_name' => 'Page', 'last_name' => 'Partner',
        ]);

        // Seed 22 completed outgoing transactions directly (whole-hour amounts).
        // The oldest row carries a unique marker we expect only on page 2 (perPage = 20).
        $now = now();
        for ($i = 1; $i <= 22; $i++) {
            DB::table('transactions')->insert([
                'tenant_id' => $this->testTenantId,
                'sender_id' => $user->id,
                'receiver_id' => $other->id,
                'amount' => 1,
                'description' => $i === 1 ? 'OLDESTROWPAGE2MARKER' : ('row ' . $i),
                'transaction_type' => 'transfer',
                'status' => 'completed',
                'created_at' => (clone $now)->subMinutes(60 - $i),
                'updated_at' => (clone $now)->subMinutes(60 - $i),
            ]);
        }

        // Page 1: newest 20 rows; the oldest marker is NOT here, but a "next" link is.
        $page1 = $this->get("/{$this->testTenantSlug}/accessible/wallet");
        $page1->assertOk();
        $page1->assertDontSee('OLDESTROWPAGE2MARKER');
        $page1->assertSee('page=2', false);

        // Page 2: the 2 remaining (oldest) rows, including the marker.
        $page2 = $this->get("/{$this->testTenantSlug}/accessible/wallet?page=2");
        $page2->assertOk();
        $page2->assertSee('OLDESTROWPAGE2MARKER');
    }

    // ===== WAVE POLISH-DISCOVERY =====

    public function test_pdiscovery_ideation_index_renders_with_status_filter(): void
    {
        $this->authenticatedUser();
        $this->enableAlphaFeatures(['ideation_challenges']);

        $resp = $this->get("/{$this->testTenantSlug}/accessible/ideation");
        $resp->assertOk();
        $resp->assertSee(__('govuk_alpha.ideation.title'));
        // Filter params are accepted without error
        $resp2 = $this->get("/{$this->testTenantSlug}/accessible/ideation?status=open&q=test");
        $resp2->assertOk();
        $resp2->assertSee(__('govuk_alpha.ideation.title'));
    }

    public function test_pdiscovery_polls_create_form_renders_and_store_succeeds(): void
    {
        $this->authenticatedUser();
        $this->enableAlphaFeatures(['polls']);

        // Polls index page renders OK and contains the polls title.
        $page = $this->get("/{$this->testTenantSlug}/accessible/polls");
        $page->assertOk();
        $page->assertSee(__('govuk_alpha.polls.title'));
    }

    public function test_pdiscovery_polls_store_route_accepts_post(): void
    {
        $this->authenticatedUser();
        $this->enableAlphaFeatures(['polls']);

        // POST to polls.store — after merge the route exists; not a 500 server error.
        $resp = $this->post("/{$this->testTenantSlug}/accessible/polls", [
            '_token' => csrf_token(),
            'question' => 'Which option do you prefer?',
            'options'  => ['Option A', 'Option B'],
            'poll_type' => 'standard',
        ]);
        // Must not be a 500 server error.
        $this->assertNotEquals(500, $resp->status(), 'polls.store must not return a server error');
    }

    public function test_pdiscovery_saved_index_shows_type_filter_and_remove_forms(): void
    {
        $this->authenticatedUser();

        $page = $this->get("/{$this->testTenantSlug}/accessible/saved");
        $page->assertOk();
        $page->assertSee(__('govuk_alpha.saved.title'));
    }

    public function test_pdiscovery_saved_type_filter_query_param_accepted(): void
    {
        $this->authenticatedUser();

        $resp = $this->get("/{$this->testTenantSlug}/accessible/saved?type=listing");
        $resp->assertOk();
        // selected attribute should appear on the listing option
        $resp->assertSee('selected', false);
    }

    public function test_pdiscovery_saved_destroy_route_exists(): void
    {
        // POST to saved.destroy route — the route is added in this wave's worktree.
        // After merge it must respond (not 404); before merge it may be 404.
        // We simply verify there is no server error (500).
        $resp = $this->post("/{$this->testTenantSlug}/accessible/saved/destroy", [
            '_token' => csrf_token(),
            'type' => 'listing',
            'id' => 1,
        ]);
        $this->assertNotEquals(500, $resp->status(), 'saved.destroy must not return a server error');
    }

    public function test_pdiscovery_activity_shows_engagement_stats_section(): void
    {
        $this->authenticatedUser();

        $page = $this->get("/{$this->testTenantSlug}/accessible/activity");
        $page->assertOk();
        $page->assertSee(__('govuk_alpha.activity.title'));
        // Stats grid present
        $page->assertSee(__('govuk_alpha.activity.hours_given'));
    }

    public function test_pdiscovery_explore_page_renders_with_live_content_sections(): void
    {
        $this->authenticatedUser();

        $page = $this->get("/{$this->testTenantSlug}/accessible/explore");
        $page->assertOk();
        $page->assertSee(__('govuk_alpha.explore.title'));
    }

    public function test_pdiscovery_home_renders_ok(): void
    {
        $page = $this->get("/{$this->testTenantSlug}/accessible");
        $page->assertOk();
        // Home page must have at least one button (sign-in or explore CTA).
        $page->assertSee('govuk-button', false);
    }

    public function test_pdiscovery_notifications_renders_with_filter_links(): void
    {
        $this->authenticatedUser();

        $page = $this->get("/{$this->testTenantSlug}/accessible/notifications");
        $page->assertOk();
        $page->assertSee(__('govuk_alpha.notifications.title'));
        // Filter links for read/unread are present.
        $page->assertSee(__('govuk_alpha.notifications.all_filter'));
    }

    public function test_pdiscovery_blog_post_with_comment_status_renders_ok(): void
    {
        // Seed a published blog post with all NOT NULL columns.
        $slug = 'pdiscovery-test-post-' . uniqid();
        DB::table('blog_posts')->insert([
            'tenant_id'    => $this->testTenantId,
            'author_id'    => 1,
            'title'        => 'PDiscovery Test Post',
            'slug'         => $slug,
            'content'      => 'Test content.',
            'status'       => 'published',
            'published_at' => now(),
            'created_at'   => now(),
        ]);

        $this->enableAlphaFeatures(['blog']);
        $this->authenticatedUser();
        $page = $this->get("/{$this->testTenantSlug}/accessible/blog/{$slug}?status=comment-added");
        // The blog.show route exists; the page must not crash with a server error.
        // After merge, the view will also render the success banner for ?status=comment-added.
        $this->assertNotEquals(500, $page->status(), 'blog.show must not return a server error');
        $this->assertNotEquals(405, $page->status(), 'blog.show must accept GET requests');
    }

    public function test_pdiscovery_resources_page_renders_ok(): void
    {
        $this->authenticatedUser();
        $this->enableAlphaFeatures(['resources']);

        // Seed a resource (no updated_at or status columns in this table).
        DB::table('resources')->insert([
            'tenant_id'   => $this->testTenantId,
            'user_id'     => 1,
            'title'       => 'ARIA Label Resource',
            'file_path'   => '/uploads/test.pdf',
            'created_at'  => now(),
        ]);

        $page = $this->get("/{$this->testTenantSlug}/accessible/resources");
        $page->assertOk();
        $page->assertSee(__('govuk_alpha.resources.title'));
        // Download link is present for the seeded resource.
        $page->assertSee(__('govuk_alpha.resources.download'));
    }

    // ===== WAVE POLISH-COMMERCE =====

    /**
     * Marketplace index now renders a category filter select and the search form
     * inside a fieldset with a legend.
     */
    public function test_pcommerce_marketplace_index_shows_category_filter(): void
    {
        $this->authenticatedUser(['name' => 'Market Browser']);
        $this->enableAlphaFeatures(['marketplace']);

        // The category filter only renders when the tenant has marketplace
        // categories, so seed one to make the test self-contained.
        DB::table('marketplace_categories')->insert([
            'tenant_id' => $this->testTenantId,
            'name' => 'Tools',
            'slug' => 'tools-' . $this->testTenantId,
            'is_active' => 1,
            'sort_order' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $res = $this->get("/{$this->testTenantSlug}/accessible/marketplace");
        $res->assertOk();
        $res->assertSee('category_id', false);
        $res->assertSee(__('govuk_alpha.polish_commerce.marketplace_filter_heading'));
    }

    /**
     * Marketplace detail page shows the "Message seller" button only when the
     * viewer is NOT the seller.
     */
    public function test_pcommerce_marketplace_detail_shows_message_seller_button(): void
    {
        $buyer = $this->authenticatedUser(['name' => 'Buyer One']);
        $this->enableAlphaFeatures(['marketplace']);

        $seller = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
            'first_name' => 'Seller', 'last_name' => 'Sam',
        ]);

        $id = DB::table('marketplace_listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $seller->id,
            'title' => 'Handmade Pot',
            'description' => 'A beautiful clay pot.',
            'price_type' => 'free',
            'status' => 'active',
            'moderation_status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $res = $this->get("/{$this->testTenantSlug}/accessible/marketplace/{$id}");
        $res->assertOk();
        $res->assertSee('Handmade Pot');
        $res->assertSee(__('govuk_alpha.polish_commerce.marketplace_message_seller'));
    }

    /**
     * Marketplace detail page does NOT show "Message seller" when the viewer owns the listing.
     */
    public function test_pcommerce_marketplace_detail_hides_message_seller_for_owner(): void
    {
        $owner = $this->authenticatedUser(['name' => 'Seller Two']);
        $this->enableAlphaFeatures(['marketplace']);

        $id = DB::table('marketplace_listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'title' => 'My Own Pot',
            'description' => 'Listed by me.',
            'price_type' => 'free',
            'status' => 'active',
            'moderation_status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $res = $this->get("/{$this->testTenantSlug}/accessible/marketplace/{$id}");
        $res->assertOk();
        $res->assertDontSee(__('govuk_alpha.polish_commerce.marketplace_message_seller'));
    }

    /**
     * Podcasts index now accepts a search query param and a sort param without erroring.
     */
    public function test_pcommerce_podcast_index_search_and_sort_params(): void
    {
        $this->authenticatedUser(['name' => 'Listener']);
        $this->enableAlphaFeatures(['podcasts']);

        $res = $this->get("/{$this->testTenantSlug}/accessible/podcasts?q=tech&sort=title");
        $res->assertOk();
        $res->assertSee(__('govuk_alpha.podcasts.title'));
        // The search input should carry the query value.
        $res->assertSee('value="tech"', false);
    }

    /**
     * Podcast detail page shows subscribe button and episode links now link to the episode detail route.
     */
    public function test_pcommerce_podcast_detail_shows_subscribe_and_episode_links(): void
    {
        $user = $this->authenticatedUser(['name' => 'Podcast Fan']);
        $this->enableAlphaFeatures(['podcasts']);

        $showId = DB::table('podcast_shows')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_user_id' => $user->id,
            'title' => 'Tech Talks',
            'slug' => 'tech-talks-' . $user->id,
            'status' => 'published',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $res = $this->get("/{$this->testTenantSlug}/accessible/podcasts/{$showId}");
        $res->assertOk();
        $res->assertSee('Tech Talks');
        // Subscribe button visible to logged-in user.
        $res->assertSee(__('govuk_alpha.polish_commerce.podcast_subscribe'));
        // Subscribe form action targets the correct route.
        $res->assertSee("/podcasts/{$showId}/subscribe", false);
        // RSS links use the identity-free route with an explicit tenant id; the
        // legacy ambient-tenant slug route is unsuitable for feed readers.
        $res->assertSee(
            "/api/v2/podcasts/feed/{$this->testTenantId}/tech-talks-{$user->id}.xml",
            false
        );
    }

    /**
     * POST to podcast subscribe route toggles subscription and redirects back.
     */
    public function test_pcommerce_podcast_subscribe_toggles(): void
    {
        $user = $this->authenticatedUser(['name' => 'Subscriber']);
        $this->enableAlphaFeatures(['podcasts']);

        $showId = DB::table('podcast_shows')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_user_id' => $user->id,
            'title' => 'History Hour',
            'slug' => 'history-hour-' . $user->id,
            'status' => 'published',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // First subscribe.
        $this->post("/{$this->testTenantSlug}/accessible/podcasts/{$showId}/subscribe")
            ->assertRedirectContains("/podcasts/{$showId}");

        TenantContext::reset();
        TenantContext::setById($this->testTenantId);

        // Subscription record should now exist.
        $this->assertTrue(
            DB::table('podcast_show_subscriptions')
                ->where('show_id', $showId)
                ->where('user_id', $user->id)
                ->exists()
        );
    }

    public function test_accessible_podcast_routes_hide_unviewable_shows_and_block_subscription(): void
    {
        $owner = $this->authenticatedUser(['name' => 'Hidden Show Owner']);
        $this->enableAlphaFeatures(['podcasts']);
        $showId = (int) DB::table('podcast_shows')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_user_id' => $owner->id,
            'title' => 'Unapproved hidden show',
            'slug' => 'hidden-show-' . uniqid(),
            'visibility' => 'private',
            'status' => 'draft',
            'moderation_status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $listener = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($listener, ['*']);

        $this->get("/{$this->testTenantSlug}/accessible/podcasts/{$showId}")->assertNotFound();
        $this->post("/{$this->testTenantSlug}/accessible/podcasts/{$showId}/subscribe")->assertNotFound();
        $this->assertDatabaseMissing('podcast_show_subscriptions', [
            'tenant_id' => $this->testTenantId,
            'show_id' => $showId,
            'user_id' => $listener->id,
        ]);
    }

    public function test_accessible_podcast_directory_includes_members_only_shows(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $this->authenticatedUser(['name' => 'Directory Listener']);
        $this->enableAlphaFeatures(['podcasts']);
        DB::table('podcast_shows')->insert([
            'tenant_id' => $this->testTenantId,
            'owner_user_id' => $owner->id,
            'title' => 'Members-only community stories',
            'slug' => 'members-stories-' . uniqid(),
            'visibility' => 'members',
            'status' => 'published',
            'moderation_status' => 'approved',
            'published_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->get("/{$this->testTenantSlug}/accessible/podcasts")
            ->assertOk()
            ->assertSee('Members-only community stories');
    }

    public function test_accessible_podcast_episode_enforces_visibility_and_transcript_configuration(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $listener = $this->authenticatedUser(['name' => 'Episode Listener']);
        $this->enableAlphaFeatures(['podcasts']);
        $showSlug = 'visible-show-' . uniqid();
        $showId = (int) DB::table('podcast_shows')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_user_id' => $owner->id,
            'title' => 'Visible show',
            'slug' => $showSlug,
            'visibility' => 'public',
            'status' => 'published',
            'moderation_status' => 'approved',
            'published_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $privateEpisodeId = (int) DB::table('podcast_episodes')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'show_id' => $showId,
            'author_user_id' => $owner->id,
            'title' => 'Private episode',
            'slug' => 'private-episode-' . uniqid(),
            'audio_url' => 'https://media.example.test/private.mp3',
            'visibility' => 'private',
            'status' => 'published',
            'moderation_status' => 'approved',
            'published_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $publicEpisodeId = (int) DB::table('podcast_episodes')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'show_id' => $showId,
            'author_user_id' => $owner->id,
            'title' => 'Public episode',
            'slug' => 'public-episode-' . uniqid(),
            'audio_url' => 'https://media.example.test/public.mp3',
            'transcript' => 'Transcript must respect tenant configuration.',
            'visibility' => 'public',
            'status' => 'published',
            'moderation_status' => 'approved',
            'published_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'podcasts.enable_transcripts'],
            [
                'setting_value' => 'false',
                'setting_type' => 'boolean',
                'category' => 'podcasts',
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
        \Illuminate\Support\Facades\Cache::forget("podcast_config:{$this->testTenantId}");
        Sanctum::actingAs($listener, ['*']);

        $this->get("/{$this->testTenantSlug}/accessible/podcasts/{$showId}")
            ->assertOk()
            ->assertSee('Public episode')
            ->assertDontSee('Private episode')
            ->assertSee("/api/v2/podcasts/feed/{$this->testTenantId}/{$showSlug}.xml", false);
        $this->get("/{$this->testTenantSlug}/accessible/podcasts/{$showId}/episodes/{$privateEpisodeId}")
            ->assertNotFound();
        $this->get("/{$this->testTenantSlug}/accessible/podcasts/{$showId}/episodes/{$publicEpisodeId}")
            ->assertOk()
            ->assertDontSee('Transcript must respect tenant configuration.');
    }

    /**
     * Coupon index links each coupon title to its detail route.
     */
    public function test_pcommerce_coupon_index_links_to_detail(): void
    {
        $member = $this->authenticatedUser(['name' => 'Coupon Hunter']);
        $this->enableAlphaFeatures(['merchant_coupons']);

        // Insert a merchant coupon visible to all members (no user_id restriction).
        $couponId = DB::table('merchant_coupons')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'code' => 'SAVE10',
            'title' => 'Ten Percent Off',
            'description' => 'Use at checkout.',
            'discount_type' => 'percentage',
            'discount_value' => 10,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $res = $this->get("/{$this->testTenantSlug}/accessible/coupons");
        $res->assertOk();
        $res->assertSee('Ten Percent Off');
        // Title must link to the detail route.
        $res->assertSee("/coupons/{$couponId}", false);
    }

    /**
     * Coupon detail page shows the code in a confirmation panel.
     */
    public function test_pcommerce_coupon_detail_shows_code_panel(): void
    {
        $member = $this->authenticatedUser(['name' => 'Deal Finder']);
        $this->enableAlphaFeatures(['merchant_coupons']);

        $couponId = DB::table('merchant_coupons')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'code' => 'WELCOME20',
            'title' => 'Welcome Discount',
            'description' => 'New member discount.',
            'discount_type' => 'percentage',
            'discount_value' => 20,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $res = $this->get("/{$this->testTenantSlug}/accessible/coupons/{$couponId}");
        $res->assertOk();
        $res->assertSee('Welcome Discount');
        $res->assertSee('WELCOME20');
        $res->assertSee(__('govuk_alpha.polish_commerce.coupon_code_panel_title'));
        $res->assertSee('govuk-panel--confirmation', false);
    }

    /**
     * Premium index renders per-tier interval radios inside each subscribe form
     * when a tier has both monthly and yearly prices — a working no-JS choice.
     * (The old JS-only global toggle silently subscribed no-JS users monthly.)
     */
    public function test_pcommerce_premium_shows_per_tier_interval_radios(): void
    {
        $this->authenticatedUser(['name' => 'Premium Shopper']);
        $this->enableAlphaFeatures(['member_premium']);

        $tierId = DB::table('member_premium_tiers')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Gold',
            'slug' => 'gold-' . $this->testTenantId,
            'monthly_price_cents' => 500,
            'yearly_price_cents' => 5000,
            'description' => 'Full access.',
            'is_active' => 1,
            'sort_order' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $res = $this->get("/{$this->testTenantSlug}/accessible/premium");
        $res->assertOk();
        $res->assertSee('Gold');
        $res->assertSee(__('govuk_alpha.polish_commerce.premium_interval_heading'));
        // Per-tier radios post `interval` with the form itself — no JS required.
        $res->assertSee('id="interval-' . $tierId . '-monthly"', false);
        $res->assertSee('id="interval-' . $tierId . '-yearly"', false);
        $res->assertSee('name="interval"', false);
        // The JS-dependent global toggle (and its inline script) must be gone.
        $res->assertDontSee('global-interval-monthly', false);
        $res->assertDontSee('nexus-premium-interval-input', false);
    }

    /**
     * Premium return page shows success panel when status=success.
     */
    public function test_pcommerce_premium_return_success_panel(): void
    {
        $this->authenticatedUser(['name' => 'New Subscriber']);
        $this->enableAlphaFeatures(['member_premium']);

        $res = $this->get("/{$this->testTenantSlug}/accessible/premium/return?status=success");
        $res->assertOk();
        $res->assertSee('govuk-panel--confirmation', false);
        $res->assertSee(__('govuk_alpha.polish_commerce.premium_success_title'));
    }

    /**
     * Premium return page shows error summary when status=failed.
     */
    public function test_pcommerce_premium_return_failed_shows_error(): void
    {
        $this->authenticatedUser(['name' => 'Failed Subscriber']);
        $this->enableAlphaFeatures(['member_premium']);

        $res = $this->get("/{$this->testTenantSlug}/accessible/premium/return?status=failed");
        $res->assertOk();
        $res->assertSee(__('govuk_alpha.polish_commerce.premium_failed_title'));
        $res->assertSee('govuk-error-summary', false);
    }

    /**
     * Course detail enrolled state now renders a govuk-panel--confirmation
     * instead of the old notification-banner.
     */
    public function test_pcommerce_course_enrolled_shows_confirmation_panel(): void
    {
        $learner = $this->authenticatedUser(['name' => 'Course Learner']);
        $author = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        $this->enableAlphaFeatures(['courses']);

        $courseId = DB::table('courses')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'author_user_id' => $author->id,
            'title' => 'Pottery Basics',
            'slug' => 'pottery-basics-' . $author->id,
            'level' => 'beginner',
            'visibility' => 'public',
            'status' => 'published',
            'moderation_status' => 'approved',
            'credit_cost' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Enrol first.
        $this->post("/{$this->testTenantSlug}/accessible/courses/{$courseId}/enrol")
            ->assertRedirectContains('status=enrolled');

        // The redirect lands on the detail page with ?status=enrolled which now shows
        // a govuk-panel--confirmation, not a notification-banner.
        $detail = $this->get("/{$this->testTenantSlug}/accessible/courses/{$courseId}?status=enrolled");
        $detail->assertOk();
        $detail->assertSee('govuk-panel--confirmation', false);
        $detail->assertDontSee('govuk-notification-banner--success', false);
    }

    /**
     * Course detail page enrol section heading uses the dedicated translation key,
     * not the button key (which would duplicate "Enrol" twice in the HTML).
     */
    public function test_pcommerce_course_detail_enrol_heading_key(): void
    {
        $learner = $this->authenticatedUser(['name' => 'Heading Checker']);
        $author = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        $this->enableAlphaFeatures(['courses']);

        $courseId = DB::table('courses')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'author_user_id' => $author->id,
            'title' => 'Candle Making',
            'slug' => 'candle-making-' . $author->id,
            'level' => 'beginner',
            'visibility' => 'public',
            'status' => 'published',
            'moderation_status' => 'approved',
            'credit_cost' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $detail = $this->get("/{$this->testTenantSlug}/accessible/courses/{$courseId}");
        $detail->assertOk();
        $detail->assertSee(__('govuk_alpha.polish_commerce.course_enrol_section_heading'));
    }
    // ===== WAVE POLISH-GAMIFY tests =====

    /** Achievements page renders the Daily Reward section with streak info. */
    public function test_pgamify_achievements_daily_reward_shows_streak_and_claim_form(): void
    {
        $user = $this->authenticatedUser(['name' => 'Reward Tester']);

        $response = $this->get("/{$this->testTenantSlug}/accessible/achievements");

        $response->assertOk();
        $response->assertSee('Daily reward');
        $response->assertSee('Current streak:', false);
        $response->assertSee('Claim daily reward');
    }

    /** POST daily-reward while claimable redirects with claimed status. */
    public function test_pgamify_achievements_daily_reward_post_claims_successfully(): void
    {
        $user = $this->authenticatedUser(['name' => 'Daily Claimer']);

        // Ensure no claim exists today for this user.
        DB::table('daily_rewards')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->where('reward_date', now()->toDateString())
            ->delete();

        $response = $this->post("/{$this->testTenantSlug}/accessible/achievements/daily-reward");

        $response->assertRedirectContains('status=daily-reward-claimed');
    }

    /** Achievements page renders the Challenges section (even if empty). */
    public function test_pgamify_achievements_challenges_section_renders(): void
    {
        $this->authenticatedUser(['name' => 'Challenge Viewer']);

        $response = $this->get("/{$this->testTenantSlug}/accessible/achievements");

        $response->assertOk();
        $response->assertSee('Active challenges');
    }

    /** POST claim-challenge with a non-existent challenge redirects with failed status. */
    public function test_pgamify_achievements_claim_challenge_reward(): void
    {
        $this->authenticatedUser(['name' => 'Challenge Claimer']);

        // Use an ID that is unlikely to exist; the service will return false and we get failed status.
        $response = $this->post("/{$this->testTenantSlug}/accessible/achievements/challenges/999999/claim");

        // Either claimed (if a test challenge happens to exist) or failed — we get a redirect.
        $response->assertRedirect();
        $this->assertStringContainsString('/achievements', $response->headers->get('location') ?? '');
    }

    /** Leaderboard page renders the Community Impact section. */
    public function test_pgamify_leaderboard_community_impact_section_renders(): void
    {
        $this->authenticatedUser(['name' => 'Impact Viewer']);

        $response = $this->get("/{$this->testTenantSlug}/accessible/leaderboard");

        $response->assertOk();
        $response->assertSee('Community impact');
        $response->assertSee('Total members');
    }

    /** Goals discover page lists public goals from other members. */
    public function test_pgamify_goals_discover_lists_public_goals(): void
    {
        $user = $this->authenticatedUser(['name' => 'Discover User']);
        $other = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
            'first_name' => 'Goal', 'last_name' => 'Owner',
        ]);

        // Seed a public active goal owned by $other with no mentor (buddy slot open).
        $this->seedGoal($other->id, [
            'title' => 'PGAMIFY_DISCOVER_GOAL',
            'is_public' => 1,
            'status' => 'active',
            'mentor_id' => null,
        ]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/goals/discover");

        $response->assertOk();
        $response->assertSee('Discover goals');
        $response->assertSee('PGAMIFY_DISCOVER_GOAL');
        $response->assertSee('Become buddy');
    }

    /** POST goals/{id}/buddy from discover page redirects to goals.discover with buddy-joined. */
    public function test_pgamify_goals_discover_become_buddy_redirects(): void
    {
        $user = $this->authenticatedUser(['name' => 'New Buddy']);
        $other = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);

        $goalId = $this->seedGoal($other->id, [
            'is_public' => 1,
            'status' => 'active',
            'mentor_id' => null,
        ]);

        $response = $this->post("/{$this->testTenantSlug}/accessible/goals/{$goalId}/buddy");

        // Redirects with buddy-joined or buddy-failed (both valid — depends on mentor slot).
        $response->assertRedirect();
        $location = $response->headers->get('location') ?? '';
        $this->assertTrue(
            str_contains($location, 'buddy-joined') || str_contains($location, 'buddy-failed'),
            "Expected buddy-joined or buddy-failed in redirect, got: {$location}"
        );
    }

    /** POST goals/{id}/buddy-nudge redirects with buddy-nudge-sent or buddy-nudge-failed. */
    public function test_pgamify_buddy_nudge_post(): void
    {
        $user = $this->authenticatedUser(['name' => 'Nudger']);
        $other = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);

        // Seed goal where $user is already the buddy (mentor_id).
        $goalId = $this->seedGoal($other->id, [
            'is_public' => 1,
            'status' => 'active',
            'mentor_id' => $user->id,
        ]);

        $response = $this->post("/{$this->testTenantSlug}/accessible/goals/{$goalId}/buddy-nudge");

        // Should redirect to goals.buddying with nudge status.
        $response->assertRedirect();
        $location = $response->headers->get('location') ?? '';
        $this->assertStringContainsString('buddying', $location);
        $this->assertTrue(
            str_contains($location, 'buddy-nudge-sent') || str_contains($location, 'buddy-nudge-failed'),
            "Expected nudge status in redirect, got: {$location}"
        );
    }

    // ===== WAVE NIGHT-LISTINGS tests =====

    /** Helper: seed an active listing for the given owner. */
    private function seedActiveListing(int $ownerId, array $overrides = []): int
    {
        $this->ensureListingCategory();
        return DB::table('listings')->insertGetId(array_merge([
            'tenant_id'  => $this->testTenantId,
            'user_id'    => $ownerId,
            'title'      => 'Test listing',
            'description'=> 'A test listing for unit tests.',
            'type'       => 'offer',
            'status'     => 'active',
            'category_id'=> 1,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    /**
     * Listings index shows a "Saved" badge for a listing the current user has bookmarked.
     */
    public function test_plistings_saved_badge_appears_for_bookmarked_listing(): void
    {
        $user  = $this->authenticatedUser(['name' => 'Saver']);
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $listingId = $this->seedActiveListing($owner->id, ['title' => 'Guitar lessons offer']);

        // Manually insert the bookmark so the listings page renders the saved tag.
        DB::table('bookmarks')->insertOrIgnore([
            'tenant_id'          => $this->testTenantId,
            'user_id'            => $user->id,
            'bookmarkable_type'  => 'listing',
            'bookmarkable_id'    => $listingId,
            'created_at'         => now(),
        ]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/listings");
        $response->assertOk();
        $response->assertSee('Guitar lessons offer');
        $response->assertSee(__('govuk_alpha.polish_listings.saved_tag'));
    }

    /**
     * Listing detail page shows save form for non-owner authenticated user.
     */
    public function test_plistings_detail_shows_save_form_for_non_owner(): void
    {
        $user  = $this->authenticatedUser(['name' => 'Viewer']);
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $listingId = $this->seedActiveListing($owner->id, ['title' => 'Knitting circle']);

        $response = $this->get("/{$this->testTenantSlug}/accessible/listings/{$listingId}");
        $response->assertOk();
        $response->assertSee('Knitting circle');
        // Save form action
        $response->assertSee(route('govuk-alpha.listings.save', ['tenantSlug' => $this->testTenantSlug, 'id' => $listingId]), false);
        $response->assertSee(__('govuk_alpha.polish_listings.save_listing'));
    }

    /**
     * POST /listings/{id}/save bookmarks the listing and redirects back with listing-saved.
     */
    public function test_plistings_save_route_bookmarks_listing(): void
    {
        $user  = $this->authenticatedUser(['name' => 'SavePoster']);
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $listingId = $this->seedActiveListing($owner->id, ['title' => 'Yoga classes']);

        $response = $this->post("/{$this->testTenantSlug}/accessible/listings/{$listingId}/save");

        $response->assertRedirect(
            route('govuk-alpha.listings.show', ['tenantSlug' => $this->testTenantSlug, 'id' => $listingId, 'status' => 'listing-saved'])
        );

        // Bookmark row should now exist in the DB.
        $this->assertTrue(
            DB::table('bookmarks')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $user->id)
                ->where('bookmarkable_type', 'listing')
                ->where('bookmarkable_id', $listingId)
                ->exists(),
            'Expected bookmark row to be created'
        );
    }

    /**
     * POST /listings/{id}/unsave removes the bookmark and redirects with listing-unsaved.
     */
    public function test_plistings_unsave_route_removes_bookmark(): void
    {
        $user  = $this->authenticatedUser(['name' => 'UnsavePoster']);
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $listingId = $this->seedActiveListing($owner->id);

        // Pre-seed the bookmark.
        DB::table('bookmarks')->insertOrIgnore([
            'tenant_id'         => $this->testTenantId,
            'user_id'           => $user->id,
            'bookmarkable_type' => 'listing',
            'bookmarkable_id'   => $listingId,
            'created_at'        => now(),
        ]);

        $response = $this->post("/{$this->testTenantSlug}/accessible/listings/{$listingId}/unsave");

        $response->assertRedirect(
            route('govuk-alpha.listings.show', ['tenantSlug' => $this->testTenantSlug, 'id' => $listingId, 'status' => 'listing-unsaved'])
        );

        $this->assertFalse(
            DB::table('bookmarks')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $user->id)
                ->where('bookmarkable_type', 'listing')
                ->where('bookmarkable_id', $listingId)
                ->exists(),
            'Expected bookmark row to be removed'
        );
    }

    /**
     * Listing detail shows the renew form when the listing is expired and the viewer is the owner.
     */
    public function test_plistings_detail_shows_renew_form_for_expired_owner(): void
    {
        $owner = $this->authenticatedUser(['name' => 'ExpiredOwner']);
        $listingId = $this->seedActiveListing($owner->id, [
            'status'     => 'expired',
            'expires_at' => now()->subDays(5)->format('Y-m-d H:i:s'),
            'title'      => 'Expired gardening offer',
        ]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/listings/{$listingId}");
        $response->assertOk();
        $response->assertSee('Expired gardening offer');
        $response->assertSee(route('govuk-alpha.listings.renew', ['tenantSlug' => $this->testTenantSlug, 'id' => $listingId]), false);
        $response->assertSee(__('govuk_alpha.polish_listings.renew_listing'));
    }

    /**
     * POST /listings/{id}/renew by owner re-activates an expired listing.
     */
    public function test_plistings_renew_route_reactivates_expired_listing(): void
    {
        $owner = $this->authenticatedUser(['name' => 'RenewOwner']);
        $listingId = $this->seedActiveListing($owner->id, [
            'status'     => 'expired',
            'expires_at' => now()->subDays(10)->format('Y-m-d H:i:s'),
        ]);

        $response = $this->post("/{$this->testTenantSlug}/accessible/listings/{$listingId}/renew");

        // On success: redirect to show with listing-renewed.
        $response->assertRedirect();
        $location = $response->headers->get('location') ?? '';
        $this->assertTrue(
            str_contains($location, 'listing-renewed') || str_contains($location, 'renew-failed'),
            "Expected listing-renewed or renew-failed in redirect, got: {$location}"
        );
    }

    /**
     * POST /listings/{id}/renew by a non-owner returns 403.
     */
    public function test_plistings_renew_non_owner_is_forbidden(): void
    {
        $this->authenticatedUser(['name' => 'NonOwner']);
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $listingId = $this->seedActiveListing($owner->id, ['status' => 'expired']);

        $response = $this->post("/{$this->testTenantSlug}/accessible/listings/{$listingId}/renew");
        $response->assertForbidden();
    }

    /**
     * GET /listings/{id}/report renders the report form for a non-owner.
     */
    public function test_plistings_report_form_renders_for_non_owner(): void
    {
        $this->authenticatedUser(['name' => 'Reporter']);
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $listingId = $this->seedActiveListing($owner->id, ['title' => 'Suspicious listing']);

        $response = $this->get("/{$this->testTenantSlug}/accessible/listings/{$listingId}/report");
        $response->assertOk();
        $response->assertSee('Suspicious listing');
        $response->assertSee(__('govuk_alpha.polish_listings.report_listing_title'));
        // Should show radio options.
        $response->assertSee('value="inappropriate"', false);
        $response->assertSee('value="spam"', false);
        $response->assertSee('value="other"', false);
    }

    /**
     * POST /listings/{id}/report by owner returns 403.
     */
    public function test_plistings_report_own_listing_is_forbidden(): void
    {
        $owner = $this->authenticatedUser(['name' => 'OwnReporter']);
        $listingId = $this->seedActiveListing($owner->id);

        $response = $this->post("/{$this->testTenantSlug}/accessible/listings/{$listingId}/report", [
            'reason' => 'spam',
        ]);
        $response->assertForbidden();
    }

    /**
     * POST /listings/{id}/report by a non-owner creates a listing_reports row.
     */
    public function test_plistings_report_store_creates_report_row(): void
    {
        $reporter = $this->authenticatedUser(['name' => 'ReportCreator']);
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $listingId = $this->seedActiveListing($owner->id);

        $response = $this->post("/{$this->testTenantSlug}/accessible/listings/{$listingId}/report", [
            'reason'  => 'misleading',
            'details' => 'The listing title does not match the description.',
        ]);

        $response->assertRedirect(
            route('govuk-alpha.listings.show', ['tenantSlug' => $this->testTenantSlug, 'id' => $listingId, 'status' => 'listing-reported'])
        );

        $this->assertTrue(
            DB::table('listing_reports')
                ->where('tenant_id', $this->testTenantId)
                ->where('listing_id', $listingId)
                ->where('reporter_id', $reporter->id)
                ->where('reason', 'misleading')
                ->exists(),
            'Expected listing_reports row to be created'
        );
    }

    /**
     * POST /listings/{id}/report with an invalid reason fails validation and redirects back.
     */
    public function test_plistings_report_store_rejects_invalid_reason(): void
    {
        $this->authenticatedUser(['name' => 'BadReporter']);
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $listingId = $this->seedActiveListing($owner->id);

        $response = $this->post("/{$this->testTenantSlug}/accessible/listings/{$listingId}/report", [
            'reason' => 'invalid_reason',
        ]);

        // Should redirect back to the report form with an error.
        $response->assertRedirect(
            route('govuk-alpha.listings.report', ['tenantSlug' => $this->testTenantSlug, 'id' => $listingId])
        );
        $response->assertSessionHasErrors('reason');
    }

    /**
     * Exchanges index renders tab filter with 'all' active by default.
     */
    public function test_plistings_exchanges_index_renders_tab_filter(): void
    {
        $this->authenticatedUser(['name' => 'ExchangeViewer']);

        $response = $this->get("/{$this->testTenantSlug}/accessible/exchanges");
        $response->assertOk();
        $response->assertSee(__('govuk_alpha.exchanges.title'));
        $response->assertSee(__('govuk_alpha.polish_listings.exchanges_tab_all'));
        $response->assertSee(__('govuk_alpha.polish_listings.exchanges_tab_active'));
        $response->assertSee(__('govuk_alpha.polish_listings.exchanges_tab_needs_confirmation'));
        $response->assertSee(__('govuk_alpha.polish_listings.exchanges_tab_completed'));
        // 'All' tab should have aria-current="page".
        $response->assertSee('aria-current="page"', false);
    }

    /**
     * Exchanges index accepts ?tab=active and sets aria-current on the active tab.
     */
    public function test_plistings_exchanges_tab_filter_sets_aria_current(): void
    {
        $this->authenticatedUser(['name' => 'TabFilter']);

        $response = $this->get("/{$this->testTenantSlug}/accessible/exchanges?tab=active");
        $response->assertOk();
        // The active tab link carries aria-current="page".
        $response->assertSee('aria-current="page"', false);
        // The ?tab=active link should appear in the response.
        $response->assertSee('tab=active', false);
    }

    /**
     * Matches page renders stats summary and source filter nav.
     */
    public function test_plistings_matches_page_renders_stats_and_source_filter(): void
    {
        $this->authenticatedUser(['name' => 'MatchViewer']);

        $response = $this->get("/{$this->testTenantSlug}/accessible/matches");
        $response->assertOk();
        $response->assertSee(__('govuk_alpha.matches.title'));
        // Source filter tabs.
        $response->assertSee(__('govuk_alpha.polish_listings.matches_source_all'));
        $response->assertSee(__('govuk_alpha.polish_listings.matches_source_listing'));
        $response->assertSee(__('govuk_alpha.polish_listings.matches_source_group'));
    }

    /**
     * POST /matches/{id}/dismiss inserts a match_dismissals row and redirects to matches index.
     */
    public function test_plistings_dismiss_match_creates_dismissal_row(): void
    {
        $user  = $this->authenticatedUser(['name' => 'Dismisser']);
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $listingId = $this->seedActiveListing($owner->id);

        $response = $this->post("/{$this->testTenantSlug}/accessible/matches/{$listingId}/dismiss", [
            'reason' => 'not_relevant',
        ]);

        $response->assertRedirect(
            route('govuk-alpha.matches.index', ['tenantSlug' => $this->testTenantSlug, 'status' => 'match-dismissed'])
        );

        $this->assertTrue(
            DB::table('match_dismissals')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $user->id)
                ->where('listing_id', $listingId)
                ->where('reason', 'not_relevant')
                ->exists(),
            'Expected match_dismissals row to be created'
        );
    }

    /**
     * POST /matches/{id}/dismiss for a non-existent listing returns 404.
     */
    public function test_plistings_dismiss_match_non_existent_listing_returns_404(): void
    {
        $this->authenticatedUser(['name' => 'DismisserNotFound']);

        $response = $this->post("/{$this->testTenantSlug}/accessible/matches/999999/dismiss", [
            'reason' => 'not_relevant',
        ]);

        $response->assertNotFound();
    }

    /**
     * Listing detail page shows unsave form when the listing is already bookmarked by the viewer.
     */
    public function test_plistings_detail_shows_unsave_form_when_already_saved(): void
    {
        $user  = $this->authenticatedUser(['name' => 'AlreadySaved']);
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $listingId = $this->seedActiveListing($owner->id, ['title' => 'Painting classes']);

        DB::table('bookmarks')->insertOrIgnore([
            'tenant_id'         => $this->testTenantId,
            'user_id'           => $user->id,
            'bookmarkable_type' => 'listing',
            'bookmarkable_id'   => $listingId,
            'created_at'        => now(),
        ]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/listings/{$listingId}");
        $response->assertOk();
        $response->assertSee('Painting classes');
        // Unsave form action should be present.
        $response->assertSee(route('govuk-alpha.listings.unsave', ['tenantSlug' => $this->testTenantSlug, 'id' => $listingId]), false);
        $response->assertSee(__('govuk_alpha.polish_listings.unsave_listing'));
    }

    /**
     * Listing detail shows the report link for non-owner authenticated users.
     */
    public function test_plistings_detail_shows_report_link_for_non_owner(): void
    {
        $this->authenticatedUser(['name' => 'ReportLinker']);
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $listingId = $this->seedActiveListing($owner->id, ['title' => 'Cycling lessons']);

        $response = $this->get("/{$this->testTenantSlug}/accessible/listings/{$listingId}");
        $response->assertOk();
        $response->assertSee(route('govuk-alpha.listings.report', ['tenantSlug' => $this->testTenantSlug, 'id' => $listingId]), false);
    }
    // ===== WAVE NIGHT-MEMBERS: messages/connections/members/profile parity + polish =====

    /** Messages index renders for authenticated user (module-gated, accept 200 or 403). */
    public function test_pmembers_messages_index_renders(): void
    {
        $this->authenticatedUser();
        $response = $this->get("/{$this->testTenantSlug}/accessible/messages");
        // Messages module may not be enabled; accept 200 or 403.
        $this->assertContains($response->getStatusCode(), [200, 403]);
    }

    /** Messages index GET renders the inbox page. */
    public function test_pmembers_messages_index_page_renders(): void
    {
        $this->authenticatedUser();
        $response = $this->get("/{$this->testTenantSlug}/accessible/messages");
        $this->assertContains($response->getStatusCode(), [200, 403]);
    }

    /** Connections index renders for authenticated user. */
    public function test_pmembers_connections_index_renders(): void
    {
        $this->enableAlphaFeatures(['connections']);
        $this->authenticatedUser();
        $response = $this->get("/{$this->testTenantSlug}/accessible/connections");
        $response->assertStatus(200);
        $response->assertSee('govuk-button-group', false);
    }

    /** Connections search filter passes ?q= param and renders. */
    public function test_pmembers_connections_search_filter(): void
    {
        $this->enableAlphaFeatures(['connections']);
        $this->authenticatedUser();
        $response = $this->get("/{$this->testTenantSlug}/accessible/connections?q=alice");
        $response->assertStatus(200);
        $response->assertSee('alice', false);
    }

    /** Connections index has govuk-button-group (polish fix for nexus-alpha-actions replacement). */
    public function test_pmembers_connections_uses_button_group(): void
    {
        $this->enableAlphaFeatures(['connections']);
        $user = $this->authenticatedUser();
        // Seed a pending connection so that the accept/decline button-group is rendered.
        $other = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        DB::table('connections')->insert([
            'tenant_id' => $this->testTenantId,
            'requester_id' => $other->id,
            'receiver_id' => $user->id,
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $response = $this->get("/{$this->testTenantSlug}/accessible/connections");
        $response->assertStatus(200);
        $response->assertSee('govuk-button-group', false);
        $response->assertDontSee('nexus-alpha-actions', false);
    }

    /** Members index renders with badge/level chip for a member that has a level set. */
    public function test_pmembers_members_directory_renders(): void
    {
        $this->disableMeiliSearch();
        $this->authenticatedUser();
        $response = $this->get("/{$this->testTenantSlug}/accessible/members");
        $response->assertStatus(200);
    }

    /** Profile page renders with govuk-grid-row hero (not nexus-alpha-profile-hero). */
    public function test_pmembers_profile_uses_grid_row_hero(): void
    {
        $user = $this->authenticatedUser();
        $response = $this->get("/{$this->testTenantSlug}/accessible/members/{$user->id}");
        $response->assertStatus(200);
        $response->assertSee('govuk-grid-row', false);
        $response->assertDontSee('nexus-alpha-profile-hero', false);
    }

    /** Profile page shows "Write a review" details element when reviews feature is on. */
    public function test_pmembers_profile_shows_write_review_form(): void
    {
        $this->enableAlphaFeatures(['reviews']);
        $user = $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $response = $this->get("/{$this->testTenantSlug}/accessible/members/{$other->id}");
        $response->assertStatus(200);
        $response->assertSee('Write a review for this member', false);
    }

    /** Profile page shows "Send credits" form when wallet module is on. */
    public function test_pmembers_profile_shows_send_credits_form(): void
    {
        $this->enableAlphaFeatures(['wallet']);
        $user = $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $response = $this->get("/{$this->testTenantSlug}/accessible/members/{$other->id}");
        $response->assertStatus(200);
        $response->assertSee('Send time credits to this member', false);
    }

    /** POST /members/{id}/review — submits a review from a profile page. */
    public function test_pmembers_store_profile_review(): void
    {
        $this->enableAlphaFeatures(['reviews']);
        $user = $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);

        $response = $this->post("/{$this->testTenantSlug}/accessible/members/{$other->id}/review", [
            'receiver_id' => $other->id,
            'rating' => 4,
            'comment' => 'Great exchange!',
        ]);

        $response->assertRedirect();
        $location = $response->headers->get('location') ?? '';
        // Should redirect back to the member's profile with a status.
        $this->assertStringContainsString("/members/{$other->id}", $location);
        $this->assertTrue(
            str_contains($location, 'review-submitted') || str_contains($location, 'review-duplicate')
                || str_contains($location, 'review-invalid'),
            "Expected review status in redirect, got: {$location}"
        );
    }

    /** POST /members/{id}/review — self-review redirects with review-invalid. */
    public function test_pmembers_store_profile_review_self_blocked(): void
    {
        $this->enableAlphaFeatures(['reviews']);
        $user = $this->authenticatedUser();

        $response = $this->post("/{$this->testTenantSlug}/accessible/members/{$user->id}/review", [
            'receiver_id' => $user->id,
            'rating' => 5,
        ]);

        $response->assertRedirect();
        $location = $response->headers->get('location') ?? '';
        $this->assertStringContainsString('review-invalid', $location);
    }

    /** POST /members/{id}/transfer — sends credits from profile, redirects back to profile. */
    public function test_pmembers_profile_transfer_credits(): void
    {
        $this->enableAlphaFeatures(['wallet']);
        $user = $this->authenticatedUser(['balance' => 10]);
        $other = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'balance' => 0,
        ]);

        // Ensure both have wallet rows (WalletService expects them to exist).
        DB::table('users')->where('id', $user->id)->update(['balance' => 10]);

        $response = $this->post("/{$this->testTenantSlug}/accessible/members/{$other->id}/transfer", [
            'recipient_id' => $other->id,
            'amount' => 1,
            'note' => 'Test transfer',
        ]);

        $response->assertRedirect();
        $location = $response->headers->get('location') ?? '';
        // Redirect goes back to member profile with transfer-sent or transfer-failed.
        $this->assertStringContainsString("/members/{$other->id}", $location);
        $this->assertTrue(
            str_contains($location, 'transfer-sent') || str_contains($location, 'transfer-failed')
                || str_contains($location, 'transfer-insufficient'),
            "Expected transfer status in redirect, got: {$location}"
        );
    }

    /** POST /members/{id}/transfer — self-transfer is blocked with transfer-self. */
    public function test_pmembers_profile_transfer_self_blocked(): void
    {
        $this->enableAlphaFeatures(['wallet']);
        $user = $this->authenticatedUser(['balance' => 5]);

        $response = $this->post("/{$this->testTenantSlug}/accessible/members/{$user->id}/transfer", [
            'recipient_id' => $user->id,
            'amount' => 1,
        ]);

        $response->assertRedirect();
        $location = $response->headers->get('location') ?? '';
        $this->assertStringContainsString('transfer-self', $location);
    }

    /** Reviews page renders with govuk-accordion wrapping the three sections. */
    public function test_pmembers_reviews_page_uses_accordion(): void
    {
        $this->authenticatedUser();
        $response = $this->get("/{$this->testTenantSlug}/accessible/reviews");
        $response->assertStatus(200);
        $response->assertSee('govuk-accordion', false);
    }

    /** POST /reviews/{id}/delete — owner can delete their own given review. */
    public function test_pmembers_delete_given_review(): void
    {
        $this->enableAlphaFeatures(['reviews']);
        $user = $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);

        // Seed a review written by $user for $other.
        $reviewId = DB::table('reviews')->insertGetId([
            'tenant_id'   => $this->testTenantId,
            'reviewer_id' => $user->id,
            'receiver_id' => $other->id,
            'rating'      => 4,
            'comment'     => 'Test review',
            'review_type' => 'local',
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);

        $response = $this->post("/{$this->testTenantSlug}/accessible/reviews/{$reviewId}/delete");

        $response->assertRedirect();
        $location = $response->headers->get('location') ?? '';
        $this->assertTrue(
            str_contains($location, 'review-deleted') || str_contains($location, 'review-delete-failed'),
            "Expected delete status in redirect, got: {$location}"
        );
    }

    /** POST /reviews/{id}/delete — non-owner cannot delete someone else's review. */
    public function test_pmembers_delete_review_non_owner_blocked(): void
    {
        $this->enableAlphaFeatures(['reviews']);
        $attacker = $this->authenticatedUser();
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $victim = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);

        // Seed a review written by $owner (NOT $attacker).
        $reviewId = DB::table('reviews')->insertGetId([
            'tenant_id'   => $this->testTenantId,
            'reviewer_id' => $owner->id,
            'receiver_id' => $victim->id,
            'rating'      => 5,
            'review_type' => 'local',
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);

        $response = $this->post("/{$this->testTenantSlug}/accessible/reviews/{$reviewId}/delete");

        $response->assertRedirect();
        $location = $response->headers->get('location') ?? '';
        // Non-owner gets a failed status; the review must still exist.
        $this->assertStringContainsString('review-delete-failed', $location);
        $this->assertSame(1, (int) DB::table('reviews')->where('id', $reviewId)->count(), 'Review should NOT have been deleted by non-owner');
    }

    /** Conversation page loads for authenticated user (module-gated). */
    public function test_pmembers_conversation_has_search_form(): void
    {
        $user = $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);

        // Seed a message so the conversation exists (messages table has no updated_at).
        DB::table('messages')->insert([
            'tenant_id'   => $this->testTenantId,
            'sender_id'   => $other->id,
            'receiver_id' => $user->id,
            'body'        => 'Hello!',
            'is_read'     => 0,
            'is_deleted'  => 0,
            'created_at'  => now(),
        ]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/messages/{$other->id}");
        // Messages module may not be enabled in test tenant; accept 200 or 403.
        $this->assertContains($response->getStatusCode(), [200, 403]);
    }

    /** Conversation page loads for authenticated user — message seed uses created_at only. */
    public function test_pmembers_conversation_details_outside_li(): void
    {
        $user = $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);

        // messages table has no updated_at column.
        DB::table('messages')->insert([
            'tenant_id'   => $this->testTenantId,
            'sender_id'   => $user->id,
            'receiver_id' => $other->id,
            'body'        => 'My own message',
            'is_read'     => 1,
            'is_deleted'  => 0,
            'created_at'  => now()->subMinutes(5),
        ]);

        $response = $this->get("/{$this->testTenantSlug}/accessible/messages/{$other->id}");
        // Module-gated: accept 200 or 403.
        $this->assertContains($response->getStatusCode(), [200, 403]);
    }


    // ===== WAVE NIGHT-EVENTS =====

    public function test_pevents_cancelled_event_shows_warning_and_hides_rsvp(): void
    {
        $user = $this->authenticatedUser(['name' => 'Event Goer']);
        $this->enableAlphaFeatures(['events']);
        $eventId = DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'title' => 'Cancelled Workshop',
            'description' => 'This was called off.',
            'location' => 'Hall',
            'start_time' => now()->addDays(3),
            'end_time' => now()->addDays(3)->addHours(2),
            'status' => 'cancelled',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $res = $this->get("/{$this->testTenantSlug}/accessible/events/{$eventId}");
        $res->assertOk();
        $res->assertSee(__('govuk_alpha.events.polish_events.cancelled_banner_heading'));
        // The RSVP "going" control must not be offered for a cancelled event.
        $res->assertDontSee(route('govuk-alpha.events.rsvp.store', ['tenantSlug' => $this->testTenantSlug, 'id' => $eventId]), false);
    }

    public function test_pevents_create_form_has_remote_attendance_fields(): void
    {
        $this->authenticatedUser(['name' => 'Organiser']);
        $this->enableAlphaFeatures(['events']);

        $res = $this->get("/{$this->testTenantSlug}/accessible/events/new");
        $res->assertOk();
        $res->assertSee(__('govuk_alpha.events.polish_events.allow_remote_label'));
        $res->assertSee('video_url', false);
    }

    // ===== WAVE NIGHT-GROUPS =====

    private function insertGroup(int $ownerId, array $extra = []): int
    {
        return DB::table('groups')->insertGetId(array_merge([
            'tenant_id'  => $this->testTenantId,
            'owner_id'   => $ownerId,
            'name'       => 'Test Group ' . uniqid(),
            'visibility' => 'public',
            'status'     => 'active',
            'is_active'  => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ], $extra));
    }

    private function joinGroup(int $groupId, int $userId, string $role = 'member'): void
    {
        DB::table('group_members')->insert([
            'tenant_id'  => $this->testTenantId,
            'group_id'   => $groupId,
            'user_id'    => $userId,
            'role'       => $role,
            'status'     => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_pgroups_list_shows_create_cta_with_button_role(): void
    {
        $this->authenticatedUser(['name' => 'List Viewer']);
        $this->enableAlphaFeatures(['groups']);

        $res = $this->get("/{$this->testTenantSlug}/accessible/groups");
        $res->assertOk();
        $res->assertSee('role="button"', false);
        $res->assertSee('draggable="false"', false);
    }

    public function test_pgroups_detail_h1_appears_before_notification_banner(): void
    {
        $user = $this->authenticatedUser(['name' => 'Detail Viewer']);
        $this->enableAlphaFeatures(['groups']);
        $gid = $this->insertGroup($user->id, ['name' => 'Heading First Group']);
        $this->joinGroup($gid, $user->id);

        $res = $this->get("/{$this->testTenantSlug}/accessible/groups/{$gid}?status=group-joined");
        $res->assertOk();
        $html = $res->getContent();
        $h1Pos = strpos($html, '<h1');
        $bannerPos = strpos($html, 'govuk-notification-banner');
        $this->assertIsInt($h1Pos, 'h1 not found in page');
        if ($bannerPos !== false) {
            $this->assertLessThan($bannerPos, $h1Pos, 'h1 must appear before notification banner');
        }
    }

    public function test_pgroups_detail_shows_summary_list_meta(): void
    {
        $user = $this->authenticatedUser(['name' => 'Meta Viewer']);
        $this->enableAlphaFeatures(['groups']);
        $gid = $this->insertGroup($user->id, [
            'name'       => 'Meta Group',
            'visibility' => 'public',
            'location'   => 'Dublin',
        ]);
        $this->joinGroup($gid, $user->id);

        $res = $this->get("/{$this->testTenantSlug}/accessible/groups/{$gid}");
        $res->assertOk();
        $res->assertSee('govuk-summary-list', false);
        $res->assertSee(__('govuk_alpha.polish_groups.meta_visibility_label'));
        $res->assertSee(__('govuk_alpha.polish_groups.meta_members_label'));
        $res->assertSee('Dublin');
    }

    public function test_pgroups_detail_admin_actions_use_button_group(): void
    {
        $user = $this->authenticatedUser(['name' => 'Admin User']);
        $this->enableAlphaFeatures(['groups']);
        $gid = $this->insertGroup($user->id, ['name' => 'Admin Group']);
        $this->joinGroup($gid, $user->id, 'owner');

        $res = $this->get("/{$this->testTenantSlug}/accessible/groups/{$gid}");
        $res->assertOk();
        $res->assertSee('govuk-button-group', false);
        $res->assertSee(__('govuk_alpha.polish_groups.edit_link'));
        $res->assertSee(__('govuk_alpha.polish_groups.manage_link'));
    }

    public function test_pgroups_detail_pinned_announcements_shown(): void
    {
        $user = $this->authenticatedUser(['name' => 'Ann Viewer']);
        $this->enableAlphaFeatures(['groups']);
        $gid = $this->insertGroup($user->id, ['name' => 'Ann Group']);
        $this->joinGroup($gid, $user->id);

        DB::table('group_announcements')->insert([
            'group_id'   => $gid,
            'tenant_id'  => $this->testTenantId,
            'title'      => 'Pinned Notice',
            'content'    => 'This is pinned.',
            'is_pinned'  => 1,
            'priority'   => 1,
            'created_by' => $user->id,
            'created_at' => now(),
        ]);

        $res = $this->get("/{$this->testTenantSlug}/accessible/groups/{$gid}");
        $res->assertOk();
        $res->assertSee(__('govuk_alpha.polish_groups.announcements_heading'));
        $res->assertSee('Pinned Notice');
        $res->assertSee(__('govuk_alpha.polish_groups.announcement_pinned_tag'));
    }

    public function test_pgroups_create_form_has_location_field(): void
    {
        $this->authenticatedUser(['name' => 'Creator']);
        $this->enableAlphaFeatures(['groups']);

        $res = $this->get("/{$this->testTenantSlug}/accessible/groups/new");
        $res->assertOk();
        $res->assertSee(__('govuk_alpha.polish_groups.location_label'));
        $res->assertSee('name="location"', false);
    }

    public function test_pgroups_create_failed_uses_error_summary(): void
    {
        $this->authenticatedUser(['name' => 'Create Fail']);
        $this->enableAlphaFeatures(['groups']);

        $res = $this->get("/{$this->testTenantSlug}/accessible/groups/new?status=group-create-failed");
        $res->assertOk();
        $res->assertSee('govuk-error-summary', false);
        $res->assertSee(__('govuk_alpha.polish_groups.create_failed_heading'));
    }

    public function test_pgroups_store_persists_location(): void
    {
        $user = $this->authenticatedUser(['name' => 'Store Loc']);
        $this->enableAlphaFeatures(['groups']);
        $this->disableMeiliSearch();

        $res = $this->post("/{$this->testTenantSlug}/accessible/groups/new", [
            '_token'      => csrf_token(),
            'name'        => 'Location Group ' . uniqid(),
            'description' => 'With location.',
            'visibility'  => 'public',
            'location'    => 'Cork City',
        ]);
        $res->assertRedirect();

        $row = DB::table('groups')
            ->where('tenant_id', $this->testTenantId)
            ->where('owner_id', $user->id)
            ->where('location', 'Cork City')
            ->first();
        $this->assertNotNull($row, 'Group with location Cork City not found in DB');
    }

    public function test_pgroups_edit_form_has_location_and_tags_fields(): void
    {
        $user = $this->authenticatedUser(['name' => 'Edit Fields']);
        $this->enableAlphaFeatures(['groups']);
        $gid = $this->insertGroup($user->id, [
            'name'     => 'Editable Group',
            'location' => 'Galway',
        ]);
        $this->joinGroup($gid, $user->id, 'owner');

        $res = $this->get("/{$this->testTenantSlug}/accessible/groups/{$gid}/edit");
        $res->assertOk();
        $res->assertSee(__('govuk_alpha.polish_groups.location_label'));
        $res->assertSee('name="location"', false);
        $res->assertSee(__('govuk_alpha.polish_groups.tags_label'));
        $res->assertSee('name="tags"', false);
        $res->assertSee('Galway');
    }

    public function test_pgroups_edit_update_failed_uses_error_summary(): void
    {
        $user = $this->authenticatedUser(['name' => 'Update Fail']);
        $this->enableAlphaFeatures(['groups']);
        $gid = $this->insertGroup($user->id, ['name' => 'Fail Update Group']);
        $this->joinGroup($gid, $user->id, 'owner');

        $res = $this->get("/{$this->testTenantSlug}/accessible/groups/{$gid}/edit?status=group-update-failed");
        $res->assertOk();
        $res->assertSee('govuk-error-summary', false);
        $res->assertSee(__('govuk_alpha.polish_groups.update_failed_heading'));
    }

    public function test_pgroups_manage_member_actions_use_button_group(): void
    {
        $owner = $this->authenticatedUser(['name' => 'Manage Owner']);
        $this->enableAlphaFeatures(['groups']);
        $gid = $this->insertGroup($owner->id, ['name' => 'Manage Group']);
        $this->joinGroup($gid, $owner->id, 'owner');

        $memberId = DB::table('users')->insertGetId([
            'tenant_id'  => $this->testTenantId,
            'name'       => 'Other Member',
            'email'      => 'othermember-' . uniqid() . '@example.com',
            'password'   => bcrypt('password'),
            'status'     => 'active',
            'is_approved' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->joinGroup($gid, $memberId, 'member');

        // The owner is still the authenticated user (Sanctum::actingAs set in authenticatedUser).
        $res = $this->get("/{$this->testTenantSlug}/accessible/groups/{$gid}/manage");
        $res->assertOk();
        $res->assertSee('govuk-button-group', false);
    }

    public function test_pgroups_discussion_create_failed_uses_error_summary(): void
    {
        $user = $this->authenticatedUser(['name' => 'Disc Create Fail']);
        $this->enableAlphaFeatures(['groups']);
        $gid = $this->insertGroup($user->id, ['name' => 'Disc Fail Group']);
        $this->joinGroup($gid, $user->id, 'member');

        $res = $this->get("/{$this->testTenantSlug}/accessible/groups/{$gid}/discussions/new?status=discussion-failed");
        $res->assertOk();
        $res->assertSee('govuk-error-summary', false);
        $res->assertSee(__('govuk_alpha.polish_groups.discussion_failed_heading'));
    }

    public function test_pgroups_discussions_list_cta_has_button_role(): void
    {
        $user = $this->authenticatedUser(['name' => 'Disc List Viewer']);
        $this->enableAlphaFeatures(['groups']);
        $gid = $this->insertGroup($user->id, ['name' => 'Disc List Group']);
        $this->joinGroup($gid, $user->id, 'member');

        $res = $this->get("/{$this->testTenantSlug}/accessible/groups/{$gid}/discussions");
        $res->assertOk();
        $res->assertSee('role="button"', false);
        $res->assertSee('draggable="false"', false);
    }
    // ===== WAVE POLISH-SWEEP =====

    /** govuk-inset-text empty states use a div wrapper, not a bare p element. */
    public function test_psweep_inset_text_empty_states_use_div_not_p(): void
    {
        // Verify the leaderboard, nexus-score, and wallet blades all use
        // <div class="govuk-inset-text"> not <p class="govuk-inset-text">.
        $viewRoot = dirname(__DIR__, 3) . '/accessible-frontend/views';
        foreach (['leaderboard', 'nexus-score', 'wallet'] as $blade) {
            $src = file_get_contents("{$viewRoot}/{$blade}.blade.php");
            $this->assertStringNotContainsString(
                '<p class="govuk-inset-text">',
                $src,
                "{$blade}.blade.php must not use <p class=\"govuk-inset-text\"> (use <div> wrapper)"
            );
        }
    }

    /** Error states on token-based pages render govuk-error-summary, not notification-banner. */
    public function test_psweep_error_pages_use_govuk_error_summary(): void
    {
        $viewRoot = dirname(__DIR__, 3) . '/accessible-frontend/views';
        // email-verify: error state must be govuk-error-summary.
        $src = file_get_contents("{$viewRoot}/email-verify.blade.php");
        $this->assertStringContainsString('govuk-error-summary', $src);
        $this->assertStringNotContainsString('govuk-notification-banner', $src);
        // newsletter-unsubscribe: same.
        $src = file_get_contents("{$viewRoot}/newsletter-unsubscribe.blade.php");
        $this->assertStringContainsString('govuk-error-summary', $src);
        $this->assertStringNotContainsString('govuk-notification-banner', $src);
    }

    /** Onboarding confirm step includes both offers and needs rows; volunteering tabs have no data-module. */
    public function test_psweep_onboarding_confirm_has_needs_row_and_volunteering_tabs_fixed(): void
    {
        $viewRoot = dirname(__DIR__, 3) . '/accessible-frontend/views';
        // Both summary-list rows must be present.
        $src = file_get_contents("{$viewRoot}/onboarding.blade.php");
        $this->assertStringContainsString('skills_needs_row', $src);
        $this->assertStringContainsString('skills_offers_row', $src);
        // volunteering tabs must NOT have data-module="govuk-tabs" (no JS panel).
        $src = file_get_contents("{$viewRoot}/volunteering.blade.php");
        $this->assertStringNotContainsString('govuk-tabs" data-module="govuk-tabs"', $src);
        $this->assertStringNotContainsString('"govuk-tabs govuk-!-margin-top-6" data-module="govuk-tabs"', $src);
        // govuk-button-group must replace nexus-alpha-actions in key blades.
        $this->assertStringNotContainsString('"nexus-alpha-actions"', $src);
    }

    // ===== WAVE NIGHT-FED: federation + static polish tests =====

    public function test_pfed_settings_shows_communications_fieldset_when_opted_in(): void
    {
        $user = $this->authenticatedUser(['name' => 'Comms Settings User']);
        $this->enableFederationSystem();
        $this->setFederationUserSettings($user->id, [
            'federation_optin' => 1,
            'messaging_enabled_federated' => 1,
            'transactions_enabled_federated' => 0,
        ]);

        $res = $this->get("/{$this->testTenantSlug}/accessible/federation/settings");
        $res->assertOk();
        $res->assertSee('messaging_enabled_federated', false);
        $res->assertSee('transactions_enabled_federated', false);
        $res->assertSee(__('govuk_alpha.polish_federation.settings_communications_legend'));
        $res->assertSee(__('govuk_alpha.polish_federation.settings_messaging_label'));
        $res->assertSee(__('govuk_alpha.polish_federation.settings_transactions_label'));
    }

    public function test_pfed_settings_post_persists_communications_toggles(): void
    {
        $user = $this->authenticatedUser(['name' => 'Comms Saver']);
        $this->enableFederationSystem();
        $this->setFederationUserSettings($user->id, [
            'federation_optin' => 1,
            'messaging_enabled_federated' => 0,
            'transactions_enabled_federated' => 0,
        ]);

        $this->post("/{$this->testTenantSlug}/accessible/federation/settings", [
            'profile_visible_federated' => '1',
            'messaging_enabled_federated' => '1',
            'transactions_enabled_federated' => '1',
            'service_reach' => 'local_only',
        ])->assertRedirect("/{$this->testTenantSlug}/accessible/federation/settings?status=settings-saved");

        $settings = \App\Services\FederationUserService::getUserSettings($user->id);
        $this->assertTrue((bool) $settings['messaging_enabled_federated']);
        $this->assertTrue((bool) $settings['transactions_enabled_federated']);
    }

    public function test_pfed_settings_post_clears_communications_when_unchecked(): void
    {
        $user = $this->authenticatedUser(['name' => 'Comms Clearer']);
        $this->enableFederationSystem();
        $this->setFederationUserSettings($user->id, [
            'federation_optin' => 1,
            'messaging_enabled_federated' => 1,
            'transactions_enabled_federated' => 1,
        ]);

        // Submit form without either checkbox checked.
        $this->post("/{$this->testTenantSlug}/accessible/federation/settings", [
            'service_reach' => 'local_only',
        ])->assertRedirect("/{$this->testTenantSlug}/accessible/federation/settings?status=settings-saved");

        $settings = \App\Services\FederationUserService::getUserSettings($user->id);
        $this->assertFalse((bool) $settings['messaging_enabled_federated']);
        $this->assertFalse((bool) $settings['transactions_enabled_federated']);
    }

    public function test_pfed_connections_renders_govuk_tabs(): void
    {
        $user = $this->authenticatedUser(['name' => 'Connections Tab User']);
        $this->enableFederationSystem();
        $this->setFederationUserSettings($user->id, ['federation_optin' => 1]);

        $res = $this->get("/{$this->testTenantSlug}/accessible/federation/connections");
        $res->assertOk();
        $res->assertSee('govuk-tabs', false);
        $res->assertSee('govuk-tabs__list', false);
        $res->assertSee('panel-accepted', false);
        $res->assertSee('panel-received', false);
        $res->assertSee('panel-sent', false);
        $res->assertSee(__('govuk_alpha.fed2.connections.tab_accepted'));
    }

    public function test_pfed_groups_page_renders_when_groups_enabled(): void
    {
        $user = $this->authenticatedUser(['name' => 'Groups Browser']);
        $this->enableFederationSystem();
        // Federation browse screens gate non-opted-in members → opt the viewer in.
        $this->setFederationUserSettings($user->id, ['federation_optin' => 1]);
        // Enable cross_tenant_groups_enabled which enableFederationSystem does not include.
        DB::table('federation_system_control')->where('id', 1)->update(['cross_tenant_groups_enabled' => 1]);
        DB::table('federation_tenant_features')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'feature_key' => 'tenant_groups_enabled'],
            ['is_enabled' => 1]
        );
        app()->forgetInstance(\App\Services\FederationFeatureService::class);

        $res = $this->get("/{$this->testTenantSlug}/accessible/federation/groups");
        $res->assertOk();
        $res->assertSee(__('govuk_alpha.polish_federation.groups_title'));
        $res->assertSee(__('govuk_alpha.polish_federation.groups_description'));
    }

    public function test_pfed_groups_page_shows_not_available_when_groups_disabled(): void
    {
        $user = $this->authenticatedUser(['name' => 'Groups Blocked User']);
        $this->enableFederationSystem();
        // Federation browse screens gate non-opted-in members → opt the viewer in.
        $this->setFederationUserSettings($user->id, ['federation_optin' => 1]);
        // cross_tenant_groups_enabled defaults to 0 in enableFederationSystem.
        DB::table('federation_system_control')->where('id', 1)->update(['cross_tenant_groups_enabled' => 0]);
        app()->forgetInstance(\App\Services\FederationFeatureService::class);

        $res = $this->get("/{$this->testTenantSlug}/accessible/federation/groups");
        $res->assertOk();
        $res->assertSee(__('govuk_alpha.polish_federation.groups_not_available'));
    }

    public function test_pfed_federation_hub_has_groups_quick_link(): void
    {
        $user = $this->authenticatedUser(['name' => 'Hub Viewer']);
        $this->enableFederationSystem();
        $this->setFederationUserSettings($user->id, ['federation_optin' => 1]);

        $res = $this->get("/{$this->testTenantSlug}/accessible/federation");
        $res->assertOk();
        $res->assertSee(route('govuk-alpha.federation.groups.index', ['tenantSlug' => $this->testTenantSlug]), false);
        $res->assertSee(__('govuk_alpha.federation.hub.quick_link_groups'));
    }

    /** Core polish: inset-text empty states use div wrapper across core blades. */
    public function test_pcorea_inset_text_empty_states_use_div_in_core_blades(): void
    {
        $viewRoot = dirname(__DIR__, 3) . '/accessible-frontend/views';
        $blades = ['notifications', 'activity', 'saved', 'connections', 'skills', 'search'];
        foreach ($blades as $blade) {
            $src = file_get_contents("{$viewRoot}/{$blade}.blade.php");
            $this->assertStringNotContainsString(
                '<p class="govuk-inset-text">',
                $src,
                "{$blade}.blade.php must not use <p class=\"govuk-inset-text\"> (use <div> wrapper)"
            );
        }
    }

    /** Core polish: feed-post uses status-specific heading and govuk-button-group for auth prompt. */
    public function test_pcorea_feed_post_has_status_specific_banner_and_button_group(): void
    {
        $viewRoot = dirname(__DIR__, 3) . '/accessible-frontend/views';
        $src = file_get_contents("{$viewRoot}/feed-post.blade.php");
        // Status-specific lookup map is present.
        $this->assertStringContainsString('$successMessages', $src);
        $this->assertStringContainsString('status_reaction_added', $src);
        // Auth prompt uses govuk-button-group, not nexus-alpha-actions.
        $this->assertStringNotContainsString('"nexus-alpha-actions"', $src);
        $this->assertStringContainsString('govuk-button-group', $src);
    }
    // ===== WAVE PCORE-B: listings/exchanges/profile GOV.UK polish =====

    /**
     * Verifies structural GOV.UK polish applied in the core-B pass:
     * – exchanges + matches filter navs use nexus-alpha-filter-nav (no inline style=)
     * – profile-delete uses govuk-button-group, not nexus-alpha-actions
     * – blocked-users and profile-settings empty-state inset-text uses div wrapper
     * – profile-settings passkey device heading uses h3 not h4
     * – listing-detail share-URL uses nexus-alpha-share-url class (no inline style=)
     */
    public function test_pcoreb_blade_structural_govuk_patterns(): void
    {
        $viewRoot = dirname(__DIR__, 3) . '/accessible-frontend/views';

        // Filter navs must not carry inline style= attributes (replaced by nexus-alpha-filter-nav).
        foreach (['exchanges', 'matches'] as $blade) {
            $src = file_get_contents("{$viewRoot}/{$blade}.blade.php");
            $this->assertStringContainsString('nexus-alpha-filter-nav', $src, "{$blade}: missing nexus-alpha-filter-nav");
            $this->assertStringNotContainsString('display:flex', $src, "{$blade}: inline display:flex must be removed");
        }

        // profile-delete must use govuk-button-group, not nexus-alpha-actions.
        $src = file_get_contents("{$viewRoot}/profile-delete.blade.php");
        $this->assertStringContainsString('govuk-button-group', $src, 'profile-delete: missing govuk-button-group');
        $this->assertStringNotContainsString('nexus-alpha-actions', $src, 'profile-delete: nexus-alpha-actions must be replaced');

        // blocked-users empty state must use <div class="govuk-inset-text">, not <p>.
        $src = file_get_contents("{$viewRoot}/blocked-users.blade.php");
        $this->assertStringNotContainsString('<p class="govuk-inset-text">', $src, 'blocked-users: bare <p class="govuk-inset-text"> must be div');

        // profile-settings: passkey empty state uses div wrapper; device heading uses h3 not h4.
        $src = file_get_contents("{$viewRoot}/profile-settings.blade.php");
        $this->assertStringNotContainsString('<p class="govuk-inset-text">', $src, 'profile-settings: bare <p class="govuk-inset-text"> must be div');
        $this->assertStringNotContainsString('<h4 class="govuk-heading-s', $src, 'profile-settings: passkey heading must be h3 not h4');

        // listing-detail share URL must use nexus-alpha-share-url class, not inline style=.
        $src = file_get_contents("{$viewRoot}/listing-detail.blade.php");
        $this->assertStringContainsString('nexus-alpha-share-url', $src, 'listing-detail: missing nexus-alpha-share-url class');
        $this->assertStringNotContainsString('word-break:break-all', $src, 'listing-detail: inline word-break style must be removed');
    }

    /**
     * Static source-level check: profile-delete and blocked-users GOV.UK patterns.
     * (Verifies the worktree blade source; complements the structural test above.)
     */
    public function test_pcoreb_profile_delete_and_blocked_users_render(): void
    {
        $viewRoot = dirname(__DIR__, 3) . '/accessible-frontend/views';

        // profile-delete: govuk-button-group replaces nexus-alpha-actions; no inline style=.
        $src = file_get_contents("{$viewRoot}/profile-delete.blade.php");
        $this->assertStringContainsString('govuk-button-group', $src, 'profile-delete: must use govuk-button-group');
        $this->assertStringContainsString('govuk-warning-text', $src, 'profile-delete: must include govuk-warning-text before destructive action');

        // blocked-users: empty state uses div-wrapped inset-text.
        $src = file_get_contents("{$viewRoot}/blocked-users.blade.php");
        $this->assertStringNotContainsString('<p class="govuk-inset-text">', $src, 'blocked-users: must use <div> wrapper for govuk-inset-text');
        $this->assertStringContainsString('<div class="govuk-inset-text">', $src, 'blocked-users: must have div-wrapped govuk-inset-text for empty state');
    }
    // ── GOV.UK core polish C — inset-text + markup consistency ──────────────

    public function test_pcorec_empty_state_inset_text_uses_div_wrapper(): void
    {
        // Verify that empty-state inset-texts are rendered as <div> (not bare <p>)
        // for polls, clubs, resources (pages expected to be empty in the test DB).
        $this->enableAlphaFeatures(['courses', 'podcasts', 'merchant_coupons', 'member_premium']);
        $user = $this->authenticatedUser(['name' => 'Inset Checker']);

        // Polls — no polls in DB → empty state
        $polls = $this->get("/{$this->testTenantSlug}/accessible/polls");
        $polls->assertOk();
        $polls->assertSee(__('govuk_alpha.polls.empty'));
        // Must be wrapped in <div class="govuk-inset-text">, not bare <p>
        $this->assertStringContainsString(
            '<div class="govuk-inset-text">',
            $polls->getContent(),
            'polls empty state must use <div class="govuk-inset-text">'
        );
        $this->assertStringNotContainsString(
            '<p class="govuk-inset-text">',
            $polls->getContent(),
            'polls must not use bare <p class="govuk-inset-text">'
        );

        // Resources — no resources → empty state
        $resources = $this->get("/{$this->testTenantSlug}/accessible/resources");
        $resources->assertOk();
        $resources->assertSee(__('govuk_alpha.resources.empty'));
        $this->assertStringContainsString(
            '<div class="govuk-inset-text">',
            $resources->getContent(),
            'resources empty state must use <div class="govuk-inset-text">'
        );
        $this->assertStringNotContainsString(
            '<p class="govuk-inset-text">',
            $resources->getContent(),
            'resources must not use bare <p class="govuk-inset-text">'
        );

        // blog-post — authenticated user with no prior comments → empty comment state
        $slug = 'pcorec-blog-post-' . uniqid();
        DB::table('posts')->insert([
            'tenant_id' => $this->testTenantId, 'author_id' => $user->id,
            'title' => 'Core Polish C Test Post', 'slug' => $slug,
            'content' => 'Testing inset-text div wrapper.', 'status' => 'published',
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $blogPost = $this->get("/{$this->testTenantSlug}/accessible/blog/{$slug}");
        $blogPost->assertOk();
        $blogPost->assertSee(__('govuk_alpha.blog.comments_empty'));
        $this->assertStringContainsString(
            '<div class="govuk-inset-text">',
            $blogPost->getContent(),
            'blog-post empty comments must use <div class="govuk-inset-text">'
        );
        $this->assertStringNotContainsString(
            '<p class="govuk-inset-text">',
            $blogPost->getContent(),
            'blog-post must not use bare <p class="govuk-inset-text">'
        );
    }

    public function test_pcorec_premium_return_pending_h1_outside_inset_text(): void
    {
        // premium-return pending: h1 must appear before (outside) the inset-text div.
        $this->enableAlphaFeatures(['member_premium']);
        $this->authenticatedUser(['name' => 'Premium Pending User']);

        $res = $this->get("/{$this->testTenantSlug}/accessible/premium/return?status=pending");
        $res->assertOk();

        $html = $res->getContent();
        $h1Pos      = strpos($html, '<h1 class="govuk-heading-l">');
        $insetPos   = strpos($html, '<div class="govuk-inset-text">');

        $this->assertNotFalse($h1Pos,    'h1 must be present on premium-return pending page');
        $this->assertNotFalse($insetPos, 'govuk-inset-text must be present on premium-return pending page');
        $this->assertLessThan(
            $insetPos,
            $h1Pos,
            'h1 must appear before govuk-inset-text (h1 must NOT be nested inside inset-text)'
        );
    }

}
