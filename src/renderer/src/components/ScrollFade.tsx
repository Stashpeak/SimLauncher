import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

interface ScrollFadeProps {
  children: ReactNode
  className?: string
}

export function ScrollFade({ children, className = '' }: ScrollFadeProps): ReactNode {
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState({ top: false, bottom: false })

  const updateFade = useCallback(() => {
    const scrollArea = scrollAreaRef.current
    if (!scrollArea) return

    const maxScrollTop = scrollArea.scrollHeight - scrollArea.clientHeight
    const nextFade = {
      top: scrollArea.scrollTop > 1,
      bottom: maxScrollTop - scrollArea.scrollTop > 1
    }

    setFade((prev) =>
      prev.top === nextFade.top && prev.bottom === nextFade.bottom ? prev : nextFade
    )
  }, [])

  useEffect(() => {
    updateFade()

    const scrollArea = scrollAreaRef.current
    if (!scrollArea) return

    // Observe both the scroll container and its immediate children so the fade
    // recalculates when the content height changes (e.g. a list item collapses)
    // without requiring the user to scroll first. The window resize listener
    // covers viewport-driven changes that wouldn't surface through ResizeObserver
    // alone (e.g. sidebar toggling). The rAF handles the initial render tick
    // where the first synchronous updateFade() may see height = 0.
    const resizeObserver = new ResizeObserver(updateFade)
    resizeObserver.observe(scrollArea)
    Array.from(scrollArea.children).forEach((child) => resizeObserver.observe(child))

    window.addEventListener('resize', updateFade)
    const frame = window.requestAnimationFrame(updateFade)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updateFade)
      resizeObserver.disconnect()
    }
  }, [children, updateFade])

  return (
    <div
      ref={scrollAreaRef}
      onScroll={updateFade}
      className={`scroll-fade-mask ${className} ${fade.top ? 'scroll-fade-mask-top' : ''} ${
        fade.bottom ? 'scroll-fade-mask-bottom' : ''
      }`}
    >
      {children}
    </div>
  )
}
