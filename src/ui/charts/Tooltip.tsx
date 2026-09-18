import type { ReactNode } from 'react'

export interface TooltipRow {
  label: string
  value: string
  /** CSS colour for the identity swatch; omitted rows show no swatch. */
  color?: string
}

/**
 * `left`/`top` are CSS lengths relative to the plot box, not pixels: the charts
 * scale with their container, so positions are expressed as percentages of the
 * SVG viewBox.
 */
export function Tooltip({
  left,
  top,
  title,
  rows,
  footer,
}: {
  left: string
  top: string
  title: string
  rows: TooltipRow[]
  footer?: ReactNode | undefined
}) {
  return (
    <div className="tooltip" style={{ left, top }} role="presentation">
      <div className="tooltip__title">{title}</div>
      {rows.map((row) => (
        <div className="tooltip__row" key={row.label}>
          <span>
            {row.color ? (
              <span
                className="legend__swatch"
                style={{ background: row.color }}
                aria-hidden="true"
              />
            ) : null}
            {row.label}
          </span>
          <span>{row.value}</span>
        </div>
      ))}
      {footer ? (
        <div className="stat__hint" style={{ marginTop: 4 }}>
          {footer}
        </div>
      ) : null}
    </div>
  )
}

export function Legend({ items }: { items: { label: string; color: string; line?: boolean }[] }) {
  return (
    <ul className="legend">
      {items.map((item) => (
        <li key={item.label}>
          <span
            className={item.line ? 'legend__swatch legend__swatch--line' : 'legend__swatch'}
            style={{ background: item.color }}
            aria-hidden="true"
          />
          {item.label}
        </li>
      ))}
    </ul>
  )
}
