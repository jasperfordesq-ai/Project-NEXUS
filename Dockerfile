# =============================================================================
# Project NEXUS - Development Dockerfile
# =============================================================================
# Uses Apache with mod_rewrite (required for .htaccess routing)
# PHP 8.1 with all required extensions
# =============================================================================

FROM php:8.5.9-apache

# Build arguments
ARG DEBIAN_FRONTEND=noninteractive

# =============================================================================
# System Dependencies
# =============================================================================
# `apt-get -y upgrade` first: the pinned php base image ships Debian packages
# that accumulate known CVEs between its releases — the Trivy container gate
# blocks on fixed-but-not-installed CRITICAL/HIGH findings.
RUN apt-get -o Acquire::Retries=3 update && apt-get -o Acquire::Retries=3 -y upgrade && apt-get -o Acquire::Retries=3 install -y --no-install-recommends \
    # Build tools
    libpng-dev \
    libjpeg-dev \
    libwebp-dev \
    libfreetype6-dev \
    libicu-dev \
    libzip-dev \
    libonig-dev \
    libxml2-dev \
    libcurl4-openssl-dev \
    libgmp-dev \
    # Utilities
    curl \
    git \
    unzip \
    default-mysql-client \
    webp \
    # Clean up
    && rm -rf /var/lib/apt/lists/*

# =============================================================================
# PHP Extensions (matching composer.json requirements)
# =============================================================================
RUN docker-php-ext-configure gd \
        --with-freetype \
        --with-jpeg \
        --with-webp \
    && docker-php-ext-install -j$(nproc) \
        pdo_mysql \
        gd \
        exif \
        intl \
        zip \
        mbstring \
        bcmath \
        gmp \
        pcntl \
        opcache \
        xml \
        curl \
        fileinfo

# Redis extension (for sessions/cache).
# pecl.php.net intermittently 504s / serves truncated tarballs, which repeatedly
# broke CI ("Docker Build Verify") and production image builds on an unchanged
# line. Retry with backoff and a clean download dir each attempt so a transient
# blip doesn't fail the build; fail hard only after 5 genuine failures.
RUN ok=0; \
    for i in 1 2 3 4 5; do \
        rm -rf /tmp/pear/download/* 2>/dev/null || true; \
        if pecl install redis; then ok=1; break; fi; \
        echo "pecl install redis failed (attempt $i/5)" >&2; \
        if [ "$i" -lt 5 ]; then sleep "$((i * 10))"; fi; \
    done; \
    if [ "$ok" != 1 ]; then echo "pecl install redis failed after 5 attempts" >&2; exit 1; fi; \
    docker-php-ext-enable redis

# PCOV extension (for PHPUnit code coverage — lightweight, no overhead when disabled).
# Same pecl.php.net resilience wrapper as redis above.
RUN ok=0; \
    for i in 1 2 3 4 5; do \
        rm -rf /tmp/pear/download/* 2>/dev/null || true; \
        if pecl install pcov; then ok=1; break; fi; \
        echo "pecl install pcov failed (attempt $i/5)" >&2; \
        if [ "$i" -lt 5 ]; then sleep "$((i * 10))"; fi; \
    done; \
    if [ "$ok" != 1 ]; then echo "pecl install pcov failed after 5 attempts" >&2; exit 1; fi; \
    docker-php-ext-enable pcov

# =============================================================================
# Apache Configuration
# =============================================================================
# Enable required modules
RUN a2enmod rewrite headers expires deflate remoteip

# Set document root to httpdocs (where index.php lives)
ENV APACHE_DOCUMENT_ROOT=/var/www/html/httpdocs

# Update Apache config to use httpdocs as document root
RUN sed -ri -e 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/sites-available/*.conf
RUN sed -ri -e 's!/var/www/!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/apache2.conf /etc/apache2/conf-available/*.conf

# Allow .htaccess overrides
RUN sed -i '/<Directory \/var\/www\/>/,/<\/Directory>/ s/AllowOverride None/AllowOverride All/' /etc/apache2/apache2.conf

# mod_remoteip: Rewrite REMOTE_ADDR to the real client IP behind Cloudflare + Docker.
# This makes $_SERVER['REMOTE_ADDR'] correct for ALL PHP code, even code that
# doesn't use ClientIp::get(). Only trusted proxy IPs are allowed to set headers.
RUN printf '<IfModule remoteip_module>\n\
  # Trust Cloudflare CF-Connecting-IP header (most reliable)\n\
  RemoteIPHeader CF-Connecting-IP\n\
  # Cloudflare IPv4 ranges (https://www.cloudflare.com/ips-v4/)\n\
  RemoteIPTrustedProxy 173.245.48.0/20\n\
  RemoteIPTrustedProxy 103.21.244.0/22\n\
  RemoteIPTrustedProxy 103.22.200.0/22\n\
  RemoteIPTrustedProxy 103.31.4.0/22\n\
  RemoteIPTrustedProxy 141.101.64.0/18\n\
  RemoteIPTrustedProxy 108.162.192.0/18\n\
  RemoteIPTrustedProxy 190.93.240.0/20\n\
  RemoteIPTrustedProxy 188.114.96.0/20\n\
  RemoteIPTrustedProxy 197.234.240.0/22\n\
  RemoteIPTrustedProxy 198.41.128.0/17\n\
  RemoteIPTrustedProxy 162.158.0.0/15\n\
  RemoteIPTrustedProxy 104.16.0.0/13\n\
  RemoteIPTrustedProxy 104.24.0.0/14\n\
  RemoteIPTrustedProxy 172.64.0.0/13\n\
  RemoteIPTrustedProxy 131.0.72.0/22\n\
  # Cloudflare IPv6 ranges (https://www.cloudflare.com/ips-v6/)\n\
  RemoteIPTrustedProxy 2400:cb00::/32\n\
  RemoteIPTrustedProxy 2606:4700::/32\n\
  RemoteIPTrustedProxy 2803:f800::/32\n\
  RemoteIPTrustedProxy 2405:b500::/32\n\
  RemoteIPTrustedProxy 2405:8100::/32\n\
  RemoteIPTrustedProxy 2a06:98c0::/29\n\
  RemoteIPTrustedProxy 2c0f:f248::/32\n\
  # Docker bridge networks (container-to-host forwarding)\n\
  RemoteIPTrustedProxy 172.16.0.0/12\n\
  RemoteIPTrustedProxy 10.0.0.0/8\n\
  RemoteIPTrustedProxy 192.168.0.0/16\n\
  RemoteIPTrustedProxy 127.0.0.0/8\n\
</IfModule>\n' > /etc/apache2/conf-available/remoteip.conf \
    && a2enconf remoteip

# Pass environment variables to PHP via Apache
# This ensures Docker env vars are available to PHP via $_SERVER and getenv()
RUN echo 'PassEnv DB_HOST DB_PORT DB_NAME DB_USER DB_PASS DB_TYPE REDIS_HOST REDIS_PORT APP_ENV APP_DEBUG APP_URL APP_KEY JWT_SECRET PUSHER_APP_KEY PUSHER_APP_SECRET PUSHER_APP_ID PUSHER_APP_CLUSTER OPENAI_API_KEY SENTRY_DSN_PHP SENTRY_ENVIRONMENT SENTRY_TRACES_SAMPLE_RATE ADMIN_NOTIFICATION_EMAIL MEILISEARCH_HOST MEILISEARCH_KEY SENDGRID_API_KEY SENDGRID_FROM_EMAIL SENDGRID_FROM_NAME EMAIL_ENCRYPTION_KEY USE_GMAIL_API GMAIL_CLIENT_ID GMAIL_CLIENT_SECRET GMAIL_REFRESH_TOKEN GMAIL_SENDER_EMAIL GMAIL_SENDER_NAME SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_ENCRYPTION SMTP_FROM_EMAIL SMTP_FROM_NAME STRIPE_SECRET_KEY STRIPE_PUBLISHABLE_KEY STRIPE_WEBHOOK_SECRET STRIPE_IDENTITY_SECRET_KEY STRIPE_IDENTITY_WEBHOOK_SECRET VERIFF_API_KEY VERIFF_API_SECRET JUMIO_API_TOKEN JUMIO_API_SECRET ONFIDO_API_TOKEN ONFIDO_WEBHOOK_SECRET IDENFY_API_KEY IDENFY_API_SECRET REACT_FRONTEND_URL' >> /etc/apache2/conf-available/passenv.conf \
    && a2enconf passenv

# =============================================================================
# PHP Configuration (Development)
# =============================================================================
RUN mv "$PHP_INI_DIR/php.ini-development" "$PHP_INI_DIR/php.ini"

# Custom PHP settings
RUN echo "\n\
; Project NEXUS Development Settings\n\
display_errors = On\n\
error_reporting = E_ALL\n\
log_errors = On\n\
error_log = /var/log/php_errors.log\n\
\n\
; Performance\n\
; memory_limit is 1G per-process, aligned with Dockerfile.prod.\n\
; For unlimited-memory artisan tasks use: php -d memory_limit=-1 artisan <command>\n\
memory_limit = 1G\n\
max_execution_time = 120\n\
max_input_time = 120\n\
max_input_vars = 3000\n\
\n\
; File uploads\n\
upload_max_filesize = 100M\n\
post_max_size = 105M\n\
max_file_uploads = 20\n\
\n\
; Sessions (file-based for dev, Redis in container)\n\
session.gc_maxlifetime = 7200\n\
session.cookie_httponly = 1\n\
\n\
; Timezone\n\
date.timezone = UTC\n\
\n\
; OPcache - tuned for Laravel\n\
opcache.enable = 1\n\
opcache.validate_timestamps = 1\n\
opcache.revalidate_freq = 0\n\
opcache.memory_consumption = 256\n\
opcache.max_accelerated_files = 30000\n\
opcache.interned_strings_buffer = 32\n\
opcache.jit = tracing\n\
opcache.jit_buffer_size = 100M\n\
opcache.preload = /var/www/html/scripts/opcache-preload.php\n\
opcache.preload_user = www-data\n\
" >> "$PHP_INI_DIR/php.ini"

# =============================================================================
# Working Directory
# =============================================================================
WORKDIR /var/www/html

# =============================================================================
# Composer (for dependency management)
# =============================================================================
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# =============================================================================
# Health Check Endpoint
# =============================================================================
# Create a simple health check file
RUN mkdir -p /var/www/html/httpdocs && \
    echo '<?php header("Content-Type: application/json"); echo json_encode(["status" => "healthy", "timestamp" => date("c")]);' \
    > /var/www/html/httpdocs/health.php

# =============================================================================
# Laravel Directory Structure
# =============================================================================
# Create storage directories required by Laravel framework
RUN mkdir -p /var/www/html/storage/app/public \
             /var/www/html/storage/framework/cache/data \
             /var/www/html/storage/framework/sessions \
             /var/www/html/storage/framework/views \
             /var/www/html/storage/logs \
             /var/www/html/bootstrap/cache

# =============================================================================
# Permissions
# =============================================================================
RUN chown -R www-data:www-data /var/www/html

# Create upload directories with correct ownership so Docker volumes mount
# with the right permissions (named volumes initialise from image content)
RUN mkdir -p /var/www/html/httpdocs/uploads/tenants \
             /var/www/html/httpdocs/uploads/posts \
             /var/www/html/uploads \
             /var/www/html/public/uploads/posts \
    && chown -R www-data:www-data /var/www/html/httpdocs/uploads /var/www/html/uploads /var/www/html/public/uploads \
    && chmod -R 775 /var/www/html/httpdocs/uploads /var/www/html/uploads /var/www/html/public/uploads

# Symlink storage/app/public into the web root so /storage/* URLs work
# (used by marketplace image uploads and any Laravel Storage::disk('public') files)
RUN ln -sf /var/www/html/storage/app/public /var/www/html/httpdocs/storage

# Ensure Laravel storage and bootstrap/cache are writable by www-data
RUN chmod -R 775 /var/www/html/storage /var/www/html/bootstrap/cache

# =============================================================================
# Expose Port
# =============================================================================
EXPOSE 80

# =============================================================================
# Default Command
# Ensure upload dirs are writable by www-data at each startup (handles volume
# re-mounts that reset ownership) then start Apache.
# =============================================================================
CMD ["sh", "-c", "mkdir -p /var/www/html/httpdocs/uploads/tenants /var/www/html/httpdocs/uploads/posts /var/www/html/uploads /var/www/html/public/uploads/posts /var/www/html/storage/app/public; ln -sfn /var/www/html/storage/app/public /var/www/html/httpdocs/storage; chown -R www-data:www-data /var/www/html/httpdocs/uploads /var/www/html/uploads /var/www/html/public/uploads 2>/dev/null; chmod -R 775 /var/www/html/httpdocs/uploads /var/www/html/uploads /var/www/html/public/uploads 2>/dev/null; chown -R www-data:www-data /var/www/html/storage /var/www/html/bootstrap/cache 2>/dev/null; chmod -R 775 /var/www/html/storage /var/www/html/bootstrap/cache 2>/dev/null; apache2-foreground"]
