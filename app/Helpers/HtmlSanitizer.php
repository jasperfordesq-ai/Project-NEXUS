<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Helpers;

/**
 * HTML Sanitizer - Removes potentially dangerous HTML while preserving safe formatting
 *
 * This is a lightweight sanitizer for user-generated content. For maximum security,
 * consider using HTMLPurifier for complex content requiring extensive HTML support.
 */
class HtmlSanitizer
{
    /**
     * Allowed HTML tags for basic content
     */
    private static array $allowedTags = [
        'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li',
        'blockquote', 'pre', 'code',
        'a', 'img',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'div', 'span',
        'hr', 'figure', 'figcaption'
    ];

    /**
     * Allowed attributes per tag
     */
    private static array $allowedAttributes = [
        'a' => ['href', 'title', 'target', 'rel'],
        'img' => ['src', 'alt', 'title', 'width', 'height', 'loading'],
        'td' => ['colspan', 'rowspan'],
        'th' => ['colspan', 'rowspan', 'scope'],
        'div' => ['class'],
        'span' => ['class'],
        'p' => ['class'],
        'figure' => ['class'],
        'blockquote' => ['class', 'cite'],
        'pre' => ['class'],
        'code' => ['class'],
        'table' => ['class']
    ];

    /**
     * Dangerous protocols to block in URLs
     */
    private static array $dangerousProtocols = [
        'javascript:', 'vbscript:', 'data:', 'file:'
    ];

    /**
     * Sanitize HTML content
     *
     * `class` is dropped unless `$allowClass` is true. F-075 (E-027): member
     * content (posts, comments, group discussions) kept `class`, so a member
     * could borrow the app's own Tailwind classes to draw a full-screen fake
     * "sign in again" panel over the page. Only administrator-authored content
     * (legal documents, help-centre answers) opts back in.
     *
     * @param string $html The HTML content to sanitize
     * @param bool $allowImages Whether to allow img tags
     * @param bool $allowClass Keep `class` attributes (administrator-authored content only)
     * @return string Sanitized HTML
     */
    public static function sanitize(string $html, bool $allowImages = true, bool $allowClass = false): string
    {
        if (empty($html)) {
            return '';
        }

        $allowedTagList = self::$allowedTags;
        if (!$allowImages) {
            $allowedTagList = array_diff($allowedTagList, ['img']);
        }
        $tagString = '<' . implode('><', $allowedTagList) . '>';

        // Remove script and style blocks including their content before strip_tags
        $html = preg_replace('/<script\b[^>]*>.*?<\/script>/is', '', $html);
        $html = preg_replace('/<style\b[^>]*>.*?<\/style>/is', '', $html);

        // First pass: strip disallowed tags
        $html = strip_tags($html, $tagString);

        // Second pass: sanitize attributes using DOMDocument
        $html = self::sanitizeAttributes($html, $allowImages, $allowClass);

        return $html;
    }

    /**
     * Sanitize attributes in HTML content
     */
    private static function sanitizeAttributes(string $html, bool $allowImages, bool $allowClass = false): string
    {
        libxml_use_internal_errors(true);

        $dom = new \DOMDocument('1.0', 'UTF-8');
        $wrappedHtml = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>' . $html . '</body></html>';
        $dom->loadHTML($wrappedHtml, LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD);

        libxml_clear_errors();

        $xpath = new \DOMXPath($dom);
        $elements = $xpath->query('//*');

        foreach ($elements as $element) {
            if (!($element instanceof \DOMElement)) {
                continue;
            }

            $tagName = strtolower($element->tagName);

            if (in_array($tagName, ['html', 'head', 'body', 'meta'])) {
                continue;
            }

            $attributesToRemove = [];
            foreach ($element->attributes as $attr) {
                $attrName = strtolower($attr->name);
                $attrValue = $attr->value;

                if (strpos($attrName, 'on') === 0) {
                    $attributesToRemove[] = $attr->name;
                    continue;
                }

                if ($attrName === 'style') {
                    $attributesToRemove[] = $attr->name;
                    continue;
                }

                if ($attrName === 'class') {
                    if (!$allowClass) {
                        $attributesToRemove[] = $attr->name;
                    }
                    continue;
                }

                $allowedAttrs = self::$allowedAttributes[$tagName] ?? [];
                if (!in_array($attrName, $allowedAttrs)) {
                    $attributesToRemove[] = $attr->name;
                    continue;
                }

                if (in_array($attrName, ['href', 'src'])) {
                    $sanitizedUrl = self::sanitizeUrl($attrValue);
                    if ($sanitizedUrl === false) {
                        $attributesToRemove[] = $attr->name;
                    } else {
                        $element->setAttribute($attr->name, $sanitizedUrl);
                    }
                }
            }

            foreach ($attributesToRemove as $attrName) {
                $element->removeAttribute($attrName);
            }

            if ($tagName === 'a') {
                $element->setAttribute('rel', 'noopener noreferrer');
            }
        }

        $body = $dom->getElementsByTagName('body')->item(0);
        if (!$body) {
            return htmlspecialchars($html, ENT_QUOTES, 'UTF-8');
        }

        $result = '';
        foreach ($body->childNodes as $child) {
            $result .= $dom->saveHTML($child);
        }

        return $result;
    }

    /**
     * Sanitize a URL
     *
     * @param string $url The URL to sanitize
     * @return string|false Sanitized URL or false if dangerous
     */
    private static function sanitizeUrl(string $url): string|false
    {
        $url = trim($url);

        $lowerUrl = strtolower(trim(preg_replace('/\s+/', '', $url)));
        foreach (self::$dangerousProtocols as $protocol) {
            if (strpos($lowerUrl, $protocol) === 0) {
                // Allow data:image/* URIs (used for inline images)
                if ($protocol === 'data:' && str_starts_with($lowerUrl, 'data:image/')) {
                    continue;
                }
                return false;
            }
        }

        // Allow data:image/* URIs through the protocol check
        if (str_starts_with($lowerUrl, 'data:image/')) {
            return $url;
        }

        if (preg_match('/^(https?:\/\/|mailto:|tel:|\/|#)/', $lowerUrl) || !preg_match('/^[a-z]+:/i', $url)) {
            return $url;
        }

        return false;
    }

    /**
     * Strip all HTML tags and return plain text
     *
     * @param string $html The HTML content
     * @return string Plain text
     */
    public static function stripAll(string $html): string
    {
        return strip_tags($html);
    }

    // =========================================================================
    // CMS / Page Builder methods (formerly in Nexus\Core\HtmlSanitizer)
    // =========================================================================

    /**
     * Safe CSS properties allowed in style attributes.
     */
    private static array $safeCssProperties = [
        'color', 'background-color', 'background', 'font-size', 'font-weight',
        'font-style', 'font-family', 'text-align', 'text-decoration',
        'line-height', 'letter-spacing', 'word-spacing',
        'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
        'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
        'border', 'border-color', 'border-width', 'border-style',
        'border-radius', 'width', 'max-width', 'min-width',
        'height', 'max-height', 'min-height',
        'display', 'float', 'clear', 'overflow',
        'list-style', 'list-style-type', 'vertical-align',
        'opacity', 'visibility', 'white-space',
    ];

    /**
     * Sanitize HTML content with optional style attribute support.
     *
     * When $allowStyles is true, safe CSS properties are preserved in style
     * attributes; dangerous CSS (expression, behavior, -moz-binding, javascript
     * URLs) is stripped.
     *
     * Null bytes are always removed.
     *
     * @param string $html
     * @param bool   $allowStyles  Whether to keep safe style attributes
     * @return string
     */
    public static function sanitizeCms(string $html, bool $allowStyles = false): string
    {
        if (empty($html)) {
            return '';
        }

        // Remove null bytes
        $html = str_replace("\0", '', $html);

        $allowedTagList = self::$allowedTags;
        $tagString = '<' . implode('><', $allowedTagList) . '>';

        // Strip disallowed tags (keep text content)
        $html = strip_tags($html, $tagString);

        // Sanitize attributes via DOM
        $html = self::sanitizeCmsAttributes($html, $allowStyles);

        return $html;
    }

    /**
     * Sanitize attributes for CMS content, optionally allowing styles.
     */
    private static function sanitizeCmsAttributes(string $html, bool $allowStyles): string
    {
        libxml_use_internal_errors(true);

        $dom = new \DOMDocument('1.0', 'UTF-8');
        $wrappedHtml = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>' . $html . '</body></html>';
        $dom->loadHTML($wrappedHtml, LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD);

        libxml_clear_errors();

        $xpath = new \DOMXPath($dom);
        $elements = $xpath->query('//*');

        foreach ($elements as $element) {
            if (!($element instanceof \DOMElement)) {
                continue;
            }

            $tagName = strtolower($element->tagName);

            if (in_array($tagName, ['html', 'head', 'body', 'meta'])) {
                continue;
            }

            $attributesToRemove = [];
            foreach ($element->attributes as $attr) {
                $attrName = strtolower($attr->name);
                $attrValue = $attr->value;

                // Remove all event handlers (on*)
                if (strpos($attrName, 'on') === 0) {
                    $attributesToRemove[] = $attr->name;
                    continue;
                }

                // Handle style attribute
                if ($attrName === 'style') {
                    if ($allowStyles) {
                        $sanitizedStyle = self::sanitizeStyle($attrValue);
                        if (empty(trim($sanitizedStyle))) {
                            $attributesToRemove[] = $attr->name;
                        } else {
                            $element->setAttribute($attr->name, $sanitizedStyle);
                        }
                    } else {
                        $attributesToRemove[] = $attr->name;
                    }
                    continue;
                }

                // Check allowed attributes
                $allowedAttrs = self::$allowedAttributes[$tagName] ?? [];
                if (!in_array($attrName, $allowedAttrs) && $attrName !== 'class') {
                    $attributesToRemove[] = $attr->name;
                    continue;
                }

                // Sanitize URLs
                if (in_array($attrName, ['href', 'src'])) {
                    $sanitizedUrl = self::sanitizeUrl($attrValue);
                    if ($sanitizedUrl === false) {
                        $attributesToRemove[] = $attr->name;
                    } else {
                        $element->setAttribute($attr->name, $sanitizedUrl);
                    }
                }
            }

            foreach ($attributesToRemove as $attrName) {
                $element->removeAttribute($attrName);
            }

            // Add rel=noopener noreferrer for links with target=_blank
            if ($tagName === 'a' && $element->getAttribute('target') === '_blank') {
                $element->setAttribute('rel', 'noopener noreferrer');
            }
        }

        $body = $dom->getElementsByTagName('body')->item(0);
        if (!$body) {
            return htmlspecialchars($html, ENT_QUOTES, 'UTF-8');
        }

        $result = '';
        foreach ($body->childNodes as $child) {
            $result .= $dom->saveHTML($child);
        }

        return $result;
    }

    /**
     * Sanitize CSS style string by removing dangerous expressions.
     *
     * Removes expression(), -moz-binding, behavior:, and javascript/data URLs.
     * Keeps only safe CSS properties.
     *
     * @param string $style The CSS style string
     * @return string Sanitized style string
     */
    public static function sanitizeStyle(string $style): string
    {
        // Remove dangerous CSS patterns
        $style = preg_replace('/expression\s*\([^)]*\)/i', '', $style);
        $style = preg_replace('/-moz-binding\s*:[^;]*/i', '', $style);
        $style = preg_replace('/behavior\s*:[^;]*/i', '', $style);

        // Remove javascript/data URLs in url()
        $style = preg_replace_callback('/url\s*\(([^)]*)\)/i', function ($matches) {
            $url = trim($matches[1], " \t\n\r\0\x0B'\"");
            $lowerUrl = strtolower(trim(preg_replace('/\s+/', '', $url)));
            if (str_starts_with($lowerUrl, 'javascript:') || str_starts_with($lowerUrl, 'vbscript:')) {
                return '';
            }
            // Allow data:image/* URLs but block data:text/*
            if (str_starts_with($lowerUrl, 'data:') && !str_starts_with($lowerUrl, 'data:image/')) {
                return '';
            }
            return $matches[0];
        }, $style);

        // Filter to safe properties only
        $declarations = explode(';', $style);
        $safe = [];
        foreach ($declarations as $decl) {
            $decl = trim($decl);
            if (empty($decl)) {
                continue;
            }
            $parts = explode(':', $decl, 2);
            if (count($parts) !== 2) {
                continue;
            }
            $property = strtolower(trim($parts[0]));
            $value = trim($parts[1]);
            if (in_array($property, self::$safeCssProperties) && !empty($value)) {
                $safe[] = $property . ': ' . $value;
            }
        }

        return implode('; ', $safe);
    }

    /**
     * Strip HTML tags and return clean text content.
     *
     * Unlike stripAll(), this also removes script/style content (not just tags)
     * and normalizes whitespace.
     *
     * @param string $html
     * @return string
     */
    public static function stripTags(string $html): string
    {
        // Remove script and style blocks including content
        $html = preg_replace('/<script\b[^>]*>.*?<\/script>/is', '', $html);
        $html = preg_replace('/<style\b[^>]*>.*?<\/style>/is', '', $html);

        // Strip remaining tags
        $text = strip_tags($html);

        // Normalize whitespace
        $text = preg_replace('/\s+/', ' ', $text);

        return trim($text);
    }

    /**
     * Create a plain-text excerpt from HTML content.
     *
     * Strips all HTML, truncates to $length characters, and appends '...' if
     * truncated. When possible, cuts at a word boundary (if the last space is
     * at >= 80% of $length).
     *
     * @param string $html
     * @param int    $length
     * @return string
     */
    public static function excerpt(string $html, int $length = 160): string
    {
        $text = self::stripTags($html);

        if (mb_strlen($text) <= $length) {
            return $text;
        }

        $truncated = mb_substr($text, 0, $length);

        // Try to cut at word boundary if last space is >= 80% of the length
        $lastSpace = mb_strrpos($truncated, ' ');
        if ($lastSpace !== false && $lastSpace >= $length * 0.8) {
            $truncated = mb_substr($truncated, 0, $lastSpace);
        }

        return $truncated . '...';
    }
}
