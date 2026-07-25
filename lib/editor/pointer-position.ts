export interface EditorHitRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

function intervalDistance(value: number, start: number, end: number) {
  return value < start ? start - value : value > end ? value - end : 0;
}

export function livePreviewPointerCoords(
  lineRect: EditorHitRect,
  contentRects: readonly EditorHitRect[],
  clientX: number,
  clientY: number,
  lineHeight: number,
) {
  const candidates = contentRects.filter((rect) => (
    Number.isFinite(rect.top)
    && Number.isFinite(rect.bottom)
    && rect.height > 0
    && rect.width > 0
    && rect.bottom >= lineRect.top
    && rect.top <= lineRect.bottom
  ));

  let closest: EditorHitRect | null = null;
  let closestVerticalDistance = Number.POSITIVE_INFINITY;
  let closestHorizontalDistance = Number.POSITIVE_INFINITY;
  for (const rect of candidates) {
    const verticalDistance = intervalDistance(clientY, rect.top, rect.bottom);
    const horizontalDistance = intervalDistance(clientX, rect.left, rect.right);
    if (
      verticalDistance < closestVerticalDistance
      || (verticalDistance === closestVerticalDistance && horizontalDistance < closestHorizontalDistance)
    ) {
      closest = rect;
      closestVerticalDistance = verticalDistance;
      closestHorizontalDistance = horizontalDistance;
    }
  }

  if (closest) {
    const horizontalInset = Math.min(1, closest.width / 2);
    const verticalInset = Math.min(1, closest.height / 2);
    return {
      x: Math.max(closest.left + horizontalInset, Math.min(clientX, closest.right - horizontalInset)),
      y: closest.top + verticalInset,
    };
  }

  const offsetY = Math.max(0, Math.min(clientY - lineRect.top, Math.max(0, lineRect.height - 1)));
  const visualRow = Math.floor(offsetY / lineHeight);
  const rowTop = lineRect.top + visualRow * lineHeight;
  const rowBottom = Math.min(lineRect.bottom, rowTop + lineHeight);
  return {
    x: clientX,
    y: Math.min(rowTop + lineHeight * 0.25, rowBottom - 1),
  };
}
