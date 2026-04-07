#!/usr/bin/env bash
# backend/deploy.sh — Build a backend container locally
#
# Usage:
#   chmod +x backend/deploy.sh
#   ./backend/deploy.sh
#
# This script intentionally avoids any cloud-specific tooling. It builds the
# backend image locally and prints an example docker run command.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR"
IMAGE_NAME="${IMAGE_NAME:-mockmate-backend}"

echo "══════════════════════════════════════════════════════════════"
echo "  MockMate Backend → Local Container Build"
echo "══════════════════════════════════════════════════════════════"
echo "  Directory: $BACKEND_DIR"
echo "  Image:     $IMAGE_NAME"
echo ""

echo "▸ Building Docker image..."
docker build -t "$IMAGE_NAME" "$BACKEND_DIR"

echo ""
echo "✔ Backend image build complete!"
echo "  Example run command:"
echo "  docker run --env-file \"$BACKEND_DIR/.env\" -p 8080:8080 $IMAGE_NAME"
