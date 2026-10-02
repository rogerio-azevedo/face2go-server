#!/bin/bash
set -euo pipefail

if [ -f /var/app/staging/dist/build-info.json ]; then
  echo "dist já compilado no CodeBuild, pulando build na instância"
  exit 0
fi

chmod +x /var/app/staging/scripts/eb-build.sh
/var/app/staging/scripts/eb-build.sh /var/app/staging
