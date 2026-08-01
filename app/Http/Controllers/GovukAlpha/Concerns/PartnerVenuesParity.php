<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\GovukAlpha\Concerns;

use App\Core\TenantContext;
use App\Services\PartnerVenueService;
use App\Services\PartnerVenueVisitService;
use Endroid\QrCode\Builder\Builder;
use Endroid\QrCode\Encoding\Encoding;
use Endroid\QrCode\ErrorCorrectionLevel;
use Endroid\QrCode\Writer\SvgWriter;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Partner venues — accessible (GOV.UK) frontend parity methods.
 *
 * Composed into AlphaController. Method names are module-prefixed (venues*).
 * Services are resolved via app(), never the constructor.
 *
 * Three surfaces, mirroring the React pages:
 *   - venuesIndex:  the venue directory (name, category, informational offer)
 *   - venuesPass:   the member's pass — QR rendered SERVER-SIDE as inline SVG
 *     (endroid/qr-code, the TotpService pattern) because this frontend must
 *     work without JavaScript; the QR encodes the SAME check-in URL the React
 *     pass uses, so staff scanning either pass land on one canonical flow
 *   - venuesCheckin / venuesCheckinStore: the staff confirm page. GET never
 *     records anything (link-preview crawlers prefetch URLs); the visit is
 *     recorded only by the deliberate POST, exactly like the volunteering and
 *     events check-in pages.
 *
 * Every backing call is the SAME tenant-scoped service the React API uses
 * (PartnerVenueService, PartnerVenueVisitService::recordVisit with its
 * one-visit-per-day unique key and staff authorization). No engagement or
 * money logic is reimplemented here.
 */
trait PartnerVenuesParity
{
    public function venuesIndex(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('partner_venues'), 403);

        if ($this->currentUserId() === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        return $this->view('accessible-frontend::venues', [
            'title' => __('govuk_alpha_venues.index.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'venues',
            'venues' => app(PartnerVenueService::class)->directory(),
        ]);
    }

    public function venuesPass(Request $request, string $tenantSlug): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('partner_venues'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $visitService = app(PartnerVenueVisitService::class);
        $pass = $visitService->getOrCreatePass($userId);

        // Inline SVG, no JS, no external request — the accessible-frontend
        // equivalent of the React page's client-side qrcode render.
        $builder = new Builder(
            writer: new SvgWriter(),
            data: (string) $pass['qr_url'],
            encoding: new Encoding('UTF-8'),
            errorCorrectionLevel: ErrorCorrectionLevel::Medium,
            size: 260,
            margin: 12,
        );

        return $this->view('accessible-frontend::venue-pass', [
            'title' => __('govuk_alpha_venues.pass.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'venues',
            'pass' => $pass,
            'qrSvg' => $builder->build()->getString(),
            'visits' => $visitService->myVisits($userId),
        ]);
    }

    /**
     * Rotate the member's pass — invalidates the previous QR, the recovery
     * action when a pass may have been photographed. Parity with the React
     * MyPassPage's "get a new code" button.
     */
    public function venuesPassRotate(Request $request, string $tenantSlug): RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('partner_venues'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        app(PartnerVenueVisitService::class)->rotatePass($userId);

        return redirect()->route('govuk-alpha.venues.pass', ['tenantSlug' => $tenantSlug, 'status' => 'rotated']);
    }

    /**
     * Staff scan landing page. Deliberately confirms nothing on GET.
     */
    public function venuesCheckin(Request $request, string $tenantSlug, string $token): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('partner_venues'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        return $this->view('accessible-frontend::venue-checkin', [
            'title' => __('govuk_alpha_venues.checkin.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'venues',
            'token' => $token,
            'result' => null,
            'venueChoices' => [],
        ]);
    }

    public function venuesCheckinStore(Request $request, string $tenantSlug, string $token): Response|RedirectResponse
    {
        $this->assertTenantSlug($tenantSlug);
        abort_unless(TenantContext::hasFeature('partner_venues'), 403);

        $userId = $this->currentUserId();
        if ($userId === null) {
            return redirect()->route('govuk-alpha.login', ['tenantSlug' => $tenantSlug, 'status' => 'auth-required']);
        }

        $venueId = $request->input('venue_id');
        $venueId = is_numeric($venueId) ? (int) $venueId : null;

        // The service reports outcomes as statuses (invalid_pass / forbidden /
        // needs_venue / recorded / already_recorded_today) rather than
        // exceptions, so the page just renders whichever state comes back.
        $result = app(PartnerVenueVisitService::class)->recordVisit($token, $userId, $venueId);

        return $this->view('accessible-frontend::venue-checkin', [
            'title' => __('govuk_alpha_venues.checkin.title'),
            'tenantSlug' => $tenantSlug,
            'activeNav' => 'venues',
            'token' => $token,
            'result' => $result,
            'venueChoices' => is_array($result['venues'] ?? null) ? $result['venues'] : [],
        ]);
    }
}
