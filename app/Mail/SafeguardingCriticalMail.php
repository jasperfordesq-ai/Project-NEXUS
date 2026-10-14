<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Mail;

use Illuminate\Bus\Queueable;
use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Safeguarding critical-severity report alert.
 *
 * Sent to coordinators / users holding `safeguarding.view` when a critical
 * report is submitted. Subject and body are resolved at render time via
 * `__()` so the email renders in the active locale — callers MUST wrap the
 * `Mail::to(...)->send(...)` invocation in `LocaleContext::withLocale($recipient, ...)`
 * so each recipient receives the alert in their `preferred_language`.
 */
class SafeguardingCriticalMail extends Mailable
{
    use Queueable;
    use SerializesModels;

    /**
     * @param array<string,mixed> $report   Row data (id, category, severity,
     *                                      review_due_at, sla_hours, admin_url, …)
     * @param string              $reporter Display name of the reporter
     */
    public function __construct(
        public array $report,
        public string $reporter,
    ) {
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: (string) __('safeguarding.critical.subject'),
        );
    }

    public function content(): Content
    {
        $reviewDueAt = isset($this->report['review_due_at']) && $this->report['review_due_at'] !== null
            ? (string) $this->report['review_due_at']
            : null;

        $remaining = '—';
        if ($reviewDueAt !== null) {
            $secondsLeft = strtotime($reviewDueAt) - time();
            if ($secondsLeft > 0) {
                $hours = (int) floor($secondsLeft / 3600);
                $minutes = (int) floor(($secondsLeft % 3600) / 60);
                $remaining = sprintf('%dh %02dm', $hours, $minutes);
            } else {
                $remaining = '0h 00m';
            }
        }

        // The header names and links the community the alert belongs to, on
        // its own address (slug included when it has no domain of its own).
        $communityName = (string) (TenantContext::get()['name'] ?? config('app.name'));
        $communityUrl = rtrim(EmailTemplateBuilder::tenantUrl('/'), '/');

        return new Content(
            markdown: 'emails.safeguarding-critical',
            with: [
                'report'   => $this->report,
                'reporter' => $this->reporter,
                'remaining' => $remaining,
                'communityName' => $communityName,
                'communityUrl' => $communityUrl !== '' ? $communityUrl : (string) config('app.frontend_url'),
            ],
        );
    }
}
