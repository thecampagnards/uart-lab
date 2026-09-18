import { useState } from 'react'
import { LD2420 } from './devices/registry'
import { OperatingMode, type OperatingModeValue } from './devices/ld2420/constants'
import { useLd2420Session } from './hooks/useLd2420Session'
import { useTheme, type ThemeChoice } from './hooks/useTheme'
import { ConfigPanel } from './ui/components/ConfigPanel'
import { ConnectionPanel } from './ui/components/ConnectionPanel'
import { DeviceList } from './ui/components/DeviceList'
import { LivePanel } from './ui/components/LivePanel'
import { TracePanel } from './ui/components/TracePanel'
import { Notice } from './ui/components/primitives'

type Tab = 'live' | 'config' | 'trace'

const TABS: { id: Tab; label: string }[] = [
  { id: 'live', label: 'Monitor' },
  { id: 'config', label: 'Configuration' },
  { id: 'trace', label: 'Serial trace' },
]

export default function App() {
  const [theme, setTheme] = useTheme()
  const [tab, setTab] = useState<Tab>('live')
  const [selectedDevice, setSelectedDevice] = useState(LD2420.id)
  const { state, actions, history, trace } = useLd2420Session()

  const connected = state.status === 'connected' || state.status === 'busy'

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          uart-lab
          <span>serial console for UART sensors</span>
        </div>
        <div className="app__header-spacer" />
        <ThemeToggle theme={theme} onChange={setTheme} />
      </header>

      <aside className="app__sidebar">
        <DeviceList
          selectedId={selectedDevice}
          onSelect={setSelectedDevice}
          connectedId={connected ? LD2420.id : null}
        />
      </aside>

      <main className="app__main">
        {state.notices.map((notice) => (
          <Notice
            key={notice.id}
            level={notice.level}
            onDismiss={() => actions.dismissNotice(notice.id)}
          >
            {notice.message}
          </Notice>
        ))}

        <ConnectionPanel
          device={LD2420}
          state={state}
          onConnectSerial={(baudRate) => void actions.connectSerial(baudRate, LD2420.portFilters)}
          onConnectSimulator={() => void actions.connectSimulator()}
          onDisconnect={() => void actions.disconnect()}
        />

        <div className="tabs" role="tablist" aria-label="Sections">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={`tab-${entry.id}`}
              aria-selected={tab === entry.id}
              aria-controls={`panel-${entry.id}`}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          id={`panel-${tab}`}
          aria-labelledby={`tab-${tab}`}
          style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        >
          {tab === 'live' ? (
            <LivePanel
              state={state}
              history={history}
              config={state.deviceConfig ?? state.draftConfig}
              onSetMode={(mode: OperatingModeValue) => void actions.setMode(mode)}
            />
          ) : null}

          {tab === 'config' ? (
            connected ? (
              <ConfigPanel
                state={state}
                onChange={actions.setDraft}
                onApply={() => void actions.applyConfig()}
                onRevert={actions.revertDraft}
                onReload={() => void actions.reloadConfig()}
                onFactoryReset={() => void actions.resetToFactory()}
                onReboot={() => void actions.reboot()}
                onError={(message) => actions.notify('error', message)}
              />
            ) : (
              <Notice level="info">
                Connect a module — or start the simulated demo — to read and edit its configuration.
              </Notice>
            )
          ) : null}

          {tab === 'trace' ? <TracePanel trace={trace} onClear={actions.clearTrace} /> : null}
        </div>

        <footer className="stat__hint" style={{ paddingBottom: 8 }}>
          {LD2420.vendor} {LD2420.name} ·{' '}
          {state.mode === OperatingMode.Report ? 'report' : 'simple'} mode ·{' '}
          <a href="https://github.com/damianmichna/hi-link" target="_blank" rel="noreferrer">
            protocol documentation
          </a>{' '}
          by Damian Michna (CC BY-SA 4.0).
        </footer>
      </main>
    </div>
  )
}

function ThemeToggle({
  theme,
  onChange,
}: {
  theme: ThemeChoice
  onChange: (choice: ThemeChoice) => void
}) {
  return (
    <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <span className="visually-hidden">Theme</span>
      <select
        value={theme}
        onChange={(event) => onChange(event.target.value as ThemeChoice)}
        aria-label="Theme"
      >
        <option value="system">System theme</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  )
}
