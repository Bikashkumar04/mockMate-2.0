#!/usr/bin/env bash
# deploy.sh — Deploy MockMate (backend + frontend) in one command
#
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh              # deploy both backend and frontend
#   ./deploy.sh backend      # deploy backend only
#   ./deploy.sh frontend     # deploy frontend only
#
# Prerequisites:
#   - Backend:  gcloud CLI authenticated, GCP project set, APIs enabled
#   - Frontend: Vercel CLI installed (npm i -g vercel), project linked

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-all}"

deploy_backend() {
  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  Deploying Backend → Cloud Run                             ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  bash "${REPO_ROOT}/backend/deploy.sh"
}

deploy_frontend() {
  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  Deploying Frontend → Vercel                               ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  bash "${REPO_ROOT}/frontend/deploy.sh"
}

case "$TARGET" in
  backend)
    deploy_backend
    ;;
  frontend)
    deploy_frontend
    ;;
  all)
    deploy_backend
    deploy_frontend
    ;;
  *)
    echo "Usage: ./deploy.sh [backend|frontend|all]"
    exit 1
    ;;
esac

echo ""
echo "✔ Done!"
