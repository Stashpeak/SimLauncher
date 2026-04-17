import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

interface ScrollFadeProps {
  children: ReactNode
  className?: string
}

export function ScrollFade({ children, className = '' }: ScrollFadeProps) {
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
