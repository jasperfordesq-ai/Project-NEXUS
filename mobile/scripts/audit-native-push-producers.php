<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

use PhpParser\Node;
use PhpParser\NodeFinder;
use PhpParser\ParserFactory;
use PhpParser\PrettyPrinter\Standard;

require dirname(__DIR__, 2) . '/vendor/autoload.php';

$root = dirname(__DIR__, 2);
$parser = (new ParserFactory())->createForNewestSupportedVersion();
$printer = new Standard();
$finder = new NodeFinder();
$rows = [];

$targets = [
    'NotificationDispatcher::fanOutPush' => ['recipient' => 0, 'title' => null, 'body' => 2, 'type' => 1, 'data' => null, 'link' => 3],
    // Indirect entry points that call fanOutPush() inside the dispatcher.
    'NotificationDispatcher::dispatch' => ['recipient' => 0, 'title' => null, 'body' => 4, 'type' => 3, 'data' => null, 'link' => 5],
    'NotificationDispatcher::dispatchHotMatch' => ['recipient' => 0, 'title' => null, 'body' => null, 'type' => null, 'fixed_type' => 'hot_match', 'data' => null, 'link' => null, 'fixed_link' => '/matches?highlight=listing-{listing_id}'],
    'NotificationDispatcher::dispatchMutualMatch' => ['recipient' => 0, 'title' => null, 'body' => null, 'type' => null, 'fixed_type' => 'mutual_match', 'data' => null, 'link' => null, 'fixed_link' => '/matches?type=mutual&highlight=listing-{listing_id}'],
    'NotificationDispatcher::dispatchMatchDigest' => ['recipient' => 0, 'title' => null, 'body' => null, 'type' => null, 'fixed_type' => 'match_digest', 'data' => null, 'link' => null, 'fixed_link' => '/matches'],
    'NotificationDispatcher::dispatchMatchApprovalRequest' => ['recipient' => 0, 'title' => null, 'body' => null, 'type' => null, 'fixed_type' => 'match_approval_request', 'data' => null, 'link' => null, 'fixed_link' => '/broker/matches/requests/{request_id}'],
    'NotificationDispatcher::dispatchMatchApproved' => ['recipient' => 0, 'title' => null, 'body' => null, 'type' => null, 'fixed_type' => 'match_approved', 'data' => null, 'link' => null, 'fixed_link' => '/listings/{listing_id}'],
    'NotificationDispatcher::dispatchMatchRejected' => ['recipient' => 0, 'title' => null, 'body' => null, 'type' => null, 'fixed_type' => 'match_rejected', 'data' => null, 'link' => null, 'fixed_link' => '/matches'],
    'NotificationDispatcher::send' => ['recipient' => 0, 'title' => null, 'body' => null, 'body_data_key' => 'message', 'type' => 1, 'data' => 2, 'link' => null],
    'NotificationDispatcher::notifyAdmins' => ['recipient' => null, 'title' => null, 'body' => 2, 'type' => 0, 'data' => 1, 'link' => null],
    'NotificationDispatcher::notifyModerationAdmins' => ['recipient' => null, 'title' => null, 'body' => null, 'type' => 0, 'data' => null, 'link' => 1],
    'NotificationDispatcher::dispatchVerificationPassed' => ['recipient' => 0, 'title' => null, 'body' => null, 'type' => null, 'fixed_type' => 'verification_passed', 'data' => null, 'link' => null, 'fixed_link' => '/settings/verification'],
    'NotificationDispatcher::dispatchVerificationFailed' => ['recipient' => 0, 'title' => null, 'body' => null, 'type' => null, 'fixed_type' => 'verification_failed', 'data' => null, 'link' => null, 'fixed_link' => '/settings/verification'],
    'NotificationDispatcher::dispatchVerificationCompletedToAdmins' => ['recipient' => null, 'title' => null, 'body' => null, 'type' => null, 'fixed_type' => 'verification_completed', 'data' => null, 'link' => null, 'fixed_link' => '/admin/identity-verifications'],
    'RealtimeService::broadcastAndPush' => ['recipient' => 0, 'title' => 1, 'body' => null, 'type' => null, 'data' => 2, 'link' => null],
    'FCMPushService::sendToUser' => ['recipient' => 0, 'title' => 1, 'body' => 2, 'type' => null, 'data' => 3, 'link' => null],
    'FCMPushService::sendToUsers' => ['recipient' => 0, 'title' => 1, 'body' => 2, 'type' => null, 'data' => 3, 'link' => null],
];

$iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root . '/app'));
foreach ($iterator as $file) {
    if (!$file->isFile() || $file->getExtension() !== 'php') {
        continue;
    }
    $absolute = $file->getPathname();
    $relative = str_replace('\\', '/', substr($absolute, strlen($root) + 1));
    $source = file_get_contents($absolute);
    if ($source === false || !preg_match('/(?:NotificationDispatcher|RealtimeService|FCMPushService)\s*::/', $source)) {
        continue;
    }

    try {
        $ast = $parser->parse($source) ?? [];
    } catch (Throwable $error) {
        fwrite(STDERR, "Unable to parse {$relative}: {$error->getMessage()}\n");
        exit(1);
    }

    /** @var list<Node\Expr\StaticCall> $calls */
    $calls = $finder->findInstanceOf($ast, Node\Expr\StaticCall::class);
    foreach ($calls as $call) {
        if (!$call->class instanceof Node\Name || !$call->name instanceof Node\Identifier) {
            continue;
        }
        $class = strtolower($call->class->getLast()) === 'self'
            ? 'self'
            : $call->class->getLast();
        $signature = $class . '::' . $call->name->toString();
        if (!isset($targets[$signature])) {
            continue;
        }
        $shape = $targets[$signature];
        $recipient = $shape['recipient'] !== null ? ($call->args[$shape['recipient']]->value ?? null) : null;
        $title = $shape['title'] !== null ? ($call->args[$shape['title']]->value ?? null) : null;
        $body = $shape['body'] !== null
            ? ($call->args[$shape['body']]->value ?? null)
            : (isset($shape['body_data_key']) ? arrayValue($call->args[$shape['data']]->value ?? null, $shape['body_data_key']) : null);
        $data = $shape['data'] !== null ? ($call->args[$shape['data']]->value ?? null) : null;
        $type = isset($shape['fixed_type'])
            ? null
            : ($shape['type'] !== null
            ? ($call->args[$shape['type']]->value ?? null)
            : arrayValue($data, 'type'));
        $link = isset($shape['fixed_link'])
            ? null
            : ($shape['link'] !== null
            ? ($call->args[$shape['link']]->value ?? null)
            : (arrayValue($data, 'link') ?? arrayValue($data, 'url') ?? arrayValue($data, 'cta_url')));

        $rows[] = [
            'id' => $relative . ':' . $call->getStartLine() . ':' . $signature,
            'file' => $relative,
            'line' => $call->getStartLine(),
            'transport' => $signature,
            'role' => in_array($relative, ['app/Services/NotificationDispatcher.php', 'app/Services/RealtimeService.php'], true)
                && str_starts_with($signature, 'FCMPushService::')
                ? 'transport_boundary'
                : 'producer',
            'recipient_expression' => expression($recipient, $printer),
            'title_expression' => expression($title, $printer),
            'body_expression' => expression($body, $printer),
            'type_expression' => $shape['fixed_type'] ?? expression($type, $printer),
            'link_expression' => $shape['fixed_link'] ?? expression($link, $printer),
            'data_expression' => expression($data, $printer),
        ];
    }
}

usort($rows, static fn (array $a, array $b): int => [$a['file'], $a['line']] <=> [$b['file'], $b['line']]);
$json = json_encode([
    'schema_version' => 3,
    'generated_by' => 'mobile/scripts/audit-native-push-producers.php',
    'producer_count' => count($rows),
    'producers' => $rows,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n";

$output = $root . '/mobile/config/native-push-producer-inventory.json';
if (in_array('--write', $argv, true)) {
    if (!is_dir(dirname($output))) {
        mkdir(dirname($output), 0777, true);
    }
    file_put_contents($output, $json);
    fwrite(STDOUT, 'Wrote ' . count($rows) . " native push producer calls.\n");
    exit(0);
}

if (in_array('--check', $argv, true)) {
    $existing = is_file($output) ? file_get_contents($output) : false;
    if ($existing !== $json) {
        fwrite(STDERR, "Native push producer inventory is stale. Run the script with --write.\n");
        exit(1);
    }
    fwrite(STDOUT, 'Native push producer inventory is current: ' . count($rows) . " calls.\n");
    exit(0);
}

fwrite(STDOUT, $json);

function arrayValue(?Node $node, string $key): ?Node
{
    if (!$node instanceof Node\Expr\Array_) {
        return null;
    }
    foreach ($node->items as $item) {
        if ($item === null || !$item->key instanceof Node\Scalar\String_) {
            continue;
        }
        if ($item->key->value === $key) {
            return $item->value;
        }
    }
    return null;
}

function expression(?Node $node, Standard $printer): ?string
{
    if ($node === null) {
        return null;
    }
    if ($node instanceof Node\Scalar\String_) {
        return $node->value;
    }
    return $printer->prettyPrintExpr($node);
}
