<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Core;

/**
 * SVG upload handler with strict allowlist sanitisation.
 *
 * SVG served same-origin is a stored-XSS vector, so it MUST NOT go through the
 * raster pipeline in {@see ImageUploader} (which only accepts JPEG/PNG/GIF/WebP).
 * This class parses the SVG with the DOM extension and rebuilds a clean document
 * from an allowlist of presentational elements/attributes, stripping every known
 * scripting vector (script/foreignObject elements, on* handlers, javascript:/data:
 * and remote href targets, dangerous inline/embedded CSS, and DOCTYPE entities).
 *
 * The storage path mirrors ImageUploader so logos live alongside other tenant
 * uploads: /uploads/tenants/{slug}/{directory}/{random}.svg
 */
class SvgUploader
{
    private static int $maxSize = 2 * 1024 * 1024; // 2 MB

    /**
     * Presentational SVG elements that are safe to keep. Anything not in this
     * list (script, foreignObject, image, a, audio, video, iframe, handler, …)
     * is removed wholesale. Compared case-insensitively against the local name.
     */
    private const ALLOWED_ELEMENTS = [
        'svg', 'g', 'defs', 'symbol', 'use', 'switch', 'view', 'metadata',
        'title', 'desc',
        'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
        'text', 'tspan', 'textpath', 'tref',
        'lineargradient', 'radialgradient', 'stop',
        'clippath', 'mask', 'pattern', 'marker',
        'style',
        // Filter primitives (no external references kept — feimage is excluded).
        'filter', 'fegaussianblur', 'feoffset', 'feblend', 'feflood',
        'fecomposite', 'femerge', 'femergenode', 'fecolormatrix',
        'fecomponenttransfer', 'fefunca', 'fefuncb', 'fefuncg', 'fefuncr',
        'feconvolvematrix', 'fediffuselighting', 'fedisplacementmap',
        'fedistantlight', 'femorphology', 'fepointlight', 'fespecularlighting',
        'fespotlight', 'fetile', 'feturbulence',
        // Declarative animation (cannot execute script).
        'animate', 'animatetransform', 'animatemotion', 'animatecolor',
        'set', 'mpath',
        'font', 'glyph', 'glyphref', 'hkern', 'vkern',
    ];

    /** Tokens that disqualify a CSS string (inline style or <style> body). */
    private const CSS_FORBIDDEN = [
        'javascript:', 'expression(', '@import', 'url(', 'behavior:',
        '-moz-binding', '<',
        // Any CSS escape. `\75rl(` is `url(` to the CSS parser and slips past the
        // token matching above; logo styles have no legitimate need for escapes.
        '\\',
    ];

    /**
     * SMIL animation elements. They can rewrite ANY attribute of their target
     * at render time, including event handlers and href, which would sidestep
     * the attribute scrub — so their `attributeName` target is checked too.
     */
    private const ANIMATION_ELEMENTS = ['animate', 'animatetransform', 'animatemotion', 'animatecolor', 'set'];

    /**
     * Validate, sanitise, and store an uploaded SVG.
     *
     * @param array  $file      $_FILES-style array (name, type, tmp_name, error, size)
     * @param string $directory Subfolder under uploads (e.g. 'tenant-logos')
     * @return string|null Public path to the stored file, or null on empty input
     * @throws \Exception On validation failure
     */
    public static function save(array $file, string $directory = 'tenant-logos'): ?string
    {
        if (empty($file['name'])) {
            return null;
        }

        if (($file['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK) {
            throw new \Exception('Upload Error Code: ' . $file['error']);
        }

        $extension = \strtolower(\pathinfo($file['name'], PATHINFO_EXTENSION));
        if ($extension !== 'svg') {
            throw new \Exception('Invalid file extension. Only SVG allowed.');
        }

        if (($file['size'] ?? 0) > self::$maxSize) {
            throw new \Exception('File too large. Max 2MB.');
        }

        $raw = @\file_get_contents($file['tmp_name']);
        if ($raw === false || $raw === '') {
            throw new \Exception('File is not a valid SVG.');
        }

        $clean = self::sanitize($raw);

        // Generate secure filename + tenant-scoped path (mirrors ImageUploader).
        $filename = \bin2hex(\random_bytes(16)) . '.svg';

        $tenant = TenantContext::get();
        $slug = $tenant['slug'] ?? 'default';
        if (($tenant['id'] ?? null) == 1 && empty($tenant['slug'])) {
            $slug = 'master';
        }

        $tenantDir = 'tenants/' . $slug . '/' . $directory;
        $targetDir = __DIR__ . '/../../httpdocs/uploads/' . $tenantDir;

        // Race-safe create with a clear error on failure (mirrors ImageUploader):
        // a tenant folder owned by root would otherwise let mkdir() fail silently
        // and surface as a misleading "Failed to save file" further down.
        if (!\is_dir($targetDir) && !@\mkdir($targetDir, 0755, true) && !\is_dir($targetDir)) {
            throw new \Exception("Could not create upload directory ({$targetDir}). The web server user likely lacks write permission on the tenant uploads folder.");
        }

        $targetPath = $targetDir . '/' . $filename;
        $publicPath = '/uploads/' . $tenantDir . '/' . $filename;

        if (\file_put_contents($targetPath, $clean) === false) {
            throw new \Exception('Failed to save file.');
        }

        return $publicPath;
    }

    /**
     * Parse and rebuild the SVG from the allowlist. Throws if the input is not
     * a well-formed SVG document.
     */
    public static function sanitize(string $raw): string
    {
        // Reject DOCTYPE / entity declarations outright — closes the XXE and
        // billion-laughs entity-expansion vectors before the parser sees them.
        if (\preg_match('/<!DOCTYPE/i', $raw) || \preg_match('/<!ENTITY/i', $raw)) {
            throw new \Exception('SVG must not contain a DOCTYPE or entity declarations.');
        }

        $previous = \libxml_use_internal_errors(true);
        // PHP 8 / libxml 2.9+ disables external entity loading by default; we also
        // pass LIBXML_NONET so any stray reference can never reach the network.
        $dom = new \DOMDocument();
        $dom->preserveWhiteSpace = false;
        $loaded = $dom->loadXML($raw, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);
        \libxml_clear_errors();
        \libxml_use_internal_errors($previous);

        if (!$loaded || $dom->documentElement === null) {
            throw new \Exception('File is not a valid, well-formed SVG.');
        }

        if (\strtolower($dom->documentElement->localName ?? '') !== 'svg') {
            throw new \Exception('Root element must be <svg>.');
        }

        self::scrubNode($dom->documentElement);

        $out = $dom->saveXML($dom->documentElement);
        if ($out === false || $out === '') {
            throw new \Exception('Failed to serialise sanitised SVG.');
        }

        return '<?xml version="1.0" encoding="UTF-8"?>' . "\n" . $out . "\n";
    }

    /**
     * Recursively strip disallowed elements and attributes from a node.
     */
    private static function scrubNode(\DOMNode $node): void
    {
        // Snapshot children first — we mutate the tree while iterating.
        $children = [];
        foreach ($node->childNodes as $child) {
            $children[] = $child;
        }

        foreach ($children as $child) {
            // Drop comments and processing instructions (e.g. xml-stylesheet PIs).
            if ($child->nodeType === XML_COMMENT_NODE || $child->nodeType === XML_PI_NODE) {
                $node->removeChild($child);
                continue;
            }

            if ($child->nodeType !== XML_ELEMENT_NODE) {
                continue; // text nodes etc. are harmless
            }

            /** @var \DOMElement $child */
            $tag = \strtolower($child->localName ?? '');

            if (!\in_array($tag, self::ALLOWED_ELEMENTS, true)) {
                $node->removeChild($child);
                continue;
            }

            // Declarative animation that targets an event handler, href or style
            // would re-introduce exactly what scrubAttributes() removes.
            if (\in_array($tag, self::ANIMATION_ELEMENTS, true) && self::animatesDangerousAttribute($child)) {
                $node->removeChild($child);
                continue;
            }

            // <style> bodies: keep only if the CSS is free of dangerous tokens.
            if ($tag === 'style') {
                if (self::cssIsDangerous($child->textContent ?? '')) {
                    $node->removeChild($child);
                }
                continue;
            }

            self::scrubAttributes($child);
            self::scrubNode($child);
        }
    }

    /**
     * Remove unsafe attributes from an element.
     */
    private static function scrubAttributes(\DOMElement $el): void
    {
        $attrs = [];
        foreach ($el->attributes as $attr) {
            $attrs[] = $attr;
        }

        foreach ($attrs as $attr) {
            $name = \strtolower($attr->localName ?? $attr->nodeName);
            $value = (string) $attr->nodeValue;

            // Strip all event handlers (onload, onclick, …).
            if (\str_starts_with($name, 'on')) {
                $el->removeAttributeNode($attr);
                continue;
            }

            // href / xlink:href: only same-document fragment refs are allowed.
            if ($name === 'href') {
                if (!\preg_match('/^#/', \trim($value))) {
                    $el->removeAttributeNode($attr);
                }
                continue;
            }

            // Inline style: drop the attribute if it carries a dangerous token.
            if ($name === 'style') {
                if (self::cssIsDangerous($value)) {
                    $el->removeAttributeNode($attr);
                }
                continue;
            }

            // Defensive catch-all: any attribute value that smuggles a script URI.
            if (\stripos($value, 'javascript:') !== false) {
                $el->removeAttributeNode($attr);
            }
        }
    }

    /**
     * True when a SMIL element's `attributeName` names an event handler, an
     * href (plain or namespaced) or `style` — the attributes whose values are
     * otherwise vetted and which animation could set freely.
     */
    private static function animatesDangerousAttribute(\DOMElement $el): bool
    {
        foreach ($el->attributes as $attr) {
            if (\strtolower($attr->localName ?? $attr->nodeName) !== 'attributename') {
                continue;
            }
            $target = \strtolower(\trim((string) $attr->nodeValue));
            $colon = \strrpos($target, ':');
            $local = $colon === false ? $target : \substr($target, $colon + 1);

            return \str_starts_with($local, 'on') || \in_array($local, ['href', 'style'], true);
        }

        return false;
    }

    private static function cssIsDangerous(string $css): bool
    {
        $lower = \strtolower($css);
        foreach (self::CSS_FORBIDDEN as $token) {
            if (\str_contains($lower, $token)) {
                return true;
            }
        }
        return false;
    }
}
