#!/bin/bash
set -euo pipefail

# ============================================================
# AUTONOMOUS SSL SETUP — zero user configuration required
# ============================================================

SSL_DIR="${SSL_DIR:-/ssl}"          # HA mapped SSL directory
ADDON_SSL="${ADDON_SSL:-/data/ssl}" # Persistent add-on storage
CA_CERT="$ADDON_SSL/ca.crt"
CA_KEY="$ADDON_SSL/ca.key"
SERVER_CERT="$ADDON_SSL/server.crt"
SERVER_KEY="$ADDON_SSL/server.key"

# Output variables (sourced by run.sh)
export SSL_MODE=""
export CERT_FILE=""
export KEY_FILE=""
export CA_DOWNLOAD=""

detect_local_ip() {
	# Multiple fallback methods
	LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}') ||
		LOCAL_IP=$(ip route get 1 2>/dev/null | awk '{print $7; exit}') ||
		LOCAL_IP="127.0.0.1"
	echo "$LOCAL_IP"
}

check_cert_valid() {
	local cert="$1"
	local days="${2:-7}" # Must be valid for at least N days
	[ -f "$cert" ] && openssl x509 -checkend $((days * 86400)) -noout -in "$cert" 2>/dev/null
}

# ── COPY TO SHARED SSL FOR NGINX ──
share_certificates() {
	if [ -d "/ssl" ] && [ -f "$SERVER_CERT" ]; then
		echo "[SSL] 📤 Sharing certificates with NGINX/Home Assistant (/ssl/)..."
		cp "$SERVER_CERT" "/ssl/ha-webrtc.crt"
		cp "$SERVER_KEY" "/ssl/ha-webrtc.key"
		if [ -f "$CA_CERT" ]; then
			cp "$CA_CERT" "/ssl/ha-webrtc-ca.crt"
		fi
		chmod 644 "/ssl/ha-webrtc.crt" "/ssl/ha-webrtc.key" "/ssl/ha-webrtc-ca.crt" 2>/dev/null || true
		echo "[SSL] ✅ Copied to /ssl/ha-webrtc.crt"
	fi
}

# ──────────────────────────────────────────────
# PRIORITY 1: Home Assistant SSL certificates
# ──────────────────────────────────────────────
try_ha_certs() {
	local certfile="$SSL_DIR/fullchain.pem"
	local keyfile="$SSL_DIR/privkey.pem"

	# Also check common HA cert filenames
	if [ ! -f "$certfile" ]; then
		for name in "certificate.pem" "cert.pem" "ssl.crt"; do
			[ -f "$SSL_DIR/$name" ] && certfile="$SSL_DIR/$name" && break
		done
	fi
	if [ ! -f "$keyfile" ]; then
		for name in "private.pem" "key.pem" "ssl.key" "privkey.pem"; do
			[ -f "$SSL_DIR/$name" ] && keyfile="$SSL_DIR/$name" && break
		done
	fi

	if [ -f "$certfile" ] && [ -f "$keyfile" ]; then
		if check_cert_valid "$certfile" 1; then
			SSL_MODE="homeassistant"
			CERT_FILE="$certfile"
			KEY_FILE="$keyfile"
			echo "[SSL] ✅ Using Home Assistant certificates"
			echo "[SSL]    Cert: $CERT_FILE"
			return 0
		else
			echo "[SSL] ⚠️  HA certs found but expired/expiring"
		fi
	fi
	return 1
}

# ──────────────────────────────────────────────
# PRIORITY 2: Ingress mode (HA proxies HTTPS)
# ──────────────────────────────────────────────
try_ingress() {
	# Check if we're running behind Ingress
	if [ -n "${SUPERVISOR_TOKEN:-}" ]; then
		local ingress_active
		ingress_active=$(curl -sf \
			-H "Authorization: Bearer $SUPERVISOR_TOKEN" \
			http://supervisor/addons/self/info 2>/dev/null |
			jq -r '.data.ingress' 2>/dev/null) || true

		if [ "$ingress_active" = "true" ]; then
			SSL_MODE="ingress"
			CERT_FILE=""
			KEY_FILE=""
			echo "[SSL] ✅ Ingress active — HA handles HTTPS"
			echo "[SSL]    Add-on serves HTTP internally on port 8099"
			return 0
		fi
	fi
	return 1
}

# ──────────────────────────────────────────────
# PRIORITY 3: Auto-generate local CA + cert
# ──────────────────────────────────────────────
generate_certs() {
	mkdir -p "$ADDON_SSL"

	# Reuse existing if still valid
	if check_cert_valid "$SERVER_CERT" 30; then
		SSL_MODE="self-signed"
		CERT_FILE="$SERVER_CERT"
		KEY_FILE="$SERVER_KEY"
		CA_DOWNLOAD="$CA_CERT"
		echo "[SSL] ✅ Using existing auto-generated certificate"
		share_certificates
		return 0
	fi

	echo "[SSL] 🔐 Generating local CA and server certificate..."

	local LOCAL_IP
	LOCAL_IP=$(detect_local_ip)
	local HOSTNAME
	HOSTNAME=$(hostname 2>/dev/null || echo "homeassistant")

	# ── Step 1: Create local CA (if not exists or expired) ──
	if ! check_cert_valid "$CA_CERT" 365; then
		openssl genrsa -out "$CA_KEY" 2048 2>/dev/null

		openssl req -x509 -new -nodes \
			-key "$CA_KEY" \
			-sha256 \
			-days 3650 \
			-out "$CA_CERT" \
			-subj "/C=XX/O=HA-WebRTC/CN=HA WebRTC Local CA" \
			2>/dev/null

		echo "[SSL]    New CA created (valid 10 years)"
	fi

	# ── Step 2: Create server certificate with SANs ──
	cat >"$ADDON_SSL/server.cnf" <<EOF
[req]
default_bits       = 2048
distinguished_name = dn
req_extensions     = v3_req
prompt             = no

[dn]
CN = ${HOSTNAME}

[v3_req]
basicConstraints     = CA:FALSE
keyUsage             = digitalSignature, keyEncipherment
extendedKeyUsage     = serverAuth
subjectAltName       = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = ${HOSTNAME}
DNS.3 = ${HOSTNAME}.local
DNS.4 = homeassistant
DNS.5 = homeassistant.local
IP.1  = ${LOCAL_IP}
IP.2  = 127.0.0.1
EOF

	openssl genrsa -out "$SERVER_KEY" 2048 2>/dev/null

	openssl req -new \
		-key "$SERVER_KEY" \
		-out "$ADDON_SSL/server.csr" \
		-config "$ADDON_SSL/server.cnf" \
		2>/dev/null

	openssl x509 -req \
		-in "$ADDON_SSL/server.csr" \
		-CA "$CA_CERT" \
		-CAkey "$CA_KEY" \
		-CAcreateserial \
		-out "$SERVER_CERT" \
		-days 825 \
		-sha256 \
		-extfile "$ADDON_SSL/server.cnf" \
		-extensions v3_req \
		2>/dev/null

	# Cleanup temp files
	rm -f "$ADDON_SSL/server.csr" "$ADDON_SSL/server.cnf" "$ADDON_SSL/ca.srl"

	SSL_MODE="self-signed"
	CERT_FILE="$SERVER_CERT"
	KEY_FILE="$SERVER_KEY"
	CA_DOWNLOAD="$CA_CERT"

	# ── COPY TO SHARED SSL FOR NGINX ──

	share_certificates

	echo "[SSL] ✅ Certificate ready"
	echo "[SSL]    IP: $LOCAL_IP"
	echo "[SSL]    Valid: 825 days"
	echo "[SSL]    CA download: https://$LOCAL_IP:8443/ca.crt"
}

# ──────────────────────────────────────────────
# MAIN: Run cascade
# ──────────────────────────────────────────────
setup_ssl() {
	echo "[SSL] ─── Autonomous SSL Setup ───"
	echo "[SSL] 🏠 Local LAN Mode: Prioritizing local IP access"

	try_ha_certs && return 0
	try_ingress && return 0
	generate_certs && return 0

	echo "[SSL] ❌ All methods failed"
	return 1
}

# Execute if run directly (not sourced)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
	setup_ssl
	echo ""
	echo "[SSL] Mode:  $SSL_MODE"
	echo "[SSL] Cert:  $CERT_FILE"
	echo "[SSL] Key:   $KEY_FILE"
	[ -n "$CA_DOWNLOAD" ] && echo "[SSL] CA:    $CA_DOWNLOAD"
fi
