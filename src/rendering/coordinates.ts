export type Size = {
  width: number
  height: number
}

export type Point = {
  x: number
  y: number
}

export type RenderedRect = Size & {
  x: number
  y: number
}

const EMPTY_RECT: RenderedRect = { x: 0, y: 0, width: 0, height: 0 }

/** Returns the source video's CSS-pixel rectangle inside a contain-fit box. */
export function calculateRenderedRect(
  container: Size,
  source: Size,
): RenderedRect {
  if (
    container.width <= 0 ||
    container.height <= 0 ||
    source.width <= 0 ||
    source.height <= 0
  ) {
    return EMPTY_RECT
  }

  const scale = Math.min(
    container.width / source.width,
    container.height / source.height,
  )
  const width = source.width * scale
  const height = source.height * scale

  return {
    x: (container.width - width) / 2,
    y: (container.height - height) / 2,
    width,
    height,
  }
}

/**
 * Maps normalized, unmirrored source coordinates into preview CSS pixels.
 * Mirroring is applied only at this final display boundary.
 */
export function sourcePointToPreview(
  sourcePoint: Point,
  renderedRect: RenderedRect,
  mirrored: boolean,
): Point {
  const displayX = mirrored ? 1 - sourcePoint.x : sourcePoint.x

  return {
    x: renderedRect.x + displayX * renderedRect.width,
    y: renderedRect.y + sourcePoint.y * renderedRect.height,
  }
}
