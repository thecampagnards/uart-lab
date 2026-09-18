import type { ReactNode } from 'react'

export function Card({
  title,
  subtitle,
  actions,
  children,
}: {
  title?: string | undefined
  subtitle?: string | undefined
  actions?: ReactNode | undefined
  children: ReactNode
}) {
  return (
    <section className="card">
      {title || actions ? (
        <header className="card__header">
          <div>
            {title ? <h2 className="card__title">{title}</h2> : null}
            {subtitle ? <p className="card__subtitle">{subtitle}</p> : null}
          </div>
          {actions ? <div className="button-row">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  )
}

export function Stat({
  label,
  value,
  unit,
  hint,
}: {
  label: string
  value: ReactNode
  unit?: string | undefined
  hint?: ReactNode | undefined
}) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value">
        {value}
        {unit ? <span className="stat__unit">{unit}</span> : null}
      </div>
      {hint ? <div className="stat__hint">{hint}</div> : null}
    </div>
  )
}

export type BadgeTone = 'neutral' | 'good' | 'warning' | 'critical'

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={tone === 'neutral' ? 'badge' : `badge badge--${tone}`}>
      {tone !== 'neutral' ? <span className="badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  )
}

export function Notice({
  level,
  children,
  onDismiss,
}: {
  level: 'info' | 'warning' | 'error'
  children: ReactNode
  onDismiss?: (() => void) | undefined
}) {
  const role = level === 'error' ? 'alert' : 'status'
  return (
    <div className={`notice notice--${level}`} role={role}>
      <span>{children}</span>
      {onDismiss ? (
        <button
          type="button"
          className="button button--ghost notice__close"
          onClick={onDismiss}
          aria-label="Dismiss this message"
        >
          ×
        </button>
      ) : null}
    </div>
  )
}
