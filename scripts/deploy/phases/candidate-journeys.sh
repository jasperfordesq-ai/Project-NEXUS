#!/usr/bin/env bash
# Copyright © 2024–2026 Jasper Ford
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Candidate Journey Gate — the "act like a real user" deploy-time safety check.
#
# Runs the proven @smoke browser journeys (e2e/tests/smoke.spec.ts via
# playwright.deploy.config.ts) against a freshly built blue/green CANDIDATE,
# BEFORE traffic is switched to it. A non-zero exit makes bluegreen-deploy.sh
# abort the cutover, so a build with a broken core journey never reaches users.
#
# Safety:
#   * The candidate shares the PRODUCTION database. The @smoke suite is
#     read-only + login only (no writes), so it is safe to run live.
#   * Self-skips (warn, exit 0) until E2E_GATE_USER_EMAIL / E2E_GATE_USER_PASSWORD
#     are present in $DEPLOY_DIR/.env. This makes rollout safe: the gate does not
#     block any deploy until you explicitly configure a dedicated test member.
#   * DEPLOY_SKIP_JOURNEYS=1 force-skips (use only for emergency rollback deploys).
#
# Usage (from bluegreen-deploy.sh):
#   bash phases/candidate-journeys.sh <api_port> <frontend_port> <color> <release_dir> <commit>

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/../lib/common.sh"

API_PORT="${1:-${NEXUS_API_PORT:-}}"
FRONTEND_PORT="${2:-${NEXUS_FRONTEND_PORT:-}}"
COLOR="${3:-${NEXUS_COLOR:-candidate}}"
TENANT="${E2E_GATE_TENANT:-hour-timebank}"
RUNNER_IMAGE="nexus-e2e-runner:pw-1.59.1"
SUITE_DIR="${4:-$DEPLOY_DIR}"
EXPECTED_COMMIT="${5:-}"
TLS_DIR=""
trap 'if [ -n "$TLS_DIR" ]; then rm -rf -- "$TLS_DIR"; fi' EXIT

env_value() {
    # Read a KEY=value from the deploy .env without exposing it on the process
    # list. Returns empty (never fails under set -e) when absent.
    local key="$1" val=""
    val="$(grep -E "^${key}=" "$DEPLOY_DIR/.env" 2>/dev/null | head -n1 | sed "s/^${key}=//" | tr -d "\"'")" || val=""
    printf '%s' "$val"
}

run_candidate_journeys() {
    log_step "=== Candidate Journey Gate ($COLOR) ==="

    if [ "${DEPLOY_SKIP_JOURNEYS:-0}" = "1" ]; then
        log_warn "DEPLOY_SKIP_JOURNEYS=1 — journey gate skipped by request"
        return 0
    fi

    if [ -z "$API_PORT" ] || [ -z "$FRONTEND_PORT" ]; then
        log_warn "Candidate ports unknown (api='$API_PORT' frontend='$FRONTEND_PORT') — journey gate skipped"
        return 0
    fi

    if [ ! -f "$SUITE_DIR/e2e/tests/smoke.spec.ts" ] || [ ! -f "$SUITE_DIR/playwright.deploy.config.ts" ]; then
        log_err "Candidate browser suite missing from $SUITE_DIR"
        return 1
    fi
    if [ -n "$EXPECTED_COMMIT" ] && [ "$(git -C "$SUITE_DIR" rev-parse HEAD)" != "$EXPECTED_COMMIT" ]; then
        log_err "Candidate browser suite does not match release $EXPECTED_COMMIT"
        return 1
    fi

    # Dedicated, low-privilege prod test-member credentials. Kept in .env, never
    # in git. Absent => gate not yet configured => skip (do NOT block deploys).
    local cred_email cred_pass
    cred_email="$(env_value E2E_GATE_USER_EMAIL)"
    cred_pass="$(env_value E2E_GATE_USER_PASSWORD)"
    if [ -z "$cred_email" ] || [ -z "$cred_pass" ]; then
        log_warn "E2E_GATE_USER_EMAIL/E2E_GATE_USER_PASSWORD not set in .env — journey gate NOT configured; skipping."
        log_warn "  -> Set both in $DEPLOY_DIR/.env (a dedicated test member) to ENABLE the gate."
        return 0
    fi

    # Build the runner image once; reused (and cached) on subsequent deploys.
    if ! docker image inspect "$RUNNER_IMAGE" >/dev/null 2>&1; then
        log_info "Building Playwright runner image $RUNNER_IMAGE (one-time)..."
        if ! docker build -f "$SUITE_DIR/Dockerfile.e2e" -t "$RUNNER_IMAGE" "$SUITE_DIR" >>"$LOG_FILE" 2>&1; then
            log_err "Failed to build journey runner image — see $LOG_FILE"
            return 1
        fi
    fi

    # Defensive: ensure empty auth fixtures exist so any skipped storage-state
    # test never errors on a missing file (admin specs skip without creds).
    mkdir -p "$SUITE_DIR/e2e/fixtures/.auth" 2>/dev/null || true
    for f in user admin; do
        [ -f "$SUITE_DIR/e2e/fixtures/.auth/$f.json" ] || \
            printf '{"cookies":[],"origins":[]}' > "$SUITE_DIR/e2e/fixtures/.auth/$f.json" 2>/dev/null || true
    done

    # Production deliberately rejects browser credential requests from HTTP.
    # Terminate TLS inside the runner and forward only to candidate loopback ports.
    # The temporary certificate never leaves the server and is not trusted by
    # ordinary browsers; this Playwright context explicitly accepts it.
    TLS_DIR="$(mktemp -d /tmp/nexus-gate-tls.XXXXXX)"
    chmod 700 "$TLS_DIR"
    if ! openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
        -keyout "$TLS_DIR/key.pem" -out "$TLS_DIR/cert.pem" \
        -subj '/CN=127.0.0.1' -addext 'subjectAltName=IP:127.0.0.1' >/dev/null 2>&1; then
        log_err "Could not create the candidate's temporary HTTPS certificate"
        return 1
    fi

    log_info "Running @smoke journeys against candidate $COLOR over local HTTPS (frontend :$FRONTEND_PORT, API :$API_PORT)..."
    # --network host reaches only the candidate's loopback ports. The suite is
    # mounted from the exact release worktree, never the older server checkout.
    if docker run --rm --network host --entrypoint /bin/sh \
        -e CI=1 \
        -e E2E_BASE_URL="https://127.0.0.1:3443" \
        -e E2E_API_URL="http://127.0.0.1:$API_PORT" \
        -e E2E_REACT_URL="https://127.0.0.1:3443" \
        -e NEXUS_E2E_FRONTEND_PORT="$FRONTEND_PORT" \
        -e NEXUS_E2E_API_PORT="$API_PORT" \
        -e NEXUS_E2E_PROXY_HOST=127.0.0.1 \
        -e NEXUS_E2E_EXPECTED_COMMIT="$EXPECTED_COMMIT" \
        -e E2E_TENANT="$TENANT" \
        -e E2E_USER_EMAIL="$cred_email" \
        -e E2E_USER_PASSWORD="$cred_pass" \
        -v "$SUITE_DIR/e2e:/work/e2e:ro" \
        -v "$SUITE_DIR/playwright.deploy.config.ts:/work/playwright.deploy.config.ts:ro" \
        -v "$TLS_DIR:/tmp/nexus-gate-tls:ro" \
        "$RUNNER_IMAGE" -ec '
            node e2e/scripts/ci-https-proxy.mjs /tmp/nexus-gate-tls/key.pem /tmp/nexus-gate-tls/cert.pem &
            proxy_pid=$!
            trap "kill $proxy_pid 2>/dev/null || true" EXIT
            for attempt in $(seq 1 20); do
                if ! kill -0 "$proxy_pid" 2>/dev/null; then exit 1; fi
                if curl --insecure --fail --silent https://127.0.0.1:3443/version.php \
                    | grep -Fq "$NEXUS_E2E_EXPECTED_COMMIT"; then break; fi
                sleep 1
            done
            curl --insecure --fail --silent https://127.0.0.1:3443/version.php \
                | grep -Fq "$NEXUS_E2E_EXPECTED_COMMIT"
            npx playwright test --config=playwright.deploy.config.ts
        ' 2>&1 | tee -a "$LOG_FILE"; then
        log_ok "Candidate journey gate PASSED — safe to switch traffic to $COLOR"
        return 0
    fi

    log_err "Candidate journey gate FAILED — NOT switching traffic. Candidate $COLOR will be discarded."
    return 1
}

run_candidate_journeys
