import { useRef, useState } from 'react'
import { GATE_SIZE_M, TOTAL_GATES } from '../../devices/ld2420/constants'
import {
  cloneConfig,
  parseConfigFile,
  toConfigFile,
  validateConfig,
  type Ld2420Config,
} from '../../devices/ld2420/config'
import { linearToDb } from '../../devices/ld2420/frames'
import type { SessionState } from '../../hooks/useLd2420Session'
import { Badge, Card } from './primitives'

export interface ConfigPanelProps {
  state: SessionState
  onChange: (update: (draft: Ld2420Config) => Ld2420Config) => void
  onApply: () => void
  onRevert: () => void
  onReload: () => void
  onFactoryReset: () => void
  onReboot: () => void
  onError: (message: string) => void
}

export function ConfigPanel({
  state,
  onChange,
  onApply,
  onRevert,
  onReload,
  onFactoryReset,
  onReboot,
  onError,
}: ConfigPanelProps) {
  const draft = state.draftConfig
  const fileInput = useRef<HTMLInputElement | null>(null)
  const [confirmingReset, setConfirmingReset] = useState(false)
  const problems = validateConfig(draft)
  const problemFields = new Set(problems.map((problem) => problem.field))
  const locked = state.pendingOperation !== null || state.deviceConfig === null

  const setField = <K extends keyof Ld2420Config>(key: K, value: Ld2420Config[K]): void => {
    onChange((current) => ({ ...cloneConfig(current), [key]: value }))
  }

  const setThreshold = (
    kind: 'moveThresholds' | 'stillThresholds',
    gate: number,
    value: number,
  ): void => {
    onChange((current) => {
      const next = cloneConfig(current)
      next[kind][gate] = value
      return next
    })
  }

  const handleExport = (): void => {
    const file = toConfigFile(draft, {
      ...(state.identity.firmware !== undefined ? { firmware: state.identity.firmware } : {}),
      ...(state.identity.serial !== undefined ? { serial: state.identity.serial } : {}),
    })
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `ld2420-config-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = async (file: File): Promise<void> => {
    try {
      const config = parseConfigFile(await file.text())
      onChange(() => config)
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <>
      <Card
        title="General parameters"
        subtitle="Changes stay local until you press “Write to module”."
        actions={
          <>
            {state.dirty ? <Badge tone="warning">Unwritten changes</Badge> : null}
            <button type="button" className="button" disabled={locked} onClick={onReload}>
              Re-read from module
            </button>
            <button
              type="button"
              className="button"
              disabled={locked || !state.dirty}
              onClick={onRevert}
            >
              Discard
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={locked || !state.dirty || problems.length > 0}
              onClick={onApply}
            >
              Write to module
            </button>
          </>
        }
      >
        {state.pendingOperation ? (
          <p className="notice notice--info" style={{ marginBottom: 12 }} role="status">
            {state.pendingOperation}…
          </p>
        ) : null}
        {problems.length > 0 ? (
          <p className="notice notice--error" style={{ marginBottom: 12 }} role="alert">
            {problems.map((problem) => problem.message).join(' ')}
          </p>
        ) : null}

        <div className="field-row">
          <label className="field">
            Minimum gate
            <input
              type="number"
              min={0}
              max={TOTAL_GATES - 1}
              step={1}
              value={draft.minGate}
              disabled={locked}
              aria-invalid={problemFields.has('minGate')}
              onChange={(event) => setField('minGate', toInt(event.target.value))}
            />
          </label>
          <label className="field">
            Maximum gate
            <input
              type="number"
              min={0}
              max={TOTAL_GATES - 1}
              step={1}
              value={draft.maxGate}
              disabled={locked}
              aria-invalid={problemFields.has('maxGate')}
              onChange={(event) => setField('maxGate', toInt(event.target.value))}
            />
          </label>
          <label className="field">
            Absence delay (s)
            <input
              type="number"
              min={0}
              max={65535}
              step={1}
              value={draft.timeoutS}
              disabled={locked}
              aria-invalid={problemFields.has('timeoutS')}
              onChange={(event) => setField('timeoutS', toInt(event.target.value))}
            />
          </label>
          <p className="stat__hint" style={{ maxWidth: 320 }}>
            Monitored range:{' '}
            <strong>
              {(draft.minGate * GATE_SIZE_M).toFixed(1)} –{' '}
              {((draft.maxGate + 1) * GATE_SIZE_M).toFixed(1)} m
            </strong>
            . The delay holds the “present” state for that many seconds after the last detection.
          </p>
        </div>
      </Card>

      <Card
        title="Per-gate thresholds"
        subtitle="Motion threshold: fires the detection. Still threshold: holds detection on a stationary target. Raw values are 0–65535; the dB column matches the scale used by the Hi-Link tool."
        actions={
          <>
            <button type="button" className="button" onClick={handleExport}>
              Export as JSON
            </button>
            <button
              type="button"
              className="button"
              disabled={locked}
              onClick={() => fileInput.current?.click()}
            >
              Import…
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="visually-hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void handleImport(file)
                event.target.value = ''
              }}
            />
          </>
        }
      >
        <div className="table-wrap">
          <table className="data">
            <caption className="visually-hidden">Detection thresholds per distance gate</caption>
            <thead>
              <tr>
                <th scope="col">Gate</th>
                <th scope="col">Distance</th>
                <th scope="col">Motion threshold</th>
                <th scope="col">dB</th>
                <th scope="col">Still threshold</th>
                <th scope="col">dB</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: TOTAL_GATES }, (_, gate) => {
                const inRange = gate >= draft.minGate && gate <= draft.maxGate
                const move = draft.moveThresholds[gate] ?? 0
                const still = draft.stillThresholds[gate] ?? 0
                return (
                  <tr key={gate} className={inRange ? undefined : 'row-out-of-range'}>
                    <th scope="row">{gate}</th>
                    <td>
                      {(gate * GATE_SIZE_M).toFixed(1)}–{((gate + 1) * GATE_SIZE_M).toFixed(1)} m
                    </td>
                    <td className="numeric-input">
                      <input
                        type="number"
                        min={0}
                        max={65535}
                        step={1}
                        value={move}
                        disabled={locked}
                        aria-label={`Motion threshold, gate ${gate}`}
                        aria-invalid={problemFields.has(`moveThresholds.${gate}`)}
                        onChange={(event) =>
                          setThreshold('moveThresholds', gate, toInt(event.target.value))
                        }
                      />
                    </td>
                    <td>{linearToDb(move).toFixed(1)}</td>
                    <td className="numeric-input">
                      <input
                        type="number"
                        min={0}
                        max={65535}
                        step={1}
                        value={still}
                        disabled={locked}
                        aria-label={`Still threshold, gate ${gate}`}
                        aria-invalid={problemFields.has(`stillThresholds.${gate}`)}
                        onChange={(event) =>
                          setThreshold('stillThresholds', gate, toInt(event.target.value))
                        }
                      />
                    </td>
                    <td>{linearToDb(still).toFixed(1)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Module actions" subtitle="These act on the device immediately.">
        <div className="button-row">
          <button type="button" className="button" disabled={locked} onClick={onReboot}>
            Restart module
          </button>
          {confirmingReset ? (
            <>
              <span className="stat__hint">Replace every threshold with the factory values?</span>
              <button
                type="button"
                className="button button--danger"
                disabled={locked}
                onClick={() => {
                  setConfirmingReset(false)
                  onFactoryReset()
                }}
              >
                Confirm
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setConfirmingReset(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="button button--danger"
              disabled={locked}
              onClick={() => setConfirmingReset(true)}
            >
              Factory defaults…
            </button>
          )}
        </div>
        <p className="stat__hint" style={{ marginTop: 10 }}>
          Baud rate changes and firmware updates are not exposed: the upgrade command{' '}
          <code className="mono">0x74</code> leaves the module unusable if the transfer does not
          complete.
        </p>
      </Card>
    </>
  )
}

/** Keeps an emptied field from becoming NaN and poisoning the draft. */
function toInt(value: string): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? 0 : parsed
}
