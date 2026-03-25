/**
 * Google Classroom-style class banner configurations
 * 15 pre-made designs with color gradients and 5 shape patterns
 */

export interface ClassBanner {
  id: string;
  name: string;
  gradient: string;
}

export const CLASS_BANNERS: ClassBanner[] = [
  {
    id: "1",
    name: "Rose Pink",
    gradient: "linear-gradient(135deg, #E91E63 0%, #C2185B 100%)",
  },
  {
    id: "2",
    name: "Ocean Blue",
    gradient: "linear-gradient(135deg, #2196F3 0%, #1565C0 100%)",
  },
  {
    id: "3",
    name: "Forest Green",
    gradient: "linear-gradient(135deg, #4CAF50 0%, #2E7D32 100%)",
  },
  {
    id: "4",
    name: "Purple Galaxy",
    gradient: "linear-gradient(135deg, #9C27B0 0%, #4A148C 100%)",
  },
  {
    id: "5",
    name: "Orange Sunset",
    gradient: "linear-gradient(135deg, #FF9800 0%, #E65100 100%)",
  },
  {
    id: "6",
    name: "Teal Wave",
    gradient: "linear-gradient(135deg, #009688 0%, #004D40 100%)",
  },
  {
    id: "7",
    name: "Cherry Red",
    gradient: "linear-gradient(135deg, #F44336 0%, #B71C1C 100%)",
  },
  {
    id: "8",
    name: "Midnight",
    gradient: "linear-gradient(135deg, #37474F 0%, #1C313A 100%)",
  },
  {
    id: "9",
    name: "Math Blue",
    gradient: "linear-gradient(135deg, #1A237E 0%, #283593 100%)",
  },
];

/**
 * Shape patterns for banners (1-5)
 */
export const BANNER_SHAPES = [1, 2, 3, 4, 5, 6];

/**
 * Get a random banner ID with shape (format: "bannerId-shapeId")
 */
export function getRandomBannerId(): string {
  const randomBannerIndex = Math.floor(Math.random() * CLASS_BANNERS.length);
  const randomShapeIndex = Math.floor(Math.random() * BANNER_SHAPES.length);
  return `${CLASS_BANNERS[randomBannerIndex].id}-${BANNER_SHAPES[randomShapeIndex]}`;
}

/**
 * Parse banner style string to get banner ID and shape ID
 */
export function parseBannerStyle(bannerStyle: string | null | undefined): { bannerId: string; shapeId: number } {
  if (!bannerStyle) {
    return { bannerId: "1", shapeId: 1 };
  }

  const parts = bannerStyle.split("-");
  const bannerId = parts[0] || "1";
  const shapeId = parseInt(parts[1]) || 1;

  return { bannerId, shapeId };
}

/**
 * Get banner configuration by ID
 */
export function getBannerById(id: string | null | undefined): ClassBanner {
  const banner = CLASS_BANNERS.find((b) => b.id === id);
  return banner || CLASS_BANNERS[0]; // Default to first banner if not found
}

/**
 * Get banner gradient style for a class
 */
export function getBannerStyle(bannerStyle: string | null | undefined): string {
  const { bannerId } = parseBannerStyle(bannerStyle);
  const banner = getBannerById(bannerId);
  return banner.gradient;
}

/**
 * Get shape ID from banner style
 */
export function getBannerShapeId(bannerStyle: string | null | undefined): number {
  const { shapeId } = parseBannerStyle(bannerStyle);
  return shapeId;
}
