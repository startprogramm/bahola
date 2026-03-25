import { DefaultSession, DefaultUser } from "next-auth";
import { JWT, DefaultJWT } from "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      avatar: string | null;
      language: string;
      isNewUser: boolean;
      schoolId?: string | null;
      credits?: number;
      role?: string;
    } & DefaultSession["user"];
  }

  interface User extends DefaultUser {
    avatar: string | null;
    language?: string;
    isNewUser?: boolean;
    schoolId?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    avatar: string | null;
    language: string;
    isNewUser: boolean;
    schoolId?: string | null;
    credits?: number;
    role?: string;
  }
}
