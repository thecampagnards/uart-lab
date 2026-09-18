import { DEVICES, type DeviceDescriptor } from '../../devices/registry'

export function DeviceList({
  selectedId,
  onSelect,
  connectedId,
}: {
  selectedId: string
  onSelect: (id: string) => void
  connectedId: string | null
}) {
  return (
    <nav aria-label="Devices to configure">
      <p className="device-list__label">My devices</p>
      <ul className="device-list">
        {DEVICES.map((device) => (
          <li key={device.id}>
            <DeviceCard
              device={device}
              selected={device.id === selectedId}
              connected={device.id === connectedId}
              onSelect={onSelect}
            />
          </li>
        ))}
      </ul>
      <p className="stat__hint" style={{ marginTop: 12 }}>
        Only one device is supported for now. The catalogue lives in{' '}
        <code className="mono">src/devices/registry.ts</code>.
      </p>
    </nav>
  )
}

function DeviceCard({
  device,
  selected,
  connected,
  onSelect,
}: {
  device: DeviceDescriptor
  selected: boolean
  connected: boolean
  onSelect: (id: string) => void
}) {
  return (
    <button
      type="button"
      className="device-card"
      aria-current={selected}
      disabled={!device.implemented}
      onClick={() => onSelect(device.id)}
    >
      <div className="device-card__name">
        {device.name}
        {connected ? (
          <span className="badge badge--good" style={{ marginLeft: 8, fontSize: 10 }}>
            <span className="badge__dot" aria-hidden="true" />
            connected
          </span>
        ) : null}
      </div>
      <div className="device-card__vendor">{device.vendor}</div>
      <p className="device-card__summary">{device.summary}</p>
    </button>
  )
}
