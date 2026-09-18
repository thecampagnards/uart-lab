import { useState } from 'react'
import { isWebSerialSupported } from '../../core/transport'
import { OPERATING_MODE_LABELS } from '../../devices/ld2420/constants'
import type { DeviceDescriptor } from '../../devices/registry'
import type { SessionState } from '../../hooks/useLd2420Session'
import { Badge, Card } from './primitives'

export function ConnectionPanel({
  device,
  state,
  onConnectSerial,
  onConnectSimulator,
  onDisconnect,
}: {
  device: DeviceDescriptor
  state: SessionState
  onConnectSerial: (baudRate: number) => void
  onConnectSimulator: () => void
  onDisconnect: () => void
}) {
  const [baudRate, setBaudRate] = useState(device.defaultBaudRate)
  const supported = isWebSerialSupported()
  const connected = state.status === 'connected' || state.status === 'busy'

  return (
    <Card
      title="Connection"
      subtitle="The browser opens the serial port through the Web Serial API. No data leaves your machine."
      actions={
        <Badge tone={connected ? 'good' : state.status === 'connecting' ? 'warning' : 'neutral'}>
          {connected
            ? state.transportKind === 'simulated'
              ? 'Simulated demo'
              : 'Connected'
            : state.status === 'connecting'
              ? 'Connecting…'
              : 'Disconnected'}
        </Badge>
      }
    >
      {!supported ? (
        <p className="notice notice--warning" style={{ marginBottom: 12 }}>
          This browser does not expose the Web Serial API. Use Chrome, Edge or Opera on desktop — or
          start the simulated demo below to explore the interface.
        </p>
      ) : null}

      <div className="field-row">
        <label className="field">
          Baud rate
          <select
            value={baudRate}
            disabled={connected}
            onChange={(event) => setBaudRate(Number(event.target.value))}
          >
            {device.supportedBaudRates.map((rate) => (
              <option key={rate} value={rate}>
                {rate.toLocaleString('en-US')} baud
                {rate === 115200
                  ? ' (default on fw ≥ 1.5.8)'
                  : rate === 256000
                    ? ' (default on fw < 1.5.8)'
                    : ''}
              </option>
            ))}
          </select>
        </label>

        {connected ? (
          <button type="button" className="button" onClick={onDisconnect}>
            Disconnect
          </button>
        ) : (
          <>
            <button
              type="button"
              className="button button--primary"
              disabled={!supported || state.status === 'connecting'}
              onClick={() => onConnectSerial(baudRate)}
            >
              Choose a serial port…
            </button>
            <button
              type="button"
              className="button"
              disabled={state.status === 'connecting'}
              onClick={onConnectSimulator}
            >
              Simulated demo
            </button>
          </>
        )}
      </div>

      {connected ? (
        <dl className="dl" style={{ marginTop: 14 }}>
          <dt>Port</dt>
          <dd>{state.portLabel ?? '—'}</dd>
          <dt>Baud rate</dt>
          <dd>{state.baudRate.toLocaleString('en-US')} baud · 8N1</dd>
          <dt>Firmware</dt>
          <dd>{state.identity.firmware ?? 'unknown'}</dd>
          <dt>Serial number</dt>
          <dd className="mono">{state.identity.serial ?? '—'}</dd>
          <dt>Mode</dt>
          <dd>{OPERATING_MODE_LABELS[state.mode]}</dd>
        </dl>
      ) : (
        <p className="stat__hint" style={{ marginTop: 12 }}>
          FT232RL wiring: <code className="mono">TX→RX</code>, <code className="mono">RX→OT1</code>,{' '}
          <code className="mono">GND→GND</code>, <code className="mono">3V3→3V3</code>. The module
          is a 3.3 V part — powering it from 5 V destroys it.
        </p>
      )}
    </Card>
  )
}
