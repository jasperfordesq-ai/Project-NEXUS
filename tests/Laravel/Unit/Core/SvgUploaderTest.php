<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Core;

use App\Core\SvgUploader;
use PHPUnit\Framework\TestCase;

/**
 * Unit tests for the SVG sanitiser used by tenant header-logo uploads.
 *
 * These cover the security-critical surface: scripting vectors must be stripped
 * while legitimate presentational logo markup is preserved. sanitize() is a pure
 * function (DOMDocument only), so no Laravel/DB bootstrapping is required.
 */
class SvgUploaderTest extends TestCase
{
    public function test_preserves_legitimate_logo_markup(): void
    {
        $svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
            . '<g fill="#1d70b8"><path d="M2 2h20v20H2z" style="opacity:0.9"/></g>'
            . '<title>Acme</title></svg>';

        $out = SvgUploader::sanitize($svg);

        $this->assertStringContainsString('<svg', $out);
        $this->assertStringContainsString('<path', $out);
        $this->assertStringContainsString('fill="#1d70b8"', $out);
        $this->assertStringContainsString('style="opacity:0.9"', $out);
    }

    public function test_removes_script_element(): void
    {
        $svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script>'
            . '<rect width="10" height="10"/></svg>';

        $out = SvgUploader::sanitize($svg);

        $this->assertStringNotContainsString('<script', $out);
        $this->assertStringNotContainsString('alert(1)', $out);
        $this->assertStringContainsString('<rect', $out);
    }

    public function test_strips_event_handler_attributes(): void
    {
        $svg = '<svg xmlns="http://www.w3.org/2000/svg">'
            . '<rect width="10" height="10" onload="alert(1)" onclick="evil()"/></svg>';

        $out = SvgUploader::sanitize($svg);

        $this->assertStringNotContainsString('onload', $out);
        $this->assertStringNotContainsString('onclick', $out);
        $this->assertStringContainsString('<rect', $out);
    }

    /**
     * E-005, F-018. `\75rl(` is `url(` once the CSS parser decodes the escape,
     * so token matching on the raw text missed it in both a <style> body and an
     * inline style attribute.
     */
    public function test_css_escapes_cannot_smuggle_a_forbidden_token(): void
    {
        $svg = '<svg xmlns="http://www.w3.org/2000/svg">'
            . '<style>rect{fill:\75rl(https://evil.example/track.png)}</style>'
            . '<rect width="10" height="10" style="fill:\\75 rl(https://evil.example/b.png)"/>'
            . '<circle r="4" style="opacity:0.5"/></svg>';

        $out = SvgUploader::sanitize($svg);

        $this->assertStringNotContainsString('<style', $out);
        $this->assertStringNotContainsString('evil.example', $out);
        $this->assertStringContainsString('<rect', $out);
        $this->assertStringContainsString('style="opacity:0.5"', $out);
    }

    /**
     * E-005, F-018. SMIL can set any attribute of its target at render time,
     * so an <animate>/<set> aimed at an event handler or href re-created what
     * the attribute scrub had removed. Harmless animation is kept.
     */
    public function test_removes_smil_animation_that_targets_event_handlers_or_href(): void
    {
        $svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
            . '<rect id="r" width="10" height="10">'
            . '<set attributeName="onload" to="alert(1)"/>'
            . '<animate attributeName="opacity" from="0" to="1" dur="1s"/>'
            . '</rect>'
            . '<use href="#r"><animate attributeName="xlink:href" to="https://evil.example/x.svg#p"/></use>'
            . '<circle r="2"><set ATTRIBUTENAME="style" to="fill:\\75rl(https://evil.example/c)"/></circle>'
            . '</svg>';

        $out = SvgUploader::sanitize($svg);

        $this->assertStringNotContainsString('<set', $out);
        $this->assertStringNotContainsString('alert(1)', $out);
        $this->assertStringNotContainsString('evil.example', $out);
        $this->assertStringContainsString('attributeName="opacity"', $out);
        $this->assertStringContainsString('<use', $out);
    }

    public function test_removes_foreign_object(): void
    {
        $svg = '<svg xmlns="http://www.w3.org/2000/svg">'
            . '<foreignObject><body xmlns="http://www.w3.org/1999/xhtml">hi</body></foreignObject>'
            . '<circle r="5"/></svg>';

        $out = SvgUploader::sanitize($svg);

        $this->assertStringNotContainsStringIgnoringCase('foreignObject', $out);
        $this->assertStringContainsString('<circle', $out);
    }

    public function test_strips_external_and_script_hrefs_but_keeps_fragment_refs(): void
    {
        $svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
            . '<use xlink:href="javascript:alert(1)"/>'
            . '<use xlink:href="https://evil.example/x.svg"/>'
            . '<use xlink:href="#safe"/></svg>';

        $out = SvgUploader::sanitize($svg);

        $this->assertStringNotContainsString('javascript:', $out);
        $this->assertStringNotContainsString('evil.example', $out);
        // The same-document fragment reference is preserved.
        $this->assertStringContainsString('#safe', $out);
    }

    public function test_drops_inline_style_with_dangerous_token(): void
    {
        $svg = '<svg xmlns="http://www.w3.org/2000/svg">'
            . '<rect width="10" height="10" style="background:url(javascript:alert(1))"/></svg>';

        $out = SvgUploader::sanitize($svg);

        $this->assertStringNotContainsString('javascript:', $out);
        $this->assertStringNotContainsString('url(', $out);
    }

    public function test_rejects_doctype(): void
    {
        $svg = '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]>'
            . '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';

        $this->expectException(\Exception::class);
        SvgUploader::sanitize($svg);
    }

    public function test_rejects_non_svg_root(): void
    {
        $this->expectException(\Exception::class);
        SvgUploader::sanitize('<html><body>not an svg</body></html>');
    }

    public function test_rejects_malformed_xml(): void
    {
        $this->expectException(\Exception::class);
        SvgUploader::sanitize('<svg><rect></svg>');
    }
}
