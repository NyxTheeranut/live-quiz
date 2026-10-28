#!/bin/sh
# Run before every commit: stamps a fresh version onto every local script/stylesheet link.
# Why: GitHub Pages lets browsers cache files for ~10 minutes, so a page could load a NEW
# host.html with an OLD host.js and break. A new ?v=... makes the browser fetch matching files.
cd "$(dirname "$0")" || exit 1
V=$(date +%Y%m%d%H%M%S)
for f in host.html index.html bots.html; do
  perl -pi -e "s/((?:src|href)=\"(?:theme\.css|host\.css|fx\.js|sound\.js|studio\.js|host\.js|config\.js))(?:\?v=\d+)?\"/\$1?v=$V\"/g" "$f"
done
echo "stamped $V"
