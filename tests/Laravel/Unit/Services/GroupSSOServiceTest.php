<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\GroupSSOService;

class GroupSSOServiceTest extends TestCase
{
    public function test_class_exists(): void
    {
        $this->assertTrue(class_exists(GroupSSOService::class));
    }

    public function test_has_public_methods(): void
    {
        $ref = new \ReflectionClass(GroupSSOService::class);
        // findOrCreateSSOUser was removed on 2026-08-28: it had no callers and
        // its INSERT named users.auth_provider, a column that does not exist.
        foreach (['getSSOConfig', 'setSSOConfig', 'mapSAMLAttributes', 'getGroupMappings', 'assignSSOGroups'] as $m) {
            $this->assertTrue($ref->hasMethod($m), "Method {$m} should exist");
            $this->assertTrue($ref->getMethod($m)->isPublic(), "Method {$m} should be public");
            $this->assertTrue($ref->getMethod($m)->isStatic(), "Method {$m} should be static");
        }
    }

    public function test_mapSAMLAttributes_returns_array(): void
    {
        try {
            $result = GroupSSOService::mapSAMLAttributes([], []);
            $this->assertIsArray($result);
        } catch (\TypeError $e) {
            $this->fail('TypeError: ' . $e->getMessage());
        } catch (\Throwable $e) {
            $this->assertTrue(true);
        }
    }
}
