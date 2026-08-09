#!/usr/bin/env -S bash
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

process-compose -f "$script_dir"/infinitas.yaml up

#CONTROLLER_DEVICE=/dev/input/by-id/usb-Konami_Amusement_SOUND_VOLTEX_controller_BF002-joystick
#if konamate controller pressed -d "$CONTROLLER_DEVICE" --button 0; then
#  :
#elif [ "$?" -eq 1 ]; then
#  systemctl poweroff
#fi
