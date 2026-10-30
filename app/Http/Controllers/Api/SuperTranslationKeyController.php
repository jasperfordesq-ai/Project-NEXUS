<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Models\ActivityLog;
use App\Services\PlatformSecretStore;
use App\Services\Translation\TranslationEngine;
use Illuminate\Http\JsonResponse;

/**
 * Super admin → Translation: the platform's fallback Google Cloud Translation
 * key, used by every community that has not saved its own (owner, 30 Oct 2026).
 * Global super admins and god only (the `super-admin` route group refuses
 * tenant super admins; requirePlatformSuperAdmin() checks again). The key is
 * stored encrypted and never returned — only whether it is set.
 */
class SuperTranslationKeyController extends BaseApiController
{
    public function __construct(private readonly PlatformSecretStore $secrets)
    {
    }

    /** GET /api/v2/admin/super/translation/google-key */
    public function show(): JsonResponse
    {
        $this->requirePlatformSuperAdmin();

        return $this->respondWithData($this->status());
    }

    /** PUT /api/v2/admin/super/translation/google-key  { api_key } */
    public function update(): JsonResponse
    {
        $userId = $this->requirePlatformSuperAdmin();
        $key = trim((string) $this->input('api_key', ''));
        if ($key === '' || strlen($key) < 20 || strlen($key) > 200 || preg_match('/\s/', $key) === 1) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.translation_google_key_invalid'), 'api_key', 422);
        }

        $this->secrets->set(PlatformSecretStore::GOOGLE_TRANSLATE_KEY, $key, $userId);
        ActivityLog::log($userId, 'super_translation_google_key_set', 'Saved the platform Google Translate key');

        return $this->respondWithData($this->status());
    }

    /** DELETE /api/v2/admin/super/translation/google-key */
    public function destroy(): JsonResponse
    {
        $userId = $this->requirePlatformSuperAdmin();
        $this->secrets->forget(PlatformSecretStore::GOOGLE_TRANSLATE_KEY);
        ActivityLog::log($userId, 'super_translation_google_key_removed', 'Removed the platform Google Translate key');

        return $this->respondWithData($this->status());
    }

    /** @return array{platform_key_set: bool, environment_key_set: bool} */
    private function status(): array
    {
        $env = config('services.google_translate.api_key');

        return [
            'platform_key_set' => $this->secrets->has(PlatformSecretStore::GOOGLE_TRANSLATE_KEY),
            // The GOOGLE_TRANSLATE_API_KEY server setting, used only when no key is saved here.
            'environment_key_set' => is_string($env) && $env !== '',
            'effective' => TranslationEngine::platformGoogleKey() !== null,
        ];
    }
}
