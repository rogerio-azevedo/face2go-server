#!/bin/bash
# Build usado no CodeBuild e no hook predeploy do Elastic Beanstalk.
set -euo pipefail

ROOT="${1:-.}"
cd "$ROOT"

export NODE_ENV=development
export CI=true

if ! command -v pnpm >/dev/null 2>&1; then
  npm install -g pnpm@8
fi

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

BUILD_COMMIT="${CODEBUILD_RESOLVED_SOURCE_VERSION:-${GITHUB_SHA:-unknown}}"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DEPLOY_MARKER="context-auth-build-v2"

cat > dist/build-info.json <<EOF
{"builtAt":"${BUILT_AT}","commit":"${BUILD_COMMIT}","deployMarker":"${DEPLOY_MARKER}","routesVerified":["join-context","select-context"]}
EOF

echo "Build OK: builtAt=${BUILT_AT} commit=${BUILD_COMMIT}"
