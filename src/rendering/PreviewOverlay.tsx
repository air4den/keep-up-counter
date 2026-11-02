import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  calculateRenderedRect,
  type RenderedRect,
  type Size,
} from './coordinates'

type PreviewOverlayProps = {
  containerRef: RefObject<HTMLDivElement | null>
  sourceSize: Size
  onRectChange: (rect: RenderedRect) => void
}

export function PreviewOverlay({
  containerRef,
  sourceSize,
  onRectChange,
}: PreviewOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [containerSize, setContainerSize] = useState<Size>({
    width: 0,
    height: 0,
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const measure = () => {
      const { width, height } = container.getBoundingClientRect()
      setContainerSize({ width, height })
    }

    const observer = new ResizeObserver(measure)
    observer.observe(container)
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    measure()

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
    }
  }, [containerRef])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const context = canvas.getContext('2d')
    if (!context) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(containerSize.width * dpr)
    canvas.height = Math.round(containerSize.height * dpr)
    canvas.style.width = `${containerSize.width}px`
    canvas.style.height = `${containerSize.height}px`
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, containerSize.width, containerSize.height)

    const renderedRect = calculateRenderedRect(containerSize, sourceSize)
    onRectChange(renderedRect)
    if (renderedRect.width === 0 || renderedRect.height === 0) return

    const borderWidth = 8
    context.strokeStyle = '#28a745'
    context.lineWidth = borderWidth
    context.strokeRect(
      renderedRect.x + borderWidth / 2,
      renderedRect.y + borderWidth / 2,
      renderedRect.width - borderWidth,
      renderedRect.height - borderWidth,
    )

  }, [containerSize, onRectChange, sourceSize])

  return <canvas ref={canvasRef} className="preview-overlay" aria-hidden="true" />
}
