<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Core;

/**
 * Email-safe background declarations for gradient-styled surfaces.
 *
 * Outlook (Word rendering engine), Outlook.com/OWA and several webmail
 * sanitisers drop any `background` declaration whose value is a CSS gradient —
 * and the colour goes with it. A CTA styled
 * `background: linear-gradient(...); color: #ffffff` therefore arrives as white
 * text on a white card: present in the DOM, invisible to the reader. Reported
 * from production on 2026-08-03 (exchange request email, Outlook light mode:
 * the "Review Request" button rendered as blank space).
 *
 * Emitting the first gradient stop as a standalone `background-color` keeps the
 * surface readable when the gradient is stripped, while capable clients still
 * paint the gradient from `background-image`. The two declarations are separate
 * so a sanitiser that rejects the gradient cannot take the solid colour with it.
 */
final class EmailBackground
{
    /**
     * Build `background-color` + `background-image` declarations from a CSS
     * gradient value.
     *
     * @param string $gradient e.g. `linear-gradient(135deg, #6366f1, #8b5cf6)`
     * @return string CSS declarations, semicolon-terminated
     */
    public static function gradient(string $gradient): string
    {
        $gradient = trim($gradient);
        if ($gradient === '') {
            return '';
        }

        $solid = self::firstColor($gradient);
        if ($solid === null) {
            // Not a gradient we can derive a fallback from (plain colour, or an
            // exotic value) — pass it through untouched.
            return "background: {$gradient};";
        }

        return "background-color: {$solid}; background-image: {$gradient};";
    }

    /**
     * The first colour stop of a gradient value, usable on its own as a solid
     * fallback. Returns null when no colour can be read out.
     */
    public static function firstColor(string $gradient): ?string
    {
        if (stripos($gradient, 'gradient(') === false) {
            return null;
        }

        // Whichever colour literal appears first — a hex (#fff / #ffffff /
        // #ffffffff) or a functional colour (rgb/rgba/hsl/hsla). One alternation
        // so position decides, not the order the branches are tried in.
        $pattern = '/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:rgba?|hsla?)\([^)]*\)/i';

        return preg_match($pattern, $gradient, $m) === 1 ? $m[0] : null;
    }
}
