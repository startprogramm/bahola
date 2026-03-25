export type Platform = "bahola" | "maktab";

export function getPlatform(): Platform {
  return (process.env.APP_MODE as Platform) ||
    (process.env.NEXT_PUBLIC_APP_MODE as Platform) ||
    "bahola";
}

export function isMaktab(): boolean {
  return getPlatform() === "maktab";
}

export function isBahola(): boolean {
  return getPlatform() === "bahola";
}
