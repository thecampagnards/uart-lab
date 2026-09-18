/** The subset of ABD parameters this tool exposes, plus (de)serialisation. */
import {
  FACTORY_MAX_GATE,
  FACTORY_MIN_GATE,
  FACTORY_MOVE_THRESHOLDS,
  FACTORY_STILL_THRESHOLDS,
  FACTORY_TIMEOUT_S,
  Param,
  TOTAL_GATES,
  moveThresholdAddr,
  stillThresholdAddr,
} from './constants'
import type { ParamWrite } from './frames'

export interface Ld2420Config {
  /** Nearest gate taken into account, 0..15. */
  minGate: number
  /** Furthest gate taken into account, 0..15. */
  maxGate: number
  /** Seconds of continued "presence" after the last detection, 0..65535. */
  timeoutS: number
  /** Motion trigger threshold per gate, linear, 0..65535. */
  moveThresholds: number[]
  /** Static hold threshold per gate, linear, 0..65535. */
  stillThresholds: number[]
}

export const FIELD_LIMITS = {
  gate: { min: 0, max: TOTAL_GATES - 1 },
  timeoutS: { min: 0, max: 65535 },
  threshold: { min: 0, max: 65535 },
} as const

export function factoryConfig(): Ld2420Config {
  return {
    minGate: FACTORY_MIN_GATE,
    maxGate: FACTORY_MAX_GATE,
    timeoutS: FACTORY_TIMEOUT_S,
    moveThresholds: [...FACTORY_MOVE_THRESHOLDS],
    stillThresholds: [...FACTORY_STILL_THRESHOLDS],
  }
}

export function cloneConfig(config: Ld2420Config): Ld2420Config {
  return {
    ...config,
    moveThresholds: [...config.moveThresholds],
    stillThresholds: [...config.stillThresholds],
  }
}

export function configsEqual(a: Ld2420Config, b: Ld2420Config): boolean {
  return (
    a.minGate === b.minGate &&
    a.maxGate === b.maxGate &&
    a.timeoutS === b.timeoutS &&
    a.moveThresholds.every((v, i) => v === b.moveThresholds[i]) &&
    a.stillThresholds.every((v, i) => v === b.stillThresholds[i])
  )
}

/** Rebuild a config from the flat (address → value) map a bulk read returns. */
export function configFromValues(values: ReadonlyMap<number, number>): Ld2420Config {
  const base = factoryConfig()
  const at = (addr: number, fallback: number): number => values.get(addr) ?? fallback
  return {
    minGate: at(Param.MinGate, base.minGate),
    maxGate: at(Param.MaxGate, base.maxGate),
    timeoutS: at(Param.Timeout, base.timeoutS),
    moveThresholds: Array.from({ length: TOTAL_GATES }, (_, g) =>
      at(moveThresholdAddr(g), base.moveThresholds[g]!),
    ),
    stillThresholds: Array.from({ length: TOTAL_GATES }, (_, g) =>
      at(stillThresholdAddr(g), base.stillThresholds[g]!),
    ),
  }
}

/** Only the parameters that actually changed, so an apply writes the minimum. */
export function diffConfig(current: Ld2420Config, next: Ld2420Config): ParamWrite[] {
  const writes: ParamWrite[] = []
  if (next.minGate !== current.minGate) writes.push({ address: Param.MinGate, value: next.minGate })
  if (next.maxGate !== current.maxGate) writes.push({ address: Param.MaxGate, value: next.maxGate })
  if (next.timeoutS !== current.timeoutS) {
    writes.push({ address: Param.Timeout, value: next.timeoutS })
  }
  for (let g = 0; g < TOTAL_GATES; g++) {
    if (next.moveThresholds[g] !== current.moveThresholds[g]) {
      writes.push({ address: moveThresholdAddr(g), value: next.moveThresholds[g]! })
    }
    if (next.stillThresholds[g] !== current.stillThresholds[g]) {
      writes.push({ address: stillThresholdAddr(g), value: next.stillThresholds[g]! })
    }
  }
  return writes
}

export interface ConfigProblem {
  field: string
  message: string
}

export function validateConfig(config: Ld2420Config): ConfigProblem[] {
  const problems: ConfigProblem[] = []
  const int = (v: number): boolean => Number.isInteger(v)
  const inRange = (v: number, lo: number, hi: number): boolean => int(v) && v >= lo && v <= hi

  if (!inRange(config.minGate, FIELD_LIMITS.gate.min, FIELD_LIMITS.gate.max)) {
    problems.push({
      field: 'minGate',
      message: 'Minimum gate must be a whole number from 0 to 15.',
    })
  }
  if (!inRange(config.maxGate, FIELD_LIMITS.gate.min, FIELD_LIMITS.gate.max)) {
    problems.push({
      field: 'maxGate',
      message: 'Maximum gate must be a whole number from 0 to 15.',
    })
  }
  if (config.minGate > config.maxGate) {
    problems.push({
      field: 'minGate',
      message: 'Minimum gate must be less than or equal to maximum gate.',
    })
  }
  if (!inRange(config.timeoutS, FIELD_LIMITS.timeoutS.min, FIELD_LIMITS.timeoutS.max)) {
    problems.push({ field: 'timeoutS', message: 'Absence delay must be from 0 to 65535 s.' })
  }
  for (const [name, list] of [
    ['moveThresholds', config.moveThresholds],
    ['stillThresholds', config.stillThresholds],
  ] as const) {
    if (list.length !== TOTAL_GATES) {
      problems.push({ field: name, message: `Exactly ${TOTAL_GATES} thresholds are required.` })
      continue
    }
    list.forEach((value, gate) => {
      if (!inRange(value, FIELD_LIMITS.threshold.min, FIELD_LIMITS.threshold.max)) {
        problems.push({
          field: `${name}.${gate}`,
          message: `Gate ${gate} threshold: expected a whole number from 0 to 65535.`,
        })
      }
    })
  }
  return problems
}

export interface ConfigFile {
  format: 'uart-lab/ld2420-config'
  version: 1
  exportedAt: string
  device: { firmware?: string; serial?: string }
  config: Ld2420Config
}

export function toConfigFile(
  config: Ld2420Config,
  device: { firmware?: string; serial?: string } = {},
): ConfigFile {
  return {
    format: 'uart-lab/ld2420-config',
    version: 1,
    exportedAt: new Date().toISOString(),
    device,
    config: cloneConfig(config),
  }
}

/** Parse an exported file, rejecting anything that is not a valid config. */
export function parseConfigFile(json: string): Ld2420Config {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('Unreadable file: this is not valid JSON.')
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Empty configuration file.')
  const root = parsed as Partial<ConfigFile> & Partial<Ld2420Config>
  const candidate = (root.config ?? root) as Partial<Ld2420Config>
  const config: Ld2420Config = {
    minGate: Number(candidate.minGate),
    maxGate: Number(candidate.maxGate),
    timeoutS: Number(candidate.timeoutS),
    moveThresholds: (candidate.moveThresholds ?? []).map(Number),
    stillThresholds: (candidate.stillThresholds ?? []).map(Number),
  }
  const problems = validateConfig(config)
  if (problems.length > 0) {
    throw new Error(`Invalid configuration: ${problems.map((p) => p.message).join(' ')}`)
  }
  return config
}
