#!/bin/sh
# Deploy gate: roundtable.js must parse. One missing brace darkens the desk.
set -e
cd "$(dirname "$0")/.."
node --check frontend/static/roundtable.js
echo "ok: node --check frontend/static/roundtable.js"
