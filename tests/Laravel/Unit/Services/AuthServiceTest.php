<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\AuthService;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Mockery;

class AuthServiceTest extends TestCase
{
    private AuthService $service;
    private $mockUser;

    protected function setUp(): void
    {
        parent::setUp();
        $this->mockUser = Mockery::mock(User::class);
        $this->service = new AuthService($this->mockUser);
    }

    public function test_login_returns_null_when_user_not_found(): void
    {
        $mockQuery = Mockery::mock();
        $mockQuery->shouldReceive('where')->andReturnSelf();
        $mockQuery->shouldReceive('first')->andReturnNull();

        $this->mockUser->shouldReceive('newQuery')->andReturn($mockQuery);

        $result = $this->service->login('nobody@test.com', 'password');
        $this->assertNull($result);
    }

    public function test_login_returns_null_when_password_incorrect(): void
    {
        // Create a real-ish user object with password set
        $fakeUser = new \stdClass();
        $fakeUser->id = 1;
        $fakeUser->password = Hash::make('correct_password');

        $mockQuery = Mockery::mock();
        $mockQuery->shouldReceive('where')->andReturnSelf();
        $mockQuery->shouldReceive('first')->andReturn($fakeUser);

        $this->mockUser->shouldReceive('newQuery')->andReturn($mockQuery);

        $result = $this->service->login('user@test.com', 'wrong_password');
        $this->assertNull($result);
    }

    // The login() success path (token issuance) is covered against a real DB by
    // tests/Laravel/Feature/Services/AuthServiceTest::test_login_returns_user_and_token_on_valid_credentials
    // and at the live controller layer by AuthControllerTest::test_login_returns_token_and_user_on_valid_credentials.
    // The previous markTestIncomplete stub here asserted nothing and is removed as redundant theatre.

    public function test_logout_returns_true_when_token_deleted(): void
    {
        DB::shouldReceive('table')->with('api_tokens')->andReturnSelf();
        DB::shouldReceive('join')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('delete')->andReturn(1);

        $result = $this->service->logout('some-token');
        $this->assertTrue($result);
    }

    public function test_logout_returns_false_when_token_not_found(): void
    {
        DB::shouldReceive('table')->with('api_tokens')->andReturnSelf();
        DB::shouldReceive('join')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('delete')->andReturn(0);

        $result = $this->service->logout('invalid-token');
        $this->assertFalse($result);
    }

    public function test_validateToken_returns_null_when_token_invalid(): void
    {
        DB::shouldReceive('table')->with('api_tokens')->andReturnSelf();
        DB::shouldReceive('join')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('select')->andReturnSelf();
        DB::shouldReceive('first')->andReturnNull();

        $result = $this->service->validateToken('bad-token');
        $this->assertNull($result);
    }

}
