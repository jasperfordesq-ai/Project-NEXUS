#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# PART B — Run this ON THE PRODUCTION SERVER (after running Part A locally)
# ─────────────────────────────────────────────────────────────────────────
# Installs rclone, verifies the token uploaded by Part A, wires up the
# nightly cron job, and does an end-to-end test backup + Drive sync.
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
BACKUP_LOG="/opt/nexus-php/backups/backup.log"
CRON_SCHEDULE="0 2 * * *"

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
# Step 4: Wire up cron job
# ---------------------------------------------------------------------------
header "Step 4: Configure nightly cron job"

CRON_ENV="RCLONE_REMOTE=${RCLONE_REMOTE}"
CRON_CMD="${CRON_SCHEDULE} bash ${BACKUP_SCRIPT} >> ${BACKUP_LOG} 2>&1"

CURRENT_CRON=$(crontab -l 2>/dev/null || true)

if echo "$CURRENT_CRON" | grep -q "$BACKUP_SCRIPT"; then
    log "Backup cron job already exists — updating to include RCLONE_REMOTE..."
    NEW_CRON=$(echo "$CURRENT_CRON" \
        | grep -v "RCLONE_REMOTE=" \
        | grep -v "$BACKUP_SCRIPT")
    printf '%s\n%s\n%s\n' "$NEW_CRON" "$CRON_ENV" "$CRON_CMD" \
        | grep -v '^$' | crontab -
else
    log "Adding backup cron job..."
    printf '%s\n%s\n%s\n' "$CURRENT_CRON" "$CRON_ENV" "$CRON_CMD" \
        | grep -v '^$' | crontab -
fi

success "Cron job set: runs every night at 02:00 server time"
echo ""
log "Current crontab:"
crontab -l

# ---------------------------------------------------------------------------
# Step 5: End-to-end test run
# ---------------------------------------------------------------------------
header "Step 5: End-to-end test"

echo ""
read -rp "Run a full backup + Google Drive sync now to confirm everything works? (Y/n): " RUN_NOW
if [[ ! "$RUN_NOW" =~ ^[Nn]$ ]]; then
    log "Running backup — uploads volume is ~272MB, allow a couple of minutes..."
    echo ""
    RCLONE_REMOTE="$RCLONE_REMOTE" bash "$BACKUP_SCRIPT"
    echo ""
    success "Backup complete. Files now in Google Drive (${DRIVE_FOLDER}/):"
    rclone ls "${RCLONE_REMOTE}" | sort
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  All done                                                ║${NC}"
echo -e "${BOLD}╠══════════════════════════════════════════════════════════╣${NC}"
echo -e "${BOLD}║  Schedule : every night at 02:00 server time             ║${NC}"
echo -e "${BOLD}║  Backed up: database + uploads + storage                 ║${NC}"
echo -e "${BOLD}║  Rotation : 7 days kept on server, synced to Drive       ║${NC}"
echo -e "${BOLD}║  Location : My Drive / nexus-backups/                    ║${NC}"
echo -e "${BOLD}╠══════════════════════════════════════════════════════════╣${NC}"
echo -e "${BOLD}║  Useful commands:                                        ║${NC}"
echo -e "${BOLD}║    List Drive files:                                     ║${NC}"
echo -e "${BOLD}║      sudo rclone ls ${RCLONE_REMOTE}                     ║${NC}"
echo -e "${BOLD}║    Restore uploads to server:                            ║${NC}"
echo -e "${BOLD}║      sudo rclone copy ${RCLONE_REMOTE}/nexus_uploads_DATE.tar.gz /tmp/${NC}"
echo -e "${BOLD}║      sudo docker run --rm \\                              ║${NC}"
echo -e "${BOLD}║        -v nexus-php-uploads:/data \\                     ║${NC}"
echo -e "${BOLD}║        -v /tmp:/in alpine \\                             ║${NC}"
echo -e "${BOLD}║        tar xzf /in/nexus_uploads_DATE.tar.gz -C /data   ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
