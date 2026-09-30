<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Services\LegalPublicationDeliveryService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Response;

final class LegalPublicationTrackingController
{
    public function open(int $deliveryId, string $signature): Response
    {
        $gif = base64_decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
        LegalPublicationDeliveryService::recordEvent($deliveryId, 'open', $signature);
        return response($gif, 200, [
            'Content-Type' => 'image/gif',
            'Cache-Control' => 'private, no-store, no-cache, must-revalidate',
        ]);
    }

    public function click(int $deliveryId, string $signature): RedirectResponse
    {
        $url = LegalPublicationDeliveryService::recordEvent($deliveryId, 'click', $signature);
        return redirect()->away($url ?: config('app.frontend_url', config('app.url')));
    }
}
