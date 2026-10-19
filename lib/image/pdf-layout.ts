const POINTS_PER_INCH = 72;
const A4_SHORT_SIDE = 595.28;
const A4_LONG_SIDE = 841.89;
export const PAGE_MARGIN = 36;

// A file's own resolution is believed only within this range. Outside it the figure is
// more likely a placeholder than a physical size (some writers store 1 or 2,000,000).
const MIN_PLAUSIBLE_DENSITY = 72;
const MAX_PLAUSIBLE_DENSITY = 1200;
export const DEFAULT_DENSITY = 96;

/** A PDF transformation matrix [a b c d e f], mapping the unit square onto the page. */
export type Matrix = [number, number, number, number, number, number];

export interface PageLayout {
  width: number;
  height: number;
  /** Draws the image's stored pixels upright, scaled and centred on the page. */
  matrix: Matrix;
}

/** EXIF orientations 5 to 8 store the picture on its side. */
export function isSideways(orientation: number): boolean {
  return orientation >= 5 && orientation <= 8;
}

function plausibleDensity(density: number | undefined): number {
  return density !== undefined && density >= MIN_PLAUSIBLE_DENSITY && density <= MAX_PLAUSIBLE_DENSITY
    ? density
    : DEFAULT_DENSITY;
}

// An image's unit square has the stored picture's first row at the top. For each EXIF
// orientation, the matrix that shows the stored picture upright in a box `width` by
// `height` points at (x, y), derived from where the tag says each stored corner belongs.
const ORIENTED_MATRICES: Record<number, (x: number, y: number, width: number, height: number) => Matrix> = {
  1: (x, y, w, h) => [w, 0, 0, h, x, y],
  2: (x, y, w, h) => [-w, 0, 0, h, x + w, y],
  3: (x, y, w, h) => [-w, 0, 0, -h, x + w, y + h],
  4: (x, y, w, h) => [w, 0, 0, -h, x, y + h],
  5: (x, y, w, h) => [0, -h, -w, 0, x + w, y + h],
  6: (x, y, w, h) => [0, -h, w, 0, x, y + h],
  7: (x, y, w, h) => [0, h, w, 0, x, y],
  8: (x, y, w, h) => [0, h, -w, 0, x + w, y],
};

/**
 * Lays out one image on its own A4 page: portrait or landscape to match the picture as
 * displayed, with `PAGE_MARGIN` on every side, the picture centred and at its real size
 * (from its stated resolution, or `DEFAULT_DENSITY`), scaled down to fit but never up.
 * `orientation` is the EXIF orientation the stored pixels still need applying, 1 if none.
 */
export function layoutImagePage({
  storedWidth,
  storedHeight,
  orientation,
  density,
}: {
  storedWidth: number;
  storedHeight: number;
  orientation: number;
  density?: number;
}): PageLayout {
  const sideways = isSideways(orientation);
  const displayedWidth = sideways ? storedHeight : storedWidth;
  const displayedHeight = sideways ? storedWidth : storedHeight;

  const landscape = displayedWidth > displayedHeight;
  const pageWidth = landscape ? A4_LONG_SIDE : A4_SHORT_SIDE;
  const pageHeight = landscape ? A4_SHORT_SIDE : A4_LONG_SIDE;

  const pointsPerPixel = POINTS_PER_INCH / plausibleDensity(density);
  const realWidth = displayedWidth * pointsPerPixel;
  const realHeight = displayedHeight * pointsPerPixel;
  const scale = Math.min(1, (pageWidth - 2 * PAGE_MARGIN) / realWidth, (pageHeight - 2 * PAGE_MARGIN) / realHeight);
  const width = realWidth * scale;
  const height = realHeight * scale;

  return {
    width: pageWidth,
    height: pageHeight,
    matrix: (ORIENTED_MATRICES[orientation] ?? ORIENTED_MATRICES[1])(
      (pageWidth - width) / 2,
      (pageHeight - height) / 2,
      width,
      height,
    ),
  };
}
