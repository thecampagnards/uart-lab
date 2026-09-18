/**
 * @vitest-environment jsdom
 *
 * Geometry smoke tests for the charts.
 *
 * The visx primitives are trusted; what is checked here is the wiring around
 * them — that a degenerate or empty series does not produce NaN coordinates,
 * that the mark counts match the data, and that the accessibility affordances
 * the charts promise are actually emitted. jsdom rather than a string render
 * because `ParentSize` needs a layout box to hand the charts a width.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import type { ReactElement } from 'react'
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
  energy: Array.from({ length: TOTAL_GATES }, (_, gate) => Math.max(1, 40000 >> gate)),
})

/**
 * jsdom reports every element as 0×0, so the charts render at their
 * `initialSize` width — which is exactly the first-paint path worth covering.
 */
function draw(element: ReactElement): SVGSVGElement {
  const { container } = render(<MantineProvider>{element}</MantineProvider>)
  const svg = container.querySelector('svg')
  if (!svg) throw new Error('the chart rendered no SVG')
  return svg
}

/**
 * Absolute y of a text node, summing the translate of every ancestor group.
 *
 * Axis labels are placed by visx relative to nested transformed groups, so a
 * label can sit outside the SVG box while its own `y` attribute looks harmless.
 * That is how the gate axis label ended up with its descenders clipped.
 */
function absoluteY(node: SVGTextElement): number {
  let y = Number(node.getAttribute('y') ?? 0)
  let parent: Element | null = node.parentElement
  while (parent && parent.tagName.toLowerCase() !== 'svg') {
    const transform = parent.getAttribute('transform') ?? ''
    const translate = /translate\(\s*(-?[\d.]+)\s*[, ]\s*(-?[\d.]+)\s*\)/.exec(transform)
    if (translate) y += Number(translate[2])
    parent = parent.parentElement
  }
  return y
}

/** Rough descender depth below the baseline, for a label's true bottom edge. */
const DESCENDER = 3

/**
 * A rotated label is positioned in its own frame, so a plain y says nothing
 * about where it lands. visx puts the rotation on the text element itself for an
 * axis label, and on a wrapping group elsewhere, so both are checked.
 */
function isRotated(node: Element): boolean {
  let current: Element | null = node
  while (current && current.tagName.toLowerCase() !== 'svg') {
    if ((current.getAttribute('transform') ?? '').includes('rotate')) return true
    current = current.parentElement
  }
  return false
}

function labelsFitVertically(svg: SVGSVGElement): string[] {
  const height = Number(svg.getAttribute('height'))
  const offenders: string[] = []
  for (const node of svg.querySelectorAll('text')) {
    if (isRotated(node)) continue
    const top = absoluteY(node)
    if (top + DESCENDER > height || top < 0) {
      offenders.push(`"${node.textContent ?? ''}" baseline at ${top.toFixed(0)} of ${height}`)
    }
  }
  return offenders
}

function hasFiniteGeometry(svg: SVGSVGElement): boolean {
  const attributes = ['x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'width', 'height', 'd']
  for (const node of svg.querySelectorAll('*')) {
    for (const name of attributes) {
      const value = node.getAttribute(name)
      if (value === null) continue
      if (/NaN|Infinity|undefined/.test(value)) return false
    }
  }
  return true
}

afterEach(cleanup)

describe('GateEnergyChart', () => {
  const chart = (energy: number[], thresholds = config) => (
    <GateEnergyChart
      energy={energy}
      moveThresholds={thresholds.moveThresholds}
      stillThresholds={thresholds.stillThresholds}
      minGate={thresholds.minGate}
      maxGate={thresholds.maxGate}
    />
  )

  it('draws one bar and two threshold ticks per gate', () => {
    const svg = draw(chart(Array.from({ length: TOTAL_GATES }, (_, g) => 60000 >> g)))
    expect(svg.querySelectorAll('rect[fill="var(--series-1)"]')).toHaveLength(TOTAL_GATES)
    expect(svg.querySelectorAll('line[stroke="var(--series-2)"]')).toHaveLength(TOTAL_GATES)
    expect(svg.querySelectorAll('line[stroke="var(--series-3)"]')).toHaveLength(TOTAL_GATES)
  })

  it('gives every gate a focusable, labelled hit area', () => {
    const svg = draw(chart(Array.from({ length: TOTAL_GATES }, () => 1000)))
    const targets = svg.querySelectorAll('rect[role="button"]')
    expect(targets).toHaveLength(TOTAL_GATES)
    expect(targets[0]!.getAttribute('aria-label')).toMatch(/^Gate 0, energy/)
  })

  it('emits finite geometry, including on an all-zero reading', () => {
    expect(hasFiniteGeometry(draw(chart(new Array<number>(TOTAL_GATES).fill(0))))).toBe(true)
    cleanup()
    expect(hasFiniteGeometry(draw(chart(new Array<number>(TOTAL_GATES).fill(65535))))).toBe(true)
  })

  it('leaves room for the axis label rather than clipping its descenders', () => {
    const svg = draw(chart(new Array<number>(TOTAL_GATES).fill(500)))
    expect(labelsFitVertically(svg)).toEqual([])
    expect(
      [...svg.querySelectorAll('text')].some((n) =>
        /Gate \(0\.7 m each\)/.test(n.textContent ?? ''),
      ),
    ).toBe(true)
  })

  it('describes itself and points at the table for the numbers', () => {
    const svg = draw(chart(new Array<number>(TOTAL_GATES).fill(500)))
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.getAttribute('aria-label')).toMatch(/table below the chart/)
  })
})

describe('DistanceTimeline', () => {
  const samples = Array.from({ length: 600 }, (_, i) =>
    measurement(i * 100, 100 + Math.round(200 * Math.abs(Math.sin(i / 40))), i % 137 !== 0),
  )

  it('draws a single stroked path for the one series', () => {
    const svg = draw(<DistanceTimeline samples={samples} windowMs={60_000} />)
    expect(svg.querySelectorAll('path[stroke="var(--series-1)"]')).toHaveLength(1)
    // Absence runs are recessive bands, not a second colour series.
    expect(svg.querySelectorAll('rect[fill="var(--chart-absence)"]').length).toBeGreaterThan(0)
    expect(hasFiniteGeometry(svg)).toBe(true)
  })

  it('labels only the endpoint, never every point', () => {
    const svg = draw(<DistanceTimeline samples={samples} windowMs={60_000} />)
    const labels = [...svg.querySelectorAll('text')].filter((node) =>
      /\d+\.\d{2} m/.test(node.textContent ?? ''),
    )
    expect(labels).toHaveLength(1)
  })

  it('keeps its own axis labels inside the box', () => {
    expect(
      labelsFitVertically(draw(<DistanceTimeline samples={samples} windowMs={60_000} />)),
    ).toEqual([])
  })

  it('shows a waiting state rather than an empty box', () => {
    const svg = draw(<DistanceTimeline samples={[]} windowMs={60_000} />)
    expect(svg.textContent).toContain('Waiting for data')
    expect(hasFiniteGeometry(svg)).toBe(true)
  })

  it('survives a single sample, where the time domain collapses', () => {
    const svg = draw(<DistanceTimeline samples={[measurement(0, 150)]} windowMs={60_000} />)
    expect(hasFiniteGeometry(svg)).toBe(true)
  })
})

describe('EnergyWaterfall', () => {
  it('draws the full grid of cells with a scale legend', () => {
    const samples = Array.from({ length: 300 }, (_, i) => measurement(i * 100, 200))
    const { container } = render(
      <MantineProvider>
        <EnergyWaterfall samples={samples} windowMs={60_000} minGate={0} maxGate={12} />
      </MantineProvider>,
    )
    expect(container.textContent).toContain('0 dB')
    expect(container.textContent).toContain('older · newer')
  })

  it('keeps the gate rows tall enough for their own labels', () => {
    const samples = Array.from({ length: 300 }, (_, i) => measurement(i * 100, 200))
    const svg = draw(
      <EnergyWaterfall samples={samples} windowMs={60_000} minGate={0} maxGate={12} />,
    )
    const cells = [...svg.querySelectorAll('rect')]
    expect(cells.length).toBeGreaterThan(0)
    // 16 gates share the plot height; below ~16px per row the labels collide.
    for (const cell of cells) {
      expect(Number(cell.getAttribute('height'))).toBeGreaterThanOrEqual(16)
    }
    // And the bottom row's label must still sit inside the plot.
    const labels = [...svg.querySelectorAll('text')]
    const lowest = Math.max(...labels.map((node) => Number(node.getAttribute('y'))))
    expect(lowest).toBeLessThan(Number(svg.getAttribute('height')))
  })

  it('tolerates simple-mode samples that carry no gate energy', () => {
    const samples = [{ t: 0, presence: true, distanceCm: 120, energy: [] }]
    const svg = draw(
      <EnergyWaterfall samples={samples} windowMs={60_000} minGate={0} maxGate={12} />,
    )
    expect(hasFiniteGeometry(svg)).toBe(true)
  })
})
