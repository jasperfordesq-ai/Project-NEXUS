<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\Translation;

use App\Core\TenantContext;
use App\Models\AiSettings;
use App\Services\AI\AiUsageGate;
use App\Services\PlatformSecretStore;
use App\Services\TranscriptionService;
use App\Services\TranslationConfigurationService;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Which service translates for the current community, with which key.
 *
 * Owner decision, 30 Oct 2026:
 *  - Google Translate is every community's default. It uses the community's
 *    own Google key when one is saved (Admin → Translation settings), otherwise
 *    the platform's fallback key (Super admin → Translation), otherwise the
 *    GOOGLE_TRANSLATE_API_KEY environment variable.
 *  - AI translation ("ai") is a community's choice. It uses only the
 *    community's OWN OpenAI key from Admin → AI settings — never the platform's
 *    key — and only while the community's AI is switched on. Without both it
 *    falls back to Google.
 *
 * Until now every translation went to OpenAI on the platform's key and only
 * when the community's AI was on; the engine setting was read by nothing.
 */
class TranslationEngine
{
    public const ENGINE_GOOGLE = 'google';
    public const ENGINE_AI = 'ai';

    /** tenant_settings key for a community's own Google key (encrypted). */
    public const COMMUNITY_GOOGLE_KEY_SETTING = 'translation.google_api_key';

    /**
     * The engine and key that would be used now, or null when no engine is
     * available (no Google key anywhere and no usable AI).
     *
     * @return array{engine: string, key: string, key_source: string}|null
     */
    public static function resolve(): ?array
    {
        $tenantId = (int) TenantContext::getId();

        if (self::chosenEngine() === self::ENGINE_AI) {
            $ownAiKey = $tenantId > 0 ? AiSettings::get($tenantId, 'openai_api_key') : null;
            if (is_string($ownAiKey) && $ownAiKey !== '' && AiUsageGate::aiEnabled()) {
                return ['engine' => self::ENGINE_AI, 'key' => $ownAiKey, 'key_source' => 'community'];
            }
        }

        $community = self::communityGoogleKey();
        if ($community !== null) {
            return ['engine' => self::ENGINE_GOOGLE, 'key' => $community, 'key_source' => 'community'];
        }
        $platform = self::platformGoogleKey();
        if ($platform !== null) {
            return ['engine' => self::ENGINE_GOOGLE, 'key' => $platform, 'key_source' => 'platform'];
        }

        return null;
    }

    public static function available(): bool
    {
        return self::resolve() !== null;
    }

    /** True when the next translation would use the community's AI (and its AI budget). */
    public static function usesAi(): bool
    {
        return (self::resolve()['engine'] ?? null) === self::ENGINE_AI;
    }

    /**
     * Translate with the resolved engine. Context and glossary help the AI;
     * Google's Basic edition has no use for them.
     */
    public static function translate(
        string $text,
        string $fromLanguage,
        string $toLanguage,
        array $conversationContext = [],
        array $glossary = [],
    ): ?string {
        $resolved = self::resolve();
        if ($resolved === null) {
            return null;
        }
        if (trim($text) === '') {
            return '';
        }

        if ($resolved['engine'] === self::ENGINE_AI) {
            return TranscriptionService::translate($text, $fromLanguage, $toLanguage, $conversationContext, $glossary, $resolved['key']);
        }

        return app(GoogleTranslateClient::class)->translate($text, $fromLanguage, $toLanguage, $resolved['key']);
    }

    /** "google" or "ai". Older stored values: "openai" means ai; "deepl" was never built. */
    public static function chosenEngine(): string
    {
        $value = strtolower((string) TranslationConfigurationService::get(TranslationConfigurationService::CONFIG_ENGINE, self::ENGINE_GOOGLE));

        return in_array($value, [self::ENGINE_AI, 'openai'], true) ? self::ENGINE_AI : self::ENGINE_GOOGLE;
    }

    public static function communityGoogleKey(): ?string
    {
        $tenantId = (int) TenantContext::getId();
        if ($tenantId < 1) {
            return null;
        }
        try {
            $encrypted = DB::table('tenant_settings')->where('tenant_id', $tenantId)
                ->where('setting_key', self::COMMUNITY_GOOGLE_KEY_SETTING)->value('setting_value');
            if (!is_string($encrypted) || $encrypted === '') {
                return null;
            }
            $key = Crypt::decryptString($encrypted);

            return $key === '' ? null : $key;
        } catch (\Throwable $e) {
            Log::error('TranslationEngine: could not read the community Google key', ['tenant_id' => $tenantId, 'error' => $e->getMessage()]);
            return null;
        }
    }

    public static function setCommunityGoogleKey(?string $key): void
    {
        $tenantId = (int) TenantContext::getId();
        $key = $key === null ? '' : trim($key);
        if ($key === '') {
            DB::table('tenant_settings')->where('tenant_id', $tenantId)->where('setting_key', self::COMMUNITY_GOOGLE_KEY_SETTING)->delete();
            return;
        }
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $tenantId, 'setting_key' => self::COMMUNITY_GOOGLE_KEY_SETTING],
            ['setting_value' => Crypt::encryptString($key), 'setting_type' => 'string', 'updated_at' => now()],
        );
    }

    public static function platformGoogleKey(): ?string
    {
        $stored = app(PlatformSecretStore::class)->get(PlatformSecretStore::GOOGLE_TRANSLATE_KEY);
        if ($stored !== null) {
            return $stored;
        }
        $env = config('services.google_translate.api_key');

        return is_string($env) && $env !== '' ? $env : null;
    }

    /**
     * What an admin may see: which keys exist and which one is in use. Never
     * the key itself.
     *
     * @return array{engine: string, community_key_set: bool, platform_key_set: bool, in_use: string|null, own_ai_key_set: bool, ai_enabled: bool}
     */
    public static function adminStatus(): array
    {
        $tenantId = (int) TenantContext::getId();
        $resolved = self::resolve();

        return [
            'engine' => self::chosenEngine(),
            'community_key_set' => self::communityGoogleKey() !== null,
            'platform_key_set' => self::platformGoogleKey() !== null,
            // 'community' | 'platform' (Google), 'ai' (own AI key), or null (nothing works)
            'in_use' => $resolved === null ? null : ($resolved['engine'] === self::ENGINE_AI ? 'ai' : $resolved['key_source']),
            'own_ai_key_set' => $tenantId > 0 && AiSettings::has($tenantId, 'openai_api_key'),
            'ai_enabled' => AiUsageGate::aiEnabled(),
        ];
    }
}
