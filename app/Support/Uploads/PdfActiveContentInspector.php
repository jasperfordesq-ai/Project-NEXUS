<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Uploads;

/**
 * Decides whether an uploaded PDF carries active content (F-552's sibling,
 * F-551: a group file whose embedded JavaScript ran when a member opened it in a
 * browser PDF viewer).
 *
 * There is no PDF tool on the servers, so this is a small structural reader, not
 * a renderer. It walks the file's objects the way a viewer's parser does:
 *
 * - literal and hex strings are skipped as strings, so text such as
 *   "(>> stream ... endstream)" can never hide a dictionary from the scan;
 * - stream data is skipped up to the FIRST `endstream` (never further, so a
 *   lying /Length cannot make the reader jump over real objects);
 * - object streams (PDF 1.5 compressed objects, where /JS can hide) are decoded
 *   and walked too;
 * - names are compared after #xx unescaping, so /J#53 is /JS.
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
     */
    private const ACTIVE_NAMES = [
        'JS',
        'JavaScript',
        'Launch',
        'SubmitForm',
        'ImportData',
        'RichMedia',
        'XFA',
    ];

    private const MAX_DEPTH = 100;

    /** Ceiling on decoded object-stream bytes per file, against inflate bombs. */
    private const MAX_DECODED_BYTES = 64 * 1024 * 1024;

    private string $data = '';
    private int $length = 0;
    private int $pos = 0;
    private int $decodedBytes = 0;
    private bool $encrypted = false;
    private bool $sawObjectStream = false;
    private ?string $verdict = null;

    /** @var list<string> object-stream bodies queued for a second pass */
    private array $objectStreams = [];

    public static function inspectFile(string $path): string
    {
        $contents = @file_get_contents($path);

        return is_string($contents) ? (new self())->inspect($contents) : self::UNINSPECTABLE;
    }

    public function inspect(string $contents): string
    {
        $this->decodedBytes = 0;
        $this->encrypted = false;
        $this->sawObjectStream = false;
        $this->verdict = null;
        $this->objectStreams = [];

        $this->walk($contents, true);

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

        $this->skipWhitespaceAndComments();
        if ($this->pos >= $this->length || $this->verdict !== null) {
            return null;
        }

        $char = $this->data[$this->pos];

        if ($char === '/') {
            ++$this->pos;
            $name = $this->decodeName($this->readRegularToken());
            if (in_array($name, self::ACTIVE_NAMES, true)) {
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
        $end = strpos($this->data, 'endstream', $start);
        $end = $end === false ? $this->length : $end;
        $this->pos = min($this->length, $end + strlen('endstream'));

        $entries = $dictionary['entries'] ?? [];
        $isObjectStream = $this->isName($entries['Type'] ?? null, 'ObjStm') || array_key_exists('First', $entries);
        if (! $isObjectStream) {
            return;
        }

        $this->sawObjectStream = true;
        if ($this->encrypted) {
            // Ciphertext; inspect() reports the file as uninspectable.
            return;
        }

        $decoded = $this->decodeStream(substr($this->data, $start, $end - $start), $entries);
        if ($decoded === null) {
            $this->verdict = self::UNINSPECTABLE;
            return;
        }

        $this->objectStreams[] = $decoded;
    }

    /** @param array<string, mixed> $entries */
    private function decodeStream(string $raw, array $entries): ?string
    {
        $filters = $this->filterNames($entries['Filter'] ?? null);
        if ($filters === null) {
            return null;
        }

        $parameters = $entries['DecodeParms'] ?? ($entries['DP'] ?? null);
        if ($parameters !== null && $this->usesPredictor($parameters)) {
            return null;
        }

        $data = rtrim($raw, "\r\n");
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
            $piece = @inflate_add($context, $chunk, ZLIB_SYNC_FLUSH);
            if ($piece === false) {
                return null;
            }
            $output .= $piece;
            if (strlen($output) > $budget) {
                return null;
            }
            if (inflate_get_status($context) === ZLIB_STREAM_END) {
                break;
            }
        }

        return $output;
    }

    private function asciiHex(string $data): ?string
    {
        $end = strpos($data, '>');
        $hex = preg_replace('/\s+/', '', $end === false ? $data : substr($data, 0, $end));
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
        if ($end !== false) {
            $data = substr($data, 0, $end);
        }

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
