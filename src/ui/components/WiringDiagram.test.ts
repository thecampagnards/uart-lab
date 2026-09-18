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
