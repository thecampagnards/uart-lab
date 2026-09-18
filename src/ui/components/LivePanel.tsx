import { useState } from 'react'
import type { MeasurementHistory } from '../../core/history'
import { GATE_SIZE_M, OperatingMode, TOTAL_GATES } from '../../devices/ld2420/constants'
import { linearToDb } from '../../devices/ld2420/frames'
import type { Ld2420Config } from '../../devices/ld2420/config'
import { useLiveSnapshot } from '../../hooks/useLiveSnapshot'
import type { SessionState } from '../../hooks/useLd2420Session'
import { DistanceTimeline } from '../charts/DistanceTimeline'
import { EnergyWaterfall } from '../charts/EnergyWaterfall'
import { GateEnergyChart } from '../charts/GateEnergyChart'
import { formatNumber } from '../charts/scales'
import { Badge, Card, Stat } from './primitives'

const WINDOW_CHOICES = [15_000, 60_000, 180_000]

export function LivePanel({
  state,
  history,
  config,
  onSetMode,
}: {
  state: SessionState
  history: MeasurementHistory
  config: Ld2420Config
  onSetMode: (mode: typeof OperatingMode.Report | typeof OperatingMode.Simple) => void
}) {
  const [windowMs, setWindowMs] = useState(60_000)
  const live = state.status === 'connected' || state.status === 'busy'
  const snapshot = useLiveSnapshot(history, windowMs, live, 10)
  const latest = snapshot.latest
  const energy = latest?.energy.length === TOTAL_GATES ? latest.energy : null
  const reportMode = state.mode === OperatingMode.Report

  return (
    <>
      {/* One filter row above everything it scopes, per the chart conventions. */}
      <div className="button-row" style={{ justifyContent: 'space-between' }}>
        <div className="button-row">
          <span className="stat__label">Window</span>
          {WINDOW_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              className={windowMs === choice ? 'button button--primary' : 'button'}
              onClick={() => setWindowMs(choice)}
            >
              {choice / 1000} s
            </button>
          ))}
        </div>
        <div className="button-row">
          <span className="stat__label">Mode</span>
          <button
            type="button"
            className={reportMode ? 'button button--primary' : 'button'}
            disabled={!live || state.pendingOperation !== null}
            onClick={() => onSetMode(OperatingMode.Report)}
          >
            Report (energy)
          </button>
          <button
            type="button"
            className={!reportMode ? 'button button--primary' : 'button'}
            disabled={!live || state.pendingOperation !== null}
            onClick={() => onSetMode(OperatingMode.Simple)}
          >
            Simple (ASCII)
          </button>
        </div>
      </div>

      <div className="stat-grid">
        <Stat
          label="Presence"
          value={
            latest ? (
              <Badge tone={latest.presence ? 'good' : 'neutral'}>
                {latest.presence ? 'Detected' : 'None'}
              </Badge>
            ) : (
              '—'
            )
          }
          hint={`Absence delay: ${config.timeoutS} s`}
        />
        <Stat
          label="Distance"
          value={latest && latest.presence ? (latest.distanceCm / 100).toFixed(2) : '—'}
          unit={latest && latest.presence ? 'm' : undefined}
          hint={
            latest && latest.presence
              ? `gate ${Math.min(TOTAL_GATES - 1, Math.floor(latest.distanceCm / 100 / GATE_SIZE_M))}`
              : 'no target'
          }
        />
        <Stat
          label="Frame rate"
          value={snapshot.rateHz > 0 ? snapshot.rateHz.toFixed(1) : '—'}
          unit={snapshot.rateHz > 0 ? 'Hz' : undefined}
          hint={`${formatNumber(snapshot.totalSamples)} frames received`}
        />
        <Stat
          label="Active gates"
          value={`${config.minGate}–${config.maxGate}`}
          hint={`${(config.minGate * GATE_SIZE_M).toFixed(1)} – ${((config.maxGate + 1) * GATE_SIZE_M).toFixed(1)} m`}
        />
      </div>

      <Card
        title="Energy per gate"
        subtitle="Each bar is one 0.7 m gate. The ticks mark the configured thresholds: above a threshold, the gate fires."
      >
        {energy ? (
          <GateEnergyChart
            energy={energy}
            moveThresholds={config.moveThresholds}
            stillThresholds={config.stillThresholds}
            minGate={config.minGate}
            maxGate={config.maxGate}
          />
        ) : (
          <p className="stat__hint">
            {reportMode
              ? 'Waiting for the first report frame…'
              : 'Simple mode does not carry per-gate energy. Switch to report mode to feed this chart.'}
          </p>
        )}
        {energy ? <GateTable energy={energy} config={config} /> : null}
      </Card>

      <div className="grid-2">
        <Card
          title="Distance over time"
          subtitle="Grey bands are stretches with no reported presence."
        >
          <DistanceTimeline samples={snapshot.samples} windowMs={windowMs} />
        </Card>
        <Card
          title="Energy history"
          subtitle="Time runs left to right, gates top to bottom: a target walking closer draws a diagonal."
        >
          <EnergyWaterfall
            samples={snapshot.samples}
            minGate={config.minGate}
            maxGate={config.maxGate}
          />
        </Card>
      </div>
    </>
  )
}

/** The table view every chart needs: the same numbers, without colour. */
function GateTable({ energy, config }: { energy: readonly number[]; config: Ld2420Config }) {
  const [open, setOpen] = useState(false)
  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="stat__hint" style={{ cursor: 'pointer', marginTop: 10 }}>
        Show the values as a table
      </summary>
      <div className="table-wrap" style={{ marginTop: 8 }}>
        <table className="data">
          <caption className="visually-hidden">
            Measured energy and configured thresholds, per distance gate
          </caption>
          <thead>
            <tr>
              <th scope="col">Gate</th>
              <th scope="col">Distance</th>
              <th scope="col">Energy</th>
              <th scope="col">Energy (dB)</th>
              <th scope="col">Motion threshold</th>
              <th scope="col">Still threshold</th>
              <th scope="col">State</th>
            </tr>
          </thead>
          <tbody>
            {energy.map((value, gate) => {
              const inRange = gate >= config.minGate && gate <= config.maxGate
              const move = config.moveThresholds[gate] ?? 0
              const still = config.stillThresholds[gate] ?? 0
              return (
                <tr key={gate} className={inRange ? undefined : 'row-out-of-range'}>
                  <th scope="row">{gate}</th>
                  <td>
                    {(gate * GATE_SIZE_M).toFixed(1)}–{((gate + 1) * GATE_SIZE_M).toFixed(1)} m
                  </td>
                  <td>{formatNumber(value)}</td>
                  <td>{linearToDb(value).toFixed(1)}</td>
                  <td>{formatNumber(move)}</td>
                  <td>{formatNumber(still)}</td>
                  <td>
                    {!inRange
                      ? 'out of range'
                      : value > move
                        ? 'motion'
                        : value > still
                          ? 'still'
                          : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </details>
  )
}
