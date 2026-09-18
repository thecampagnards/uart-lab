import { describe, expect, it } from 'vitest'
import source from '../../../doc/wiring-ft232rl.svg?raw'
import { stripStandaloneTheme } from './stripStandaloneTheme'

describe('wiring diagram source', () => {
  it('carries standalone colours so it reads outside the app', () => {
    expect(source).toContain('prefers-color-scheme: dark')
    expect(source).toContain('standalone-theme:start')
    expect(source).toContain('standalone-theme:end')
  })

  it('draws with currentColor and variables, never baked-in hues on the marks', () => {
    const marks = source.slice(source.indexOf('</style>'))
    // Every stroke and fill on a mark resolves against the page, so both the
    // standalone rules and the app's can drive it.
    for (const [, value] of marks.matchAll(/(?:stroke|fill)="([^"]+)"/g)) {
      expect(value).toMatch(/^(currentColor|none|var\(--(power|data|muted)\))$/)
    }
  })
})

/**
 * Rough advance widths for a UI sans. It is an estimate, not a text engine, but
 * it is enough to catch a label that has grown past the drawing — which is not
 * something a unit test would otherwise see and not something the author can
 * see either without opening the file.
 */
function estimateWidth(text: string, fontSize: number): number {
  const narrow = [...text].filter((c) => ' iljI.,:;|/'.includes(c)).length
  const wide = [...text].filter((c) => c === c.toUpperCase() && /[A-Z]/.test(c)).length
  const other = text.length - narrow - wide
  return (narrow * 0.3 + wide * 0.68 + other * 0.52) * fontSize
}

const FONT_SIZES: Record<string, number> = {
  sub: 11,
  pinlabel: 12.5,
  'pinlabel-off': 12.5,
  'pinlabel-danger': 12.5,
  title: 14,
  wirelabel: 11.5,
}

interface Label {
  text: string
  left: number
  right: number
  y: number
}

function labels(): Label[] {
  const out: Label[] = []
  for (const match of source.matchAll(
    /<text class="([\w-]+)" x="(-?[\d.]+)" y="(-?[\d.]+)"([^>]*)>([^<]+)</g,
  )) {
    const [, className, xRaw, yRaw, rest, text] = match
    const size = FONT_SIZES[className!] ?? 12
    const width = estimateWidth(text!.trim(), size)
    const x = Number(xRaw)
    const anchor = /text-anchor="end"/.test(rest!)
      ? 'end'
      : /text-anchor="middle"/.test(rest!)
        ? 'middle'
        : 'start'
    const left = anchor === 'end' ? x - width : anchor === 'middle' ? x - width / 2 : x
    out.push({ text: text!.trim(), left, right: left + width, y: Number(yRaw) })
  }
  return out
}

describe('wiring diagram layout', () => {
  const VIEW_WIDTH = 760

  it('parses a label for every text node', () => {
    expect(labels().length).toBeGreaterThan(20)
  })

  it('keeps every label inside the drawing', () => {
    for (const label of labels()) {
      expect(
        label.left >= 0 && label.right <= VIEW_WIDTH,
        `"${label.text}" runs from ${label.left.toFixed(0)} to ${label.right.toFixed(0)}`,
      ).toBe(true)
    }
  })

  it('keeps labels inside the bridge block from spilling into the wire lane', () => {
    // The left block spans x 40-250, y 56-404; the wires live to the right of it.
    for (const label of labels()) {
      if (label.y <= 56 || label.y >= 404 || label.left < 40 || label.left > 250) continue
      expect(
        label.right <= 250,
        `"${label.text}" reaches ${label.right.toFixed(0)}, past the block edge at 250`,
      ).toBe(true)
    }
  })
})

describe('stripStandaloneTheme', () => {
  const stripped = stripStandaloneTheme(source)

  it('removes the standalone colours so the app can supply its own', () => {
    expect(stripped).not.toContain('prefers-color-scheme')
    expect(stripped).not.toContain('#3f3f3f')
    expect(stripped).not.toContain('--power: #c62f2f')
  })

  it('keeps the drawing, its classes and its description intact', () => {
    expect(stripped).toContain('class="chip"')
    expect(stripped).toContain('font-family')
    expect(stripped).toContain('role="img"')
    expect(stripped).toMatch(/aria-label="Wiring between an FT232RL/)
    expect(stripped.match(/<rect/g)?.length).toBe(source.match(/<rect/g)?.length)
  })

  it('is a no-op on markup without the markers', () => {
    expect(stripStandaloneTheme('<svg><rect/></svg>')).toBe('<svg><rect/></svg>')
  })
})
