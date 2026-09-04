#!/bin/bash
set -euo pipefail

# CodeBuild já gera dist/ + node_modules de produção. Só instala se o
# artefato vier incompleto (fallback).
cd /var/app/staging

if [ -f dist/main.js ] && [ -d node_modules ]; then
  echo "Prebuilt dist/ and node_modules present; skipping install on instance."
  exit 0
fi

echo "WARN: prebuilt artifact missing; installing production deps on instance."
npm install -g pnpm@11.24.0
pnpm install --frozen-lockfile --prod
