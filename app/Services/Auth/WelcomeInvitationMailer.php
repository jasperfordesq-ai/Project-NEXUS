<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// No strict_types: this is AdminUsersController::sendWelcomeEmail's email,
// moved verbatim. A community's welcome_email config is free-form JSON, and it
// must be coerced exactly as it was in the (non-strict) controller.

namespace App\Services\Auth;

use App\Core\EmailTemplateBuilder;
use App\I18n\LocaleContext;
use App\Services\EmailDispatchService;
use App\Support\Tenancy\UserTenantResolver;
use Illuminate\Support\Facades\DB;

/**
 * The welcome invitation email — ONE email, whoever sends it.
 *
 * Used by the admin "Resend welcome email" action and by the member-import
 * background sender, so a member gets the same email either way:
 *  - rendered in the member's preferred language;
 *  - the community's custom welcome subject/body when it has one;
 *  - with $withPasswordLink, a fresh 7-day set-password link
 *    (PasswordResetTokens::issueInvitation) and its button; a community's
 *    full-HTML welcome template has nowhere to put the link, so the standard
 *    wording is used for that member instead;
 *  - without it, a "sign in" button (or the full-HTML template as written).
 *
 * The CALLER decides whether a link is due, checks permissions, and writes the
 * activity log — this class does none of those. Any failure throws a
 * \RuntimeException, after revoking the link it issued: a link nobody received
 * must not stay live.
 */
class WelcomeInvitationMailer
{
    public function __construct(private readonly PasswordResetTokens $tokens)
    {
    }

    /**
     * @param array<string,mixed> $user User record from the database (User::findById(..., true))
     * @throws \RuntimeException when the email could not be built or sent
     */
    public function send(array $user, bool $withPasswordLink): void
    {
        $invitationToken = null;

        try {
            LocaleContext::withLocale($user['preferred_language'] ?? null, function () use ($user, $withPasswordLink, &$invitationToken) {
                // Resolve tenant from the USER's tenant_id
                $resolvedTenant = UserTenantResolver::resolve($user);
                $userTenantId = $resolvedTenant['tenant_id'];
                $tenantName = $resolvedTenant['name'];
                $tenantNameSafe = htmlspecialchars($tenantName, ENT_QUOTES, 'UTF-8');

                // Read tenant configuration for custom welcome email content
                $tenantRow = DB::selectOne("SELECT configuration FROM tenants WHERE id = ?", [$userTenantId]);
                $config = json_decode($tenantRow->configuration ?? '{}', true);
                $welcomeConfig = $config['welcome_email'] ?? [];

                $subject = !empty($welcomeConfig['subject']) ? $welcomeConfig['subject'] : __('emails_misc.admin_actions.welcome_resend_subject', ['community' => $tenantNameSafe]);

                $firstName = htmlspecialchars($user['first_name'] ?? '', ENT_QUOTES, 'UTF-8');

                if (!empty($welcomeConfig['body'])) {
                    $mainMessage = $welcomeConfig['body'];
                } else {
                    $mainMessage = '<p>' . __('emails_misc.admin_actions.welcome_resend_greeting', ['name' => $firstName]) . '</p>'
                        . '<p>' . __('emails_misc.admin_actions.welcome_resend_body', ['community' => $tenantNameSafe]) . '</p>';
                }

                $loginLink = $resolvedTenant['frontend_url'] . $resolvedTenant['slug_prefix'] . "/login";
                $isFullHtml = stripos($mainMessage, '<!DOCTYPE') !== false || stripos($mainMessage, '<html') !== false;

                if ($withPasswordLink) {
                    $invitationToken = $this->tokens->issueInvitation($user['email'], $userTenantId);
                    $setPasswordLink = $resolvedTenant['frontend_url'] . $resolvedTenant['slug_prefix']
                        . '/password/reset?token=' . $invitationToken;
                    // A community's full-HTML welcome template has nowhere to put
                    // the link, so the standard wording is used for this member.
                    if ($isFullHtml) {
                        $mainMessage = '<p>' . __('emails_misc.admin_actions.welcome_resend_greeting', ['name' => $firstName]) . '</p>'
                            . '<p>' . __('emails_misc.admin_actions.welcome_resend_body', ['community' => $tenantNameSafe]) . '</p>';
                    }
                    $html = EmailTemplateBuilder::make()
                        ->theme('brand')
                        ->title(__('emails_misc.admin_actions.welcome_resend_title'))
                        ->paragraph($mainMessage)
                        ->paragraph(__('emails.account_invitation.expiry', ['days' => PasswordResetTokens::INVITATION_TTL_DAYS]))
                        ->button(__('emails.account_invitation.cta'), $setPasswordLink)
                        ->render();
                } elseif ($isFullHtml) {
                    $html = $mainMessage;
                } else {
                    $html = EmailTemplateBuilder::make()
                        ->theme('brand')
                        ->title(__('emails_misc.admin_actions.welcome_resend_title'))
                        ->paragraph($mainMessage)
                        ->button(__('emails_misc.admin_actions.welcome_resend_cta'), $loginLink)
                        ->render();
                }

                if (!EmailDispatchService::sendRaw($user['email'], $subject, $html, null, null, null, 'welcome', ['tenant_id' => $userTenantId])) {
                    throw new \RuntimeException('Welcome email send returned false');
                }
            });
        } catch (\Throwable $e) {
            if ($invitationToken !== null) {
                $this->tokens->revoke((string) $user['email'], (int) $user['tenant_id'], $invitationToken);
            }
            if ($e instanceof \RuntimeException) {
                throw $e;
            }
            // Same message, so a caller's log line reads exactly as before.
            throw new \RuntimeException($e->getMessage(), 0, $e);
        }
    }
}
