/**
 * @vitest-environment jsdom
 *
 * End-to-end smoke test through the real UI: mount the app, connect to the
 * built-in simulator and drive a configuration change the way a user would.
 * Anything that throws on mount, or a panel wired to the wrong action, fails
 * here rather than in front of the person holding the sensor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

describe('App', () => {
  beforeEach(() => {
    // jsdom has no canvas backend; the waterfall guards against a null context,
    // and this keeps the "not implemented" noise out of the test output.
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never
  })

  afterEach(cleanup)

  it('renders the shell without a device connected', () => {
    render(<App />)
    expect(screen.getByText('uart-lab')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /HLK-LD2420/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Monitor' })).toHaveAttribute('aria-selected', 'true')
  })

  it('warns that configuration needs a connection', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('tab', { name: 'Configuration' }))
    expect(screen.getByText(/Connect a module/)).toBeInTheDocument()
  })

  it('connects to the simulator, then reads and writes a parameter', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Simulated demo' }))

    // Identity comes back from the simulated module.
    expect(await screen.findByText('v1.6.1')).toBeInTheDocument()
    // Once connected the "Simulated demo" button is replaced by "Disconnect",
    // so the only remaining occurrence is the status badge.
    expect(screen.getByText('Simulated demo')).toBeInTheDocument()

    // The live panel picks up the report stream.
    await waitFor(
      () => {
        expect(screen.getByText(/frames received/)).not.toHaveTextContent('0 frames')
      },
      { timeout: 4000 },
    )

    await user.click(screen.getByRole('tab', { name: 'Configuration' }))
    const timeout = screen.getByLabelText(/Absence delay/)
    expect(timeout).toHaveValue('30')

    await user.clear(timeout)
    await user.type(timeout, '45')
    expect(screen.getByText('Unwritten changes')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Write to module' }))

    // The write is followed by a read-back, so the badge clears only if the
    // module really holds the new value.
    await waitFor(() => {
      expect(screen.queryByText('Unwritten changes')).not.toBeInTheDocument()
    })
    expect(screen.getByLabelText(/Absence delay/)).toHaveValue('45')
  }, 20_000)

  it('refuses to write an out-of-range gate and says why', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Simulated demo' }))
    await screen.findByText('v1.6.1')

    await user.click(screen.getByRole('tab', { name: 'Configuration' }))
    const minGate = screen.getByLabelText('Minimum gate')
    await user.clear(minGate)
    await user.type(minGate, '14')

    const alerts = await screen.findAllByRole('alert')
    expect(alerts.some((node) => /less than or equal/.test(node.textContent ?? ''))).toBe(true)
    expect(screen.getByRole('button', { name: 'Write to module' })).toBeDisabled()
  }, 20_000)

  it('exposes the serial trace', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Simulated demo' }))
    await screen.findByText('v1.6.1')

    await user.click(screen.getByRole('tab', { name: 'Serial trace' }))
    // `open_command_mode`, byte for byte as the protocol document spells it. It
    // appears once per operation, hence findAll.
    const opens = await screen.findAllByText(/fd fc fb fa 04 00 ff 00 01 00 04 03 02 01/)
    expect(opens.length).toBeGreaterThan(0)
    // And the module's ACK, carrying protocol version 2 and a 32-byte buffer.
    expect(screen.getAllByText(/fd fc fb fa 08 00 ff 01 00 00 02 00 20 00/).length).toBeGreaterThan(
      0,
    )
  }, 20_000)
})
