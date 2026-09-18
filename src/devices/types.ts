/** Structural stand-in for `SerialPortFilter`, so the registry stays DOM-free. */
export interface SerialPortFilterLike {
  usbVendorId?: number
  usbProductId?: number
}

/**
 * What a device entry offers. The shell derives its tabs from this, so a device
 * that can only be flashed does not present a configuration form it cannot fill.
 */
export type DeviceCapability = 'monitor' | 'configure' | 'firmware' | 'flash' | 'trace'
