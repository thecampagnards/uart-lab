import { parseConfigFile, toConfigFile, type Ld2420Config } from '../../devices/ld2420/config'
import { JsonDocumentCard } from './JsonDocumentCard'

export function ConfigJsonPanel({
  config,
  device,
  disabled,
  onApply,
  onError,
}: {
  config: Ld2420Config
  device: { firmware?: string; serial?: string }
  disabled: boolean
  onApply: (config: Ld2420Config) => void
  onError: (message: string) => void
}) {
  return (
    <JsonDocumentCard
      title="Configuration as JSON"
      description="The same document the export produces. Paste one here to load it without going through a file."
      value={JSON.stringify(toConfigFile(config, device), null, 2)}
      disabled={disabled}
      hint="Loading only fills the form — nothing reaches the module until you press “Write to module”."
      onLoad={(text) => {
        try {
          onApply(parseConfigFile(text))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          onError(message)
          throw error instanceof Error ? error : new Error(message)
        }
      }}
    />
  )
}
