import { isMaktab } from "./platform";

export const PUBLIC_APP_LOGIN_URL = "https://bahola.uz/login";
export const MAKTAB_APP_LOGIN_URL = "https://maktab.bahola.uz/login";

export type AppAccessUser = {
  id?: string | null;
  email?: string | null;
  schoolId?: string | null;
};

function hasCrossAppBypass(_user: AppAccessUser): boolean {
  return false;
}

export class AppAccessError extends Error {
  loginUrl: string;

  constructor(message: string, loginUrl: string) {
    super(message);
    this.name = "AppAccessError";
    this.loginUrl = loginUrl;
  }
}

export function isCurrentAppMaktab(): boolean {
  return isMaktab();
}

export function getCurrentAppLoginUrl(): string {
  return isMaktab() ? MAKTAB_APP_LOGIN_URL : PUBLIC_APP_LOGIN_URL;
}

export function isMaktabAccount(user: AppAccessUser): boolean {
  return Boolean(user.schoolId);
}

export function getCrossAppAccessViolation(
  user: AppAccessUser
): AppAccessError | null {
  if (hasCrossAppBypass(user)) {
    return null;
  }

  const maktabAccount = isMaktabAccount(user);

  if (maktabAccount === isMaktab()) {
    return null;
  }

  if (maktabAccount) {
    return new AppAccessError(
      `This account belongs to maktab.bahola.uz. Please sign in at ${MAKTAB_APP_LOGIN_URL}.`,
      MAKTAB_APP_LOGIN_URL
    );
  }

  return new AppAccessError(
    `This account belongs to bahola.uz. Please sign in at ${PUBLIC_APP_LOGIN_URL}.`,
    PUBLIC_APP_LOGIN_URL
  );
}

export function assertCurrentAppAccess(user: AppAccessUser): void {
  const violation = getCrossAppAccessViolation(user);
  if (violation) {
    throw violation;
  }
}

export function getMaktabEnrollmentRequiredError(): AppAccessError {
  return new AppAccessError(
    `This account is not linked to a school. Please sign in at ${PUBLIC_APP_LOGIN_URL} or contact your school administrator.`,
    PUBLIC_APP_LOGIN_URL
  );
}

export function getMaktabRegistrationBlockedError(): AppAccessError {
  return new AppAccessError(
    "Self-registration is disabled on maktab.bahola.uz. Please contact your school administrator.",
    MAKTAB_APP_LOGIN_URL
  );
}
