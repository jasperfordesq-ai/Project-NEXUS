<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Auth\Oauth;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * E-121, owner decision D2 (6 Nov 2026): a new Google account gets no photo
 * from Google; the welcome wizard asks for one, as it does for everyone.
 *
 * The Google photo used to be saved as the member's own photo — a link to
 * Google's servers. The website's security rules block Google images, so it
 * showed as a broken picture, and the wizard counted the photo as done so it
 * never asked. Showing it would also tell Google each time a profile is viewed.
 */
class ProviderSignUpPhotoTest extends TestCase
{
    use DatabaseTransactions;
    use DrivesGoogleSignIn;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        $this->enableGoogleSignIn();
        $this->seedRegistrationMode('open');
    }

    protected function tearDown(): void
    {
        $this->restoreGoogleSignIn();
        parent::tearDown();
    }

    public function test_a_new_google_account_takes_no_photo_from_google(): void
    {
        $email = 'photo.' . uniqid() . '@gmail.com';

        $this->signInWithGoogle($this->googleUser('g-photo-' . uniqid(), $email), 'register');

        $row = DB::table('users')->where('tenant_id', $this->testTenantId)->where('email', $email)->first();
        $this->assertNotNull($row, 'the account is created');
        $this->assertEmpty($row->avatar_url, 'the wizard asks for a photo, as it does for everyone');
    }
}
