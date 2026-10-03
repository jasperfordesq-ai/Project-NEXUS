<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E086;

/** Builds small, structurally real PDFs for the F-551 tests. */
final class F551Pdf
{
    /**
     * @param array<int, string|array{string, string}> $objects object number => dictionary, or [dictionary, stream bytes]
     */
    public static function build(array $objects, string $trailerExtra = ''): string
    {
        $pdf = "%PDF-1.7\n%\xe2\xe3\xcf\xd3\n";
        $offsets = [];
        foreach ($objects as $number => $object) {
            $offsets[$number] = strlen($pdf);
            if (is_array($object)) {
                [$dictionary, $stream] = $object;
                $pdf .= "{$number} 0 obj\n{$dictionary}\nstream\n{$stream}\nendstream\nendobj\n";
            } else {
                $pdf .= "{$number} 0 obj\n{$object}\nendobj\n";
            }
        }
        $xref = strlen($pdf);
        $size = ($objects === [] ? 0 : max(array_keys($objects))) + 1;
        $pdf .= "xref\n0 {$size}\n0000000000 65535 f \n";
        for ($i = 1; $i < $size; ++$i) {
            $pdf .= isset($offsets[$i]) ? sprintf("%010d 00000 n \n", $offsets[$i]) : "0000000000 65535 f \n";
        }

        return $pdf . "trailer\n<< /Size {$size} /Root 1 0 R {$trailerExtra} >>\nstartxref\n{$xref}\n%%EOF\n";
    }

    public static function plain(): string
    {
        $content = "BT /F1 24 Tf 72 700 Td (Hello group) Tj ET";

        return self::build([
            1 => '<< /Type /Catalog /Pages 2 0 R >>',
            2 => '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            3 => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
            4 => ['<< /Length ' . strlen($content) . ' >>', $content],
            5 => '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        ]);
    }

    public static function withOpenActionJavaScript(): string
    {
        return self::build([
            1 => '<< /Type /Catalog /Pages 2 0 R /OpenAction << /S /JavaScript /JS (app.alert\(document.domain\)) >> >>',
            2 => '<< /Type /Pages /Kids [] /Count 0 >>',
        ]);
    }

    public static function withObjectStreamJavaScript(string $encoding): string
    {
        $inner = '6 0 << /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>';
        [$filter, $body] = match ($encoding) {
            'FlateDecode' => ['/FlateDecode', (string) gzcompress($inner)],
            'ASCIIHexDecode' => ['/ASCIIHexDecode', strtoupper(bin2hex($inner)) . '>'],
            'ASCII85Decode' => ['[/ASCII85Decode /FlateDecode]', self::ascii85((string) gzcompress($inner))],
        };

        return self::build([
            4 => ['<< /Type /ObjStm /N 1 /First 4 /Filter ' . $filter . ' /Length ' . strlen($body) . ' >>', $body],
            5 => '<< /Type /XRef /Size 7 /W [1 2 1] >>',
        ]);
    }

    private static function ascii85(string $bytes): string
    {
        $out = '';
        foreach (str_split($bytes, 4) as $chunk) {
            $pad = 4 - strlen($chunk);
            $value = unpack('N', str_pad($chunk, 4, "\0"))[1];
            $group = '';
            for ($i = 0; $i < 5; ++$i) {
                $group = chr($value % 85 + 33) . $group;
                $value = intdiv($value, 85);
            }
            $out .= substr($group, 0, 5 - $pad);
        }

        return $out . '~>';
    }
}
