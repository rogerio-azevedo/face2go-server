#!/bin/bash
# A plataforma Node só roda `npm install` quando não existe node_modules.
# O projeto instala com pnpm no predeploy (scripts/eb-build.sh).
set -euo pipefail

mkdir -p /var/app/staging/node_modules
