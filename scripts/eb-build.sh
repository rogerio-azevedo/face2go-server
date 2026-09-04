#!/bin/bash
# Build do CodeBuild. A instância EB só descompacta o artefato (não recompila).
set -euo pipefail

ROOT="${1:-.}"
cd "$ROOT"

export NODE_ENV=development
export CI=true

# Força pnpm 11: instâncias EB podem ter a v8 de deploys antigos.
npm install -g pnpm@11.24.0

pnpm install --frozen-lockfile --prod=false
pnpm run build

if ! grep -rq "join-context" dist/; then
  echo "FATAL: dist/ não contém join-context — build incompleto ou desatualizado."
  exit 1
fi

if ! grep -rq "select-context" dist/; then
  echo "FATAL: dist/ não contém select-context — build incompleto ou desatualizado."
  exit 1
fi

PREVIOUS_COMMIT=""
if [ -f dist/build-info.json ]; then
  PREVIOUS_COMMIT="$(node -pe "JSON.parse(require('fs').readFileSync('dist/build-info.json','utf8')).commit" 2>/dev/null || true)"
fi

BUILD_COMMIT="${CODEBUILD_RESOLVED_SOURCE_VERSION:-${GITHUB_SHA:-}}"
if [ -z "$BUILD_COMMIT" ] && [ -f deploy-commit.txt ]; then
  BUILD_COMMIT="$(tr -d '[:space:]' < deploy-commit.txt)"
fi
if [ -z "$BUILD_COMMIT" ] && command -v git >/dev/null 2>&1; then
  BUILD_COMMIT="$(git rev-parse HEAD 2>/dev/null || true)"
fi
if [ -z "$BUILD_COMMIT" ] && [ -n "$PREVIOUS_COMMIT" ] && [ "$PREVIOUS_COMMIT" != "unknown" ]; then
  BUILD_COMMIT="$PREVIOUS_COMMIT"
fi
BUILD_COMMIT="${BUILD_COMMIT:-unknown}"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DEPLOY_MARKER="context-auth-build-v2"

cat > dist/build-info.json <<EOF
{"builtAt":"${BUILT_AT}","commit":"${BUILD_COMMIT}","deployMarker":"${DEPLOY_MARKER}","routesVerified":["join-context","select-context"]}
EOF

echo "Build OK: builtAt=${BUILT_AT} commit=${BUILD_COMMIT}"
