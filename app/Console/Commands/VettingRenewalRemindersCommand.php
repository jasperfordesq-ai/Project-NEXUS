<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Console\Commands;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Services\EmailDispatchService;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

class VettingRenewalRemindersCommand extends Command
{
    protected $signature = 'safeguarding:vetting-renewals {--dry-run : Report due notifications without sending or stamping them}';
    protected $description = 'Notify active brokers and administrators before safeguarding confirmations require renewal and after they expire.';

    public function handle(): int
    {
        $today = CarbonImmutable::today();
        $rows = DB::table('member_vetting_attestations as a')
            ->join('users as member', function ($join): void {
                $join->on('member.id', '=', 'a.user_id')
                    ->whereNotIn('member.status', ['deleted', 'deactivated']);
            })
            ->join('tenants as tenant', 'tenant.id', '=', 'a.tenant_id')
            ->where('a.decision', 'confirmed')
            ->whereNull('a.revoked_at')
            ->where(function ($query) use ($today): void {
                $query->whereBetween('a.review_due_at', [$today->toDateString(), $today->addDays(90)->toDateString()])
                    ->orWhere('a.review_due_at', '<', $today->toDateString())
                    ->orWhereBetween('a.authority_expires_at', [$today->toDateString(), $today->addDays(90)->toDateString()])
                    ->orWhere('a.authority_expires_at', '<', $today->toDateString());
            })
            ->select([
                'a.id', 'a.tenant_id', 'a.user_id', 'a.certification_codes',
                'a.review_due_at', 'a.authority_expires_at',
                'a.renewal_reminder_90_sent_at', 'a.renewal_reminder_30_sent_at',
                'a.renewal_reminder_7_sent_at', 'a.renewal_due_notified_at',
                'a.expiry_notified_at',
                'member.first_name', 'member.last_name', 'member.profile_type', 'member.organization_name', 'member.name as display_name',
                'tenant.name as community_name',
            ])
            ->orderBy('a.tenant_id')
            ->orderBy('a.id')
            ->get();

        $sent = 0;
        foreach ($rows as $row) {
            $notification = $this->notificationDue($row, $today);
            if ($notification === null) {
                continue;
            }
            if ($this->option('dry-run')) {
                $sent++;
                continue;
            }

            try {
                if (! $this->notifyStaff($row, $notification)) {
                    continue;
                }
                DB::table('member_vetting_attestations')
                    ->where('id', (int) $row->id)
                    ->where('tenant_id', (int) $row->tenant_id)
                    ->update([
                        $notification['stamp_column'] => now(),
                        'updated_at' => now(),
                    ]);
                $sent++;
            } catch (\Throwable $e) {
                Log::error('Vetting renewal notification failed', [
                    'attestation_id' => (int) $row->id,
                    'tenant_id' => (int) $row->tenant_id,
                    'exception_class' => $e::class,
                ]);
            }
        }

        $this->info(sprintf('%s: %d vetting renewal notification%s.',
            $this->option('dry-run') ? 'DRY RUN' : 'Done',
            $sent,
            $sent === 1 ? '' : 's',
        ));

        return self::SUCCESS;
    }

    /** @return array{kind: string, days: int, due_date: string, stamp_column: string}|null */
    private function notificationDue(object $row, CarbonImmutable $today): ?array
    {
        $dates = array_values(array_filter([
            $this->dateValue($row->review_due_at ?? null),
            $this->dateValue($row->authority_expires_at ?? null),
        ]));
        if ($dates === []) {
            return null;
        }

        usort($dates, static fn (CarbonImmutable $left, CarbonImmutable $right): int => $left->timestamp <=> $right->timestamp);
        $due = $dates[0];
        $days = (int) $today->diffInDays($due, false);

        if ($days < 0 && $row->expiry_notified_at === null) {
            return ['kind' => 'expired', 'days' => abs($days), 'due_date' => $due->toDateString(), 'stamp_column' => 'expiry_notified_at'];
        }
        if ($days === 0 && $row->renewal_due_notified_at === null) {
            return ['kind' => 'due', 'days' => 0, 'due_date' => $due->toDateString(), 'stamp_column' => 'renewal_due_notified_at'];
        }
        if ($days > 0 && $days <= 7 && $row->renewal_reminder_7_sent_at === null) {
            return ['kind' => 'reminder', 'days' => $days, 'due_date' => $due->toDateString(), 'stamp_column' => 'renewal_reminder_7_sent_at'];
        }
        if ($days > 7 && $days <= 30 && $row->renewal_reminder_30_sent_at === null) {
            return ['kind' => 'reminder', 'days' => $days, 'due_date' => $due->toDateString(), 'stamp_column' => 'renewal_reminder_30_sent_at'];
        }
        if ($days > 30 && $days <= 90 && $row->renewal_reminder_90_sent_at === null) {
            return ['kind' => 'reminder', 'days' => $days, 'due_date' => $due->toDateString(), 'stamp_column' => 'renewal_reminder_90_sent_at'];
        }

        return null;
    }

    /** @param array{kind: string, days: int, due_date: string, stamp_column: string} $notification */
    private function notifyStaff(object $row, array $notification): bool
    {
        $staff = DB::table('users')
            ->where('tenant_id', (int) $row->tenant_id)
            ->where(function ($query): void {
                $query->whereIn('role', ['admin', 'tenant_admin', 'broker', 'super_admin', 'god'])
                    ->orWhere('is_admin', 1)
                    ->orWhere('is_tenant_super_admin', 1)
                    ->orWhere('is_super_admin', 1)
                    ->orWhere('is_god', 1);
            })
            ->where('status', 'active')
            ->get(['id', 'email', 'preferred_language']);
        if ($staff->isEmpty()) {
            return false;
        }

        $memberName = UserDisplayName::resolve($row)
            ?: (string) ($row->display_name ?? '');
        $safeMemberName = htmlspecialchars($memberName, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $safeCommunityName = htmlspecialchars((string) $row->community_name, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $previousTenantId = TenantContext::currentId();
        $delivered = false;
        try {
            TenantContext::setById((int) $row->tenant_id);
            foreach ($staff as $recipient) {
                LocaleContext::withLocale($recipient, function () use ($recipient, $row, $notification, $memberName, $safeMemberName, $safeCommunityName, &$delivered): void {
                    $key = $notification['kind'] === 'expired' ? 'expired' : 'renewal';
                    $subject = __("emails.vetting_{$key}.subject", ['name' => $memberName]);
                    $body = __("emails.vetting_{$key}.body", [
                        'name' => $safeMemberName,
                        'date' => $notification['due_date'],
                        'days' => $notification['days'],
                        'community' => $safeCommunityName,
                    ]);
                    $html = EmailTemplateBuilder::make()
                        ->theme($notification['kind'] === 'expired' ? 'warning' : 'info')
                        ->title(__("emails.vetting_{$key}.title"))
                        ->paragraph($body)
                        ->button(__('emails.vetting.review_action'), EmailTemplateBuilder::tenantUrl('/broker/vetting'))
                        ->render();

                    try {
                        Notification::createNotification(
                            (int) $recipient->id,
                            __("svc_notifications.vetting_{$key}", ['name' => $memberName]),
                            '/broker/vetting',
                            "vetting_{$key}",
                            true,
                            (int) $row->tenant_id,
                        );
                        $delivered = true;
                    } catch (\Throwable $e) {
                        Log::warning('Vetting renewal bell failed', [
                            'recipient_id' => (int) $recipient->id,
                            'exception_class' => $e::class,
                        ]);
                    }

                    if (is_string($recipient->email) && $recipient->email !== '') {
                        $delivered = EmailDispatchService::sendWithOptions(
                            $recipient->email,
                            $subject,
                            $html,
                            ['category' => 'safeguarding_vetting', 'tenant_id' => (int) $row->tenant_id],
                        ) || $delivered;
                    }
                });
            }
        } finally {
            if ($previousTenantId !== null) {
                TenantContext::setById($previousTenantId);
            } else {
                TenantContext::reset();
            }
        }

        return $delivered;
    }

    private function dateValue(mixed $value): ?CarbonImmutable
    {
        return is_string($value) && $value !== ''
            ? CarbonImmutable::parse(substr($value, 0, 10))->startOfDay()
            : null;
    }
}
