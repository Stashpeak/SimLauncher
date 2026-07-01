import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useTheme } from '../contexts/ThemeContext'
import { setZoom } from '../lib/electron'
import { getSettings, saveSettings } from '../lib/store'
import { AccentSwatchRow } from './AccentSwatchRow'
import { ZoomControl } from './ZoomControl'

interface OnboardingModalProps {
  isOpen: boolean
  /** Primary CTA: mark onboarding seen and hand off to Settings -> Games. */
  onSetup: () => void
  /** Secondary CTA (and Escape): mark onboarding seen and dismiss. */
  onSkip: () => void
}

/**
 * First-run onboarding. A single-screen modal that explains the one-click launch
 * loop, offers an optional accent + zoom personalization, and hands off to
 * Settings to configure the first sim. Shown once (gated on onboardingSeen + a
 * zero-games config in App). Skippable end-to-end. #641
 *
 * The accent + zoom controls are the same shared components Settings uses, but
 * the modal persists changes immediately (there is no save bar here) so the
 * picks survive the next launch.
 */
export function OnboardingModal({ isOpen, onSetup, onSkip }: OnboardingModalProps): ReactNode {
  const dialogRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  // Escape = Skip; initial focus lands on the primary CTA. useFocusTrap also
  // inerts the background and traps Tab within the dialog.
  useFocusTrap(isOpen, dialogRef, primaryRef, onSkip)

  const titleId = useId()
  const descId = useId()

  const theme = useTheme()
  const [zoomFactor, setZoomFactorState] = useState(1)

  // Read the current zoom once when the modal opens so the pills reflect the
  // live value. Accent comes straight from ThemeContext (always current).
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    getSettings()
      .then((settings) => {
        if (!cancelled && Number.isFinite(settings.zoomFactor)) {
          setZoomFactorState(settings.zoomFactor)
        }
      })
      .catch((err: unknown) => {
        console.error('Failed to read zoom for onboarding', err)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen])

  const isCustomColor = theme.accentPreset === 'custom'

  const handleAccentChange = (hex: string): void => {
    theme.setAccentPreset(hex) // apply live
    void saveSettings({ accentPreset: hex }) // persist now (no save bar here)
  }
  const handleCustomColorChange = (hex: string): void => {
    theme.setAccentCustom(hex)
    void saveSettings({ accentCustom: hex })
  }
  const handleZoomFactorChange = (factor: number): void => {
    setZoom(factor) // apply live
    setZoomFactorState(factor)
    void saveSettings({ zoomFactor: factor })
  }

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4 backdrop-blur-md">
      {/* Backdrop overlay. No click-to-dismiss: onboarding is dismissed only via
          the explicit Skip / Set up buttons or Escape, to avoid an accidental
          mis-click skipping it. */}
      <div aria-hidden="true" className="absolute inset-0 bg-black/40" />

      {/* Focus is trapped and the background is inerted via useFocusTrap, so
          aria-modal is honest here. */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="glass-surface-elevated animate-fade-slide relative w-full max-w-lg rounded-[24px] p-8 shadow-[0_20px_50px_rgba(0,0,0,0.5)] isolation-auto"
      >
        <h2
          id={titleId}
          className="text-2xl font-black italic tracking-tighter uppercase text-(--text-primary) mb-3"
        >
          Welcome to SimLauncher
        </h2>
        <p id={descId} className="text-sm text-(--text-secondary) leading-relaxed mb-6">
          Pick your sims and their companion apps once. One click launches the whole stack in the
          right order, and one click closes it all again.
        </p>

        <div className="mb-8">
          <span className="text-xs font-bold uppercase tracking-wide text-(--text-secondary)">
            Make it yours (optional)
          </span>
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-(--text-secondary)">Accent</span>
              <AccentSwatchRow
                accentPreset={theme.accentPreset}
                accentCustom={theme.accentCustom}
                isCustomColor={isCustomColor}
                onAccentChange={handleAccentChange}
                onCustomColorChange={handleCustomColorChange}
                className="flex flex-wrap items-center gap-2"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-(--text-secondary)">Scale</span>
              <ZoomControl
                zoomFactor={zoomFactor}
                onZoomFactorChange={handleZoomFactorChange}
                className="flex flex-wrap items-center gap-2"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <button
            ref={primaryRef}
            type="button"
            onClick={onSetup}
            className="accent-action action-hover-scale w-full cursor-pointer rounded-xl py-3 text-sm font-bold"
          >
            Set up your sims →
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="neutral-action action-hover-scale w-full cursor-pointer rounded-xl py-3 text-sm font-semibold"
          >
            Skip
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
