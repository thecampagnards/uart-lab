/** Structural stand-in for `SerialPortFilter`, so the registry stays DOM-free. */
export interface SerialPortFilterLike {
  usbVendorId?: number
  usbProductId?: number
}
