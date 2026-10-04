<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Uploads;

use ZipArchive;

/**
 * Decides whether a file that content-sniffs as a ZIP really is the Office
 * document its extension claims.
 *
 * finfo reports most .docx/.xlsx/.pptx files as plain `application/zip`, so
 * an allow-list that accepts that type for those extensions accepts ANY
 * archive renamed .docx (F-559, E-088: proven at message attachments,
 * resources and job CVs). A genuine OOXML package has a `[Content_Types].xml`
 * part and its main parts under word/, xl/ or ppt/.
 *
 * Macro-enabled packages are refused as well: a `vbaProject.bin` part, or a
 * `macroEnabled` content type, is a .docm/.xlsm/.pptm wearing a .docx name.
 * Office will not run those macros under the macro-free extension, but there
 * is no reason for a member upload to carry them.
 *
 * Nothing is extracted — only the central directory and one small XML part
 * are read — so a compression bomb costs nothing here.
 */
final class OfficeDocumentInspector
{
    private const MAIN_DIRECTORY = ['docx' => 'word/', 'xlsx' => 'xl/', 'pptx' => 'ppt/'];

    /** Content types are a few KB; anything larger is not a real package. */
    private const MAX_CONTENT_TYPES_BYTES = 256 * 1024;

    public static function isGenuineOoxml(string $path, string $extension): bool
    {
        $extension = strtolower($extension);
        $mainDirectory = self::MAIN_DIRECTORY[$extension] ?? null;
        if ($mainDirectory === null || ! class_exists(ZipArchive::class) || ! is_file($path)) {
            return false;
        }

        $zip = new ZipArchive();
        if ($zip->open($path, ZipArchive::RDONLY) !== true) {
            return false;
        }

        try {
            $index = $zip->locateName('[Content_Types].xml');
            if ($index === false) {
                return false;
            }
            $stat = $zip->statIndex($index);
            if ($stat === false || $stat['size'] > self::MAX_CONTENT_TYPES_BYTES) {
                return false;
            }
            $contentTypes = $zip->getFromIndex($index);
            if (! is_string($contentTypes) || stripos($contentTypes, 'macroEnabled') !== false) {
                return false;
            }

            $hasMainPart = false;
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $name = $zip->getNameIndex($i);
                if (! is_string($name)) {
                    continue;
                }
                if (str_ends_with(strtolower($name), 'vbaproject.bin')) {
                    return false;
                }
                if (str_starts_with($name, $mainDirectory)) {
                    $hasMainPart = true;
                }
            }

            return $hasMainPart;
        } finally {
            $zip->close();
        }
    }
}
