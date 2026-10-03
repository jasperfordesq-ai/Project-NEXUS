<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E086;

use App\Support\Uploads\PdfActiveContentInspector as Inspector;
use PHPUnit\Framework\TestCase;

/**
 * F-551 (E-086, reported by Cyphere): uploaded PDFs were never inspected, so a
 * group file carrying JavaScript ran when a member opened it. These cases pin
 * the inspector: the ways an attacker hides /JS, and the ordinary PDFs that
 * must still be accepted.
 */
final class F551PdfActiveContentInspectorTest extends TestCase
{
    public function test_an_ordinary_pdf_is_clean(): void
    {
        self::assertSame(Inspector::CLEAN, $this->inspect(F551Pdf::plain()));
    }

    public function test_an_open_action_that_only_sets_the_view_is_clean(): void
    {
        $pdf = F551Pdf::build([
            1 => '<< /Type /Catalog /Pages 2 0 R /OpenAction [3 0 R /Fit] >>',
            2 => '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            3 => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Annots [<< /Subtype /Link /A << /S /URI /URI (https://example.org) >> >>] >>',
        ]);

        self::assertSame(Inspector::CLEAN, $this->inspect($pdf));
    }

    public function test_javascript_in_the_open_action_is_active(): void
    {
        self::assertSame(Inspector::ACTIVE, $this->inspect(F551Pdf::withOpenActionJavaScript()));
    }

    public function test_a_hex_escaped_name_is_still_recognised(): void
    {
        $pdf = F551Pdf::build([
            1 => '<< /Type /Catalog /Pages 2 0 R /OpenAction << /S /J#61vaScript /J#53 (app.alert(1)) >> >>',
            2 => '<< /Type /Pages /Kids [] /Count 0 >>',
        ]);

        self::assertSame(Inspector::ACTIVE, $this->inspect($pdf));
    }

    /** @return iterable<string, array{string}> */
    public static function otherActiveNames(): iterable
    {
        yield 'document-level script name tree' => ['<< /Type /Catalog /Names << /JavaScript 5 0 R >> >>'];
        yield 'launch action' => ['<< /Type /Catalog /OpenAction << /S /Launch /F (cmd.exe) >> >>'];
        yield 'form submission' => ['<< /Type /Catalog /OpenAction << /S /SubmitForm /F (https://evil.example) >> >>'];
        yield 'XFA form' => ['<< /Type /Catalog /AcroForm << /XFA 6 0 R >> >>'];
        yield 'rich media' => ['<< /Type /Annot /Subtype /RichMedia >>'];
        yield 'additional action on a field' => ['<< /Type /Annot /AA << /K << /S /JavaScript /JS 9 0 R >> >> >>'];
    }

    /** @dataProvider otherActiveNames */
    public function test_other_active_content_is_refused(string $object): void
    {
        self::assertSame(Inspector::ACTIVE, $this->inspect(F551Pdf::build([1 => $object])));
    }

    public function test_javascript_hidden_in_a_compressed_object_stream_is_found(): void
    {
        self::assertSame(Inspector::ACTIVE, $this->inspect(F551Pdf::withObjectStreamJavaScript('FlateDecode')));
    }

    public function test_javascript_hidden_in_a_hex_encoded_object_stream_is_found(): void
    {
        self::assertSame(Inspector::ACTIVE, $this->inspect(F551Pdf::withObjectStreamJavaScript('ASCIIHexDecode')));
    }

    public function test_javascript_hidden_in_an_ascii85_then_flate_object_stream_is_found(): void
    {
        self::assertSame(Inspector::ACTIVE, $this->inspect(F551Pdf::withObjectStreamJavaScript('ASCII85Decode')));
    }

    public function test_an_object_stream_with_an_unsupported_encoding_cannot_be_passed_as_clean(): void
    {
        $pdf = F551Pdf::build([
            1 => '<< /Type /Catalog >>',
            4 => ['<< /Type /ObjStm /N 1 /First 4 /Filter /LZWDecode /Length 10 >>', 'ABCDEFGHIJ'],
        ]);

        self::assertSame(Inspector::UNINSPECTABLE, $this->inspect($pdf));
    }

    public function test_an_object_stream_whose_filter_is_indirect_cannot_be_passed_as_clean(): void
    {
        $pdf = F551Pdf::build([
            1 => '<< /Type /Catalog >>',
            4 => ['<< /Type /ObjStm /N 1 /First 4 /Filter 7 0 R /Length 10 >>', 'ABCDEFGHIJ'],
        ]);

        self::assertSame(Inspector::UNINSPECTABLE, $this->inspect($pdf));
    }

    public function test_an_object_stream_with_a_predictor_cannot_be_passed_as_clean(): void
    {
        $body = (string) gzcompress('1 0 << /S /JavaScript /JS (x) >>');
        $pdf = F551Pdf::build([
            4 => ['<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 4 >> /Length ' . strlen($body) . ' >>', $body],
        ]);

        self::assertSame(Inspector::UNINSPECTABLE, $this->inspect($pdf));
    }

    public function test_an_object_stream_identified_only_by_its_first_key_is_still_decoded(): void
    {
        $inner = '5 0 << /S /JavaScript /JS (app.alert(1)) >>';
        $body = (string) gzcompress($inner);
        $pdf = F551Pdf::build([
            1 => '<< /Type /Catalog >>',
            4 => ['<< /Type 8 0 R /N 1 /First 4 /Filter /FlateDecode /Length ' . strlen($body) . ' >>', $body],
        ]);

        self::assertSame(Inspector::ACTIVE, $this->inspect($pdf));
    }

    public function test_a_decompression_bomb_cannot_be_passed_as_clean(): void
    {
        $body = (string) gzcompress(str_repeat('0', 80 * 1024 * 1024), 9);
        $pdf = F551Pdf::build([
            4 => ['<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ' . strlen($body) . ' >>', $body],
        ]);

        self::assertSame(Inspector::UNINSPECTABLE, $this->inspect($pdf));
    }

    public function test_an_encrypted_file_with_object_streams_cannot_be_passed_as_clean(): void
    {
        $pdf = F551Pdf::build([
            1 => '<< /Type /Catalog >>',
            4 => ['<< /Type /ObjStm /N 1 /First 4 /Length 10 >>', "\x8f\x01\x99\x02\xa0\x03\xb1\x04\xc2\x05"],
        ], '/Encrypt 9 0 R');

        self::assertSame(Inspector::UNINSPECTABLE, $this->inspect($pdf));
    }

    public function test_an_encrypted_file_without_object_streams_is_still_read(): void
    {
        $clean = F551Pdf::build([1 => '<< /Type /Catalog /Pages 2 0 R >>', 2 => '<< /Type /Pages /Kids [] /Count 0 >>'], '/Encrypt 9 0 R');
        $active = F551Pdf::build([1 => '<< /Type /Catalog /OpenAction << /S /JavaScript /JS 3 0 R >> >>'], '/Encrypt 9 0 R');

        self::assertSame(Inspector::CLEAN, $this->inspect($clean));
        self::assertSame(Inspector::ACTIVE, $this->inspect($active));
    }

    public function test_a_fake_stream_inside_a_string_cannot_hide_a_dictionary(): void
    {
        // A naive "strip everything between stream and endstream" scan would
        // swallow the /JavaScript action between the two string literals.
        $pdf = F551Pdf::build([
            1 => "<< /Type /Catalog /Title (>> stream\n) /OpenAction << /S /JavaScript /JS (app.alert(1)) >> /Subject (endstream) >>",
        ]);

        self::assertSame(Inspector::ACTIVE, $this->inspect($pdf));
    }

    public function test_a_lying_stream_length_cannot_skip_over_real_objects(): void
    {
        $pdf = F551Pdf::build([
            3 => ['<< /Length 100000 >>', 'BT ET'],
            5 => '<< /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>',
        ]);

        self::assertSame(Inspector::ACTIVE, $this->inspect($pdf));
    }

    public function test_bytes_that_spell_a_name_inside_ordinary_stream_data_are_not_a_false_alarm(): void
    {
        // Compressed page content and images are arbitrary bytes; "/JS " can
        // occur in them by chance. Only dictionaries and object streams count.
        $pdf = F551Pdf::build([
            1 => '<< /Type /Catalog /Pages 2 0 R >>',
            2 => '<< /Type /Pages /Kids [] /Count 0 >>',
            3 => ['<< /Subtype /Image /Width 2 /Height 2 /Filter /DCTDecode /Length 22 >>', "\xff\xd8 /JS /JavaScript \xff\xd9"],
        ]);

        self::assertSame(Inspector::CLEAN, $this->inspect($pdf));
    }

    public function test_comments_and_garbage_do_not_crash_or_loop(): void
    {
        self::assertSame(Inspector::CLEAN, $this->inspect("%PDF-1.7\n% /JS in a comment\n1 0 obj << /A ] ) > } { >> endobj\n(unterminated"));
        self::assertSame(Inspector::CLEAN, $this->inspect(''));
        self::assertSame(Inspector::UNINSPECTABLE, $this->inspect("%PDF-1.7\n" . str_repeat('[', 500)));
    }

    public function test_an_unreadable_path_is_uninspectable(): void
    {
        self::assertSame(Inspector::UNINSPECTABLE, Inspector::inspectFile('/nonexistent/' . bin2hex(random_bytes(6)) . '.pdf'));
    }

    private function inspect(string $contents): string
    {
        return (new Inspector())->inspect($contents);
    }
}
