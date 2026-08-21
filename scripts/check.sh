#!/bin/sh
# Deploy gate: roundtable.js must parse. One missing brace darkens the desk.
set -e
cd "$(dirname "$0")/.."
node --check frontend/static/roundtable.js
node --check frontend/static/desk-fx.js
echo "ok: node --check frontend/static/roundtable.js desk-fx.js"
