#!/bin/bash
set -e

cd /var/app/staging

# pnpm não vem na AMI do EB; npm sempre existe.
npm install -g pnpm@8

pnpm install --frozen-lockfile
pnpm run build
