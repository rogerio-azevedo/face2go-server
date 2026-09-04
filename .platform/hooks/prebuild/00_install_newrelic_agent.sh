#!/bin/bash
set -euo pipefail

# APM já é carregada pelo Procfile (`node -r newrelic`). Em Immutable a
# instância é sempre nova — instalar o agente de infra atrasaria todo deploy.
echo "Skipping New Relic infra agent; APM uses the npm package."
exit 0
