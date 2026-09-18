# Architecture

## Layers

```
  React UI ───────────────────────────────────────────────┐
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

## Adding a device

1. Create `src/devices/<id>/` with, at minimum, a frame codec, a driver and
   ideally a simulator.
2. Add an entry to `src/devices/registry.ts`.
3. Wire a configuration panel into `src/App.tsx`.

Nothing in the shell (header, sidebar, tabs, theme) depends on the LD2420; only
the panels do.

## Visualisation choices

- **Energy per gate** — bars on a dB axis. On a linear axis the gap between
  near-field clutter (~60,000) and the far gates (~200) flattens everything past
  the third gate. Thresholds are drawn as thin ticks bounding the bar rather
  than as a second set of bars: they are limits, not a second magnitude.
- **Distance over time** — a single series, so no legend; only the endpoint is
  labelled. Absence is a grey band, not a series colour: it is a state, not a
  measurement.
- **Energy history** — a heatmap on a single-hue ramp (blue, light → dark),
  drawn on canvas; 16 gates × 240 columns in SVG would cost 3,840 nodes per
  frame.

Every chart has a table equivalent, and no information is carried by colour
alone.
