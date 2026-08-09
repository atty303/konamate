#!/usr/bin/env -S bash
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if process-compose -f "$script_dir"/sdvx.yaml up; then
  :
else
  exit $?
fi

CONTROLLER_DEVICE=/dev/input/by-id/usb-Konami_Amusement_SOUND_VOLTEX_controller_BF002-joystick
if konamate controller pressed -d "$CONTROLLER_DEVICE" --button 0; then
  exit 0
else
  status=$?
fi

if [ "$status" -eq 1 ]; then
  systemctl poweroff
else
  echo "Failed to read the controller; skipping poweroff" >&2
  exit "$status"
fi
