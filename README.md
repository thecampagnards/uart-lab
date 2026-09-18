# uart-lab

A browser-based console for configuring and monitoring UART sensors, with no
driver or application to install, built on the
[Web Serial API](https://developer.mozilla.org/docs/Web/API/Web_Serial_API).

First supported device: the **Hi-Link HLK-LD2420**, a 24 GHz mmWave human
presence radar.

> **Live demo** — <https://REPLACE-WITH-YOUR-ACCOUNT.github.io/uart-lab/>
> It ships with a simulated LD2420, so the whole interface can be explored
> without hardware.

## What it does

- **Connects** to the module through any USB-UART bridge (FT232RL, CP2102,
  CH340…), at any rate from 9600 to 460800 baud.
- **Live monitoring**: presence, distance, per-gate energy for all 16 gates, a
  distance timeline and a time × gate heatmap.
- **Configuration**: minimum and maximum gate, absence delay, and all 32
  thresholds (motion and still) — shown both raw and in dB.
- **Import/export** of the configuration as JSON, factory reset, module restart.
- **Serial trace** in hex, to cross-check against the protocol documentation.
- **Built-in simulated module**, to try the tool out or develop without a sensor.

Everything runs on your machine: no data is sent anywhere, and there is no
server.

## Requirements

|          |                                                                                        |
| -------- | -------------------------------------------------------------------------------------- |
| Browser  | Chrome, Edge or Opera **on desktop** (Web Serial exists on neither Firefox nor Safari) |
| Context  | HTTPS, or `http://localhost`                                                           |
| Hardware | HLK-LD2420 + a USB-UART bridge set to **3.3 V**                                        |

Wiring is described in [`doc/hardware-ft232rl.md`](doc/hardware-ft232rl.md).
**The module is a 3.3 V part: powering it from 5 V destroys it.**

## Getting started

```sh
npm install
npm run dev      # http://localhost:5173
```

Then use "Choose a serial port…" and pick your USB bridge — or "Simulated demo"
to explore without hardware.

### Scripts

| Command            | Purpose                                       |
| ------------------ | --------------------------------------------- |
| `npm run dev`      | development server                            |
| `npm run build`    | typecheck, then production build into `dist/` |
| `npm run preview`  | serve the production build                    |
| `npm test`         | test suite (Vitest)                           |
| `npm run coverage` | coverage for the protocol and core layers     |
| `npm run lint`     | ESLint                                        |
| `npm run format`   | Prettier                                      |

## Layout

```
src/
  core/         bytes, transport, Web Serial, measurement buffer
  devices/
    registry.ts device catalogue
    ld2420/     constants, frames, config, driver, simulator
  hooks/        session, live snapshots
  ui/           Mantine components and visx charts
doc/            protocol, wiring, architecture
```

Built with [Vite](https://vite.dev), [React](https://react.dev),
[Mantine](https://mantine.dev) for the components and
[visx](https://airbnb.io/visx) for the charts. Nothing below the UI depends on
either, which is what keeps the protocol layer testable in plain Node.

The details, and how to add a device, are in
[`doc/architecture.md`](doc/architecture.md).

## About the protocol

The LD2420's serial protocol is not published by the manufacturer. This project
builds on the reverse engineering done by **Damian Michna**, redistributed as
[`doc/hlk-ld2420-serial-protocol.md`](doc/hlk-ld2420-serial-protocol.md) under
CC BY-SA 4.0.

The points that document leaves open — the report frame layout, the multiplexing
of four encodings, batch limits — are written up in
[`doc/protocol-notes.md`](doc/protocol-notes.md).

Firmware update (`0x72`–`0x74`) is **not** exposed: entering upgrade mode
without carrying the transfer through leaves the module unusable, with no known
way out.

## Licence

MIT — see [`LICENSE`](LICENSE).

Exception: `doc/hlk-ld2420-serial-protocol.md` is redistributed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), © Damian Michna.

## Acknowledgements

- [Damian Michna](https://github.com/damianmichna/hi-link) — serial protocol
  documentation.
- ESPHome's [`ld2420` component](https://github.com/esphome/esphome/tree/dev/esphome/components/ld2420)
  — report frame layout and debug-mode constants.
