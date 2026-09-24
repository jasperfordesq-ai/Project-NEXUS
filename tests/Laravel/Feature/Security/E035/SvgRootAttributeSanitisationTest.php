<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\SvgUploader;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Laravel\TestCase;

/**
 * E-035 F-162 — SvgUploader::sanitize() scrubbed the attributes of every
 * child element but never those of the ROOT <svg>, so `onload`, `onclick`
 * and a `style` carrying url(javascript:…) on the root survived into the
 * stored logo. The root must get exactly the same attribute rules as its
 * children, and a legitimate logo must still keep its shapes.
 *
 * Also pins the Apache rule that gives files served from /uploads a
 * restrictive Content-Security-Policy, the second line of defence.
 */
class SvgRootAttributeSanitisationTest extends TestCase
{
    use DatabaseTransactions;

    public function test_root_event_handlers_are_removed(): void
    {
        $out = SvgUploader::sanitize(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="window.__e035=1" '
            . 'OnClick="window.__e035=2" onmouseover="window.__e035=3"><rect width="10" height="10"/></svg>'
        );

        $this->assertStringNotContainsStringIgnoringCase('onload', $out);
        $this->assertStringNotContainsStringIgnoringCase('onclick', $out);
        $this->assertStringNotContainsStringIgnoringCase('onmouseover', $out);
        $this->assertStringNotContainsString('__e035', $out);
    }

    public function test_root_dangerous_style_and_script_uris_are_removed(): void
    {
        $out = SvgUploader::sanitize(
            '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
            . 'style="x:url(javascript:1)" xlink:href="javascript:alert(1)" data-x="javascript:alert(2)">'
            . '<g onmouseover="window.__e035=3"/></svg>'
        );

        $this->assertStringNotContainsStringIgnoringCase('javascript:', $out);
        $this->assertStringNotContainsString('url(', $out);
        $this->assertStringNotContainsStringIgnoringCase('onmouseover', $out);
    }

    public function test_legitimate_logo_keeps_root_presentation_and_shapes(): void
    {
        $out = SvgUploader::sanitize(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40" width="100" height="40" '
            . 'fill="none" style="background:#fff">'
            . '<circle cx="20" cy="20" r="15" fill="#e33"/><path d="M40 10h50v20H40z" fill="#333"/></svg>'
        );

        $this->assertStringContainsString('viewBox="0 0 100 40"', $out);
        $this->assertStringContainsString('width="100"', $out);
        $this->assertStringContainsString('style="background:#fff"', $out);
        $this->assertStringContainsString('<circle', $out);
        $this->assertStringContainsString('<path d="M40 10h50v20H40z"', $out);
    }

    public function test_uploads_are_served_with_a_restrictive_content_security_policy(): void
    {
        $htaccess = (string) file_get_contents(base_path('httpdocs/.htaccess'));

        $this->assertMatchesRegularExpression(
            '!<If "%\{REQUEST_URI\} =~ m#\^/uploads/#">\s*Header set Content-Security-Policy "[^"]*default-src \'none\'[^"]*sandbox[^"]*"!',
            $htaccess,
            'Files served from /uploads must carry a default-src \'none\' + sandbox CSP.'
        );
    }
}
