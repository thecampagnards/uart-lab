# Wiring — FT232RL UART bridge to HLK-LD2420

## Logic level warning

The LD2420 is a **3.3 V** module, for both supply and signals. Many FT232RL
boards ship configured for 5 V.

1. Set the board's `VCC` / `VCCIO` jumper to **3V3** before wiring anything.
2. Measure the voltage between `VCC` and `GND` with a multimeter **before**
   connecting the module.

Powering the module from 5 V destroys it.

## Pinout

The LD2420's `J2` connector carries the application UART. Note that `OT1` is the
module's serial output, not merely a presence pin.

| LD2420 (J2) | FT232RL              | Note                            |
| ----------- | -------------------- | ------------------------------- |
| `3V3`       | `VCC` (set to 3.3 V) | supply                          |
| `GND`       | `GND`                | common ground, required         |
| `RX`        | `TXD`                | the browser writes here         |
| `OT1`       | `RXD`                | the module transmits here       |
| `OT2`       | —                    | optional on/off presence output |

On firmware older than 1.5.8, `OT1` and `OT2` are logically inverted.

## Serial settings

- 8 data bits, no parity, 1 stop bit (8N1)
- no flow control
- **115200 baud** on firmware ≥ 1.5.8
- **256000 baud** on firmware < 1.5.8

If identification fails at 115200, try 256000 before suspecting the wiring.

## Checking from the operating system

On Linux the board shows up as `/dev/ttyUSB0` and the `ftdi_sio` module loads
automatically:

```sh
dmesg | tail -5
ls -l /dev/ttyUSB*
```

If the browser is refused access to the port, your user needs to be in the
group that owns it (often `dialout` on Debian/Ubuntu):

```sh
sudo usermod -aG dialout "$USER"   # then log out and back in
```

Also check that `brltty` has not claimed the port — that daemon grabs certain
FTDI bridges and makes them disappear a few seconds after they are plugged in.

## Testing without the browser

To rule out a wiring problem before opening `uart-lab`:

```sh
# The module boots in simple mode: it streams text continuously.
stty -F /dev/ttyUSB0 115200 raw -echo && cat /dev/ttyUSB0
```

You should see `OFF` or `Range 214` / `ON` scrolling past. If nothing arrives,
`OT1` → `RXD` or the ground connection is the thing to revisit; if illegible
bytes scroll past, it is the baud rate.

## Browsers

The Web Serial API exists only in Chromium-based browsers (Chrome, Edge, Opera)
on desktop, and only over HTTPS or on `http://localhost`. Firefox and Safari do
not implement it; `uart-lab`'s simulated demo works there, a real connection
does not.
