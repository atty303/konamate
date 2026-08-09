<img width="140" height="49" alt="logo_header" src="https://github.com/user-attachments/assets/d69237a7-152d-4d10-9b47-6cb96cefb324" />

# Konamate: Running Konaste games on Linux

> [!IMPORTANT]
> YOU MUST HAVE A LEGAL SUBSCRIPTION TO PLAY THESE GAMES. THIS TOOL DOES NOT
> ALTER ANY GAME FILES.

This is a simple, customizable helper tool for launching
[コナステ (konaste)](https://p.eagate.573.jp/game/eacloud/re/video/video_top.html)
games on Linux. This tool aims to be “simple,” not “one‑click easy.” You’ll need
to perform the required setup manually following the guide, but in return you
gain the flexibility to customize the configuration to your liking and work with
future dependencies updates.

Currently, it supports the following games:

- [beatmania IIDX INFINTAS](https://p.eagate.573.jp/game/infinitas/2/index.html)
- [SOUND VOLTEX EXCEED GEAR](https://p.eagate.573.jp/game/eacsdvx/vi/index.html)
- [GITADORA](https://p.eagate.573.jp/game/eacgitadora/konagt/index.html)

> [!WARNING]
> I only regularly play INFINITAS, SDVX, and GITADORA. For other games, I’ve
> only verified that they launch.

## How it works

Konaste games authenticate your subscription in the browser, then launch the
game launcher via a custom URL scheme that includes an authorization token.
Since the standalone executable won't run by itself, traditional launchers like
Lutris cannot be used. Konamate uses Patchright to authenticate with a stored
passkey, captures the launch URL, and starts the game with the necessary
environment variables. Desktop URL association is available as an optional
alternative.

## Prerequisites

- Modern Linux distribution
- Google Chrome, Chromium, Brave, Microsoft Edge, or Vivaldi supported by
  Patchright, and a system keyring
- [umu-launcher](https://github.com/Open-Wine-Components/umu-launcher) and it's
  dependencies
  - I recommend using Proton via umu‑launcher. Since Proton containerizes all
    the dependencies that Wine requires, it can run reproducibly on any system.
  - But you can also launch Wine directly if you prefer.
- Recommended using
  [atty303/proton-ge-custom](https://github.com/atty303/proton-ge-custom) to fix
  audio delay issues
- Optional desktop integration requires `desktop-file-install` and
  `notify-send`. ImageMagick can provide game icons.

I’m using [Bazzite](https://bazzite.gg/), and the minimal setup in this guide
works out of the box without any extra system settings.

## Installation

Download the latest release from the
[GitHub releases page](https://github.com/atty303/konamate/releases) and install
it using the following command:

```bash
cp ~/Downloads/konamate-x86_64-unknown-linux-gnu ~/.local/bin/konamate
chmod +x ~/.local/bin/konamate
```

or install it with [ubi](https://github.com/houseabsolute/ubi).

```bash
ubi -p atty303/konamate -e konamate -i ~/.local/bin
```

### Upgrading from Konaste

The executable and application data locations changed in Konamate. After
installing the new executable, copy your existing configuration and browser
state to the new locations:

```bash
konamate migrate
```

Existing files in the new locations take precedence, and legacy data is left
unchanged. Keyring entries are copied from the legacy service when first used.
Wine prefixes and desktop URL associations are not migrated. If you use the
optional desktop integration, run `konamate associate <game>` again for each
configured game, then remove the old executable when it is no longer needed.

## Minimal steps to launch the games

Konamate automatically detects a compatible Chromium browser and saves its path
when a browser command is first used. To detect and save it in advance, run:

```bash
konamate settings --detect
```

Use `konamate settings --browser /path/to/chromium` when automatic detection does
not find the intended browser.

Register a passkey with the virtual authenticator. Complete the registration on
the KONAMI account page opened by the command:

```bash
konamate auth register-passkey
```

You need to prepare the PulseAudio sink that configured sample rate to 44100Hz
for the game audio output. For example, you can use the following command to
create a loopback sink temporarily:

```bash
pw-loopback -m "[ FL FR ]" --capture-props='media.class=Audio/Sink node.name=konamate-sink node.description=Konamate audio.rate=44100'
```

To persist the sink, you can configure PipeWire configuration.

### beatmania IIDX INFINTAS

<details>
<summary>Click to expand the steps</summary>

1. Run the following command to configure and create the wine prefix:

```bash
konamate config infinitas --env.PROTONPATH=GE-Proton10-9 --env.PULSE_SINK=konamate-sink
konamate exec infinitas umu-run wineboot --init
```

2. Download the installer from the
   [official website](https://p.eagate.573.jp/game/infinitas/2/download/index.html)
   (you need to log in to your account).
3. Run the following command to install it:

```bash
konamate exec infinitas WINEDLLOVERRIDES="ieframe=d" umu-run msiexec /i ~/Downloads/infinitas_installer_2022060800.msi
```

4. Authenticate and launch the game:

```bash
konamate run infinitas
```

5. After the launcher is started, click the `UPDATE` button to update the game.
6. After the update is complete, click the `SETTING` button and set audio output
   to `WASAPI (共有モード)`(Shared Mode).

> [!WARNING]
> Wine does not support WASAPI Exclusive Mode on `winepulse.drv`(PulseAudio), so
> you must use Shared Mode.

7. After the audio output is set, click the `ゲーム起動` button to launch the
   game.

</details>

### SOUND VOLTEX EXCEED GEAR

<details>
<summary>Click to expand the steps</summary>

1. Run the following command to configure and create the wine prefix:

```bash
konamate config sdvx --env.PROTONPATH=GE-Proton10-9 --env.PULSE_SINK=konamate-sink
konamate exec sdvx umu-run wineboot --init
```

2. Download the installer from the
   [official website](https://p.eagate.573.jp/game/eacsdvx/vi/download/index.html)
   (you need to log in to your account).

3. Run the following command to install it:

```bash
konamate exec sdvx WINEDLLOVERRIDES="ieframe=d" umu-run msiexec /i ~/Downloads/sdvx_installer_2022011800.msi
```

4. Authenticate and launch the game:

```bash
konamate run sdvx
```

<img width="502" height="495" alt="Screen Shot 2025-07-14 at 16 01 02" src="https://github.com/user-attachments/assets/2eaab921-bb50-49bc-99c8-e1418125662e" />

</details>

### GITADORA

<details>
<summary>Click to expand the steps</summary>

1. Run the following command to configure the wine prefix:

```bash
konamate config gitadora --env.PROTONPATH=GE-Proton10-9 --env.PULSE_SINK=konamate-sink
konamate exec gitadora umu-run wineboot --init
```

2. Download the installer from the
   [official website](https://p.eagate.573.jp/game/eacgitadora/konagt/download/installer.html)
   (you need to log in to your account).
3. Run the following command to install it:

```bash
konamate exec gitadora WINEDLLOVERRIDES="ieframe=d" umu-run msiexec /i ~/Downloads/GITADORA_installer.msi
```

4. Authenticate and launch the game:

```bash
konamate run gitadora
```

</details>

## Usage

You can explore the available commands by specifying the `--help` option.

### `konamate settings`

This command displays or stores application-wide settings. With no options it
only displays the saved settings. Use `--detect` to find a compatible browser
and save its path, or `--browser /path/to/chromium` to save a path explicitly.
Browser-related commands also accept `--browser` as a one-time override.

When no browser is configured, browser-related commands search `PATH`, the user
Flatpak exports, and the system Flatpak exports for Google Chrome, Chromium,
Brave, Microsoft Edge, or Vivaldi, in that order. The detected path is saved for
future use. An existing setting is never replaced automatically; use
`konamate settings --detect` to detect again.

### `konamate games`

This command lists the available games that can be managed by this tool.

You can add new games by creating a game definition file in the
`~/.config/konamate/games.json` file. Format of the game definition file is as
`defaultGames` in the [src/games.ts](src/games.ts). Additional properties used
by `%{key}` placeholders must have string values. Invalid JSON and values that
do not match the game definition schema are reported with their field path.

### `konamate controller`

This command reads Linux joystick state for workflow integration.
`konamate controller read --device <path>` prints the current state as JSON.
`konamate controller pressed --device <path> [--button <number>]` tests a
specific button, or any button when `--button` is omitted. It produces no
output and exits with status 0 when pressed, 1 when not pressed, and 2 when the
device cannot be read.

### `konamate config <game>`

This command configures the environment for the specified game. If user
configuration is not initialized, it will create with the default configuration.

- `konamate config infinitas`: Shows the current configuration for the game.
- `konamate config infinitas --env.NAME=<value>`: Sets the environment variable
  `NAME` to `value`. Use this to set umu-launcher, Proton or Wine environment
  variables.

### `konamate profile`

This command manages the profiles for the specified game. Profiles are used to
configure the command to run the game when launching from browser. Some default
game definitions have preconfigured profiles for running the game directly
without launcher.

- `konamate profile list infinitas`: Lists the available profiles.
- `konamate profile set infinitas <name> --command <command>`: Creates or
  replaces a profile.
- `konamate profile delete infinitas <name>`: Deletes a profile.
- `konamate profile default infinitas <name>`: Sets the default profile.
- `konamate profile default infinitas --unset`: Unsets the default profile. If
  no profile is set as default, selection will be prompted when launching. This
  is stored as `"runProfile": null` in the game configuration.

Placeholders are expanded everywhere they occur in a profile command. Values
inserted by `%u`, `%t`, `%r`, and `%{key}` are shell-escaped before the command
is executed. Placeholders cannot be nested inside shell expansions such as
`$()`, `${}`, backticks, or process substitutions.

Configuration files are validated when read. A missing configuration is
treated as uninitialized, while malformed JSON, invalid fields, and I/O errors
are reported instead of being replaced with defaults.

You can use the following placeholders in the command string:

- `%u`: URL passed to the game.
- `%t`: Token from the URL.
- `%r`: Installation directory as windows format (e.g. C:\\Games)
- `%{key}`: The value of the game definition `key`.
  - `%{id}`: The game ID (e.g. 'infinitas', 'sdvx', etc.).

### `konamate associate <game>`

This command registers the URL scheme for the specified game in the desktop
environment. It is optional and allows a regular browser to launch the game
through a desktop entry.

### `konamate exec <game> <...command>`

This command executes the specified command with configured environment
variables.

- `konamate exec infinitas umu-run winetricks <verbs>`: Runs Winetricks with the
  specified verbs.
- `konamate exec infinitas umu-run winecfg`: Opens the Wine configuration dialog.

### `konamate run <game> [url]`

Without a URL, this command authenticates in the configured browser, captures
the game launch URL, and executes the selected profile. Use `--profile NAME` to
override the default; when a terminal is available, Konamate prompts if several
profiles are available and none is selected.

With a URL, it launches the selected profile directly. Desktop entries created
by `associate` use this form with `--notify`.

## Tweaks for better performance

### Enable ntsync

`ntsync` runs faster than the existing `esync` or `fsync` methods. It requires
Linux kernel 6.14 or newer, and becomes available when `/dev/ntsync` exists.

To enable ntsync, run the following command:

```bash
konamate config infinitas --env.PROTON_USE_NTSYNC=1
```

### Use gamescope

To run the game with [gamescope](https://github.com/ValveSoftware/gamescope),
you can use the following command to configure the profile:

```bash
konamate profile set infinitas gamescope --command "gamescope -f -r 120 -w 1920 -h 1080 --mangoapp -- umu-run %r\\game\\app\\bm2dx.exe -t %t"
konamate profile default infinitas gamescope
```

To revert this configuration when game update is required, you can run:

```bash
konamate profile default infinitas launcher
```

### Setup low latency audio with PipeWire

Use [PipeWire](https://pipewire.org/) as the audio server for low latency audio
with flexible routing and maximum compatibility.

<details>
<summary>Click to expand the setup steps</summary>

Configure linux side audio settings for low latency audio:

`~/.config/pipewire/pipewire.conf.d/90-low-latency.conf`:

```
context.properties = {
  default.clock.rate = 48000

  # If possible, switch the entire graph to 44.1 kHz to suppress resampling.
  default.clock.allowed-rates = [ 44100, 48000 ]

  # Reducing it lowers latency, but increases CPU load and makes the audio more prone to dropouts.
  default.clock.quantum = 32
  default.clock.min-quantum = 32
  # Set it to twice the minimum.
  default.clock.max-quantum = 64
  default.clock.quantum-limit = 64
}
```

`~/.config/pipewire/pipewire-pulse.conf.d/90-rt.conf`:

```
context.modules = [
  {
    name = libpipewire-module-rt
    args = {
      nice.level = -20
      rt.prio = 99
    }
  }
]
```

Configure a dedicated virtual audio device for games:

`~/.config/pipewire/pipewire.conf.d/90-infinitas.conf`:

```
context.modules = [
  {
    name = libpipewire-module-loopback
    args = {
      node.description = "Konamate Loopback"
      audio.position = [ FL FR ]
      capture.props = {
        node.name = "konamate-sink"
        media.class = "Audio/Sink"
        node.description = "Konamate Sink"
        device.description = "Konamate Sink"
        device.class = "sound"
        device.icon-name = "audio-card"
        node.virtual = false
        # IMPORTANT: Set the sample rate to 44100Hz for compatibility with Konaste games.
        audio.rate = 44100
        audio.channels = 2
      }
      playback.props = {
        node.name = "konamate-output"
        node.passive = true

        # You can specify the target audio output device here or leave it as default.
        # target.object = "alsa_output.pci-0000_c4_00.6.analog-stereo"
      }
    }
  }
]
```

Apply the configuration by running:

```bash
systemctl --user restart pipewire pipewire-pulse
```

Configure the game side audio buffer size to reduce latency:

```bash
konamate config infinitas --env.PULSE_LATENCY_MSEC=60
```

Lowering the value will reduce latency, but may cause audio dropouts if your
system cannot handle it.

#### References

Since I was new to Linux’s audio system, I referred to the following.

- https://www.reddit.com/r/linux_gaming/comments/1gao420/low_latency_guide_for_linux_using_pipewire/
- https://blog.thepoon.fr/osuLinuxAudioLatency/
- https://www.benashby.com/resources/pipewire-setup-fundamentals/
- https://forum.manjaro.org/t/howto-troubleshoot-crackling-in-pipewire/82442

</details>

### Use ASIO in INFINITAS

INFINITAS supports ASIO output as a hidden feature. On Windows, follow
[the guide](https://iidx.org/infinitas_asio). You can enable it by adding the
`--asio` option to `bm2dx.exe`. Wine can enable ASIO
via [wineasio](https://github.com/wineasio/wineasio), though I haven’t verified
whether this actually reduces latency.

## Troubleshooting

### Locale issues

Maybe Koanste games expect the system to be configured for Japanese locale. If
you encounter issues, try setting the locale to Japanese may help.

```bash
konamate config infinitas --env.LANG=ja_JP.UTF-8
```

### Launching the game fails

After clicking the launch button, do not go back to the previous page. Doing so
will cause the game launch authorization to fail.

### INIFNITAS failed to start with audio device error

You need to set the audio output to `WASAPI (共有モード)` (Shared Mode) in the
game settings.

### INFIINITAS does not play sound

You need to provide audio output device that configured sample rate to 44100Hz.

## Development

1. Activate [mise](https://mise.jdx.dev/).
2. Run `mise install` in the project root to install the dependencies.
3. Run `mise run setup` to install the git hooks.

Use `mise run check` for the fast formatting, linting, type, and unit test
checks used during development. Run `mise run test` for all reproducible checks,
including a compiled binary build. You can also run `mise run build` directly
to build the CLI for the default architecture.

To install the tool from source, run the following command:

```bash
deno install -A --global -n konamate --config ./deno.jsonc src/main.ts
```

If you're not using the compiled binary, the tool cannot determine its own
execution path. You must specify the `--self-path` option when running the
`associate` command.

### Live SDVX end-to-end test

The live test exercises the integrated Patchright login and launch flow and
starts the installed game through umu/Proton. It is interactive, host-dependent,
and intentionally separate from `mise run check` and CI.

Use an existing SDVX Wine prefix, but pass it explicitly so the test does not
read or modify `~/.config/konamate`. Patchright browser storage and the generated
konamate configuration are isolated in a temporary directory. The existing
passkey is read from the keyring.

```bash
mise run test:e2e:linux:sdvx -- \
  --wine-prefix /path/to/sdvx-prefix \
  --proton-path GE-Proton10-9
```

Use `--game-env NAME=VALUE` for additional game environment variables. Browser,
audio sink, passkey entry, and result path can be selected with `--browser`,
`--pulse-sink`, `--passkey-service`, `--passkey-name`, and `--output`.

The test asks for confirmation before accessing the account or launching the
game. Proton and SDVX may update the selected prefix, shader caches, and game
settings. After the game exits, confirm the title screen, audio, and physical
controller behavior. Sanitized results are written under
`${XDG_CACHE_HOME:-~/.cache}/konamate/e2e/` by default; launch URLs,
authorization tokens, and passkey contents are not recorded.

## Verified Configurations

<details>
<summary>Click to expand the verified configurations</summary>

### All games

- OS: Bazzite 42 Desktop Edition (KDE Plasma 6)
- Browser: Firefox 140

### beatmania IIDX INFINTAS

All game functionality has been tested on the following configurations:

- Hardware: Minisforum UM790 Pro
  - CPU: AMD Ryzen 9 7940HS (8C / 4.0 - 5.2 GHz)
  - GPU: AMD Radeon 780M Integrated Graphics
  - RAM: 64 GB
- Audio: Sennheiser GSX1000 (7.1ch Virtual Surround)
- Display:
  - Primary: Hisense 43E7N 4K @120Hz via HDMI
  - Secondary: Full HD Monitor @60Hz via USB-C
- Controller: GAMO2 PHOENIXWAN+ LMT x2
- Proton: GE-Proton10-9-wma

Although I’m using displays with different refresh rates, there’s no problem
running at 120 fps. CPU load is around 10% and GPU load is around 70% during
gameplay and streaming with OBS Studio. There’s no noticeable difference
compared to running it on Windows 11 in a dual-boot setup.

### SOUND VOLTEX EXCEED GEAR

All game functionality has been tested on the following configurations:

- Hardware: Minisforum MS-A2
  - CPU: AMD Ryzen 9 7945HX (16C / 2.5 - 5.4 GHz)
  - GPU: AMD Radeon RX6400 (4GB)
  - RAM: 32 GB
- Audio: Creative Sound BlasterX G6 (7.1ch Virtual Surround)
- Display:
  - Primary: FHD @120Hz via HDMI
  - Secondary: Full HD Monitor @60Hz via USB-C
- Controller:
  [SOUND VOLTEX CONSOLE -NEMSYS- Ultimate Model (2017)](https://www.konamistyle.jp/products/detail.php?product_id=110908)
- Proton: GE-Proton10-9-wma

There’s no noticeable difference compared to running it on Windows 11 in a
dual-boot setup.

#### Alternative configuration for performance testing

- Hardware: Minisforum UM790 Pro
  - CPU: AMD Ryzen 9 7940HS (8C / 4.0 - 5.2 GHz)
  - GPU: AMD Radeon 780M Integrated Graphics (UMA 6GB)
  - RAM: 64 GB
- Audio: Sennheiser GSX1000 (7.1ch Virtual Surround)
- Display:
  - Primary: Hisense 43E7N 4K @120Hz via HDMI
  - Secondary: Full HD Monitor @60Hz via USB-C
- Proton: GE-Proton10-9

The backgrounds in VIVID WAVE—like “NOT YOUR IDOL”—are extremely GPU-intensive,
driving GPU utilization up to around 95% and causing momentary drops to about
100 fps. This happens on Windows 11 too, so it’s simply a limitation of the
Radeon 780M.

### GITADORA

Drummania functionality has been tested on the following configurations:

- Hardware: LENOVO ThinkCentre M715q
  - CPU: AMD Ryzen 5 PRO 2400GE (4C / 3.2 - 3.8 GHz)
  - GPU: AMD Radeon Vega 11 Integrated Graphics
  - RAM: 8 GB
- Audio: Onboard
- MIDI Drums: Roland TD-1 (USB)
- Proton: GE-Proton10-8

</details>

## Game technical details

<details>
<summary>Click to expand the game technical details that I'm observiing when developing this tool</summary>

### beatmania IIDX INFINTAS

- Graphics API: Direct3D 9
- Audio API: WASAPI (Shared Mode, Exclusive Mode), ASIO (Hidden feature)
  - Requires 44100Hz sample rate
  - Audio files are in WMAv2 format
  - Media Foundation is used for decoding
- Native resolution: 1920x1080
- Maximum frame rate: 120 fps

### SOUND VOLTEX EXCEED GEAR

- Graphics API:
- Audio API: WASAPI (Shared Mode, Exclusive Mode), ASIO, DirectSound
  - Requires 44100Hz sample rate
- Native resolution: 1920x1080
- Maximum frame rate: 120 fps

### GITADORA

- Graphics API:
  - Media Foundation for video decoding
- Audio API: WASAPI (Shared Mode, Exclusive Mode)
- Native resolution: 1920x1080
- Maximum frame rate: 60 fps

## References

- [mizztgc/konaste-linux](https://github.com/mizztgc/konaste-linux) - Another
  work for Konaste games on Linux that uses bash scripts and doesn't use Proton.

</details>
