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

  if (typeof window.HTMLElement.prototype.scrollIntoView !== 'function') {
    window.HTMLElement.prototype.scrollIntoView = function scrollIntoView(this: void) {}
  }
}
