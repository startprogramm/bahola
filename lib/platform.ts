export type Platform = "teztekshir" | "maktab";

export function getPlatform(): Platform {
  return (process.env.APP_MODE as Platform) ||
    (process.env.NEXT_PUBLIC_APP_MODE as Platform) ||
    "teztekshir";
}

export function isMaktab(): boolean {
  return getPlatform() === "maktab";
}

export function isTeztekshir(): boolean {
  return getPlatform() === "teztekshir";
}
