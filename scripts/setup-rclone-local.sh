#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
# Author: Jasper Ford
# See NOTICE file for attribution and acknowledgements.
#
# PART A — Run this on your LOCAL Windows machine (Git Bash)
# ─────────────────────────────────────────────────────────
# Authorises rclone with Google Drive via your browser, then copies
# the token to the production server. The server never needs a browser.
#
# Usage (from project root in Git Bash):
#   bash scripts/setup-rclone-local.sh
#
# Requires: Git Bash and an SSH key (path comes from .secrets.local/deploy.env
# or PROD_SSH_KEY env var — the public script has no hardcoded defaults).
# Run PART B on the server afterwards:
#   ssh -i "$PROD_SSH_KEY" -o RequestTTY=force "$PROD_SSH_HOST"
#   sudo bash /opt/nexus-php/scripts/setup-rclone-gdrive.sh

set -euo pipefail

# Load local secrets if present. .secrets.local/deploy.env is gitignored.
# shellcheck disable=SC1091
[ -f "$(dirname "$0")/../.secrets.local/deploy.env" ] && . "$(dirname "$0")/../.secrets.local/deploy.env"

if [ -z "${PROD_SSH_HOST:-}" ] || [ -z "${PROD_SSH_KEY:-}" ]; then
    echo "ERROR: PROD_SSH_HOST and PROD_SSH_KEY must be set." >&2
    echo "       Either create .secrets.local/deploy.env or export them." >&2
    exit 1
fi

SSH_KEY="$PROD_SSH_KEY"
SSH_HOST="$PROD_SSH_HOST"
REMOTE_NAME="gdrive"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
log()     { echo -e "${CYAN}→ $1${NC}"; }
success() { echo -e "${GREEN}✓ $1${NC}"; }
warn()    { echo -e "${YELLOW}⚠ $1${NC}"; }
fail()    { echo -e "${RED}✗ ERROR: $1${NC}"; exit 1; }
header()  { echo -e "\n${BOLD}$1${NC}\n$(echo "$1" | sed 's/./-/g')"; }

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║   NEXUS Backup — Google Drive Auth (LOCAL machine)       ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# ---------------------------------------------------------------------------
# Step 1: Check rclone is installed locally
# ---------------------------------------------------------------------------
header "Step 1: Check rclone"

if command -v rclone &>/dev/null; then
    success "rclone found: $(rclone version | head -1)"
else
    warn "rclone not found. Installing via winget..."
    winget install Rclone.Rclone --silent || {
        echo ""
        echo "  winget failed. Install rclone manually:"
        echo "  1. Go to https://rclone.org/downloads/"
        echo "  2. Download the Windows AMD64 zip"
        echo "  3. Extract rclone.exe to C:\\Windows\\System32\\"
        echo "  4. Re-run this script"
        exit 1
    }
    # Reload PATH
    export PATH="$PATH:/c/Users/$USERNAME/AppData/Local/Microsoft/WinGet/Packages/Rclone.Rclone_Microsoft.Winget.Source_8wekyb3d8bbwe/"
    command -v rclone &>/dev/null || fail "rclone still not in PATH after install — restart Git Bash and re-run"
    success "rclone installed: $(rclone version | head -1)"
fi

# ---------------------------------------------------------------------------
# Step 2: Authorise Google Drive (browser opens on this machine)
# ---------------------------------------------------------------------------
header "Step 2: Authorise Google Drive"

# Find local rclone config path (Windows: %APPDATA%\rclone\rclone.conf)
if [[ -n "${APPDATA:-}" ]]; then
    RCLONE_CONF=$(cygpath -u "$APPDATA/rclone/rclone.conf" 2>/dev/null || echo "$APPDATA/rclone/rclone.conf")
else
    RCLONE_CONF="$HOME/.config/rclone/rclone.conf"
fi

if rclone listremotes 2>/dev/null | grep -q "^${REMOTE_NAME}:"; then
    warn "A remote named '${REMOTE_NAME}' already exists in your local rclone config."
    read -rp "Re-authorise? This will replace the existing token. (y/N): " REDO
    if [[ ! "$REDO" =~ ^[Yy]$ ]]; then
        log "Keeping existing token — skipping to upload step."
        SKIP_AUTH=true
    else
        rclone config delete "$REMOTE_NAME"
        SKIP_AUTH=false
    fi
else
    SKIP_AUTH=false
fi

if [[ "$SKIP_AUTH" == "false" ]]; then
    echo ""
    echo "  A browser window will open asking you to log in to Google."
    echo "  Sign in with your Google Workspace account and click Allow."
    echo "  rclone will save the token automatically — no copying needed."
    echo ""
    read -rp "Press ENTER to open the browser..."

    # F-123: drive.file = rclone can only see and change files it created
    # itself, i.e. the backups. The old scope=drive gave the server's token the
    # owner's ENTIRE Google Drive.
    rclone config create "$REMOTE_NAME" drive scope=drive.file || {
        # Fallback: full interactive config
        echo ""
        warn "Automated config failed — running interactive config instead."
        echo "  When prompted:"
        echo "  • Storage type: enter the number for 'Google Drive'"
        echo "  • client_id / client_secret: leave blank (press Enter)"
        echo "  • scope: choose drive.file — 'Access to files created by rclone only'"
        echo "    (NOT the first option, which opens the whole Drive)"
        echo "  • root_folder_id / service_account_file: leave blank"
        echo "  • Edit advanced config: No"
        echo "  • Use auto config: Yes  ← browser will open"
        echo "  • Configure as team drive: No"
        echo ""
        rclone config
    }

    rclone listremotes | grep -q "^${REMOTE_NAME}:" || \
        fail "Remote '${REMOTE_NAME}' not found after setup. Please re-run."
    success "Google Drive authorised"
fi

# Quick sanity check
log "Testing local access to Google Drive..."
rclone lsd "${REMOTE_NAME}:" --max-depth 1 &>/dev/null || \
    fail "Could not list Google Drive. Token may be invalid — re-run and re-authorise."
success "Google Drive accessible"

# ---------------------------------------------------------------------------
# Step 3: Copy rclone config to the production server
# ---------------------------------------------------------------------------
header "Step 3: Upload token to production server"

[[ -f "$RCLONE_CONF" ]] || fail "rclone config not found at: $RCLONE_CONF"
log "Config file: $RCLONE_CONF"

# Send the server ONLY the backup remote's section. The local rclone.conf may
# hold other remotes (other accounts, other tokens) that the server must never
# see.
UPLOAD_CONF="$(mktemp)"
trap 'rm -f "$UPLOAD_CONF"' EXIT
chmod 600 "$UPLOAD_CONF"
rclone config show "${REMOTE_NAME}" > "$UPLOAD_CONF" || fail "could not extract the '${REMOTE_NAME}' remote"
grep -q "^\[${REMOTE_NAME}\]" "$UPLOAD_CONF" || fail "extracted config has no [${REMOTE_NAME}] section"
grep -qE '^scope = drive\.file$' "$UPLOAD_CONF" \
    || fail "the '${REMOTE_NAME}' remote is not limited to scope drive.file — re-run and re-authorise"

log "Copying the '${REMOTE_NAME}' remote to the server..."
# Create the config directory on the server first
ssh -i "$SSH_KEY" -o RequestTTY=force "$SSH_HOST" \
    "sudo mkdir -p /root/.config/rclone && sudo chmod 700 /root/.config/rclone"

# SCP to a private temp location, then sudo move it into place
scp -p -i "$SSH_KEY" "$UPLOAD_CONF" "${SSH_HOST}:/tmp/rclone.conf"   # -p keeps mode 600 in /tmp
ssh -i "$SSH_KEY" -o RequestTTY=force "$SSH_HOST" \
    "sudo mv /tmp/rclone.conf /root/.config/rclone/rclone.conf && sudo chown root:root /root/.config/rclone/rclone.conf && sudo chmod 600 /root/.config/rclone/rclone.conf"

success "Token uploaded to server"

# ---------------------------------------------------------------------------
# Done — tell user to run Part B
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  Part A complete — now run Part B on the server          ║${NC}"
echo -e "${BOLD}╠══════════════════════════════════════════════════════════╣${NC}"
echo -e "${BOLD}║  SSH in and run:                                         ║${NC}"
echo -e "${BOLD}║                                                          ║${NC}"
echo -e "${BOLD}║    ssh -i \"\$PROD_SSH_KEY\" \\                              ║${NC}"
echo -e "${BOLD}║      -o RequestTTY=force \"\$PROD_SSH_HOST\"                ║${NC}"
echo -e "${BOLD}║                                                          ║${NC}"
echo -e "${BOLD}║    sudo bash /opt/nexus-php/scripts/setup-rclone-gdrive.sh ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
