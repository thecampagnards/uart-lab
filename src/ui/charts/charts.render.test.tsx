/**
 * Geometry smoke tests for the charts.
 *
 * No browser is involved: the components are server-rendered and the resulting
 * SVG is checked for the failures that are invisible in code review — NaN
 * coordinates from a degenerate domain, marks drawn outside the plot box, and a
 * crash on an empty or partial series.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TOTAL_GATES } from '../../devices/ld2420/constants'
import { factoryConfig } from '../../devices/ld2420/config'
import type { Measurement } from '../../devices/ld2420/driver'
import { DistanceTimeline } from './DistanceTimeline'
import { EnergyWaterfall } from './EnergyWaterfall'
import { GateEnergyChart } from './GateEnergyChart'

const config = factoryConfig()

const measurement = (t: number, distanceCm: number, presence = true): Measurement => ({
  t,
  presence,
  distanceCm,
  energy: Array.from({ length: TOTAL_GATES }, (_, gate) => Math.max(0, 40000 >> gate)),
})

function numbersIn(markup: string): number[] {
  return [...markup.matchAll(/(?:x|y|x1|x2|y1|y2|cx|cy|r|width|height)="(-?[\d.]+)"/g)].map((m) =>
    Number(m[1]),
  )
}

describe('GateEnergyChart', () => {
  const markup = renderToStaticMarkup(
    <GateEnergyChart
      energy={Array.from({ length: TOTAL_GATES }, (_, g) => 60000 >> g)}
      moveThresholds={config.moveThresholds}
      stillThresholds={config.stillThresholds}
      minGate={config.minGate}
      maxGate={config.maxGate}
    />,
  )

  it('draws one bar and two threshold ticks per gate', () => {
    expect([...markup.matchAll(/fill="var\(--series-1\)"/g)]).toHaveLength(TOTAL_GATES)
    expect([...markup.matchAll(/stroke="var\(--series-2\)"/g)]).toHaveLength(TOTAL_GATES)
    expect([...markup.matchAll(/stroke="var\(--series-3\)"/g)]).toHaveLength(TOTAL_GATES)
  })

  it('emits no NaN or negative geometry', () => {
    expect(markup).not.toMatch(/NaN|Infinity/)
    for (const value of numbersIn(markup)) expect(Number.isFinite(value)).toBe(true)
    expect(markup).not.toMatch(/height="-/)
  })

  it('carries a legend and an accessible description', () => {
    expect(markup).toContain('Motion threshold')
    expect(markup).toContain('role="img"')
    expect(markup).toContain('aria-label')
  })

  it('survives an all-zero reading', () => {
    const zeroed = renderToStaticMarkup(
      <GateEnergyChart
        energy={new Array<number>(TOTAL_GATES).fill(0)}
        moveThresholds={new Array<number>(TOTAL_GATES).fill(0)}
        stillThresholds={new Array<number>(TOTAL_GATES).fill(0)}
        minGate={0}
        maxGate={15}
      />,
    )
    expect(zeroed).not.toMatch(/NaN/)
  })
})

describe('DistanceTimeline', () => {
  const samples = Array.from({ length: 600 }, (_, i) =>
    measurement(i * 100, 100 + Math.round(200 * Math.abs(Math.sin(i / 40))), i % 137 !== 0),
  )

  it('renders a single path for the series', () => {
    const markup = renderToStaticMarkup(<DistanceTimeline samples={samples} windowMs={60_000} />)
    expect(markup).not.toMatch(/NaN|Infinity/)
    expect([...markup.matchAll(/stroke="var\(--series-1\)"/g)]).toHaveLength(1)
    // Absence runs are drawn as recessive bands, not as a second colour series.
    expect(markup).toContain('fill="var(--gridline)"')
  })

  it('labels the endpoint rather than every point', () => {
    const markup = renderToStaticMarkup(<DistanceTimeline samples={samples} windowMs={60_000} />)
    expect([...markup.matchAll(/chart__direct-label/g)]).toHaveLength(1)
  })

  it('shows a waiting state instead of crashing on an empty series', () => {
    const markup = renderToStaticMarkup(<DistanceTimeline samples={[]} windowMs={60_000} />)
    expect(markup).toContain('Waiting for data')
    expect(markup).not.toMatch(/NaN/)
  })

  it('does not divide by zero on a single sample', () => {
    const markup = renderToStaticMarkup(
      <DistanceTimeline samples={[measurement(0, 150)]} windowMs={60_000} />,
    )
    expect(markup).not.toMatch(/NaN|Infinity/)
  })
})

describe('EnergyWaterfall', () => {
  it('renders a canvas with a scale legend', () => {
    const samples = Array.from({ length: 300 }, (_, i) => measurement(i * 100, 200))
    const markup = renderToStaticMarkup(
      <EnergyWaterfall samples={samples} minGate={0} maxGate={12} />,
    )
    expect(markup).toContain('<canvas')
    expect(markup).toContain('scale-legend__ramp')
    expect(markup).toContain('aria-label')
  })

  it('tolerates simple-mode samples that carry no gate energy', () => {
    const samples = [{ t: 0, presence: true, distanceCm: 120, energy: [] }]
    const markup = renderToStaticMarkup(
      <EnergyWaterfall samples={samples} minGate={0} maxGate={12} />,
    )
    expect(markup).toContain('<canvas')
  })
})
