import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { PreviewOverlay } from '../rendering/PreviewOverlay'
import type { RenderedRect, Size } from '../rendering/coordinates'

type CameraStatus = 'idle' | 'requesting' | 'active' | 'error'

const EMPTY_SIZE: Size = { width: 0, height: 0 }
const EMPTY_RECT: RenderedRect = { x: 0, y: 0, width: 0, height: 0 }

function getViewportSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight }
}

function cameraErrorMessage(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') {
      return 'Camera access was denied. Allow camera access in your browser settings and try again.'
    }
    if (error.name === 'NotFoundError') {
      return 'No camera was found on this device.'
    }
    if (error.name === 'NotReadableError') {
      return 'The camera is already in use or could not be started.'
    }
  }

  return 'The camera could not be started. Check your browser permissions and try again.'
}

export function CameraPreview() {
  const videoRef = useRef<HTMLVideoElement>(null) // <video> DOM element
  const previewRef = useRef<HTMLDivElement>(null) // <div> w/ video & canvas
  const streamRef = useRef<MediaStream | null>(null)  
  const mountedRef = useRef(true)
  const autoStartedRef = useRef(false)
  const [status, setStatus] = useState<CameraStatus>('idle')
  const [error, setError] = useState('')
  const [sourceSize, setSourceSize] = useState<Size>(EMPTY_SIZE)
  const [renderedRect, setRenderedRect] = useState<RenderedRect>(EMPTY_RECT)
  const [viewportSize, setViewportSize] = useState<Size>(getViewportSize)

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('error')
      setError('This browser does not support camera access.')
      return
    }

    setStatus('requesting')
    setError('')
    let requestedStream: MediaStream | null = null

    try {
      requestedStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'user' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      })

      if (!mountedRef.current) {
        for (const track of requestedStream.getTracks()) track.stop()
        return
      }

      for (const track of streamRef.current?.getTracks() ?? []) track.stop()
      streamRef.current = requestedStream

      if (videoRef.current) {
        videoRef.current.srcObject = requestedStream
        await videoRef.current.play()
      }

      if (!mountedRef.current) {
        for (const track of requestedStream.getTracks()) track.stop()
        return
      }

      setStatus('active')
    } catch (caughtError) {
      for (const track of requestedStream?.getTracks() ?? []) track.stop()
      if (streamRef.current === requestedStream) streamRef.current = null
      if (!mountedRef.current) return
      setStatus('error')
      setError(cameraErrorMessage(caughtError))
    }
  }, [])

  const updateSourceSize = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    setSourceSize({ width: video.videoWidth, height: video.videoHeight })
  }, [])

  useEffect(() => {
    mountedRef.current = true
    if (!autoStartedRef.current) {
      autoStartedRef.current = true
      void startCamera()
    }

    return () => {
      mountedRef.current = false
      for (const track of streamRef.current?.getTracks() ?? []) track.stop()
      streamRef.current = null
    }
  }, [startCamera])

  useEffect(() => {
    const updateViewportSize = () => setViewportSize(getViewportSize())
    window.addEventListener('resize', updateViewportSize)
    window.addEventListener('orientationchange', updateViewportSize)

    return () => {
      window.removeEventListener('resize', updateViewportSize)
      window.removeEventListener('orientationchange', updateViewportSize)
    }
  }, [])

  const formatNumber = (value: number) => Math.round(value)
  const compactLayout = viewportSize.width <= 520
  const fallbackSource =
    viewportSize.height > viewportSize.width
      ? { width: 3, height: 4 }
      : { width: 16, height: 9 }
  const layoutSource = sourceSize.width > 0 ? sourceSize : fallbackSource
  const maxPreviewWidth = Math.min(
    viewportSize.width - (compactLayout ? 20 : 32),
    1180,
  )
  const maxPreviewHeight = Math.max(
    180,
    viewportSize.height - (compactLayout ? 96 : 160),
  )
  const previewScale = Math.min(
    maxPreviewWidth / layoutSource.width,
    maxPreviewHeight / layoutSource.height,
  )
  const previewWidth = layoutSource.width * previewScale
  const previewAspect = layoutSource.width / layoutSource.height
  const cameraStyle = {
    width: `${previewWidth}px`,
    '--source-aspect': previewAspect,
  } as CSSProperties

  return (
    <section
      className="camera-view"
      aria-label="Camera preview"
      style={cameraStyle}
    >
      <div ref={previewRef} className="preview-frame">
        <video
          ref={videoRef}
          className="camera-video"
          autoPlay
          muted
          playsInline
          onLoadedMetadata={updateSourceSize}
          onResize={updateSourceSize}
        />
        <PreviewOverlay
          containerRef={previewRef}
          sourceSize={sourceSize}
          onRectChange={setRenderedRect}
        />

        {status !== 'active' && (
          <div className="preview-placeholder">
            {error ? (
              <p role="alert">{error}</p>
            ) : (
              <p>Starting camera…</p>
            )}
          </div>
        )}
      </div>

      <dl className="diagnostics" aria-label="Coordinate diagnostics">
        <div>
          <dt>Source</dt>
          <dd>
            {sourceSize.width > 0
              ? `${sourceSize.width} × ${sourceSize.height}`
              : '—'}
          </dd>
        </div>
        <div>
          <dt>Rendered video</dt>
          <dd>
            {renderedRect.width > 0
              ? `${formatNumber(renderedRect.width)} × ${formatNumber(renderedRect.height)}`
              : '—'}
          </dd>
        </div>
        <div>
          <dt>Letterbox offset</dt>
          <dd>
            {renderedRect.width > 0
              ? `${formatNumber(renderedRect.x)}, ${formatNumber(renderedRect.y)}`
              : '—'}
          </dd>
        </div>
      </dl>
    </section>
  )
}
