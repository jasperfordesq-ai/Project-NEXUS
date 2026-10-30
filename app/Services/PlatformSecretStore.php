<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Platform-wide secrets (table `platform_secrets`), encrypted at rest with the
 * application key and set only by a global super admin. Values are read on the
 * server; no endpoint returns one to a browser, only whether it is set.
 */
class PlatformSecretStore
{
    /** The fallback Google Cloud Translation API key (owner, 30 Oct 2026). */
    public const GOOGLE_TRANSLATE_KEY = 'google_translate_api_key';

    public function get(string $name): ?string
    {
        try {
            $encrypted = DB::table('platform_secrets')->where('name', $name)->value('value');
            if (!is_string($encrypted) || $encrypted === '') {
                return null;
            }
            $value = Crypt::decryptString($encrypted);

            return $value === '' ? null : $value;
        } catch (\Throwable $e) {
            Log::error('PlatformSecretStore: could not read a platform secret', ['name' => $name, 'error' => $e->getMessage()]);
            return null;
        }
    }

    public function has(string $name): bool
    {
        return $this->get($name) !== null;
    }

    public function set(string $name, string $value, ?int $updatedBy = null): void
    {
        DB::table('platform_secrets')->updateOrInsert(
            ['name' => $name],
            ['value' => Crypt::encryptString($value), 'updated_by' => $updatedBy, 'updated_at' => now(), 'created_at' => now()],
        );
    }

    public function forget(string $name): void
    {
        DB::table('platform_secrets')->where('name', $name)->delete();
    }
}
