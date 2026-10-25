<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\Safeguarding;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\TenantSafeguardingOption;
use App\Models\User;
use App\Models\UserSafeguardingPreference;
use App\Services\EmailDispatchService;
use App\Services\SafeguardingEffectsService;
use App\Support\UserDisplayName;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Emails a member about their own safeguarding choices.
 *
 *  - summary: "your safety choices and what they do". Sent after a member
 *    saves or changes their choices, and once as a catch-up to members who
 *    chose before it existed. The paragraphs come from
 *    SafeguardingEffectsService, i.e. from the triggers that are actually
 *    enforced, so the email cannot describe a protection the platform does
 *    not apply. Not re-sent when nothing about the member's choices changed.
 *  - vetted notice: a one-off apology and explanation to members who chose
 *    "only vetted members may contact me" before 25 Oct 2026, when its
 *    wording hid that it blocked all contact from anyone without
 *    community-recorded vetting.
 *
 * Each email is rendered in the member's own language, sent to that member
 * alone (the list of who holds a safeguarding choice is itself safeguarding
 * information), and recorded in safeguarding_member_emails.
 */
class SafeguardingChoicesEmail
{
    public const KIND_SUMMARY = 'choices_summary';
    public const KIND_VETTED_NOTICE = 'vetted_option_notice';

    public function __construct(
        private readonly EmailDispatchService $mailer,
        private readonly SafeguardingEffectsService $effects,
    ) {}

    /**
     * @return 'sent'|'would_send'|'unchanged'|'nothing_selected'|'member_unavailable'|'failed'
     */
    public function sendSummary(int $tenantId, int $userId, bool $dryRun = false): string
    {
        return TenantContext::runForTenant($tenantId, function () use ($tenantId, $userId, $dryRun): string {
            $member = $this->member($tenantId, $userId);
            if ($member === null) {
                return 'member_unavailable';
            }
            $selections = $this->selections($tenantId, $userId);
            if ($selections === []) {
                return 'nothing_selected';
            }

            $fingerprint = $this->fingerprint($tenantId, $selections);
            $last = DB::table('safeguarding_member_emails')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->where('kind', self::KIND_SUMMARY)
                ->orderByDesc('id')
                ->value('fingerprint');
            if ($last === $fingerprint) {
                return 'unchanged';
            }
            if ($dryRun) {
                return 'would_send';
            }

            $sent = (bool) LocaleContext::withLocale($member, function () use ($member, $tenantId, $selections): bool {
                $community = $this->communityName($tenantId);
                $lines = $this->effects->describe($tenantId, $selections);
                $hasVetted = in_array('vetted_only', array_column($lines, 'key'), true);

                $builder = EmailTemplateBuilder::make()
                    ->title(__('emails_misc.safeguarding_choices.summary_title'))
                    ->previewText(__('emails_misc.safeguarding_choices.summary_preview'))
                    ->greeting($this->greetingName($member))
                    ->paragraph(__('emails_misc.safeguarding_choices.summary_intro', ['community' => $community]))
                    ->bulletList(
                        // Localised here, inside the member's language, not where
                        // the selections were read.
                        array_map(fn (array $s): string => $this->escape((string) TenantSafeguardingOption::localizeOptionText(
                            $s['preset_source'],
                            $s['option_key'],
                            'label',
                            $s['raw_label'],
                        )), $selections),
                        __('emails_misc.safeguarding_choices.chosen_heading'),
                    )
                    ->bulletList(
                        array_map(fn (array $line): string => $this->escape($line['text']), $lines),
                        __('emails_misc.safeguarding_choices.effects_heading'),
                    );
                if ($hasVetted) {
                    $builder->highlight(__('emails_misc.safeguarding_choices.vetting_context'));
                }
                $builder
                    ->paragraph(__('emails_misc.safeguarding_choices.who_can_see'))
                    ->paragraph(__('emails_misc.safeguarding_choices.in_control'))
                    ->button(
                        __('emails_misc.safeguarding_choices.summary_cta'),
                        EmailTemplateBuilder::tenantUrl('/settings?tab=safeguarding'),
                    )
                    ->paragraph(__('emails_misc.safeguarding_choices.signoff', ['community' => $community]));

                return $this->deliver(
                    $member,
                    $tenantId,
                    __('emails_misc.safeguarding_choices.summary_subject', ['community' => $community]),
                    $builder->render(),
                    self::KIND_SUMMARY,
                );
            });

            if ($sent) {
                $this->record($tenantId, $userId, self::KIND_SUMMARY, $fingerprint);
            }

            return $sent ? 'sent' : 'failed';
        });
    }

    /**
     * @return 'sent'|'would_send'|'already_sent'|'not_held'|'member_unavailable'|'failed'
     */
    public function sendVettedOptionNotice(int $tenantId, int $userId, bool $dryRun = false): string
    {
        return TenantContext::runForTenant($tenantId, function () use ($tenantId, $userId, $dryRun): string {
            $member = $this->member($tenantId, $userId);
            if ($member === null) {
                return 'member_unavailable';
            }
            if (! in_array('requires_vetted_partners', array_column($this->selections($tenantId, $userId), 'option_key'), true)) {
                return 'not_held';
            }
            $already = DB::table('safeguarding_member_emails')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->where('kind', self::KIND_VETTED_NOTICE)
                ->exists();
            if ($already) {
                return 'already_sent';
            }
            if ($dryRun) {
                return 'would_send';
            }

            $sent = (bool) LocaleContext::withLocale($member, function () use ($member, $tenantId): bool {
                $community = $this->communityName($tenantId);
                $countLine = array_values(array_filter(
                    $this->effects->describe($tenantId, [[
                        'option_key' => 'requires_vetted_partners',
                        'triggers' => ['requires_vetted_interaction' => true, 'vetting_type_required' => $this->vettingCode($tenantId)],
                    ]]),
                    static fn (array $line): bool => $line['key'] === 'vetted_count',
                ));

                $builder = EmailTemplateBuilder::make()
                    ->title(__('emails_misc.safeguarding_choices.notice_title'))
                    ->previewText(__('emails_misc.safeguarding_choices.notice_preview'))
                    ->greeting($this->greetingName($member))
                    ->paragraph(__('emails_misc.safeguarding_choices.notice_thanks', ['community' => $community]))
                    ->paragraph(__('emails_misc.safeguarding_choices.notice_honest'))
                    ->paragraph('<strong>' . __('emails_misc.safeguarding_choices.notice_what_heading') . '</strong>')
                    ->paragraph(__('emails_misc.safeguarding_choices.notice_vetting_fact', ['community' => $community]));
                if ($countLine !== []) {
                    $builder->paragraph($this->escape($countLine[0]['text']));
                }
                $builder
                    ->bulletList([
                        __('emails_misc.safeguarding_choices.notice_blocked_message'),
                        __('emails_misc.safeguarding_choices.notice_blocked_credits'),
                        __('emails_misc.safeguarding_choices.notice_blocked_groups'),
                    ], __('emails_misc.safeguarding_choices.notice_blocked_heading'))
                    ->paragraph(__('emails_misc.safeguarding_choices.notice_sorry'))
                    ->paragraph('<strong>' . __('emails_misc.safeguarding_choices.notice_changed_heading') . '</strong>')
                    ->paragraph(__('emails_misc.safeguarding_choices.notice_changed'))
                    ->bulletList([
                        // Quotes the settings button by its own translation, so
                        // the email and the screen always say the same words.
                        __('emails_misc.safeguarding_choices.notice_option_switch', [
                            'button' => $this->escape((string) __('safeguarding.settings.switch_button')),
                        ]),
                        __('emails_misc.safeguarding_choices.notice_option_keep'),
                        __('emails_misc.safeguarding_choices.notice_option_talk'),
                    ], __('emails_misc.safeguarding_choices.notice_options_heading'))
                    ->button(
                        __('emails_misc.safeguarding_choices.notice_cta'),
                        EmailTemplateBuilder::tenantUrl('/settings?tab=safeguarding'),
                    )
                    ->paragraph(__('emails_misc.safeguarding_choices.who_can_see'))
                    ->paragraph(__('emails_misc.safeguarding_choices.signoff', ['community' => $community]));

                return $this->deliver(
                    $member,
                    $tenantId,
                    __('emails_misc.safeguarding_choices.notice_subject', ['community' => $community]),
                    $builder->render(),
                    self::KIND_VETTED_NOTICE,
                );
            });

            if ($sent) {
                $this->record($tenantId, $userId, self::KIND_VETTED_NOTICE, null);
            }

            return $sent ? 'sent' : 'failed';
        });
    }

    /**
     * The member's live, affirmative choices other than "none of these apply".
     *
     * @return list<array{option_key: string, triggers: array<string, mixed>, raw_label: string|null, preset_source: string|null}>
     */
    private function selections(int $tenantId, int $userId): array
    {
        $rows = DB::table('user_safeguarding_preferences as p')
            ->join('tenant_safeguarding_options as o', function ($join) use ($tenantId): void {
                $join->on('o.id', '=', 'p.option_id')->where('o.tenant_id', $tenantId)->where('o.is_active', 1);
            })
            ->where('p.tenant_id', $tenantId)
            ->where('p.user_id', $userId)
            ->whereNull('p.revoked_at')
            ->where('o.option_key', '!=', 'none_apply')
            ->orderBy('o.sort_order')
            ->get(['p.selected_value', 'o.option_type', 'o.option_key', 'o.triggers', 'o.label', 'o.preset_source']);

        $selections = [];
        foreach ($rows as $row) {
            if (! UserSafeguardingPreference::isEffectivelySelected($row->option_type, $row->selected_value)) {
                continue;
            }
            $triggers = is_string($row->triggers) ? json_decode($row->triggers, true) : (array) $row->triggers;
            $selections[] = [
                'option_key' => (string) $row->option_key,
                'triggers' => is_array($triggers) ? $triggers : [],
                'raw_label' => $row->label !== null ? (string) $row->label : null,
                'preset_source' => $row->preset_source !== null ? (string) $row->preset_source : null,
            ];
        }

        return $selections;
    }

    /**
     * Identity of what the member chose and what it does — not the live
     * vetted-member count, so a new vetting record does not re-send.
     *
     * @param list<array{option_key: string, triggers: array<string, mixed>, raw_label: string|null, preset_source: string|null}> $selections
     */
    private function fingerprint(int $tenantId, array $selections): string
    {
        $optionKeys = array_column($selections, 'option_key');
        sort($optionKeys);
        $effectKeys = array_values(array_diff(
            array_column($this->effects->describe($tenantId, $selections), 'key'),
            ['vetted_count'],
        ));
        sort($effectKeys);

        return hash('sha256', json_encode([$optionKeys, $effectKeys]));
    }

    private function member(int $tenantId, int $userId): ?User
    {
        $member = User::withoutGlobalScopes()
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->first(['id', 'tenant_id', 'email', 'first_name', 'last_name', 'name', 'profile_type', 'organization_name', 'preferred_language']);

        return $member !== null && trim((string) $member->email) !== '' ? $member : null;
    }

    private function deliver(User $member, int $tenantId, string $subject, string $html, string $kind): bool
    {
        try {
            return $this->mailer->send((string) $member->email, $subject, $html, [
                'category' => 'safeguarding',
                'tenant_id' => $tenantId,
                'source' => 'SafeguardingChoicesEmail::' . $kind,
            ]);
        } catch (\Throwable $e) {
            Log::error('SafeguardingChoicesEmail: send failed', [
                'tenant_id' => $tenantId,
                'user_id' => $member->id,
                'kind' => $kind,
                'exception_class' => $e::class,
            ]);

            return false;
        }
    }

    private function record(int $tenantId, int $userId, string $kind, ?string $fingerprint): void
    {
        DB::table('safeguarding_member_emails')->insert([
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'kind' => $kind,
            'fingerprint' => $fingerprint,
            'sent_at' => now(),
        ]);
    }

    private function vettingCode(int $tenantId): string
    {
        $raw = DB::table('tenant_safeguarding_options')
            ->where('tenant_id', $tenantId)
            ->where('option_key', 'requires_vetted_partners')
            ->value('triggers');
        $triggers = is_string($raw) ? json_decode($raw, true) : null;
        $code = is_array($triggers) ? ($triggers['vetting_type_required'] ?? null) : null;

        return is_string($code) ? $code : '';
    }

    private function communityName(int $tenantId): string
    {
        return $this->escape((string) (DB::table('tenants')->where('id', $tenantId)->value('name') ?? ''));
    }

    private function greetingName(User $member): string
    {
        return $this->escape(UserDisplayName::resolve($member));
    }

    private function escape(string $text): string
    {
        return htmlspecialchars($text, ENT_QUOTES, 'UTF-8');
    }
}
