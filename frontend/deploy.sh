#!/usr/bin/env bash
# frontend/deploy.sh — Deploy MockMate frontend to Vercel
#
# Usage:
#   chmod +x frontend/deploy.sh
#   ./frontend/deploy.sh
#
# Prerequisites:
#   - Vercel CLI installed (npm i -g vercel)
#   - Vercel project already linked (vercel link)
#   - Environment variables configured in the Vercel dashboard:
#       NEXT_PUBLIC_API_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL,
#       GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
#       MONGODB_URI, MONGODB_DATABASE

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR"

echo "══════════════════════════════════════════════════════════════"
echo "  MockMate Frontend → Vercel"
echo "══════════════════════════════════════════════════════════════"
echo "  Directory: $FRONTEND_DIR"
echo ""

echo "▸ Installing dependencies..."
cd "$FRONTEND_DIR"
npm ci

echo "▸ Building Next.js production bundle..."
npm run build

echo "▸ Deploying to Vercel (production)..."
npx vercel --prod --yes

echo ""
echo "✔ Frontend deployment complete!"
