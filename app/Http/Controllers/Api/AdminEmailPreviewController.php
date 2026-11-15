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
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * "What your members receive" (Warmth phase 6, B6).
 *
 * Renders ONE sample member email through the real shared email layout
 * (EmailTemplateBuilder) for the community in context, so its admin sees the
 * logo, colour and name their members see. Read-only: nothing is sent or
 * stored, the body is fixed sample wording (no member data), and the only link
 * is the community's own home page. Written in the admin's own language.
 *
 * Authorisation matches the neighbouring admin email endpoints
 * (ListingsDigestController::adminPreview, AdminEmailController): the
 * auth:sanctum + admin route group plus requireAdmin().
 */
class AdminEmailPreviewController extends BaseApiController
{
    protected bool $isV2Api = true;

    /** GET /v2/admin/email-preview */
    public function show(): JsonResponse
    {
        $adminId = $this->requireAdmin();

        // The caller's own row: only their language is read.
        $language = DB::table('users')->where('id', $adminId)->value('preferred_language');
        $community = (string) (TenantContext::get()['name'] ?? '');

        /** @var array{subject: string, html: string} $sample */
        $sample = LocaleContext::withLocale(
            is_string($language) && $language !== '' ? $language : null,
            function () use ($community): array {
                $communitySafe = htmlspecialchars($community, ENT_QUOTES, 'UTF-8');

                $html = EmailTemplateBuilder::make()
                    ->theme('brand')
                    ->title(__('emails_misc.email_preview.title'))
                    ->previewText(__('emails_misc.email_preview.preview_text', ['community' => $communitySafe]))
                    ->greeting(__('emails.common.fallback_name'))
                    ->paragraph(__('emails_misc.email_preview.body_intro', ['community' => $communitySafe]))
                    ->paragraph(__('emails_misc.email_preview.body_more'))
                    ->button(
                        __('emails_misc.email_preview.button', ['community' => $communitySafe]),
                        EmailTemplateBuilder::tenantUrl('/')
                    )
                    ->render();

                return [
                    // Plain text: the admin screen shows it as text, never as HTML.
                    'subject' => __('emails_misc.email_preview.subject', ['community' => $community]),
                    'html' => $html,
                ];
            }
        );

        return $this->respondWithData($sample);
    }
}
