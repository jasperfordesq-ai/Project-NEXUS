<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Uploads;

/**
 * Decides whether an uploaded PDF carries active content (F-551, reported by
 * Cyphere: a group file whose embedded JavaScript ran when a member opened it in
 * a browser PDF viewer).
 *
 * There is no PDF tool on the servers, so this is a small structural reader, not
 * a renderer. Viewers do not read a PDF top to bottom: they jump to objects
 * through the cross-reference table, and rebuild it by searching for
 * "N G obj" when it is broken. So this reader looks at the file two ways:
 *
 * - a top-to-bottom walk, in which literal and hex strings are skipped as
 *   strings (text such as "(>> stream ... endstream)" cannot hide a
 *   dictionary) and stream data is skipped to the first `endstream`;
 * - then EVERY "N G obj" header anywhere in the file, including inside other
 *   streams' data, is parsed as an object. An object smuggled into another
 *   stream's data (found in review, 3 Oct 2026: invisible to the walk, loaded
 *   by pdf.js through the xref table) is therefore still read.
 *
 * Object streams (PDF 1.5 compressed objects, where /JS can hide) are decoded
 * and walked too. Their data counts as decoded only when the decode is
 * provably complete (deflate reached its end marker, the ASCII filters their
 * terminator), so a literal "endstream" inside the data cannot cut the scan
 * short. Names are compared after #xx unescaping, so /J#53 is /JS.
 *
 * Every name anywhere in the structure is checked against ACTIVE_NAMES. The
 * check fails closed: a file that cannot be fully read (unsupported or
 * oversized object-stream encoding, an encrypted file whose object streams
 * cannot be read, absurd nesting) is reported as UNINSPECTABLE, never CLEAN.
 */
final class PdfActiveContentInspector
{
    public const CLEAN = 'clean';
    public const ACTIVE = 'active';
    public const UNINSPECTABLE = 'uninspectable';

    /**
     * Names whose presence means the document can run code, launch something,
     * or send data when opened or interacted with. Ordinary links (/URI, /GoTo)
     * and a plain /OpenAction (commonly "open at page 1, fit width") are not here.
     * Keyed for an isset() lookup: this runs for every name in the file.
     *
     * @var array<string, true>
     */
    private const ACTIVE_NAMES = [
        'JS' => true,
        'JavaScript' => true,
        'Launch' => true,
        'SubmitForm' => true,
        'ImportData' => true,
        'RichMedia' => true,
        'XFA' => true,
    ];

    private const MAX_DEPTH = 100;

    /**
     * Ceiling on decoded object-stream bytes per file, against inflate bombs.
     * Object streams hold dictionaries, not images; real files stay far below.
     */
    private const MAX_DECODED_BYTES = 16 * 1024 * 1024;

    /**
     * Seconds one file may take. The slowest of 400 real PDFs took 0.34 s; a
     * crafted 59 KB file once took 26 s (review, 3 Oct 2026). Running out of
     * time means UNINSPECTABLE, never CLEAN.
     */
    public const DEFAULT_TIME_BUDGET = 2.0;

    /** parseValue() calls between clock reads. */
    private const CLOCK_INTERVAL = 4096;

    private float $deadline = INF;
    private int $ticks = 0;

    private string $data = '';
    private int $length = 0;
    private int $pos = 0;
    private int $decodedBytes = 0;
    private bool $encrypted = false;
    private bool $sawObjectStream = false;
    private ?string $verdict = null;

    /** How many `endstream` occurrences are tried as the end of an object stream's data. */
    private const MAX_STREAM_END_CANDIDATES = 64;

    /** @var list<string> object-stream bodies queued for a second pass */
    private array $objectStreams = [];

    /** @var array<int, true> stream-data offsets already handled, so both passes decode each object stream once */
    private array $seenStreams = [];

    /**
     * @param float|null $deadline absolute microtime(true) by which to give up;
     *                             the earlier of it and the per-file budget applies
     */
    public static function inspectFile(string $path, ?float $deadline = null): string
    {
        $contents = @file_get_contents($path);

        return is_string($contents) ? (new self())->inspect($contents, $deadline) : self::UNINSPECTABLE;
    }

    public function inspect(string $contents, ?float $deadline = null): string
    {
        $this->deadline = min(microtime(true) + self::DEFAULT_TIME_BUDGET, $deadline ?? INF);
        $this->ticks = 0;
        if (microtime(true) >= $this->deadline) {
            return self::UNINSPECTABLE;
        }
        $this->decodedBytes = 0;
        $this->encrypted = false;
        $this->sawObjectStream = false;
        $this->verdict = null;
        $this->objectStreams = [];
        $this->seenStreams = [];

        $this->walk($contents, true);
        $this->readEveryObjectHeader($contents);

        // Object streams can nest object streams only through their own
        // dictionaries; walking them may queue more, so drain the queue.
        while ($this->verdict === null && $this->objectStreams !== []) {
            $this->walk(array_shift($this->objectStreams), false);
        }

        if ($this->verdict !== null) {
            return $this->verdict;
        }

        // In an encrypted file the object streams are ciphertext: names inside
        // them cannot be read, so their absence proves nothing.
        if ($this->encrypted && $this->sawObjectStream) {
            return self::UNINSPECTABLE;
        }

        return self::CLEAN;
    }

    /**
     * Parse the object after every "N G obj" header in the file, wherever it
     * sits — including inside another stream's data, where the top-to-bottom
     * walk skipped it but a viewer following the xref table would load it.
     */
    private function readEveryObjectHeader(string $contents): void
    {
        if ($this->verdict !== null
            || preg_match_all('/\d+[\x00\t\n\f\r ]+\d+[\x00\t\n\f\r ]+obj/', $contents, $matches, PREG_OFFSET_CAPTURE) === false) {
            return;
        }

        $this->data = $contents;
        $this->length = strlen($contents);
        foreach ($matches[0] as [$header, $offset]) {
            if ($this->verdict !== null) {
                return;
            }
            $this->pos = $offset + strlen($header);
            $value = $this->parseValue(0);
            $this->skipWhitespaceAndComments();
            if (substr($this->data, $this->pos, 6) === 'stream') {
                $this->pos += 6;
                $this->consumeStream(is_array($value) && ($value['type'] ?? null) === 'dict' ? $value : null);
            }
        }
    }

    private function walk(string $data, bool $allowStreams): void
    {
        $this->data = $data;
        $this->length = strlen($data);
        $this->pos = 0;
        $lastDictionary = null;

        while ($this->verdict === null) {
            $this->skipWhitespaceAndComments();
            if ($this->pos >= $this->length) {
                return;
            }

            $char = $this->data[$this->pos];
            if ($char === '<' && $this->peek(1) === '<') {
                $lastDictionary = $this->parseValue(0);
                continue;
            }
            if ($this->isDelimiter($char)) {
                $value = $this->parseValue(0);
                if (! is_array($value)) {
                    $lastDictionary = null;
                }
                continue;
            }

            $token = $this->readRegularToken();
            if ($token === 'stream' && $allowStreams) {
                $this->consumeStream(is_array($lastDictionary) && ($lastDictionary['type'] ?? null) === 'dict' ? $lastDictionary : null);
                $lastDictionary = null;
            } elseif (! in_array($token, ['obj', 'R'], true) && ! is_numeric($token)) {
                $lastDictionary = null;
            }
        }
    }

    /**
     * Parse one value starting at the current position. Dictionaries come back
     * as ['type' => 'dict', 'entries' => [key => value]], arrays as
     * ['type' => 'array', 'items' => [...]], names as ['type' => 'name', ...];
     * everything else as a scalar string. Every name is checked as it is read.
     *
     * @return array<string, mixed>|string|null
     */
    private function parseValue(int $depth): array|string|null
    {
        if ($depth > self::MAX_DEPTH) {
            $this->verdict = self::UNINSPECTABLE;
            return null;
        }
        if (++$this->ticks % self::CLOCK_INTERVAL === 0 && microtime(true) >= $this->deadline) {
            $this->verdict = self::UNINSPECTABLE;
            return null;
        }

        $this->skipWhitespaceAndComments();
        if ($this->pos >= $this->length || $this->verdict !== null) {
            return null;
        }

        $char = $this->data[$this->pos];

        if ($char === '/') {
            ++$this->pos;
            $name = $this->decodeName($this->readRegularToken());
            if (isset(self::ACTIVE_NAMES[$name])) {
                $this->verdict = self::ACTIVE;
            }
            if ($name === 'Encrypt') {
                $this->encrypted = true;
            }
            return ['type' => 'name', 'value' => $name];
        }

        if ($char === '(') {
            $this->skipLiteralString();
            return '';
        }

        if ($char === '<') {
            if ($this->peek(1) === '<') {
                $this->pos += 2;
                $entries = [];
                while ($this->verdict === null) {
                    $this->skipWhitespaceAndComments();
                    if ($this->pos >= $this->length) {
                        break;
                    }
                    if ($this->data[$this->pos] === '>' && $this->peek(1) === '>') {
                        $this->pos += 2;
                        break;
                    }
                    $key = $this->parseValue($depth + 1);
                    if (! is_array($key) || ($key['type'] ?? null) !== 'name') {
                        // Not a well-formed key: keep reading so every name in
                        // the dictionary is still checked.
                        continue;
                    }
                    $value = $this->parseValueWithReference($depth + 1);
                    $entries[$key['value']] = $value;
                }
                return ['type' => 'dict', 'entries' => $entries];
            }

            $end = strpos($this->data, '>', $this->pos + 1);
            $this->pos = $end === false ? $this->length : $end + 1;
            return '';
        }

        if ($char === '[') {
            ++$this->pos;
            $items = [];
            while ($this->verdict === null) {
                $this->skipWhitespaceAndComments();
                if ($this->pos >= $this->length) {
                    break;
                }
                if ($this->data[$this->pos] === ']') {
                    ++$this->pos;
                    break;
                }
                $items[] = $this->parseValue($depth + 1);
            }
            return ['type' => 'array', 'items' => $items];
        }

        if ($this->isDelimiter($char)) {
            // A stray ')', '>', ']', '{' or '}': step over it.
            ++$this->pos;
            return null;
        }

        return $this->readRegularToken();
    }

    /**
     * Dictionary values may be indirect references ("12 0 R"). Return a marker
     * for those so a caller can tell "filter given indirectly" from "no filter".
     *
     * @return array<string, mixed>|string|null
     */
    private function parseValueWithReference(int $depth): array|string|null
    {
        $value = $this->parseValue($depth);
        if (is_string($value) && ctype_digit($value)) {
            $saved = $this->pos;
            $this->skipWhitespaceAndComments();
            $generation = $this->pos < $this->length && ctype_digit($this->data[$this->pos]) ? $this->readRegularToken() : null;
            $this->skipWhitespaceAndComments();
            if ($generation !== null && $this->pos < $this->length && $this->data[$this->pos] === 'R'
                && ($this->pos + 1 >= $this->length || $this->isWhitespace($this->data[$this->pos + 1]) || $this->isDelimiter($this->data[$this->pos + 1]))) {
                ++$this->pos;
                return ['type' => 'ref'];
            }
            $this->pos = $saved;
        }

        return $value;
    }

    /** @param array<string, mixed>|null $dictionary */
    private function consumeStream(?array $dictionary): void
    {
        // The keyword is followed by CRLF or LF (CR alone is tolerated).
        if ($this->peek(0) === "\r") {
            ++$this->pos;
        }
        if ($this->peek(0) === "\n") {
            ++$this->pos;
        }

        $start = $this->pos;
        $firstEnd = strpos($this->data, 'endstream', $start);
        // The walk resumes after the first `endstream`; whatever a misleading
        // framing hides beyond it is read by readEveryObjectHeader().
        $this->pos = $firstEnd === false ? $this->length : $firstEnd + strlen('endstream');

        $entries = $dictionary['entries'] ?? [];
        $isObjectStream = $this->isName($entries['Type'] ?? null, 'ObjStm') || array_key_exists('First', $entries);
        if (! $isObjectStream || isset($this->seenStreams[$start])) {
            return;
        }
        $this->seenStreams[$start] = true;

        $this->sawObjectStream = true;
        if ($this->encrypted) {
            // Ciphertext; inspect() reports the file as uninspectable.
            return;
        }

        $decoded = $this->decodeObjectStream($start, $entries);
        if ($decoded === null) {
            $this->verdict = self::UNINSPECTABLE;
            return;
        }

        $this->objectStreams[] = $decoded;
    }

    /**
     * Find where an object stream's data really ends, and decode it. A plain
     * numeric /Length is tried first, then each `endstream` in turn, because
     * the data may itself contain that word. The first candidate whose decode
     * is complete wins; if none is, the data cannot be read and the caller
     * fails closed.
     *
     * @param array<string, mixed> $entries
     */
    private function decodeObjectStream(int $start, array $entries): ?string
    {
        $filters = $this->filterNames($entries['Filter'] ?? null);
        if ($filters === null) {
            return null;
        }

        $parameters = $entries['DecodeParms'] ?? ($entries['DP'] ?? null);
        if ($parameters !== null && $this->usesPredictor($parameters)) {
            return null;
        }

        $ends = [];
        $length = $entries['Length'] ?? null;
        if (is_string($length) && ctype_digit($length) && $start + (int) $length <= $this->length) {
            $ends[] = $start + (int) $length;
        }
        $offset = $start;
        while (count($ends) < self::MAX_STREAM_END_CANDIDATES
            && ($found = strpos($this->data, 'endstream', $offset)) !== false) {
            $ends[] = $found;
            $offset = $found + 1;
        }
        if ($ends === []) {
            $ends[] = $this->length;
        }

        if ($filters === []) {
            // Unencoded: completeness cannot be proven, so read the widest
            // candidate. Reading too much only risks a false alarm.
            return $this->account(substr($this->data, $start, max($ends) - $start));
        }

        foreach (array_unique($ends) as $end) {
            $data = $this->decodeComplete(rtrim(substr($this->data, $start, $end - $start), "\r\n"), $filters);
            if ($data !== null) {
                return $this->account($data);
            }
        }

        return null;
    }

    /** @param list<string> $filters */
    private function decodeComplete(string $data, array $filters): ?string
    {
        foreach ($filters as $filter) {
            $data = match ($filter) {
                'FlateDecode', 'Fl' => $this->inflate($data),
                'ASCIIHexDecode', 'AHx' => $this->asciiHex($data),
                'ASCII85Decode', 'A85' => $this->ascii85($data),
                default => null,
            };
            if ($data === null) {
                return null;
            }
        }

        return $data;
    }

    private function account(string $data): ?string
    {
        $this->decodedBytes += strlen($data);

        return $this->decodedBytes > self::MAX_DECODED_BYTES ? null : $data;
    }

    /**
     * @return list<string>|null null when the filter list cannot be read
     *                           (an indirect reference, or not names)
     */
    private function filterNames(mixed $filter): ?array
    {
        if ($filter === null) {
            return [];
        }
        if (is_array($filter) && ($filter['type'] ?? null) === 'name') {
            return [$filter['value']];
        }
        if (is_array($filter) && ($filter['type'] ?? null) === 'array') {
            $names = [];
            foreach ($filter['items'] as $item) {
                if (! is_array($item) || ($item['type'] ?? null) !== 'name') {
                    return null;
                }
                $names[] = $item['value'];
            }
            return $names;
        }

        return null;
    }

    private function usesPredictor(mixed $parameters): bool
    {
        if (! is_array($parameters)) {
            return false;
        }
        if (($parameters['type'] ?? null) === 'ref') {
            return true;
        }
        if (($parameters['type'] ?? null) === 'array') {
            foreach ($parameters['items'] as $item) {
                if ($this->usesPredictor($item)) {
                    return true;
                }
            }
            return false;
        }
        if (($parameters['type'] ?? null) !== 'dict') {
            return false;
        }

        $predictor = $parameters['entries']['Predictor'] ?? null;

        return $predictor !== null && $predictor !== '1';
    }

    private function inflate(string $data): ?string
    {
        // PDF's FlateDecode is zlib-wrapped; some writers emit raw deflate.
        return $this->inflateWith(ZLIB_ENCODING_DEFLATE, $data)
            ?? $this->inflateWith(ZLIB_ENCODING_RAW, $data);
    }

    private function inflateWith(int $encoding, string $data): ?string
    {
        $context = @inflate_init($encoding);
        if ($context === false) {
            return null;
        }

        $output = '';
        $budget = self::MAX_DECODED_BYTES - $this->decodedBytes;
        foreach (str_split($data, 65536) as $chunk) {
            if (microtime(true) >= $this->deadline) {
                return null;
            }
            $piece = @inflate_add($context, $chunk, ZLIB_SYNC_FLUSH);
            if ($piece === false) {
                return null;
            }
            $output .= $piece;
            if (strlen($output) > $budget) {
                return null;
            }
            if (inflate_get_status($context) === ZLIB_STREAM_END) {
                return $output;
            }
        }

        // The data ran out before deflate's end marker: truncated, or cut
        // short by a literal "endstream" inside it. Never treat as complete.
        return null;
    }

    private function asciiHex(string $data): ?string
    {
        $end = strpos($data, '>');
        if ($end === false) {
            return null;
        }
        $hex = preg_replace('/\s+/', '', substr($data, 0, $end));
        if (! is_string($hex) || preg_match('/[^0-9A-Fa-f]/', $hex) === 1) {
            return null;
        }
        if (strlen($hex) % 2 === 1) {
            $hex .= '0';
        }

        $binary = hex2bin($hex);

        return $binary === false ? null : $binary;
    }

    private function ascii85(string $data): ?string
    {
        $data = preg_replace('/\s+/', '', $data) ?? '';
        if (str_starts_with($data, '<~')) {
            $data = substr($data, 2);
        }
        $end = strpos($data, '~>');
        if ($end === false) {
            return null;
        }
        $data = substr($data, 0, $end);

        $output = '';
        $group = [];
        $length = strlen($data);
        for ($i = 0; $i < $length; ++$i) {
            $char = $data[$i];
            if ($char === 'z' && $group === []) {
                $output .= "\0\0\0\0";
                continue;
            }
            $code = ord($char) - 33;
            if ($code < 0 || $code > 84) {
                return null;
            }
            $group[] = $code;
            if (count($group) === 5) {
                $output .= $this->ascii85Group($group, 4);
                $group = [];
            }
        }
        if ($group !== []) {
            $bytes = count($group) - 1;
            if ($bytes < 1) {
                return null;
            }
            $output .= $this->ascii85Group(array_pad($group, 5, 84), $bytes);
        }

        return $output;
    }

    /** @param list<int> $group */
    private function ascii85Group(array $group, int $bytes): string
    {
        $value = 0;
        foreach ($group as $code) {
            $value = $value * 85 + $code;
        }

        return substr(pack('N', $value & 0xFFFFFFFF), 0, $bytes);
    }

    private function decodeName(string $raw): string
    {
        if (! str_contains($raw, '#')) {
            return $raw;
        }

        return (string) preg_replace_callback(
            '/#([0-9A-Fa-f]{2})/',
            static fn (array $match): string => chr((int) hexdec($match[1])),
            $raw
        );
    }

    private function isName(mixed $value, string $name): bool
    {
        return is_array($value) && ($value['type'] ?? null) === 'name' && $value['value'] === $name;
    }

    private function skipLiteralString(): void
    {
        $depth = 0;
        while ($this->pos < $this->length) {
            $char = $this->data[$this->pos++];
            if ($char === '\\') {
                ++$this->pos;
            } elseif ($char === '(') {
                ++$depth;
            } elseif ($char === ')') {
                if (--$depth === 0) {
                    return;
                }
            }
        }
    }

    private function skipWhitespaceAndComments(): void
    {
        while ($this->pos < $this->length) {
            $this->pos += strspn($this->data, "\0\t\n\f\r ", $this->pos);
            if ($this->pos < $this->length && $this->data[$this->pos] === '%') {
                $this->pos += strcspn($this->data, "\r\n", $this->pos);
                continue;
            }
            return;
        }
    }

    private function readRegularToken(): string
    {
        $span = strcspn($this->data, "\0\t\n\f\r ()<>[]{}/%", $this->pos);
        if ($span === 0) {
            // Defensive: never stall on an unexpected byte.
            ++$this->pos;
            return '';
        }
        $token = substr($this->data, $this->pos, $span);
        $this->pos += $span;

        return $token;
    }

    private function peek(int $offset): ?string
    {
        $index = $this->pos + $offset;

        return $index < $this->length ? $this->data[$index] : null;
    }

    private function isDelimiter(string $char): bool
    {
        return str_contains('()<>[]{}/%', $char);
    }

    private function isWhitespace(string $char): bool
    {
        return str_contains("\0\t\n\f\r ", $char);
    }
}
