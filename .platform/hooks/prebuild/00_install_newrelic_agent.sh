#!/bin/bash
set -euo pipefail

NEW_RELIC_API_KEY="$(/opt/elasticbeanstalk/bin/get-config environment -k NEW_RELIC_API_KEY)"
NEW_RELIC_ACCOUNT_ID="$(/opt/elasticbeanstalk/bin/get-config environment -k NEW_RELIC_ACCOUNT_ID)"

curl -Ls https://download.newrelic.com/install/newrelic-cli/scripts/install.sh | bash
sudo NEW_RELIC_API_KEY="$NEW_RELIC_API_KEY" NEW_RELIC_ACCOUNT_ID="$NEW_RELIC_ACCOUNT_ID" /usr/local/bin/newrelic install -y
