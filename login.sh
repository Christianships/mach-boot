#!/bin/bash
# Play the active MACH screen once per boot: only on the first login after a power-on or restart.
# Launched at every login by ~/Library/LaunchAgents/dev.mach.intro.plist (see ./mach install).
cd "$(dirname "$0")"
boot=$(sysctl -n kern.boottime | sed -E 's/^\{ sec = ([0-9]+),.*/\1/')
state="$HOME/Library/Caches/mach-boot/last-boot"
[ "$(cat "$state" 2>/dev/null)" = "$boot" ] && exit 0
mkdir -p "${state%/*}"
echo "$boot" > "$state"

# let the desktop finish coming up so the overlay lands on it
for _ in $(seq 1 30); do
  pgrep -qx Dock && pgrep -qx Finder && break
  sleep 1
done
sleep 2
exec ./mach play
