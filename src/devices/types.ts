/** Structural stand-in for `SerialPortFilter`, so the registry stays DOM-free. */
export interface SerialPortFilterLike {
  usbVendorId?: number
  usbProductId?: number
}

/**
 * What a device entry offers. The shell derives its tabs from this, so a device
 * that can only be flashed does not present a configuration form it cannot fill.
 */
export type DeviceCapability =
  /** Decoded live view: charts, presence, distance. Needs a driver. */
  | 'monitor'
  /** Read and write the device's parameters. Needs a driver. */
  | 'configure'
  /** Guided threshold setting from measurements. Needs monitoring and configuring. */
  | 'calibrate'
  /** Firmware transfer with the device's own descriptor. */
  | 'firmware'
  /** Firmware transfer with a descriptor the user supplies. */
  | 'flash'
  /** Raw serial monitor: the wire with no framing assumed. Needs no driver. */
  | 'terminal'
  /** Decoded frame trace. Only meaningful where the framing is known. */
  | 'trace'
