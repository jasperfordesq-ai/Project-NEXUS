#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# PART B — Run this ON THE PRODUCTION SERVER (after running Part A locally)
# ─────────────────────────────────────────────────────────────────────────
# Installs rclone and age, verifies the token uploaded by Part A, sets up the
# backup encryption keys, removes any old duplicate cron entry, and runs one
# real backup followed by the restore drill.
#
# Run Part A first on your local machine:
#   bash scripts/setup-rclone-local.sh
#
# Then SSH in and run this:
#   sudo bash /opt/nexus-php/scripts/setup-rclone-gdrive.sh

set -euo pipefail

REMOTE_NAME="gdrive"
DRIVE_FOLDER="nexus-backups"
RCLONE_REMOTE="${REMOTE_NAME}:${DRIVE_FOLDER}"
BACKUP_SCRIPT="/opt/nexus-php/scripts/server-nightly-backup.sh"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
log()     { echo -e "${CYAN}→ $1${NC}"; }
success() { echo -e "${GREEN}✓ $1${NC}"; }
warn()    { echo -e "${YELLOW}⚠ $1${NC}"; }
fail()    { echo -e "${RED}✗ ERROR: $1${NC}"; exit 1; }
header()  { echo -e "\n${BOLD}$1${NC}\n$(echo "$1" | sed 's/./-/g')"; }

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║   NEXUS Backup — Google Drive Setup (SERVER)             ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# ---------------------------------------------------------------------------
# Step 1: Install rclone on server
# ---------------------------------------------------------------------------
header "Step 1: Install rclone"

# F-123: from the distribution's signed packages, not `curl … | bash`
# (which ran an unreviewed script from the internet as root). age encrypts the
# offsite copies (server-nightly-backup.sh).
if command -v rclone &>/dev/null; then
    success "rclone already installed: $(rclone version | head -1)"
else
    log "Installing rclone from apt..."
    apt-get update -qq
    apt-get install -y rclone
    success "rclone installed: $(rclone version | head -1)"
fi
if command -v age &>/dev/null; then
    success "age already installed: $(age --version 2>/dev/null || echo present)"
else
    log "Installing age from apt..."
    apt-get install -y age
    success "age installed: $(age --version 2>/dev/null || echo present)"
fi

# ---------------------------------------------------------------------------
# Step 2: Verify the token was uploaded by Part A
# ---------------------------------------------------------------------------
header "Step 2: Verify Google Drive token"

RCLONE_CONF="/root/.config/rclone/rclone.conf"

[[ -f "$RCLONE_CONF" ]] || fail "No rclone config found at $RCLONE_CONF — did you run Part A (setup-rclone-local.sh) first?"

rclone listremotes | grep -q "^${REMOTE_NAME}:" || \
    fail "Remote '${REMOTE_NAME}' not in config. Re-run Part A to re-upload the token."

log "Testing Google Drive access..."
rclone lsd "${REMOTE_NAME}:" --max-depth 1 &>/dev/null || \
    fail "Could not access Google Drive. Token may be expired — re-run Part A."
success "Google Drive token valid and working"

# ---------------------------------------------------------------------------
# Step 3: Test write access to the target folder
# ---------------------------------------------------------------------------
header "Step 3: Test write access"

log "Writing test file to ${RCLONE_REMOTE}..."
echo "nexus-backup-test $(date)" | rclone rcat "${RCLONE_REMOTE}/.nexus-test" || \
    fail "Could not write to ${RCLONE_REMOTE}. Check Google Drive permissions."
rclone deletefile "${RCLONE_REMOTE}/.nexus-test" 2>/dev/null || true
success "Write access confirmed — '${DRIVE_FOLDER}' folder ready in Google Drive"
# With scope=drive.file rclone only sees files it created. If the token is new
# and this shows 0, Google may have given rclone a NEW folder of the same name;
# the old one (with the old unencrypted files) then has to be removed by hand.
VISIBLE=$(rclone lsf "${RCLONE_REMOTE}" --max-depth 1 2>/dev/null | wc -l | tr -d ' ')
log "Files rclone can see in ${RCLONE_REMOTE}: ${VISIBLE}"

# ---------------------------------------------------------------------------
# Step 3b: Encryption keys (F-123) — nothing goes offsite unencrypted
# ---------------------------------------------------------------------------
header "Step 3b: Backup encryption keys"

if [[ -s /opt/nexus-php/.backup-age-recipients ]]; then
    success "Encryption keys already configured (/opt/nexus-php/.backup-age-recipients)"
else
    echo "  Paste the two PUBLIC keys (lines starting 'age1') printed by"
    echo "  scripts/backup-keygen.sh on your own computer. Never paste a private key."
    read -rp "  Public key A: " OWNER_KEY_A
    read -rp "  Public key B: " OWNER_KEY_B
    bash "$(dirname "${BASH_SOURCE[0]}")/setup-backup-encryption.sh" \
        --owner-key "$OWNER_KEY_A" --owner-key "$OWNER_KEY_B" \
        || fail "Encryption setup failed — the nightly backup will not upload until it succeeds."
fi

# ---------------------------------------------------------------------------
# Step 4: Nightly schedule — owned by the deploy, not by this script
# ---------------------------------------------------------------------------
header "Step 4: Nightly schedule"

# Every deploy writes /etc/cron.d/nexus-db-backup (02:00, with flock) and
# /etc/cron.d/nexus-restore-drill (1st of the month, 04:00) from
# scripts/deploy/phases/install-backup-cron.sh. This script used to add its own
# root crontab entry as well, without flock, so two backups ran at 02:00 and
# could delete each other's encrypted files mid-upload. Remove any such entry.
CURRENT_CRON=$(crontab -l 2>/dev/null || true)
if grep -q "$BACKUP_SCRIPT" <<<"$CURRENT_CRON"; then
    log "Removing the old root crontab entry for the nightly backup (the deploy installs it)..."
    grep -v "$BACKUP_SCRIPT" <<<"$CURRENT_CRON" | grep -v '^RCLONE_REMOTE=' | grep -v '^$' | crontab - || true
    success "Old crontab entry removed"
fi
if [[ -f /etc/cron.d/nexus-db-backup ]]; then
    success "Nightly backup schedule present: /etc/cron.d/nexus-db-backup"
else
    warn "No /etc/cron.d/nexus-db-backup yet — it is installed by the next deploy"
fi
if [[ -f /etc/cron.d/nexus-restore-drill ]]; then
    success "Monthly restore drill schedule present: /etc/cron.d/nexus-restore-drill"
else
    warn "No /etc/cron.d/nexus-restore-drill yet — it is installed by the next deploy"
fi

# ---------------------------------------------------------------------------
# Step 5: End-to-end test run — one real backup, then the restore drill
# ---------------------------------------------------------------------------
header "Step 5: End-to-end test"

echo ""
read -rp "Run a full backup now, then the restore drill, to prove everything works? (Y/n): " RUN_NOW
if [[ ! "$RUN_NOW" =~ ^[Nn]$ ]]; then
    log "Running the nightly backup — the uploads archive is several hundred MB, allow a few minutes..."
    echo ""
    RCLONE_REMOTE="$RCLONE_REMOTE" bash "$BACKUP_SCRIPT" || fail "The backup failed — read the messages above."
    echo ""
    success "Backup complete. Encrypted files now in Google Drive (${DRIVE_FOLDER}/):"
    rclone lsf "${RCLONE_REMOTE}" --files-only --include "nexus_*.age" | sort
    echo ""
    log "Running the restore drill (downloads, decrypts and test-restores the copy just uploaded)..."
    bash "$(dirname "${BASH_SOURCE[0]}")/restore-drill.sh" || fail "The restore drill failed — read the messages above."
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}All done${NC}"
echo "  Schedule : nightly backup 02:00, restore drill 04:00 on the 1st (server time)"
echo "  Backed up: database + uploads + storage + server config (.env), ENCRYPTED"
echo "  Rotation : 7 days on the server (plain) and on Drive (encrypted)"
echo "  Location : My Drive / ${DRIVE_FOLDER}/"
echo ""
echo "  Restoring: download the *.age file you need from Drive and open it on your"
echo "  own computer with your key:"
echo "      bash scripts/backup-decrypt.sh nexus_uploads_DATE.tar.gz.age"
echo "  Full steps: the owner guide 'Backup keys and how to restore'."
echo ""
