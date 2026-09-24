#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# Shared helpers for pre-migration database backups.
#
# Public functions:
#   db_pending_migration_count <app_container>  -> echoes integer count of pending Laravel migrations
#   db_backup_with_offsite <app_container>      -> dumps + gzips + verifies + offsites to rclone gdrive (best-effort)
#                                                   Sets DB_BACKUP_FILE on success. Returns 1 on local backup failure.
#
# Both functions assume scripts/deploy/lib/common.sh has already been sourced
# (for log_*, DEPLOY_DIR).

: "${DB_BACKUP_DIR:=/opt/nexus-php/backups}"
: "${DB_BACKUP_RETENTION_DAYS:=7}"
# Matches the folder configured by scripts/setup-rclone-gdrive.sh
# (the nightly cron syncs to the same Drive folder).
: "${DB_BACKUP_RCLONE_REMOTE:=gdrive:nexus-backups}"

db_pending_migration_count() {
    local app_container="$1"
    local out
    # `migrate:status --pending` exits 0 with no rows when nothing is pending,
    # and 1 when the migrations table is missing — treat both as 0.
    out="$(docker_exec_app_user "$app_container" php /var/www/html/artisan migrate:status --pending 2>/dev/null || true)"
    if echo "$out" | grep -qi "Nothing to migrate\|No migrations found"; then
        echo 0
        return 0
    fi
    # Count rows that look like pending migrations (table rows in artisan output
    # contain the word "Pending" in the status column).
    local n
    n="$(echo "$out" | grep -cE 'Pending' || true)"
    echo "${n:-0}"
}

db_backup_with_offsite() {
    local app_container="${1:-nexus-php-app}"
    DB_BACKUP_FILE=""

    mkdir -p "$DB_BACKUP_DIR"
    # E-035 F-203: a pre-migrate dump is the whole platform in plaintext. Keep
    # the directory owner-only, and create the file 0600 before the dump writes
    # into it (the redirect below truncates it and keeps that mode).
    chmod 700 "$DB_BACKUP_DIR"
    local stamp
    stamp="$(date +%Y%m%d-%H%M%S)"
    local backup_file="$DB_BACKUP_DIR/pre-migrate-${stamp}.sql.gz"
    ( umask 077 && : > "$backup_file" )

    local db_user db_pass db_name
    db_user="$(grep "^DB_USER=" "$DEPLOY_DIR/.env" 2>/dev/null | sed 's/^DB_USER=//' | tr -d "\"'" || echo nexus)"
    db_pass="$(grep "^DB_PASS=" "$DEPLOY_DIR/.env" 2>/dev/null | sed 's/^DB_PASS=//' | tr -d "\"'")"
    db_name="$(grep "^DB_NAME=" "$DEPLOY_DIR/.env" 2>/dev/null | sed 's/^DB_NAME=//' | tr -d "\"'" || echo nexus)"

    if [ -z "$db_pass" ]; then
        log_err "DB_PASS not found in $DEPLOY_DIR/.env — cannot back up"
        return 1
    fi

    log_info "Dumping ${db_name} to ${backup_file}..."
    if ! MYSQL_PWD="$db_pass" docker exec -e MYSQL_PWD nexus-php-db \
        mariadb-dump --single-transaction --quick --routines --triggers \
        -u "$db_user" "$db_name" 2>/dev/null \
        | gzip > "$backup_file"; then
        log_err "Database backup failed — aborting migration to prevent unrecoverable data loss"
        rm -f "$backup_file"
        return 1
    fi

    # Integrity: gzip must be valid AND the dump must contain the completion marker.
    if ! gzip -t "$backup_file" 2>/dev/null; then
        log_err "Backup gzip integrity check failed — aborting"
        rm -f "$backup_file"
        return 1
    fi
    if ! gunzip -c "$backup_file" | tail -3 | grep -q "Dump completed"; then
        log_err "Backup missing 'Dump completed' marker — aborting"
        rm -f "$backup_file"
        return 1
    fi

    local size
    size="$(du -sh "$backup_file" | cut -f1)"
    log_ok "Database backed up locally: $backup_file ($size)"

    # Local retention
    find "$DB_BACKUP_DIR" -name "pre-migrate-*.sql.gz" -mtime "+$DB_BACKUP_RETENTION_DAYS" -delete 2>/dev/null || true

    # Optional encryption-at-rest for the offsite copy. If DB_BACKUP_GPG_RECIPIENT
    # is set (or DB_BACKUP_GPG_PASSPHRASE for symmetric mode), the file we upload
    # is encrypted; the local copy stays plaintext for fast in-place restore.
    local upload_path="$backup_file"
    if [ -n "${DB_BACKUP_GPG_RECIPIENT:-}" ] && command -v gpg >/dev/null 2>&1; then
        local enc_path="${backup_file}.gpg"
        if gpg --batch --yes --trust-model always --recipient "$DB_BACKUP_GPG_RECIPIENT" \
            --output "$enc_path" --encrypt "$backup_file" 2>>"$LOG_FILE"; then
            upload_path="$enc_path"
            log_ok "Backup encrypted (asymmetric, recipient $DB_BACKUP_GPG_RECIPIENT)"
        else
            log_warn "GPG encryption failed; uploading plaintext gzip"
        fi
    elif [ -n "${DB_BACKUP_GPG_PASSPHRASE:-}" ] && command -v gpg >/dev/null 2>&1; then
        local enc_path="${backup_file}.gpg"
        if printf '%s' "$DB_BACKUP_GPG_PASSPHRASE" | gpg --batch --yes --pinentry-mode loopback \
            --passphrase-fd 0 --symmetric --output "$enc_path" "$backup_file" 2>>"$LOG_FILE"; then
            upload_path="$enc_path"
            log_ok "Backup encrypted (symmetric)"
        else
            log_warn "GPG symmetric encryption failed; uploading plaintext gzip"
        fi
    fi

    # Offsite (best-effort): only if rclone is installed and a remote is configured.
    if command -v rclone >/dev/null 2>&1; then
        local remote_name="${DB_BACKUP_RCLONE_REMOTE%%:*}"
        if rclone listremotes 2>/dev/null | grep -qx "${remote_name}:"; then
            log_info "Uploading $(basename "$upload_path") to ${DB_BACKUP_RCLONE_REMOTE}..."
            if rclone copy "$upload_path" "$DB_BACKUP_RCLONE_REMOTE" \
                --transfers=1 --checkers=1 --quiet --retries=2 2>&1 | tee -a "$LOG_FILE"; then
                log_ok "Offsite copy uploaded to ${DB_BACKUP_RCLONE_REMOTE}"
                # Offsite retention — delete files older than retention days, best-effort
                rclone delete "$DB_BACKUP_RCLONE_REMOTE" \
                    --min-age "${DB_BACKUP_RETENTION_DAYS}d" --quiet 2>/dev/null || true
            else
                log_warn "Offsite upload failed (non-fatal). Backup remains local at $backup_file"
            fi
        else
            log_warn "rclone installed but remote '${remote_name}:' not configured — skipping offsite copy"
            log_warn "Run: scripts/setup-rclone-gdrive.sh to wire up the gdrive remote"
        fi
    else
        log_warn "rclone not installed — skipping offsite copy. Install: apt-get install -y rclone"
    fi

    # Clean up the encrypted artifact locally — only the plaintext gzip lives in
    # /opt/nexus-php/backups/. Remote storage is encrypted (if recipient/passphrase set).
    if [ "$upload_path" != "$backup_file" ]; then
        rm -f "$upload_path"
    fi

    DB_BACKUP_FILE="$backup_file"
    return 0
}
