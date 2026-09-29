<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E062;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\EmailDispatchService;
use App\Services\SocialNotificationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-317 (E-062) — SocialNotificationService::shouldSendEmail() looked the
 * member's email preference up under context_type = 'social', a value
 * notification_settings.context_type (enum global/group/thread) can never
 * hold. So it always answered "send": like, comment, reply and share emails
 * went to members who had switched notification email off.
 *
 * The fix reads the member's stored global preference — the row the settings
 * endpoint writes and NotificationDispatcher reads.
 *
 * Controls: a member who chose instant email is still emailed, and a member
 * who never chose anything keeps the long-standing default (emailed).
 */
class F317SocialEmailOptOutTest extends TestCase
{
    use DatabaseTransactions;

    /** @var object{calls: list<array{to:string,subject:string}>} */
    private object $spy;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);

        $this->spy = new class () extends EmailDispatchService {
            /** @var list<array{to:string,subject:string}> */
            public array $calls = [];

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->calls[] = ['to' => $to, 'subject' => $subject];

                return true;
            }
        };
        $this->app->instance(EmailDispatchService::class, $this->spy);
    }

    public function test_a_member_who_switched_email_off_is_not_emailed_for_likes_comments_or_shares(): void
    {
        $owner = $this->member();
        $actor = $this->member();
        $this->setGlobalFrequency($owner, 'off');

        SocialNotificationService::notifyLike((int) $owner->id, (int) $actor->id, 'post', 43170, 'F317');
        SocialNotificationService::notifyComment((int) $owner->id, (int) $actor->id, 'post', 43170, 'F317 comment');
        SocialNotificationService::notifyShare((int) $owner->id, (int) $actor->id, 'post', 43170);

        $this->assertSame([], $this->emailsTo($owner), 'no social email reaches a member whose email is off');
        $this->assertGreaterThan(
            0,
            DB::table('notifications')->where('user_id', (int) $owner->id)->count(),
            'the in-app notification is unaffected — only the email is switched off',
        );
    }

    public function test_control_a_member_who_chose_instant_email_is_still_emailed(): void
    {
        $owner = $this->member();
        $actor = $this->member();
        $this->setGlobalFrequency($owner, 'instant');

        SocialNotificationService::notifyLike((int) $owner->id, (int) $actor->id, 'post', 43171, 'F317');

        $this->assertNotSame([], $this->emailsTo($owner));
    }

    public function test_control_a_member_with_no_stored_preference_keeps_the_default(): void
    {
        $owner = $this->member();
        $actor = $this->member();

        SocialNotificationService::notifyLike((int) $owner->id, (int) $actor->id, 'post', 43172, 'F317');

        $this->assertNotSame([], $this->emailsTo($owner));
    }

    /** @return list<array{to:string,subject:string}> */
    private function emailsTo(User $user): array
    {
        return array_values(array_filter(
            $this->spy->calls,
            static fn (array $c): bool => $c['to'] === $user->email,
        ));
    }

    private function setGlobalFrequency(User $user, string $frequency): void
    {
        DB::table('notification_settings')->updateOrInsert(
            ['user_id' => (int) $user->id, 'context_type' => 'global', 'context_id' => 0],
            ['frequency' => $frequency],
        );
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }
}
