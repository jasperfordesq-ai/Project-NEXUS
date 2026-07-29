<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Global Helper Functions
 *
 * This file contains global helper functions used throughout the application.
 */

if (!function_exists('webp_image')) {
    /**
     * Generate optimized image HTML with WebP support
     *
     * Returns a <picture> tag with WebP source and fallback for browsers
     * that don't support WebP. Automatically adds lazy loading.
     *
     * @param string $imagePath Original image path (e.g., "/uploads/photo.jpg")
     * @param string $alt Alt text for accessibility
     * @param string $class CSS classes to apply to the img element
     * @param array $attributes Additional HTML attributes (width, height, etc.)
     * @return string HTML <picture> tag or <img> tag if WebP doesn't exist
     *
     * @example
     * // Basic usage
     * <?= webp_image($post->image_url, $post->title) ?>
     *
     * // With CSS class
     * <?= webp_image($user->avatar, $user->name, 'avatar rounded-full') ?>
     *
     * // With additional attributes
     * <?= webp_image($image, 'Photo', 'hero-img', ['width' => 800, 'height' => 600]) ?>
     */
    function webp_image(string $imagePath, string $alt = '', string $class = '', array $attributes = []): string
    {
        return \App\Helpers\ImageHelper::webp($imagePath, $alt, $class, $attributes);
    }
}

if (!function_exists('webp_avatar')) {
    /**
     * Generate optimized avatar image
     *
     * @param string|null $avatarPath Avatar image path (null for default)
     * @param string $userName User's name for alt text
     * @param int $size Size in pixels (default: 40)
     * @param array $attributes Optional HTML attributes (e.g., ['loading' => 'eager'] for above-fold)
     * @return string HTML for avatar with WebP optimization
     */
    function webp_avatar(?string $avatarPath, string $userName = 'User', int $size = 40, array $attributes = []): string
    {
        return \App\Helpers\ImageHelper::avatar($avatarPath, $userName, $size, $attributes);
    }
}

if (!function_exists('__')) {
    /**
     * Translate a string using the active locale.
     *
     * Key format: "namespace.key" (e.g. "admin.label_total_members")
     * Substitution params use {{name}} placeholders in JSON values.
     *
     * @param string $key    Dot-separated namespace.key
     * @param array  $params Named substitution params (e.g. ['name' => 'Alice'])
     * @return string Translated string, or the key itself if not found
     */
    function __(string $key, array $params = []): string
    {
        // Try custom JSON translator first (used by PHP admin views)
        $result = \App\I18n\Translator::get($key, $params);

        // If custom translator returned the raw key, fall back to Laravel's
        // native translator which loads .php translation files (lang/en/*.php)
        if ($result === $key && function_exists('app') && app()->bound('translator')) {
            $laravelResult = app('translator')->get($key, $params);
            if ($laravelResult !== $key) {
                return $laravelResult;
            }
        }

        return $result;
    }
}

if (!function_exists('tenant_id')) {
    /**
     * Get the current tenant ID from TenantContext or Laravel container.
     */
    function tenant_id(): ?int
    {
        if (function_exists('app') && app()->bound('tenant.id')) {
            return app('tenant.id');
        }
        return \App\Core\TenantContext::getId();
    }
}
