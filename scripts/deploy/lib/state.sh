#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Cross-phase state storage. Phases run as subprocesses so bash globals don't
# survive — state lives in files under a fixed, per-user directory.
#
# E-035 F-204: this used to be /tmp/nexus-deploy-state. /tmp is world-writable,
# so another local account could pre-create that directory (mkdir -p then only
# chmods it — the owner stays the attacker) and plant symlinks in it, turning a
# root deploy's state writes into writes to arbitrary files. The path must stay
# FIXED (separate phase processes share it), so it moves to a location no other
# user can create first: /run for root, or a uid-suffixed dir otherwise; and the
# directory is refused if it is a symlink or owned by someone else.
_nexus_default_state_dir() {
    if [ "$(id -u)" = "0" ] && [ -d /run ] && [ -w /run ]; then
        echo "/run/nexus-deploy-state"
    else
        echo "${TMPDIR:-/tmp}/nexus-deploy-state-$(id -u)"
    fi
}

NEXUS_STATE_DIR="${NEXUS_STATE_DIR:-$(_nexus_default_state_dir)}"

# Refuse a state directory we did not create: a symlink, or one owned by another
# uid. Returns non-zero (and says why) rather than writing into it.
_nexus_state_dir_is_safe() {
    if [ -L "$NEXUS_STATE_DIR" ]; then
        echo "state.sh: refusing symlinked state dir $NEXUS_STATE_DIR" >&2
        return 1
    fi
    if [ -d "$NEXUS_STATE_DIR" ]; then
        local owner
        owner="$(stat -c %u "$NEXUS_STATE_DIR" 2>/dev/null || echo unknown)"
        if [ "$owner" != "$(id -u)" ]; then
            echo "state.sh: refusing state dir $NEXUS_STATE_DIR owned by uid $owner" >&2
            return 1
        fi
    fi
    return 0
}

_nexus_state_dir_ensure() {
    _nexus_state_dir_is_safe || return 1
    ( umask 077 && mkdir -p "$NEXUS_STATE_DIR" ) || return 1
    chmod 0700 "$NEXUS_STATE_DIR"
    _nexus_state_dir_is_safe
}

state_init() {
    _nexus_state_dir_ensure
}

state_set() {
    local key="$1"
    local value="$2"
    _nexus_state_dir_ensure || return 1
    printf '%s' "$value" > "$NEXUS_STATE_DIR/$key"
}

state_get() {
    local key="$1"
    if [ -f "$NEXUS_STATE_DIR/$key" ]; then
        cat "$NEXUS_STATE_DIR/$key"
    else
        echo ""
    fi
}

state_clear() {
    if [ -n "$NEXUS_STATE_DIR" ] && [ -d "$NEXUS_STATE_DIR" ]; then
        rm -rf "$NEXUS_STATE_DIR"
    fi
}
