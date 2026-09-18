import { useMemo, useState } from 'react'
import type { TraceEntry } from '../../devices/ld2420/driver'
import { Card } from './primitives'

const KIND_LABELS: Record<TraceEntry['kind'], string> = {
  command: 'command',
  response: 'response',
  energy: 'report',
  simple: 'ascii',
  debug: 'debug',
  unknown: 'unknown',
}

export function TracePanel({
  trace,
  onClear,
}: {
  trace: readonly TraceEntry[]
  onClear: () => void
}) {
  const [hideStream, setHideStream] = useState(true)

  const visible = useMemo(
    () => (hideStream ? trace.filter((e) => e.kind === 'command' || e.kind === 'response') : trace),
    [hideStream, trace],
  )

  return (
    <Card
      title="Serial trace"
      subtitle="Every frame exchanged, in hex. Useful for cross-checking against the protocol document."
      actions={
        <>
          <label className="toggle">
            <input
              type="checkbox"
              checked={hideStream}
              onChange={(event) => setHideStream(event.target.checked)}
            />
            Hide measurement stream
          </label>
          <button type="button" className="button" onClick={onClear}>
            Clear
          </button>
        </>
      }
    >
      {visible.length === 0 ? (
        <p className="stat__hint">No frames yet.</p>
      ) : (
        <div className="trace">
          {visible.slice(-250).map((entry, index) => (
            <div className="trace__line" key={`${entry.t}-${index}`}>
              <span className="trace__t">{(entry.t / 1000).toFixed(3)}</span>
              <span className={`trace__dir--${entry.direction}`}>
                {entry.direction === 'tx' ? '→' : '←'}
              </span>
              <span>
                {entry.hex}
                <span className="trace__note">
                  {'  '}
                  {KIND_LABELS[entry.kind]}
                  {entry.note ? ` · ${entry.note}` : ''}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
