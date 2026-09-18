# LD2420 — protocol addenda

This file collects what implementing `uart-lab` had to establish beyond
[`hlk-ld2420-serial-protocol.md`](./hlk-ld2420-serial-protocol.md), which leaves
several sections marked "pending completion". Each point states where the
information comes from.

## Report ("monitor") mode frame, `set_mode` = `0x04`

The upstream document does not describe this frame. The layout below is the one
implemented by the ESPHome `ld2420` component, checked against the simulator and
used by `decodeEnergyReport()` in `src/devices/ld2420/frames.ts`.

| Bytes | Field                                | Type          |
| ----- | ------------------------------------ | ------------- |
| 0–3   | Header `F4 F3 F2 F1`                 | —             |
| 4–5   | Data length                          | `u16` LE      |
| 6     | Presence (`00` / `01`)               | `u8`          |
| 7–8   | Target distance, in **centimetres**  | `u16` LE      |
| 9–40  | Energy of the 16 gates, gate 0 first | 16 × `u16` LE |
| 41–44 | Footer `F8 F7 F6 F5`                 | —             |

Total length: **45 bytes**, fixed. Because the length is constant, the decoder
relies on it and uses the footer only as a check — searching for the footer
would risk matching an `F8 F7 F6 F5` sequence that occurred by chance inside the
gate energies.

## Debug mode frame, `set_mode` = `0x00`

Header `AA BF 10 14`, footer `FD FC FB FA` (source: ESPHome's constants). The
contents are not decoded by this project: the frames are recognised and consumed
so the stream stays in sync, nothing more.

Note that the debug footer is identical to the header of a command frame. That
is why the frame reader looks for the first delimiter of any flavour rather than
trusting the mode it believes is active.

## Four encodings on one wire

The module multiplexes four formats with no explicit transition:

1. command replies, delimited by a length field;
2. report frames, fixed length;
3. debug frames, delimited by a footer;
4. ASCII lines (`Range 220\r\n`, `ON\r\n`, `OFF\r\n`, `baudrate:5\r\n`).

While a mode change is in flight, frames of two formats cross on the wire. Hence
the design of `Ld2420FrameReader`: find the first recognised delimiter and drop
whatever precedes it, rather than decoding according to the mode we think is
active.

## Request/response correlation

The protocol carries no request identifier. The only available correlation is
the command byte in the reply. `Ld2420Driver` therefore serialises commands: one
in flight at a time, matched to the first response carrying the same command
byte, with a 1.5 s timeout.

## The 64-byte limit — which side?

The document states that "the total frame length must not exceed 64 bytes"
without saying whether the limit applies to transmission, reception or both.
This project applies it to both, which gives:

- parameter reads (`0x08`): **12 addresses** per frame
  (response = 14 bytes of envelope + 4 per value);
- parameter writes (`0x07`): **8 pairs** per frame
  (request = 12 bytes of envelope + 6 per pair).

A full configuration read (3 scalars + 32 thresholds) therefore fits in three
exchanges.

## Firmware upgrade (`0x70`-`0x75`)

Implemented in `Ld2420Driver.uploadFirmware`. The sequence is:

1. `0x71` `get_upgrade_partition` — which partition a transfer targets. A value
   outside {1, 2} aborts before anything irreversible happens.
2. `0x74` `set_upgrade_mode` — no reply. **Point of no return.** From here the
   module answers almost nothing else, and the upstream document records no way
   back out except completing a transfer.
3. `0x72` `init_firmware_upgrade` — partition, image length and whole-image
   checksum. This erases the partition, so the reply can take seconds; the
   driver allows 20 s. A data status of 1, 2 or 4 is an error; any other value
   is the module's receive buffer size.
4. `0x73` `send_firmware_block` — 128 bytes at a time, each with its own
   checksum. Data status `0x00` means written, `0x80` means programming
   finished, anything else is a bit set of the documented errors.
5. `0x68` `reboot`.

Three things the document does not settle, and what this project does about
them:

- **Block counter base.** The prose says the first block is 0; the worked
  example shows 1. The driver starts at 0 and, if the module rejects the
  sequence number on the _first_ block only, switches to 1-based and retries
  rather than failing the transfer. The simulator can reproduce either
  convention (`firmwareCounterBase`), and both are covered by tests.
- **The 64-byte frame ceiling does not apply here.** A block frame is 148 bytes
  end to end, so `encodeCommand` takes an explicit higher limit for `0x73`
  instead of the limit being relaxed everywhere.
- **Alignment.** Block status `0x20` rejects data that is not 4-byte aligned, so
  an image whose length is not a multiple of 4 is refused locally, before
  upgrade mode is entered. Padding it silently would change what gets flashed.

The interface asks for an explicit acknowledgement and a confirmation before
step 2, and states plainly that an interrupted transfer leaves the module
waiting for another attempt rather than working.

## Commands deliberately not exposed

- `0x01` / `0x02` (raw registers) — the meaning of the 256 registers is not
  established; exposing them would amount to offering to write at random.
- `0x26` `set_baudrate` — implemented in the driver
  (`Ld2420Driver.setBaudRate`) but not surfaced in the UI: if it goes wrong the
  module answers at a different rate from the USB bridge, and the right one has
  to be found by trial and error.

## Thresholds: linear vs dB

The wire carries linear values in 32 bits (useful range 0–65535). The Hi-Link
tool displays dB. The conversion is `dB = 10·log10(linear)`. The charts and the
configuration table show both.

## Gate distance

Each gate covers roughly **0.70 m**. The distance reported by report mode is in
centimetres, independently of the gates.
