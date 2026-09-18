# Architecture

## Layers

```
  React UI (Mantine components, visx charts) ─────────────┐
    src/App.tsx, src/ui/**                                │
      ▲ session state, measurement snapshots              │
      │                                                   │
  Hooks ──────────────────────────────────────────────────┤
    src/hooks/useLd2420Session.ts   the whole session     │
    src/hooks/useLiveSnapshot.ts    10 Hz sampling        │
      ▲                                                   │
      │                                                   │
  Driver ─────────────────────────────────────────────────┤  nothing
    src/devices/ld2420/driver.ts                          │  below the
      queueing, correlation, modes, trace                 │  UI touches
      ▲                                                   │  the DOM
      │                                                   │
  Protocol (pure) ────────────────────────────────────────┤
    src/devices/ld2420/frames.ts    encode/decode         │
    src/devices/ld2420/config.ts    config model          │
    src/devices/ld2420/constants.ts                       │
      ▲                                                   │
      │                                                   │
  Transport ──────────────────────────────────────────────┘
    src/core/transport.ts    the interface
    src/core/webserial.ts    Web Serial (real hardware)
    src/devices/ld2420/simulator.ts   simulated module
```

The rule that shapes everything: **nothing below the UI knows about the DOM**.
The protocol layer is pure functions; the driver only knows the `Transport`
interface. That is what makes the whole stack testable in Node, with neither a
browser nor hardware.

## Why a simulator

`Ld2420Simulator` implements `Transport` and speaks the same protocol as the
real module. It serves three purposes:

1. the demo published on GitHub Pages is usable without hardware;
2. the driver's integration tests (`driver.test.ts`) exercise reads, writes,
   mode changes and restarts end to end;
3. the UI can be developed away from the bench.

Its clock is injectable (`tick(dtMs)`), so tests are deterministic rather than
dependent on a `setInterval`.

## The measurement stream does not go through React state

In report mode the module emits 10–20 frames per second. Storing those in a
`useState` would trigger as many renders. Instead:

- `MeasurementHistory` is a mutable ring buffer that lives outside React;
- `useLiveSnapshot` takes a snapshot on `requestAnimationFrame`, at 10 Hz.

The UI pulls data at display rate instead of being pushed at sensor rate.

## Firmware transfer is device-independent

`src/core/firmware.ts` holds the transfer itself; a `FirmwareProtocol`
descriptor holds what differs between modules — command bytes, block and flash
sizes, status tables, partition names. The frame envelope is shared across
Hi-Link's LD family, so the sequence only had to be written once.

Descriptors live by ownership: `LD2420_FIRMWARE` in the device's own folder,
the vendor-generic one and the catalogue in `src/devices/firmwareProfiles.ts`,
and nothing device-specific in `core/`.

Only `LD2420_FIRMWARE` is marked `verified`. The Generic flash panel makes every
field editable, command bytes included, because its whole purpose is to reach a
module this tool has never seen — a descriptor can be written by hand or pasted
in as JSON. `validateFirmwareProtocol` checks what is checkable (ranges,
collisions, arithmetic) and the interface says plainly that whether the bytes
are right is not something software can tell you.

## Devices declare what they can do

Each registry entry lists `capabilities`, and the shell turns those into tabs.
The LD2420 has `monitor`, `configure`, `firmware` and `trace`; the generic
Hi-Link entry has only `flash` and `trace`, so it never shows a configuration
form it could not fill, and connecting to it skips the configuration read and
the report-mode switch that would only produce meaningless errors.

That is also where the generic flasher lives: it is a device you select, not a
tab that sits permanently beside the supported path.

## Adding a device

1. Create `src/devices/<id>/` with, at minimum, a frame codec, a driver and
   ideally a simulator.
2. Add an entry to `src/devices/registry.ts`.
3. Wire a configuration panel into `src/App.tsx`.

Nothing in the shell (header, sidebar, tabs, theme) depends on the LD2420; only
the panels do.

## Front-end stack

- **[Mantine](https://mantine.dev)** for the component layer: app shell, tabs,
  number inputs, table, modal, alerts, and the colour-scheme manager. The
  project theme (`src/theme.ts`) maps Mantine's primary colour onto the same
  blue the charts use, so a button and a chart mark are the same hue in both
  schemes.
- **[visx](https://airbnb.io/visx)** for the charts: `@visx/scale` (d3 scales),
  `@visx/axis`, `@visx/grid`, `@visx/shape`, `@visx/heatmap`, `@visx/tooltip`
  and `@visx/responsive`. visx is headless, which is the point — the palette,
  the mark specs and the legend rules stay under the project's control instead
  of being whatever a charting library ships by default.

Mantine owns the component surfaces; `src/styles/chart-tokens.css` owns the
handful of values Mantine has no opinion about — the three categorical series
slots, the sequential ramp and the recessive chart chrome. Those tokens are
keyed off Mantine's own `data-mantine-color-scheme` attribute, so the header
toggle drives the charts too.

## Visualisation choices

- **Energy per gate** — bars on a dB axis. On a linear axis the gap between
  near-field clutter (~60,000) and the far gates (~200) flattens everything past
  the third gate. Thresholds are drawn as thin ticks bounding the bar rather
  than as a second set of bars: they are limits, not a second magnitude.
- **Distance over time** — a single series, so no legend; only the endpoint is
  labelled. Absence is a grey band, not a series colour: it is a state, not a
  measurement.
- **Energy history** — a heatmap on a single-hue ramp (blue, light → dark).
  Samples are bucketed into 60 fixed time columns (`src/ui/charts/bucketSamples.ts`)
  rather than drawn one rect per frame: it caps the node count whatever the
  sample rate, a column that means "one slice of the window" reads better than
  one that means "whatever arrived", and keeping the peak per bucket preserves
  the brief gate crossings that averaging would erase. The component only takes
  a new input twice a second, so its 960 rects stay out of the 10 Hz render path.

Every chart has a table equivalent, and no information is carried by colour
alone.
