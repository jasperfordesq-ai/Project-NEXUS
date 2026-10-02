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
#   db_backup_with_offsite <app_container>      -> dumps + gzips + verifies + offsites an ENCRYPTED copy to rclone gdrive (best-effort)
#                                                   Sets DB_BACKUP_FILE on success. Returns 1 on local backup failure.
#
# Both functions assume scripts/deploy/lib/common.sh has already been sourced
# (for log_*, DEPLOY_DIR).
#
# Tests: scripts/test/test-premigrate-backup-offsite.sh

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
    # E-035 F-203: a pre-migrate dump is the whole platform in plaintext, so the
    # FILE is created 0600 before the dump writes into it (the redirect below
    # truncates it and keeps that mode). The directory is 0755, not 0700: the
    # scheduler container runs as www-data (F-205) and backup:verify must list it
    # and read file dates; names and dates are not sensitive, contents are.
    chmod 755 "$DB_BACKUP_DIR"
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

    # Offsite copy — encrypted, or not at all (F-123). The local copy stays
    # plaintext for fast in-place restore; what goes to Drive never is.
    # Preferred: age, to the same public keys as the nightly backup
    # (/opt/nexus-php/.backup-age-recipients, ≥2 keys), so the owner's keys and
    # the restore drill key open it. Older GPG settings are honoured only when
    # age is not configured. If nothing can encrypt it, the offsite copy is
    # SKIPPED — there is no plaintext fallback. Never fatal to the deploy.
    local recipients="${BACKUP_AGE_RECIPIENTS_FILE:-/opt/nexus-php/.backup-age-recipients}"
    local upload_path=""
    local enc_path=""
    local key_count=0
    if [ -r "$recipients" ]; then
        key_count="$(grep -cE '^age1[0-9a-z]+$' "$recipients" || true)"
    fi
    if command -v age >/dev/null 2>&1 && [ "${key_count:-0}" -ge 2 ]; then
        enc_path="${backup_file}.age"
        if age -R "$recipients" -o "$enc_path" "$backup_file" 2>>"$LOG_FILE" \
            && [ "$(head -c 21 "$enc_path")" = "age-encryption.org/v1" ]; then
            upload_path="$enc_path"
            log_ok "Backup encrypted for offsite (age, ${key_count} keys)"
        else
            log_warn "age encryption failed — offsite copy SKIPPED (not uploading plaintext)"
        fi
    elif [ -n "${DB_BACKUP_GPG_RECIPIENT:-}" ] && command -v gpg >/dev/null 2>&1; then
        enc_path="${backup_file}.gpg"
        if gpg --batch --yes --trust-model always --recipient "$DB_BACKUP_GPG_RECIPIENT" \
            --output "$enc_path" --encrypt "$backup_file" 2>>"$LOG_FILE"; then
            upload_path="$enc_path"
            log_ok "Backup encrypted (asymmetric, recipient $DB_BACKUP_GPG_RECIPIENT)"
        else
            log_warn "GPG encryption failed — offsite copy SKIPPED (not uploading plaintext)"
        fi
    elif [ -n "${DB_BACKUP_GPG_PASSPHRASE:-}" ] && command -v gpg >/dev/null 2>&1; then
        enc_path="${backup_file}.gpg"
        if printf '%s' "$DB_BACKUP_GPG_PASSPHRASE" | gpg --batch --yes --pinentry-mode loopback \
            --passphrase-fd 0 --symmetric --output "$enc_path" "$backup_file" 2>>"$LOG_FILE"; then
            upload_path="$enc_path"
            log_ok "Backup encrypted (symmetric)"
        else
            log_warn "GPG symmetric encryption failed — offsite copy SKIPPED (not uploading plaintext)"
        fi
    else
        log_warn "No backup encryption configured (${recipients} missing or <2 keys) — offsite copy SKIPPED, not encrypted. Run scripts/setup-backup-encryption.sh"
    fi

    # Offsite (best-effort): only an encrypted file, only if rclone + remote exist.
    if [ -z "$upload_path" ]; then
        :
    elif command -v rclone >/dev/null 2>&1; then
        local remote_name="${DB_BACKUP_RCLONE_REMOTE%%:*}"
        if rclone listremotes 2>/dev/null | grep -qx "${remote_name}:"; then
            log_info "Uploading $(basename "$upload_path") to ${DB_BACKUP_RCLONE_REMOTE}..."
            # No `| tee`: its exit status would hide a failed upload.
            if rclone copy "$upload_path" "$DB_BACKUP_RCLONE_REMOTE" \
                --transfers=1 --checkers=1 --quiet --retries=2 >>"$LOG_FILE" 2>&1; then
                log_ok "Offsite copy uploaded to ${DB_BACKUP_RCLONE_REMOTE}"
                # Offsite retention — ONLY this script's own files. The folder
                # also holds the nightly backups, which prune themselves.
                rclone delete "$DB_BACKUP_RCLONE_REMOTE" \
                    --include "pre-migrate-*" --max-depth 1 \
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
    # /opt/nexus-php/backups/.
    if [ -n "$enc_path" ]; then
        rm -f "$enc_path"
    fi

    DB_BACKUP_FILE="$backup_file"
    return 0
}
