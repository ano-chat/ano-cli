#!/usr/bin/env bash
#
# ano native binary installer.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ano-chat/ano-cli/main/scripts/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/ano-chat/ano-cli/main/scripts/install.sh | bash -s -- --version v2.21.3
#
# Environment variables:
#   ANO_INSTALL_DIR   override install location (default: $HOME/.local/bin)
#   ANO_INSTALL_VERSION  override version (default: latest GitHub Release)
#   ANO_INSTALL_NO_VERIFY=1   skip SHA256 verification (NOT recommended)
#
# What this does:
#   1. Detect OS + arch (darwin-arm64, darwin-x64, linux-x64, linux-arm64).
#   2. Resolve the version to install (latest tag or --version flag).
#   3. Download the binary + SHA256SUMS file from the GitHub Release.
#   4. Verify the SHA256 (refuses to install if mismatched).
#   5. Install to $ANO_INSTALL_DIR/ano with mode 0755.
#   6. Print PATH instructions if the install dir isn't on PATH.
#
# Why not Homebrew: this script works in any shell on any machine
# without needing a tap. Homebrew is the polished UX layer for macOS
# users who already use brew; this script is the lowest-common-
# denominator alternative that also covers Linux + container shells.
#
# Why not npm: native binaries are ~10× faster cold start (~20 ms vs
# ~150 ms via node). For users who want the speed AND don't need
# Node, this script is the path. The npm install continues to work
# for everyone else.

set -euo pipefail

REPO="ano-chat/ano-cli"
INSTALL_DIR="${ANO_INSTALL_DIR:-$HOME/.local/bin}"
VERSION="${ANO_INSTALL_VERSION:-}"
VERIFY=1
[ "${ANO_INSTALL_NO_VERIFY:-0}" = "1" ] && VERIFY=0

# ── flag parsing ───────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      VERSION="$2"
      shift 2
      ;;
    --version=*)
      VERSION="${1#--version=}"
      shift
      ;;
    --dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --dir=*)
      INSTALL_DIR="${1#--dir=}"
      shift
      ;;
    --no-verify)
      VERIFY=0
      shift
      ;;
    -h|--help)
      sed -n '2,/^$/p' "$0" | sed 's/^# //; s/^#//'
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

# ── colors (best effort) ───────────────────────────────────────────
if [ -t 1 ] && command -v tput >/dev/null 2>&1 && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
  C_BOLD="$(tput bold)"
  C_DIM="$(tput dim)"
  C_RED="$(tput setaf 1)"
  C_GREEN="$(tput setaf 2)"
  C_YELLOW="$(tput setaf 3)"
  C_RESET="$(tput sgr0)"
else
  C_BOLD=""; C_DIM=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_RESET=""
fi

info() { printf '%s→%s %s\n' "$C_BOLD" "$C_RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
err() { printf '%s✗%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; }
ok() { printf '%s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }

# ── platform detection ─────────────────────────────────────────────
detect_platform() {
  local uname_s uname_m os arch
  uname_s="$(uname -s)"
  uname_m="$(uname -m)"
  case "$uname_s" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    *)
      err "Unsupported OS: $uname_s. Native binaries are not built for this platform."
      err "Fall back to the npm install: npm install -g @ano-chat/cli"
      exit 1
      ;;
  esac
  case "$uname_m" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *)
      err "Unsupported architecture: $uname_m."
      err "Fall back to the npm install: npm install -g @ano-chat/cli"
      exit 1
      ;;
  esac
  printf '%s-%s\n' "$os" "$arch"
}

# ── version resolution ─────────────────────────────────────────────
resolve_latest_version() {
  # GitHub's "latest" redirect resolves to the most-recent release
  # tag. -sI gets the headers without following the redirect; the
  # tag is the last path segment.
  local url location
  url="https://github.com/${REPO}/releases/latest"
  location="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "$url" 2>/dev/null || true)"
  if [ -z "$location" ]; then
    err "Could not resolve latest version from GitHub. Check network."
    exit 1
  fi
  # location looks like https://github.com/ano-chat/ano-cli/releases/tag/v2.21.3
  printf '%s\n' "${location##*/}"
}

# ── checksum verification ──────────────────────────────────────────
sha256_of_file() {
  local file="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    err "Need shasum or sha256sum to verify integrity. Install one, or pass --no-verify."
    exit 1
  fi
}

# ── main ───────────────────────────────────────────────────────────
PLATFORM="$(detect_platform)"
ASSET="ano-${PLATFORM}"

if [ -z "$VERSION" ]; then
  info "Resolving latest version…"
  VERSION="$(resolve_latest_version)"
fi

case "$VERSION" in
  v*) ;;
  *) VERSION="v${VERSION}" ;;
esac

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/${ASSET}"
SUMS_URL="https://github.com/${REPO}/releases/download/${VERSION}/SHA256SUMS"

info "Installing ano-cli ${C_BOLD}${VERSION}${C_RESET} (${PLATFORM})"
info "Source: ${C_DIM}${DOWNLOAD_URL}${C_RESET}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Download the binary.
if ! curl -fL --progress-bar -o "$TMP/$ASSET" "$DOWNLOAD_URL"; then
  err "Download failed. Check that ${VERSION} ships a ${ASSET} asset on GitHub Releases."
  err "Releases page: https://github.com/${REPO}/releases/tag/${VERSION}"
  exit 1
fi

# Verify SHA256 unless --no-verify was passed. Note that the SHA256SUMS
# file is also downloaded over HTTPS from github.com; an attacker who
# could swap one could swap both. The verification primarily guards
# against accidental corruption (network drop) and lets us refuse to
# install a partially-downloaded binary.
if [ "$VERIFY" = "1" ]; then
  info "Verifying SHA256…"
  if curl -fsSL -o "$TMP/SHA256SUMS" "$SUMS_URL"; then
    expected="$(grep "  ${ASSET}\$" "$TMP/SHA256SUMS" | awk '{print $1}')"
    if [ -z "$expected" ]; then
      err "SHA256SUMS doesn't list ${ASSET} — release artifact mismatch."
      exit 1
    fi
    actual="$(sha256_of_file "$TMP/$ASSET")"
    if [ "$expected" != "$actual" ]; then
      err "SHA256 mismatch."
      err "  expected: ${expected}"
      err "  actual:   ${actual}"
      err "Aborting. Re-run with ANO_INSTALL_NO_VERIFY=1 to override (NOT recommended)."
      exit 1
    fi
    ok "Checksum verified."
  else
    warn "Could not download SHA256SUMS — skipping verification."
    warn "Re-run with --no-verify to suppress this warning."
  fi
fi

# Install.
mkdir -p "$INSTALL_DIR"
mv "$TMP/$ASSET" "$INSTALL_DIR/ano"
chmod 0755 "$INSTALL_DIR/ano"

ok "Installed ano-cli ${VERSION} to ${C_BOLD}${INSTALL_DIR}/ano${C_RESET}"

# Sanity-run.
if "$INSTALL_DIR/ano" --version >/dev/null 2>&1; then
  installed_version="$("$INSTALL_DIR/ano" --version 2>/dev/null || true)"
  info "Reported version: ${installed_version}"
else
  warn "The binary exits non-zero on \`ano --version\`. Investigate before relying on it."
fi

# PATH hint.
case ":$PATH:" in
  *":$INSTALL_DIR:"*)
    ok "Done. Run \`ano --help\` to get started."
    ;;
  *)
    cat <<EOF

${C_YELLOW}${INSTALL_DIR}${C_RESET} is not on your \$PATH.

Add this line to your shell's startup file (~/.zshrc / ~/.bashrc / ~/.profile):

  export PATH="${INSTALL_DIR}:\$PATH"

Then start a new shell, or run:

  export PATH="${INSTALL_DIR}:\$PATH"

EOF
    ;;
esac
