<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\AI;

use App\Core\TenantContext;
use App\Models\AiSettings;
use App\Services\AI\Contracts\AIProviderInterface;
use App\Services\AI\Providers\GeminiProvider;
use App\Services\AI\Providers\OpenAIProvider;
use App\Services\AI\Providers\AnthropicProvider;
use App\Services\AI\Providers\OllamaProvider;

/**
 * AI Service Factory
 *
 * Creates and manages AI provider instances.
 * Loads configuration from both config files and database settings.
 * DATABASE SETTINGS ALWAYS TAKE PRIORITY over config/env values.
 */
class AIServiceFactory
{
    private static array $instances = [];
    private static ?array $config = null;

    /**
     * Get the default AI provider
     */
    public static function getProvider(?string $providerId = null): AIProviderInterface
    {
        $config = self::getConfig();
        $providerId = $providerId ?? self::getDefaultProvider();

        if (!isset(self::$instances[$providerId])) {
            self::$instances[$providerId] = self::createProvider($providerId);
        }

        return self::$instances[$providerId];
    }

    /**
     * Get provider with automatic fallback on failure
     *
     * Attempts the primary provider first, then falls back to alternatives
     * if the primary fails. Returns both the provider and which one was used.
     */
    public static function getProviderWithFallback(?string $preferredId = null): array
    {
        $preferredId = $preferredId ?? self::getDefaultProvider();
        $fallbackOrder = self::getFallbackOrder($preferredId);

        foreach ($fallbackOrder as $providerId) {
            try {
                $provider = self::getProvider($providerId);
                if ($provider->isConfigured()) {
                    return [
                        'provider' => $provider,
                        'provider_id' => $providerId,
                        'is_fallback' => ($providerId !== $preferredId),
                    ];
                }
            } catch (\Exception $e) {
                \Illuminate\Support\Facades\Log::warning("Provider $providerId not available: " . $e->getMessage());
                continue;
            }
        }

        // If all else fails, return the preferred provider anyway
        // Let the caller handle the error
        return [
            'provider' => self::getProvider($preferredId),
            'provider_id' => $preferredId,
            'is_fallback' => false,
        ];
    }

    /**
     * Get fallback order for providers
     *
     * Returns array of provider IDs in order of preference for fallback.
     * Starts with preferred, then configured providers, then free-tier providers.
     */
    private static function getFallbackOrder(string $preferredId): array
    {
        $config = self::getConfig();
        $providers = $config['providers'] ?? [];
        $order = [$preferredId];

        // Add other configured providers
        foreach ($providers as $id => $providerConfig) {
            if ($id === $preferredId) continue;

            try {
                $provider = self::getProvider($id);
                if ($provider->isConfigured()) {
                    // Prioritize free-tier providers in fallback
                    if (!empty($providerConfig['free_tier'])) {
                        array_splice($order, 1, 0, [$id]); // Insert after preferred
                    } else {
                        $order[] = $id;
                    }
                }
            } catch (\Exception $e) {
                continue;
            }
        }

        return array_unique($order);
    }

    /**
     * Execute a chat request with automatic fallback
     *
     * If the primary provider fails, automatically tries fallback providers.
     * Returns the response along with info about which provider was used.
     */
    public static function chatWithFallback(array $messages, array $options = [], ?string $preferredProvider = null): array
    {
        $fallbackOrder = self::getFallbackOrder($preferredProvider ?? self::getDefaultProvider());
        $lastError = null;

        foreach ($fallbackOrder as $providerId) {
            try {
                $provider = self::getProvider($providerId);
                if (!$provider->isConfigured()) {
                    continue;
                }

                $response = $provider->chat($messages, $options);
                $response['provider'] = $providerId;
                $response['used_fallback'] = ($providerId !== ($preferredProvider ?? self::getDefaultProvider()));

                return $response;
            } catch (\Exception $e) {
                $lastError = $e;
                \Illuminate\Support\Facades\Log::warning("AI Provider $providerId failed: " . $e->getMessage());

                // Check if this is a rate limit or quota error
                $message = $e->getMessage();
                if (strpos($message, '429') !== false || stripos($message, 'quota') !== false) {
                    // Rate limited - try next provider
                    continue;
                }
                if (strpos($message, '401') !== false || strpos($message, '403') !== false) {
                    // Auth error - try next provider
                    continue;
                }
                if (strpos($message, '500') !== false || strpos($message, '502') !== false || strpos($message, '503') !== false) {
                    // Server error - try next provider
                    continue;
                }

                // For other errors, still try fallback
                continue;
            }
        }

        // All providers failed
        if ($lastError) {
            throw $lastError;
        }

        throw new \Exception('No AI providers available');
    }

    /**
     * Create a provider instance
     */
    private static function createProvider(string $providerId): AIProviderInterface
    {
        $config = self::getProviderConfig($providerId);

        return match ($providerId) {
            'gemini' => new GeminiProvider($config),
            'openai' => new OpenAIProvider($config),
            'anthropic' => new AnthropicProvider($config),
            'ollama' => new OllamaProvider($config),
            default => throw new \Exception("Unknown AI provider: $providerId"),
        };
    }

    /**
     * Get configuration for a specific provider
     *
     * CRITICAL: Database settings ALWAYS override config file settings.
     * This ensures that admin-configured API keys are used in production.
     */
    public static function getProviderConfig(string $providerId): array
    {
        $config = self::getConfig();
        $providerConfig = $config['providers'][$providerId] ?? [];

        // Ensure api_url is always set for cloud providers (config file may not exist)
        if (empty($providerConfig['api_url'])) {
            $providerConfig['api_url'] = match ($providerId) {
                'openai' => 'https://api.openai.com/v1',
                'anthropic' => 'https://api.anthropic.com/v1',
                'gemini' => 'https://generativelanguage.googleapis.com/v1beta',
                default => $providerConfig['api_url'] ?? '',
            };
        }

        $tenantId = TenantContext::getId();
        $hasDbKey = false;
        $apiKeySource = 'CONFIG/ENV';

        // CRITICAL FIX: Database settings MUST override config/env settings
        if ($tenantId) {
            $dbSettings = AiSettings::getAllForTenant($tenantId);

            // Map database settings to provider config - DB VALUES TAKE PRIORITY
            switch ($providerId) {
                case 'gemini':
                    if (!empty($dbSettings['gemini_api_key'])) {
                        $providerConfig['api_key'] = $dbSettings['gemini_api_key'];
                        $hasDbKey = true;
                        $apiKeySource = 'DATABASE';
                    }
                    if (!empty($dbSettings['gemini_model'])) {
                        $providerConfig['default_model'] = $dbSettings['gemini_model'];
                    }
                    break;

                case 'openai':
                    if (!empty($dbSettings['openai_api_key'])) {
                        $providerConfig['api_key'] = $dbSettings['openai_api_key'];
                        $hasDbKey = true;
                        $apiKeySource = 'DATABASE';
                    }
                    if (!empty($dbSettings['openai_model'])) {
                        $providerConfig['default_model'] = $dbSettings['openai_model'];
                    }
                    if (!empty($dbSettings['openai_org_id'])) {
                        $providerConfig['org_id'] = $dbSettings['openai_org_id'];
                    }
                    break;

                case 'anthropic':
                    if (!empty($dbSettings['anthropic_api_key'])) {
                        $providerConfig['api_key'] = $dbSettings['anthropic_api_key'];
                        $hasDbKey = true;
                        $apiKeySource = 'DATABASE';
                    }
                    if (!empty($dbSettings['claude_model'])) {
                        $providerConfig['default_model'] = $dbSettings['claude_model'];
                    }
                    break;

                case 'ollama':
                    if (!empty($dbSettings['ollama_host'])) {
                        $providerConfig['api_url'] = $dbSettings['ollama_host'];
                    }
                    if (!empty($dbSettings['ollama_model'])) {
                        $providerConfig['default_model'] = $dbSettings['ollama_model'];
                    }
                    $providerConfig['self_hosted'] = true;
                    // Ollama doesn't need an API key
                    $hasDbKey = true;
                    $apiKeySource = 'DATABASE (self-hosted)';
                    break;
            }
        }

        // VALIDATION: Throw clear error if API key is missing (except for Ollama)
        if ($providerId !== 'ollama') {
            if (empty($providerConfig['api_key'])) {
                \Illuminate\Support\Facades\Log::warning("AI FACTORY ERROR: Provider [$providerId] has no API key configured. Check database settings and config/ai.php");
                throw new \Exception("AI Provider '$providerId' is not configured. Missing API key. Please configure it in Admin > AI Settings.");
            }
        }

        return $providerConfig;
    }

    /**
     * Get the default provider ID
     */
    public static function getDefaultProvider(): string
    {
        $tenantId = TenantContext::getId();
        if ($tenantId) {
            $dbProvider = AiSettings::get($tenantId, 'ai_provider');
            if ($dbProvider) {
                return $dbProvider;
            }
        }

        $config = self::getConfig();
        return $config['default_provider'] ?? 'gemini';
    }

    /**
     * Check if AI is enabled for the current tenant
     */
    public static function isEnabled(): bool
    {
        $tenantId = TenantContext::getId();
        if ($tenantId) {
            $enabled = AiSettings::get($tenantId, 'ai_enabled');
            if ($enabled !== null) {
                return AiSettings::parseBoolean($enabled);
            }
        }

        $config = self::getConfig();
        return $config['enabled'] ?? true;
    }

    /**
     * Check if a specific feature is enabled
     */
    public static function isFeatureEnabled(string $feature): bool
    {
        if (!self::isEnabled()) {
            return false;
        }

        $tenantId = TenantContext::getId();
        if ($tenantId) {
            $enabled = AiSettings::get($tenantId, "ai_{$feature}_enabled");
            if ($enabled !== null) {
                return AiSettings::parseBoolean($enabled);
            }
        }

        $config = self::getConfig();
        return $config['features'][$feature] ?? false;
    }

    /**
     * Get all available providers with their configuration status
     */
    public static function getAvailableProviders(): array
    {
        $config = self::getConfig();
        $providers = [];

        foreach ($config['providers'] as $id => $providerConfig) {
            try {
                $provider = self::getProvider($id);
                $configured = $provider->isConfigured();
            } catch (\Exception $e) {
                // Provider failed to instantiate (likely missing API key)
                // Mark as not configured instead of throwing error
                \Illuminate\Support\Facades\Log::warning("getAvailableProviders: Provider [$id] could not be instantiated: " . $e->getMessage());
                $configured = false;
            }

            $providers[$id] = [
                'id' => $id,
                'name' => $providerConfig['name'] ?? $id,
                'configured' => $configured,
                'free_tier' => $providerConfig['free_tier'] ?? false,
                'self_hosted' => $providerConfig['self_hosted'] ?? false,
                'models' => $providerConfig['models'] ?? [],
                'default_model' => $providerConfig['default_model'] ?? '',
            ];
        }

        return $providers;
    }

    /**
     * Get the system prompt for the assistant
     */
    public static function getSystemPrompt(): string
    {
        $tenantId = TenantContext::getId();
        if ($tenantId) {
            $customPrompt = AiSettings::get($tenantId, 'ai_system_prompt');
            if ($customPrompt) {
                return $customPrompt;
            }
        }

        $config = self::getConfig();
        return $config['system_prompt'] ?? '';
    }

    /**
     * Get user limits configuration
     */
    public static function getLimitsConfig(): array
    {
        $config = self::getConfig();
        $limits = $config['limits'] ?? [];

        $tenantId = TenantContext::getId();
        if ($tenantId) {
            $dailyLimit = AiSettings::get($tenantId, 'default_daily_limit');
            if ($dailyLimit !== null) {
                $limits['daily_limit'] = (int) $dailyLimit;
            }

            $monthlyLimit = AiSettings::get($tenantId, 'default_monthly_limit');
            if ($monthlyLimit !== null) {
                $limits['monthly_limit'] = (int) $monthlyLimit;
            }
        }

        return $limits;
    }

    /**
     * Load the AI configuration file
     */
    private static function getConfig(): array
    {
        if (self::$config === null) {
            $configPath = dirname(__DIR__, 2) . '/Config/ai.php';
            if (file_exists($configPath)) {
                self::$config = require $configPath;
            } else {
                self::$config = [
                    'enabled' => false,
                    'default_provider' => 'gemini',
                    'providers' => [],
                    'features' => [],
                    'limits' => [],
                ];
            }
        }

        return self::$config;
    }

    /**
     * Clear cached instances (useful for testing or config changes)
     */
    public static function clearCache(): void
    {
        self::$instances = [];
        self::$config = null;
    }
}
