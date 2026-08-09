<img width="140" height="49" alt="logo_header" src="https://github.com/user-attachments/assets/d69237a7-152d-4d10-9b47-6cb96cefb324" />

# Running konaste games on Linux

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
Lutris cannot be used. This tool automates the registration of URL schemes in
Linux desktop environments and provides a command wrapper for launching games
with the necessary environment variables.

## Prerequisites

- Modern Linux distribution with a desktop environment
  - Required: systemd-cat, desktop-file-install, xdg-open
- [umu-launcher](https://github.com/Open-Wine-Components/umu-launcher) and it's
  dependencies
  - I recommend using Proton via umu‑launcher. Since Proton containerizes all
    the dependencies that Wine requires, it can run reproducibly on any system.
  - But you can also launch Wine directly if you prefer.
- Recommended using
  [atty303/proton-ge-custom](https://github.com/atty303/proton-ge-custom) to fix
  audio delay issues
- If ImageMagick is installed, use it to generate icons for the games.

I’m using [Bazzite](https://bazzite.gg/), and the minimal setup in this guide
works out of the box without any extra system settings.

## Installation

Download the latest release from the
[GitHub releases page](https://github.com/atty303/konamate/releases) and install
it using the following command:

```bash
cp ~/Downloads/konaste-x86_64-unknown-linux-gnu ~/.local/bin/konaste
chmod +x ~/.local/bin/konaste
```

or install it with [ubi](https://github.com/houseabsolute/ubi).

```bash
ubi -p atty303/konamate -e konaste -i ~/.local/bin
```

## Minimal steps to launch the games

You need to prepare the PulseAudio sink that configured sample rate to 44100Hz
for the game audio output. For example, you can use the following command to
create a loopback sink temporarily:

```bash
pw-loopback -m "[ FL FR ]" --capture-props='media.class=Audio/Sink node.name=konaste-sink node.description=Konaste audio.rate=44100'
```

To persist the sink, you can configure PipeWire configuration.

### beatmania IIDX INFINTAS

<details>
<summary>Click to expand the steps</summary>

1. Run the following command to configure and create the wine prefix:

```bash
konaste infinitas config --env.PROTONPATH=GE-Proton10-9 --env.PULSE_SINK=konaste-sink
konaste infinitas exec umu-run wineboot --init
```

2. Download the installer from the
   [official website](https://p.eagate.573.jp/game/infinitas/2/download/index.html)
   (you need to log in to your account).
3. Run the following command to install it:

```bash
konaste infinitas exec WINEDLLOVERRIDES="ieframe=d" umu-run msiexec /i ~/Downloads/infinitas_installer_2022060800.msi
```

4. Run the following command to associate the URL scheme with the game:

```bash
konaste infinitas associate
```

5. Run the following command to open the login page in your browser:

```bash
konaste infinitas run
```

6. After logging in, click the `ゲーム起動` button to launch the game launcher.
7. After the launcher is started, click the `UPDATE` button to update the game.
8. After the update is complete, click the `SETTING` button and set audio output
   to `WASAPI (共有モード)`(Shared Mode).

> [!WARNING]
> Wine does not support WASAPI Exclusive Mode on `winepulse.drv`(PulseAudio), so
> you must use Shared Mode.

9. After the audio output is set, click the `ゲーム起動` button to launch the
   game.

</details>

### SOUND VOLTEX EXCEED GEAR

<details>
<summary>Click to expand the steps</summary>

1. Run the following command to configure and create the wine prefix:

```bash
konaste sdvx config --env.PROTONPATH=GE-Proton10-9 --env.PULSE_SINK=konaste-sink
konaste sdvx exec umu-run wineboot --init
```

2. Download the installer from the
   [official website](https://p.eagate.573.jp/game/eacsdvx/vi/download/index.html)
   (you need to log in to your account).

3. Run the following command to install it:

```bash
konaste sdvx exec WINEDLLOVERRIDES="ieframe=d" umu-run msiexec /i ~/Downloads/sdvx_installer_2022011800.msi
```

4. Run the following command to associate the URL scheme with the game:

```bash
konaste sdvx associate
```

5. Run the following command to open the login page in your browser:

```bash
konaste sdvx run
```

<img width="502" height="495" alt="Screen Shot 2025-07-14 at 16 01 02" src="https://github.com/user-attachments/assets/2eaab921-bb50-49bc-99c8-e1418125662e" />

</details>

### GITADORA

<details>
<summary>Click to expand the steps</summary>

1. Run the following command to configure the wine prefix:

```bash
konaste gitadora config --env.PROTONPATH=GE-Proton10-9 --env.PULSE_SINK=konaste-sink
konaste gitadora exec umu-run wineboot --init
```

2. Download the installer from the
   [official website](https://p.eagate.573.jp/game/eacgitadora/konagt/download/installer.html)
   (you need to log in to your account).
3. Run the following command to install it:

```bash
konaste gitadora exec WINEDLLOVERRIDES="ieframe=d" umu-run msiexec /i ~/Downloads/GITADORA_installer.msi
```

4. Run the following command to associate the URL scheme with the game:

```bash
konaste gitadora associate
```

5. Run the following command to open the login page in your browser:

```bash
konaste gitadora run
```

4. After logging in, click the `ゲーム起動` button to launch the game.

</details>

## Usage

You can explore the available commands by specifying the `--help` option.

### `konaste ls`

This command lists the available games that can be managed by this tool.

You can add new games by creating a game definition file in the
`~/.config/konaste/games.json` file. Format of the game definition file is as
`defaultGames` in the [src/games.ts](src/games.ts). Additional properties used
by `%{key}` placeholders must have string values. Invalid JSON and values that
do not match the game definition schema are reported with their field path.

### `konaste <game> config`

This command configures the environment for the specified game. If user
configuration is not initialized, it will create with the default configuration.

- `konaste infinitas config`: Shows the current configuration for the game.
- `konaste infinitas config --env.NAME=<value>`: Sets the environment variable
  `NAME` to `value`. Use this to set umu-launcher, Proton or Wine environment
  variables.

### `konaste <game> profile`

This command manages the profiles for the specified game. Profiles are used to
configure the command to run the game when launching from browser. Some default
game definitions have preconfigured profiles for running the game directly
without launcher.

- `konaste infinitas profile`: Lists the available profiles for the game.
- `konaste infinitas profile --default`: Unsets the default profile. If no
  profile is set as default, selection will be prompted when launching. This is
  stored as `"runProfile": null` in the game configuration.
- `konaste infinitas profile <name> --command <command>`: Creates or updates a
  profile with the specified name and command.
- `konaste infinitas profile <name> --delete`: Deletes the specified profile.
- `konaste infinitas profile <name> --default`: Sets the specified profile as
  the default profile. The profile must already exist or be created by the same
  command.

Configuration files are validated when read. A missing configuration is
treated as uninitialized, while malformed JSON, invalid fields, and I/O errors
are reported instead of being replaced with defaults.

You can use the following placeholders in the command string:

- `%u`: URL passed to the game.
- `%t`: Token from the URL.
- `%r`: Installation directory as windows format (e.g. C:\\Games)
- `%{key}`: The value of the game definition `key`.
  - `%{id}`: The game ID (e.g. 'infinitas', 'sdvx', etc.).

### `konaste <game> associate`

This command registers the URL scheme for the specified game in the desktop
environment. It allows you to launch the game from the browser.

### `konaste <game> exec <...command>`

This command executes the specified command with configured environment
variables.

- `konaste infinitas exec umu-run winetricks <verbs>`: Runs Winetricks with the
  specified verbs.
- `konaste infinitas exec umu-run winecfg`: Opens the Wine configuration dialog.

### `konaste <game> run [url]`

This command opens the login URL in your default web browser if no URL is
provided.

And this is executed by the URL scheme registered by the `associate` command. It
will execute the command specified in the selected profile.

## Tweaks for better performance

### Enable ntsync

`ntsync` runs faster than the existing `esync` or `fsync` methods. It requires
Linux kernel 6.14 or newer, and becomes available when `/dev/ntsync` exists.

To enable ntsync, run the following command:

```bash
konaste infinitas config --env.PROTON_USE_NTSYNC=1
```

### Use gamescope

To run the game with [gamescope](https://github.com/ValveSoftware/gamescope),
you can use the following command to configure the profile:

```bash
konaste infinitas profile gamescope --command "gamescope -f -r 120 -w 1920 -h 1080 --mangoapp -- umu-run %r\\game\\app\\bm2dx.exe -t %t" --default
```

To revert this configuration when game update is required, you can run:

```bash
konaste infinitas profile launcher --default
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
      node.description = "Konaste Loopback"
      audio.position = [ FL FR ]
      capture.props = {
        node.name = "konaste-sink"
        media.class = "Audio/Sink"
        node.description = "Konaste Sink"
        device.description = "Konaste Sink"
        device.class = "sound"
        device.icon-name = "audio-card"
        node.virtual = false
        # IMPORTANT: Set the sample rate to 44100Hz for compatibility with Konaste games.
        audio.rate = 44100
        audio.channels = 2
      }
      playback.props = {
        node.name = "konaste-output"
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
konaste infinitas config --env.PULSE_LATENCY_MSEC=60
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
konaste infinitas config --env.LANG=ja_JP.UTF-8
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
3. Run `hk install --mise` to install the git hooks for formatting and linting.

To install the tool from source, run the following command:

```bash
deno install -A --global -n konaste --config ./deno.jsonc src/main.ts
```

If you're not using the compiled binary, the tool cannot determine its own
execution path. You must specify the `--self-path` option when running the
`associate` command.

### Live SDVX end-to-end test

The live test exercises the existing Playwright login flow, obtains a real SDVX
launch URL, and starts the installed game through umu/Proton. It is interactive,
host-dependent, and intentionally separate from `mise run check` and CI.

Use an existing SDVX Wine prefix, but pass it explicitly so the test does not
read or modify `~/.config/konaste`. Playwright browser storage and the generated
konaste configuration are isolated in a temporary directory. The existing
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
`${XDG_CACHE_HOME:-~/.cache}/konaste/e2e/` by default; launch URLs,
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
  work for konaste games on Linux that uses bash scripts and doesn't use Proton.

</details>
