#!/bin/bash
set -euo pipefail

chmod +x /var/app/staging/scripts/eb-build.sh
/var/app/staging/scripts/eb-build.sh /var/app/staging
