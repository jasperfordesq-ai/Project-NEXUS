<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Listeners;

use App\Events\UserRegistered;
use App\Listeners\NotifyAdminOfNewRegistration;
use App\Models\User;
use App\Services\TenantSettingsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Laravel\TestCase;

/**
 * E-121 — does the staff email say "waiting for your approval" or just "a new
 * member registered"?
 *
 * The listener decided from the community's approval setting, because during a
 * form sign-up the account row is still being settled. A provider sign-up
 * (Google, SSO) fires UserRegistered after its account is committed, and waits
 * according to the registration mode, which need not match that setting. Such
 * a caller now says whether the member is waiting; when it does, that wins.
 */
class NewRegistrationApprovalWordingTest extends TestCase
{
    use DatabaseTransactions;

    private function setApprovalSetting(bool $required): void
    {
        $settings = app(TenantSettingsService::class);
        foreach (['admin_approval', 'general.admin_approval'] as $key) {
            $settings->set($this->testTenantId, $key, $required ? 'true' : 'false', 'boolean');
        }
        $settings->clearCacheForTenant($this->testTenantId);
    }

    private function event(?bool $awaitingApproval): UserRegistered
    {
        $user = new User();
        $user->id = 501;

        return new UserRegistered($user, $this->testTenantId, null, $awaitingApproval);
    }

    public function test_a_member_the_caller_says_is_waiting_is_reported_as_waiting(): void
    {
        $this->setApprovalSetting(false);

        $this->assertTrue(NotifyAdminOfNewRegistration::needsApprovalFor($this->event(true)));
    }

    public function test_a_member_the_caller_says_is_in_is_reported_as_registered(): void
    {
        $this->setApprovalSetting(true);

        $this->assertFalse(NotifyAdminOfNewRegistration::needsApprovalFor($this->event(false)));
    }

    public function test_without_a_word_from_the_caller_the_community_setting_decides(): void
    {
        $this->setApprovalSetting(true);
        $this->assertTrue(NotifyAdminOfNewRegistration::needsApprovalFor($this->event(null)));

        $this->setApprovalSetting(false);
        $this->assertFalse(NotifyAdminOfNewRegistration::needsApprovalFor($this->event(null)));
    }
}
