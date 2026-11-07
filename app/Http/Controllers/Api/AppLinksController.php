<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Services\EmailDispatchService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * Email the phone-app store links to the signed-in member.
 *
 * AWID accessibility report, Oct 2026, point 15: getting the app from a
 * computer relied on scanning a QR code, which a blind member cannot do. The
 * links go to the member's OWN address only — never one the request names —
 * in their own language, and the action is rate-limited, so it cannot be used
 * to send mail to anyone else or to flood an inbox.
 */
class AppLinksController extends BaseApiController
{
    protected bool $isV2Api = true;

    /** The single all-communities app, as listed in react-frontend/src/config/externalLinks.ts. */
    public const ANDROID_PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=ie.project.nexus';

    public const IOS_APP_STORE_URL = 'https://apps.apple.com/app/timebank-global/id6823712395';

    /** POST /v2/app-links/email */
    public function email(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('app_links_email', 3, 3600);

        $tenantId = (int) TenantContext::getId();
        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select(['email', 'first_name', 'preferred_language'])
            ->first();
        if ($user === null || !is_string($user->email) || $user->email === '') {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }

        $community = (string) (TenantContext::get()['name'] ?? '');
        $sent = LocaleContext::withLocale($user, function () use ($user, $community, $tenantId): bool {
            $communitySafe = htmlspecialchars($community, ENT_QUOTES, 'UTF-8');
            $nameSafe = htmlspecialchars((string) ($user->first_name ?? ''), ENT_QUOTES, 'UTF-8');
            $iosLink = '<a href="' . self::IOS_APP_STORE_URL . '">' . self::IOS_APP_STORE_URL . '</a>';
            $androidLink = '<a href="' . self::ANDROID_PLAY_STORE_URL . '">' . self::ANDROID_PLAY_STORE_URL . '</a>';

            $html = EmailTemplateBuilder::make()
                ->theme('brand')
                ->title(__('emails_misc.app_links.title'))
                ->paragraph('<p>' . __('emails_misc.admin_actions.welcome_resend_greeting', ['name' => $nameSafe]) . '</p>'
                    . '<p>' . __('emails_misc.app_links.intro', ['community' => $communitySafe]) . '</p>')
                ->paragraph(__('emails_misc.app_links.android_line', ['link' => $androidLink]))
                ->paragraph(__('emails_misc.app_links.ios_line', ['link' => $iosLink]))
                ->render();

            return EmailDispatchService::sendRaw(
                (string) $user->email,
                __('emails_misc.app_links.subject', ['community' => $communitySafe]),
                $html,
                null,
                null,
                null,
                'app_links',
                ['tenant_id' => $tenantId]
            );
        });

        if (!$sent) {
            return $this->respondWithError('EMAIL_FAILED', __('emails_misc.app_links.send_failed'), null, 502);
        }

        return $this->respondWithData(['sent' => true]);
    }
}
