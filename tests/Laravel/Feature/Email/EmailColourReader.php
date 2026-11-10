<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Email;

use App\Support\ColourContrast;

/**
 * Reads the colour of every piece of text in an email, in the light look and
 * in the dark look a mail app shows when it honours the email's own
 * `@media (prefers-color-scheme: dark)` rules (Apple Mail does).
 *
 * It understands exactly what our email templates use: inline `color`,
 * `background-color` / `background` / `bgcolor`, gradients (painted on top, so
 * their first stop is the background whatever the dark rules say), alpha
 * colours (blended over what lies beneath), and stylesheet rules of the forms
 * `a`, `.class` and `.class a`. A rule inside the dark block counts as
 * `!important`, which all of ours are. It is not a browser: it exists so a
 * test can say "dark mode made this text unreadable".
 */
final class EmailColourReader
{
    /** @var list<array{class: ?string, anchor: bool, decls: array<string, string>}> */
    private array $globalRules = [];

    /** @var list<array{class: ?string, anchor: bool, decls: array<string, string>}> */
    private array $darkRules = [];

    private \DOMDocument $doc;

    private function __construct(string $html)
    {
        $this->parseStyles($html);
        $this->doc = new \DOMDocument();
        $previous = libxml_use_internal_errors(true);
        $this->doc->loadHTML('<?xml encoding="utf-8" ?>' . $html, LIBXML_NOERROR | LIBXML_NOWARNING);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);
    }

    /**
     * @return list<array{
     *     text: string, large: bool,
     *     light: array{fg: string, bg: string, ratio: float},
     *     dark: array{fg: string, bg: string, ratio: float}
     * }>
     */
    public static function textSamples(string $html): array
    {
        return (new self($html))->samples();
    }

    /**
     * Text that dark mode changes AND leaves below WCAG AA (4.5:1, or 3:1 for
     * large text), as readable descriptions. Text dark mode does not touch is
     * the light look's business, not this check's.
     *
     * @return list<string>
     */
    public static function darkModeFailures(string $html): array
    {
        $failures = [];
        foreach (self::textSamples($html) as $sample) {
            $light = $sample['light'];
            $dark = $sample['dark'];
            if ($light['fg'] === $dark['fg'] && $light['bg'] === $dark['bg']) {
                continue;
            }
            $minimum = $sample['large'] ? 3.0 : ColourContrast::AA_NORMAL_TEXT;
            if ($dark['ratio'] < $minimum) {
                $failures[] = sprintf(
                    '"%s": dark %s on %s = %.2f:1 (light %s on %s = %.2f:1)',
                    mb_substr($sample['text'], 0, 40),
                    $dark['fg'], $dark['bg'], $dark['ratio'],
                    $light['fg'], $light['bg'], $light['ratio'],
                );
            }
        }

        return array_values(array_unique($failures));
    }

    /**
     * Text below WCAG AA (4.5:1, or 3:1 for large text) in the light look —
     * what every mail app shows unless it applies dark-mode rules.
     *
     * @return list<string>
     */
    public static function lightModeFailures(string $html): array
    {
        $failures = [];
        foreach (self::textSamples($html) as $sample) {
            $light = $sample['light'];
            $minimum = $sample['large'] ? 3.0 : ColourContrast::AA_NORMAL_TEXT;
            if ($light['ratio'] < $minimum) {
                $failures[] = sprintf(
                    '"%s": %s on %s = %.2f:1%s',
                    mb_substr($sample['text'], 0, 40),
                    $light['fg'], $light['bg'], $light['ratio'],
                    $sample['large'] ? ' (large)' : '',
                );
            }
        }

        return array_values(array_unique($failures));
    }

    /** @return list<array{text: string, large: bool, light: array{fg: string, bg: string, ratio: float}, dark: array{fg: string, bg: string, ratio: float}}> */
    private function samples(): array
    {
        $xpath = new \DOMXPath($this->doc);
        $samples = [];
        $nodes = $xpath->query('//body//text()');
        if ($nodes === false) {
            return [];
        }
        foreach ($nodes as $node) {
            $text = trim((string) $node->nodeValue);
            $parent = $node->parentNode;
            if ($text === '' || !$parent instanceof \DOMElement || preg_match('/[\p{L}\p{N}]/u', $text) !== 1) {
                continue;
            }
            if ($this->isHidden($parent)) {
                continue;
            }
            $sample = ['text' => $text, 'large' => $this->isLarge($parent)];
            foreach (['light' => false, 'dark' => true] as $mode => $dark) {
                $bg = $this->background($parent, $dark);
                $fg = $this->blend($this->foreground($parent, $dark), $bg);
                $sample[$mode] = ['fg' => $fg, 'bg' => $bg, 'ratio' => ColourContrast::ratio($fg, $bg)];
            }
            $samples[] = $sample;
        }

        return $samples;
    }

    // ------------------------------------------------------------------
    // Stylesheet
    // ------------------------------------------------------------------

    private function parseStyles(string $html): void
    {
        preg_match_all('#<style[^>]*>(.*?)</style>#is', $html, $blocks);
        foreach ($blocks[1] as $css) {
            $css = (string) preg_replace('#/\*.*?\*/#s', '', $css);
            $global = '';
            $offset = 0;
            while (preg_match('/@media[^{]*\{/i', $css, $m, PREG_OFFSET_CAPTURE, $offset) === 1) {
                $start = $m[0][1];
                $global .= substr($css, $offset, $start - $offset);
                $open = $start + strlen($m[0][0]);
                $depth = 1;
                $i = $open;
                while ($i < strlen($css) && $depth > 0) {
                    $depth += $css[$i] === '{' ? 1 : ($css[$i] === '}' ? -1 : 0);
                    $i++;
                }
                if (stripos($m[0][0], 'prefers-color-scheme') !== false && stripos($m[0][0], 'dark') !== false) {
                    $this->darkRules = array_merge($this->darkRules, $this->parseRules(substr($css, $open, $i - 1 - $open)));
                }
                $offset = $i;
            }
            $global .= substr($css, $offset);
            $this->globalRules = array_merge($this->globalRules, $this->parseRules($global));
        }
    }

    /** @return list<array{class: ?string, anchor: bool, decls: array<string, string>}> */
    private function parseRules(string $css): array
    {
        $rules = [];
        preg_match_all('/([^{}]+)\{([^{}]*)\}/', $css, $m, PREG_SET_ORDER);
        foreach ($m as $rule) {
            $decls = $this->declarations($rule[2]);
            foreach (explode(',', $rule[1]) as $selector) {
                $selector = trim($selector);
                if ($selector === 'a') {
                    $rules[] = ['class' => null, 'anchor' => true, 'decls' => $decls];
                } elseif (preg_match('/^\.([a-zA-Z0-9_-]+)(\s+a)?$/', $selector, $s) === 1) {
                    $rules[] = ['class' => $s[1], 'anchor' => isset($s[2]), 'decls' => $decls];
                }
            }
        }

        return $rules;
    }

    /** @return array<string, string> */
    private function declarations(string $block): array
    {
        $decls = [];
        foreach (explode(';', $block) as $decl) {
            $parts = explode(':', $decl, 2);
            if (count($parts) === 2) {
                $value = trim((string) preg_replace('/!important/i', '', $parts[1]));
                $decls[strtolower(trim($parts[0]))] = $value;
            }
        }

        return $decls;
    }

    /**
     * The value a stylesheet rule gives this element for $property, or null.
     *
     * @param list<array{class: ?string, anchor: bool, decls: array<string, string>}> $rules
     */
    private function ruleValue(\DOMElement $el, array $rules, string $property): ?string
    {
        $found = null;
        foreach ($rules as $rule) {
            if (!isset($rule['decls'][$property])) {
                continue;
            }
            if ($rule['anchor']) {
                if (strtolower($el->tagName) !== 'a') {
                    continue;
                }
                if ($rule['class'] !== null && !$this->hasAncestorClass($el, $rule['class'])) {
                    continue;
                }
            } elseif ($rule['class'] === null || !$this->hasClass($el, $rule['class'])) {
                continue;
            }
            $found = $rule['decls'][$property];
        }

        return $found;
    }

    // ------------------------------------------------------------------
    // Computed colours
    // ------------------------------------------------------------------

    private function foreground(\DOMElement $el, bool $dark): string
    {
        for ($node = $el; $node instanceof \DOMElement; $node = $node->parentNode) {
            $value = $dark ? $this->ruleValue($node, $this->darkRules, 'color') : null;
            $value ??= $this->inline($node)['color'] ?? null;
            $value ??= $this->ruleValue($node, $this->globalRules, 'color');
            if ($value !== null && $this->parse($value) !== null) {
                return $value;
            }
        }

        return '#000000';
    }

    private function background(\DOMElement $el, bool $dark): string
    {
        for ($node = $el; $node instanceof \DOMElement; $node = $node->parentNode) {
            $style = $this->inline($node);
            $colour = null;
            if (isset($style['background-image']) && stripos($style['background-image'], 'gradient(') !== false) {
                $colour = $this->firstColour($style['background-image']);
            }
            if ($colour === null && $dark) {
                $rule = $this->ruleValue($node, $this->darkRules, 'background-color');
                $colour = $rule !== null ? $this->firstColour($rule) : null;
            }
            foreach (['background-color', 'background'] as $property) {
                if ($colour === null && isset($style[$property])) {
                    $colour = $this->firstColour($style[$property]);
                }
            }
            if ($colour === null && $node->hasAttribute('bgcolor')) {
                $colour = $this->firstColour($node->getAttribute('bgcolor'));
            }
            if ($colour !== null) {
                $parent = $node->parentNode;
                $below = $parent instanceof \DOMElement ? $this->background($parent, $dark) : '#ffffff';

                return $this->blend($colour, $below);
            }
        }

        return '#ffffff';
    }

    private function isLarge(\DOMElement $el): bool
    {
        $size = null;
        $weight = null;
        for ($node = $el; $node instanceof \DOMElement; $node = $node->parentNode) {
            $style = $this->inline($node);
            if ($size === null && isset($style['font-size']) && preg_match('/^([\d.]+)px/', $style['font-size'], $m) === 1) {
                $size = (float) $m[1];
            }
            if ($weight === null && isset($style['font-weight'])) {
                $weight = $style['font-weight'] === 'bold' ? 700 : (int) $style['font-weight'];
            }
            if ($weight === null && in_array(strtolower($node->tagName), ['h1', 'h2', 'h3', 'strong', 'b'], true)) {
                $weight = 700;
            }
        }
        $size ??= 16.0;
        $weight ??= 400;

        return $size >= 24 || ($size >= 18.66 && $weight >= 700);
    }

    private function isHidden(\DOMElement $el): bool
    {
        for ($node = $el; $node instanceof \DOMElement; $node = $node->parentNode) {
            if (in_array(strtolower($node->tagName), ['style', 'script', 'title', 'head'], true)) {
                return true;
            }
            if (preg_replace('/\s+/', '', strtolower($this->inline($node)['display'] ?? '')) === 'none') {
                return true;
            }
        }

        return false;
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /** @return array<string, string> */
    private function inline(\DOMElement $el): array
    {
        return $el->hasAttribute('style') ? $this->declarations($el->getAttribute('style')) : [];
    }

    private function hasClass(\DOMElement $el, string $class): bool
    {
        return in_array($class, preg_split('/\s+/', $el->getAttribute('class')) ?: [], true);
    }

    private function hasAncestorClass(\DOMElement $el, string $class): bool
    {
        for ($node = $el->parentNode; $node instanceof \DOMElement; $node = $node->parentNode) {
            if ($this->hasClass($node, $class)) {
                return true;
            }
        }

        return false;
    }

    private function firstColour(string $value): ?string
    {
        $pattern = '/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b|rgba?\([^)]*\)|\b(?:white|black)\b/i';

        return preg_match($pattern, $value, $m) === 1 ? $m[0] : null;
    }

    /** @return array{0: int, 1: int, 2: int, 3: float}|null */
    private function parse(string $colour): ?array
    {
        $colour = strtolower(trim($colour));
        if ($colour === 'white') {
            return [255, 255, 255, 1.0];
        }
        if ($colour === 'black') {
            return [0, 0, 0, 1.0];
        }
        if (preg_match('/^#([0-9a-f]{3})$/', $colour, $m) === 1) {
            $colour = '#' . $m[1][0] . $m[1][0] . $m[1][1] . $m[1][1] . $m[1][2] . $m[1][2];
        }
        if (preg_match('/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/', $colour, $m) === 1) {
            return [(int) hexdec($m[1]), (int) hexdec($m[2]), (int) hexdec($m[3]), isset($m[4]) ? hexdec($m[4]) / 255 : 1.0];
        }
        if (preg_match('/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/', $colour, $m) === 1) {
            return [(int) $m[1], (int) $m[2], (int) $m[3], isset($m[4]) ? (float) $m[4] : 1.0];
        }

        return null;
    }

    /** Paint $colour (possibly translucent) over the solid $below; returns #rrggbb. */
    private function blend(string $colour, string $below): string
    {
        $top = $this->parse($colour) ?? [0, 0, 0, 1.0];
        $base = $this->parse($below) ?? [255, 255, 255, 1.0];
        $out = '#';
        for ($i = 0; $i < 3; $i++) {
            $out .= sprintf('%02x', (int) round($top[$i] * $top[3] + $base[$i] * (1 - $top[3])));
        }

        return $out;
    }
}
