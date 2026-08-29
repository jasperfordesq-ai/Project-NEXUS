<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\Enterprise;

/**
 * Structured Logger Service
 *
 * Provides JSON-formatted logging with trace correlation for APM integration.
 * Compatible with DataDog, ELK Stack, and other log aggregation systems.
 */
class LoggerService
{
    private static ?LoggerService $instance = null;
    private string $channel;
    private string $logPath;
    private array $context = [];
    private bool $jsonFormat;

    public const EMERGENCY = 'emergency';
    public const ALERT = 'alert';
    public const CRITICAL = 'critical';
    public const ERROR = 'error';
    public const WARNING = 'warning';
    public const NOTICE = 'notice';
    public const INFO = 'info';
    public const DEBUG = 'debug';

    private const LEVEL_PRIORITY = [
        self::EMERGENCY => 0,
        self::ALERT => 1,
        self::CRITICAL => 2,
        self::ERROR => 3,
        self::WARNING => 4,
        self::NOTICE => 5,
        self::INFO => 6,
        self::DEBUG => 7,
    ];

    private string $minLevel;

    private function __construct(string $channel = 'nexus')
    {
        $this->channel = $channel;
        $this->logPath = getenv('LOG_PATH') ?: __DIR__ . '/../../../logs';
        $this->jsonFormat = getenv('LOG_FORMAT') !== 'text';
        $this->minLevel = getenv('LOG_LEVEL') ?: self::INFO;

        // Add default context
        $this->context = [
            'env' => getenv('APP_ENV') ?: 'production',
            'service' => getenv('DD_SERVICE') ?: 'nexus-app',
            'version' => self::platformVersion(),
        ];
    }

    public static function getInstance(string $channel = 'nexus'): self
    {
        if (self::$instance === null || self::$instance->channel !== $channel) {
            self::$instance = new self($channel);
        }
        return self::$instance;
    }

    /**
     * Create a new logger instance for a specific channel
     */
    public static function channel(string $channel): self
    {
        return new self($channel);
    }

    private static function platformVersion(): string
    {
        if (function_exists('config')) {
            $configuredVersion = config('app.version');
            if (is_string($configuredVersion) && $configuredVersion !== '') {
                return $configuredVersion;
            }
        }

        $envVersion = getenv('APP_VERSION');
        return is_string($envVersion) && $envVersion !== '' ? $envVersion : '1.7.0';
    }

    /**
     * Log an emergency message
     */
    public function emergency(string $message, array $context = []): void
    {
        $this->log(self::EMERGENCY, $message, $context);
    }

    /**
     * Log an alert message
     */
    public function alert(string $message, array $context = []): void
    {
        $this->log(self::ALERT, $message, $context);
    }

    /**
     * Log a critical message
     */
    public function critical(string $message, array $context = []): void
    {
        $this->log(self::CRITICAL, $message, $context);
    }

    /**
     * Log an error message
     */
    public function error(string $message, array $context = []): void
    {
        $this->log(self::ERROR, $message, $context);
    }

    /**
     * Log a warning message
     */
    public function warning(string $message, array $context = []): void
    {
        $this->log(self::WARNING, $message, $context);
    }

    /**
     * Log a notice message
     */
    public function notice(string $message, array $context = []): void
    {
        $this->log(self::NOTICE, $message, $context);
    }

    /**
     * Log an info message
     */
    public function info(string $message, array $context = []): void
    {
        $this->log(self::INFO, $message, $context);
    }

    /**
     * Log a debug message
     */
    public function debug(string $message, array $context = []): void
    {
        $this->log(self::DEBUG, $message, $context);
    }

    /**
     * Log a message at the specified level
     */
    public function log(string $level, string $message, array $context = []): void
    {
        // Check if level should be logged
        if (self::LEVEL_PRIORITY[$level] > self::LEVEL_PRIORITY[$this->minLevel]) {
            return;
        }

        $record = $this->createRecord($level, $message, $context);

        if ($this->jsonFormat) {
            $output = json_encode($record, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n";
        } else {
            $output = self::formatTextRecord($record);
        }

        $this->write($output, $level);
    }

    /**
     * Log an exception
     */
    public static function exception(\Throwable $exception, array $context = []): void
    {
        $context['exception'] = [
            'class' => get_class($exception),
            'message' => $exception->getMessage(),
            'code' => $exception->getCode(),
            'file' => $exception->getFile(),
            'line' => $exception->getLine(),
            'trace' => self::formatTrace($exception->getTrace()),
        ];

        if ($previous = $exception->getPrevious()) {
            $context['exception']['previous'] = [
                'class' => get_class($previous),
                'message' => $previous->getMessage(),
            ];
        }

        self::getInstance()->error($exception->getMessage(), $context);
    }

    /**
     * Create a log record
     */
    private function createRecord(string $level, string $message, array $context): array
    {
        $record = [
            'timestamp' => date('c'),
            'level' => strtoupper($level),
            'channel' => $this->channel,
            'message' => self::interpolate($message, $context),
        ];

        // Add trace correlation for DataDog APM
        $record['dd'] = self::getTraceContext();

        // Add request context
        $record['http'] = self::getHttpContext();

        // Add user context if available
        if ($userId = self::getUserId()) {
            $record['usr'] = ['id' => $userId];
        }

        // Merge contexts
        $record = array_merge($record, $this->context);

        // Add custom context
        if (!empty($context)) {
            // Remove interpolated values
            $cleanContext = array_filter($context, function ($key) {
                return !is_numeric($key);
            }, ARRAY_FILTER_USE_KEY);

            if (!empty($cleanContext)) {
                $record['context'] = $cleanContext;
            }
        }

        return $record;
    }

    /**
     * Get DataDog trace context
     */
    private static function getTraceContext(): array
    {
        $context = [];

        // DataDog PHP tracer
        if (function_exists('DDTrace\current_context')) {
            $ddContext = \DDTrace\current_context();
            if ($ddContext) {
                $context['trace_id'] = $ddContext['trace_id'] ?? null;
                $context['span_id'] = $ddContext['span_id'] ?? null;
            }
        }

        // Fallback to request ID
        if (empty($context['trace_id'])) {
            $context['trace_id'] = $_SERVER['HTTP_X_REQUEST_ID'] ?? $_SERVER['REQUEST_ID'] ?? uniqid('req_', true);
        }

        return array_filter($context);
    }

    /**
     * Get HTTP request context
     */
    private static function getHttpContext(): array
    {
        if (php_sapi_name() === 'cli') {
            return ['cli' => true];
        }

        return [
            'method' => $_SERVER['REQUEST_METHOD'] ?? null,
            'url' => $_SERVER['REQUEST_URI'] ?? null,
            'status_code' => http_response_code() ?: null,
            'client_ip' => self::getClientIp(),
            'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? null,
            'referer' => $_SERVER['HTTP_REFERER'] ?? null,
        ];
    }

    /**
     * Get client IP address
     */
    private static function getClientIp(): ?string
    {
        return \App\Core\ClientIp::get();
    }

    /**
     * Get current user ID
     */
    private static function getUserId(): ?int
    {
        // Try session
        if (isset($_SESSION['user_id'])) {
            return (int) $_SESSION['user_id'];
        }

        // Try Auth class if available
        if (class_exists('\\App\\Core\\Auth') && method_exists('\\App\\Core\\Auth', 'id')) {
            return \App\Core\Auth::id();
        }

        return null;
    }

    /**
     * Interpolate message placeholders
     */
    private static function interpolate(string $message, array $context): string
    {
        $replace = [];
        foreach ($context as $key => $value) {
            if (!is_array($value) && (!is_object($value) || method_exists($value, '__toString'))) {
                $replace['{' . $key . '}'] = $value;
            }
        }
        return strtr($message, $replace);
    }

    /**
     * Format stack trace
     */
    private static function formatTrace(array $trace): array
    {
        $formatted = [];
        foreach (array_slice($trace, 0, 10) as $frame) {
            $formatted[] = sprintf(
                '%s%s%s() at %s:%d',
                $frame['class'] ?? '',
                $frame['type'] ?? '',
                $frame['function'] ?? 'unknown',
                $frame['file'] ?? 'unknown',
                $frame['line'] ?? 0
            );
        }
        return $formatted;
    }

    /**
     * Format record as text
     */
    private static function formatTextRecord(array $record): string
    {
        return sprintf(
            "[%s] %s.%s: %s %s\n",
            $record['timestamp'],
            $record['channel'],
            $record['level'],
            $record['message'],
            !empty($record['context']) ? json_encode($record['context']) : ''
        );
    }

    /**
     * Write log entry
     */
    private function write(string $output, string $level): void
    {
        // Write to file
        $filename = $this->getLogFilename($level);
        $filepath = "{$this->logPath}/{$filename}";

        if (!is_dir($this->logPath)) {
            mkdir($this->logPath, 0755, true);
        }

        file_put_contents($filepath, $output, FILE_APPEND | LOCK_EX);

        // Also write to stdout in production for container logging
        if (getenv('LOG_STDOUT') === 'true' || php_sapi_name() === 'cli') {
            if (self::LEVEL_PRIORITY[$level] <= self::LEVEL_PRIORITY[self::WARNING]) {
                fwrite(STDERR, $output);
            } else {
                fwrite(STDOUT, $output);
            }
        }
    }

    /**
     * Get log filename based on level
     */
    private function getLogFilename(string $level): string
    {
        $date = date('Y-m-d');

        if (self::LEVEL_PRIORITY[$level] <= self::LEVEL_PRIORITY[self::ERROR]) {
            return "error-{$date}.log";
        }

        return "{$this->channel}-{$date}.log";
    }

    /**
     * Add context that will be included in all log entries
     */
    public function withContext(array $context): self
    {
        $this->context = array_merge($this->context, $context);
        return $this;
    }

    /**
     * Clear additional context
     */
    public function clearContext(): self
    {
        $this->context = [
            'env' => getenv('APP_ENV') ?: 'production',
            'service' => getenv('DD_SERVICE') ?: 'nexus-app',
            'version' => self::platformVersion(),
        ];
        return $this;
    }
}
