import '@testing-library/jest-dom/vitest'

/**
 * jsdom implements no layout engine and no media queries, which Mantine and
 * visx's `ParentSize` both rely on. These are the standard shims; without them
 * every component test fails on mount rather than on anything meaningful.
 *
 * Guarded so the node-environment test files (the protocol layer) are untouched.
 */
if (typeof window !== 'undefined') {
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    })
  }

  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  // jsdom has no font loading API; Mantine's autosize textarea listens on it.
  if (typeof document !== 'undefined' && document.fonts === undefined) {
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        addEventListener: () => {},
        removeEventListener: () => {},
        ready: Promise.resolve(),
      },
    })
  }

  // jsdom's Blob predates Blob.arrayBuffer(); FileReader is what it does have.
  if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
    Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.onerror = () => reject(reader.error ?? new Error('read failed'))
        reader.readAsArrayBuffer(this)
      })
    }
  }

  if (typeof window.HTMLElement.prototype.scrollIntoView !== 'function') {
    window.HTMLElement.prototype.scrollIntoView = function scrollIntoView(this: void) {}
  }
}
