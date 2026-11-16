# Astro Vitals

A locally built, macOS-inspired GNOME 50 extension for a 28-pixel WhiteSur top bar. All four readings stay in the panel: **CPU temperature, GPU temperature, RAM used, and GPU memory used**.

## Start using it

After installation, **log out and back in once.** GNOME 50 discovers new local extensions when the session starts; the installer does not interrupt your applications or log you out.

Click the readouts for exact values, memory totals, refresh speed, gentle-animation control, and a percentage display option. `°` means Celsius; `G` means GiB. The default refresh interval is three seconds.

## Design

Inter typography with tabular numerals, quiet separators, soft thermal colors, and thin animated meters. The layout reserves space for values so changing readings do not move neighboring panel items. It inherits the panel height and does not change your theme, clock, or system icons. The compact details menu uses a dark, rounded surface.

Green indicates cooler temperatures, amber warm, peach hot, and rose very hot. These are visual guides, not hardware safety limits. CPU transitions occur at 65 / 80 / 90 °C; GPU transitions at 55 / 70 / 83 °C. Memory turns amber at 80% and rose at 92% of capacity.

## Resource use and reliability

- One small compiled C helper, kept idle between requests; no repeating `nvidia-smi`, shell commands, web views, network requests, or privileged service.
- CPU: Linux `k10temp` Tctl/package sensor. RAM: `MemTotal - MemAvailable`, excluding reclaimable cache from the used count. NVIDIA temperature and VRAM: the installed driver's NVML API, using the same selected GPU for both readings.
- All sensor I/O runs outside GNOME Shell. The UI reads its pipe asynchronously. Only one sample can be outstanding. A stalled helper is killed after eight seconds; stale values become `—`; retries back off to at most once per minute.
- Subtle 260 ms meter transitions occur only when values change. No continuous animation. System animation preferences are respected. Menu details update only while open.
- Disabling the extension removes timers, signal handlers, and the helper. It does not run on the lock screen. The helper also exits on pipe closure or parent-process death.
- Sensor paths are rediscovered after failures; missing sensors show `—`, never a fabricated zero. NVIDIA device reconnection retries after driver failures. AMD fallback is available when NVML is absent, but this installation was validated on an RTX 5070.

Tested on GNOME Shell 50.1 with NVIDIA hardware. Reliability is tested, not an absolute guarantee against driver or desktop bugs.

## Rebuild / reinstall

Ubuntu's existing GCC, GLib tools, Python with GObject introspection, and GJS are sufficient. No prebuilt monitor is required.

```sh
make test
python3 install.py
```

Reinstalling an already loaded JavaScript extension also needs one logout/login because GNOME caches its modules. Existing installations are backed up under `~/.local/state/astro-vitals/`.

To disable, use GNOME Extensions or:

```sh
gnome-extensions disable astro-vitals@local
```

To remove only this extension:

```sh
python3 uninstall.py
```

## Source layout

- `extension.js`, `stylesheet.css`: native panel UI and menu.
- `transport.js`: asynchronous child process, watchdog, cancellation and retry handling.
- `model.js`: validation, units, formatting and color thresholds.
- `native/sensors.c`: read-only Linux and NVML sensor collection.
- `tests/`: protocol, formatting and live hardware tests.

The source uses [GNOME's extension lifecycle guidance](https://gjs.guide/extensions/review-guidelines/best-practices.html) and [NVIDIA's documented device-query API](https://docs.nvidia.com/deploy/nvml-api/620/api/group__nvmlDeviceQueries.html). This is an independent local tool inspired by macOS styling; it is not an Apple product.
