import { useEffect } from 'react'
import type { RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Traps keyboard focus inside a modal and restores the invoking focus on close. */
export function useDialogFocus(containerRef: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    if (!active) return
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const container = containerRef.current
    if (!container) return

    const focusFirst = (): void => {
      const autofocus = container.querySelector<HTMLElement>('[autofocus]')
      const first = autofocus ?? container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      ;(first ?? container).focus()
    }
    queueMicrotask(focusFirst)

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const focusable = [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        (element) => element.offsetParent !== null,
      )
      if (focusable.length === 0) {
        event.preventDefault()
        container.focus()
        return
      }
      const first = focusable[0]!
      const last = focusable.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    container.addEventListener('keydown', onKeyDown)
    return () => {
      container.removeEventListener('keydown', onKeyDown)
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [active, containerRef])
}
