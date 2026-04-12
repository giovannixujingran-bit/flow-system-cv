import type { Display, Rectangle } from "electron";

export const COLLAPSED_SIZE = 88;
export const EXPANDED_WIDTH = 404;
export const EXPANDED_HEIGHT = 668;
const SCREEN_MARGIN = 18;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampBounds(bounds: Rectangle, workArea: Rectangle): Rectangle {
  return {
    x: clamp(bounds.x, workArea.x, workArea.x + workArea.width - bounds.width),
    y: clamp(bounds.y, workArea.y, workArea.y + workArea.height - bounds.height),
    width: bounds.width,
    height: bounds.height,
  };
}

export function clampWindowBounds(bounds: Rectangle, display: Display): Rectangle {
  return clampBounds(bounds, display.workArea);
}

export function defaultCollapsedBounds(display: Display): Rectangle {
  return {
    x: display.workArea.x + display.workArea.width - COLLAPSED_SIZE - SCREEN_MARGIN,
    y: display.workArea.y + display.workArea.height - COLLAPSED_SIZE - SCREEN_MARGIN,
    width: COLLAPSED_SIZE,
    height: COLLAPSED_SIZE,
  };
}

export function collapsedToExpandedBounds(collapsedBounds: Rectangle, display: Display): Rectangle {
  return clampWindowBounds({
    x: collapsedBounds.x + collapsedBounds.width - EXPANDED_WIDTH,
    y: collapsedBounds.y + collapsedBounds.height - EXPANDED_HEIGHT,
    width: EXPANDED_WIDTH,
    height: EXPANDED_HEIGHT,
  }, display);
}

export function expandedToCollapsedBounds(expandedBounds: Rectangle, display: Display): Rectangle {
  return clampWindowBounds({
    x: expandedBounds.x + expandedBounds.width - COLLAPSED_SIZE,
    y: expandedBounds.y + expandedBounds.height - COLLAPSED_SIZE,
    width: COLLAPSED_SIZE,
    height: COLLAPSED_SIZE,
  }, display);
}
