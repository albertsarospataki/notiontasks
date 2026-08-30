#!/bin/sh
set -e

# Az adatkönyvtár rendszerint kívülről csatolt kötet, ami root tulajdonában
# érkezik. Rootként rendbe tesszük a tulajdonjogát, majd jogosultságot vesztve,
# a `node` felhasználóként indítjuk a szervert — a szolgáltatásnak semmilyen
# emelt jogra nincs szüksége.

DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$DATA_DIR"

if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$DATA_DIR"

  if ! command -v setpriv >/dev/null 2>&1; then
    echo "docker-entrypoint: hiányzik a setpriv, a szerver nem indul root alatt." >&2
    echo "Telepítsd a util-linux csomagot, vagy futtasd a konténert --user node kapcsolóval." >&2
    exit 1
  fi

  exec setpriv --reuid=node --regid=node --init-groups --inh-caps=-all "$@"
fi

exec "$@"
