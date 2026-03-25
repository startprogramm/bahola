import { NextAuthOptions, getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import prisma from "./prisma";
import { PLAN_DETAILS } from "./subscription";
import {
  AppAccessError,
  assertCurrentAppAccess,
  getCurrentAppLoginUrl,
  getMaktabEnrollmentRequiredError,
  isCurrentAppMaktab,
} from "./app-access";

const GOOGLE_TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo";

interface GoogleTokenInfo {
  aud?: string;
  email?: string;
  email_verified?: string;
  name?: string;
  picture?: string;
}

interface VerifiedGoogleTokenInfo {
  email: string;
  name?: string;
  picture?: string;
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const buildLoginRedirectUrl = (message: string, loginUrl = getCurrentAppLoginUrl()): string =>
  `${loginUrl}?error=${encodeURIComponent(message)}`;

const getGoogleAllowedAudiences = (): string[] => {
  const audiences = [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_ANDROID_SERVER_CLIENT_ID,
  ].filter((value): value is string => Boolean(value && value.trim()));

  if (audiences.length === 0) {
    throw new Error("Google Sign-In is not configured. Set GOOGLE_CLIENT_ID.");
  }

  return audiences;
};

const verifyGoogleIdToken = async (
  idToken: string
): Promise<VerifiedGoogleTokenInfo> => {
  const audiences = getGoogleAllowedAudiences();

  const response = await fetch(
    `${GOOGLE_TOKEN_INFO_URL}?id_token=${encodeURIComponent(idToken)}`,
    {
      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error("Invalid Google token");
  }

  const tokenInfo = (await response.json()) as GoogleTokenInfo;

  if (!tokenInfo.email || tokenInfo.email_verified !== "true") {
    throw new Error("Google account email is not verified");
  }

  if (!tokenInfo.aud || !audiences.includes(tokenInfo.aud)) {
    throw new Error("Google token audience is not allowed");
  }

  return {
    email: tokenInfo.email,
    name: tokenInfo.name,
    picture: tokenInfo.picture,
  };
};

const upsertGoogleUser = async ({
  email,
  name,
  avatar,
}: {
  email: string;
  name: string;
  avatar: string | null;
}): Promise<{ user: any; isNew: boolean }> => {
  const normalizedEmail = normalizeEmail(email);

  const existingUser = await prisma.user.findFirst({
    where: {
      email: {
        equals: normalizedEmail,
        mode: "insensitive",
      },
    },
  });

  if (!existingUser) {
    if (isCurrentAppMaktab()) {
      throw getMaktabEnrollmentRequiredError();
    }

    const newUser = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name,
        avatar,
        credits: PLAN_DETAILS.FREE.credits,
      },
    });
    assertCurrentAppAccess(newUser);
    return { user: newUser, isNew: true };
  }

  assertCurrentAppAccess(existingUser);

  if (!existingUser.avatar && avatar) {
    const updated = await prisma.user.update({
      where: { id: existingUser.id },
      data: { avatar },
    });
    assertCurrentAppAccess(updated);
    return { user: updated, isNew: false };
  }

  return { user: existingUser, isNew: false };
};

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Email and password are required");
        }

        const normalizedEmail = normalizeEmail(credentials.email);

        const user = await prisma.user.findFirst({
          where: {
            email: {
              equals: normalizedEmail,
              mode: "insensitive",
            },
          },
        });

        if (!user || !user.password) {
          throw new Error("Invalid email or password");
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password,
          user.password
        );

        if (!isPasswordValid) {
          throw new Error("Invalid email or password");
        }

        assertCurrentAppAccess(user);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          avatar: user.avatar,
        };
      },
    }),
    CredentialsProvider({
      id: "google-id-token",
      name: "Google ID Token",
      credentials: {
        idToken: { label: "Google ID Token", type: "text" },
      },
      async authorize(credentials) {
        console.log("[GOOGLE-ID-TOKEN] authorize called, keys:", credentials ? Object.keys(credentials) : "null");
        const idToken = credentials?.idToken;
        if (!idToken) {
          console.log("[GOOGLE-ID-TOKEN] ERROR: no idToken");
          throw new Error("Google ID token is required");
        }
        console.log("[GOOGLE-ID-TOKEN] idToken length:", idToken.length);

        const tokenInfo = await verifyGoogleIdToken(idToken);
        console.log("[GOOGLE-ID-TOKEN] verified, email:", tokenInfo.email);
        const { user: dbUser, isNew } = await upsertGoogleUser({
          email: tokenInfo.email,
          name: tokenInfo.name || "User",
          avatar: tokenInfo.picture || null,
        });
        console.log("[GOOGLE-ID-TOKEN] user:", dbUser.id, "isNew:", isNew);

        return {
          id: dbUser.id,
          email: dbUser.email,
          name: dbUser.name,
          avatar: dbUser.avatar,
          isNewUser: isNew,
        };
      },
    }),
    CredentialsProvider({
      id: "auto-login",
      name: "Auto Login",
      credentials: {
        userId: { label: "User ID", type: "text" },
        token: { label: "Auto Login Token", type: "text" },
      },
      async authorize(credentials) {
        const userId = credentials?.userId;
        const token = credentials?.token;
        if (!userId || !token) {
          throw new Error("Invalid auto-login credentials");
        }

        const hashedToken = crypto
          .createHash("sha256")
          .update(token)
          .digest("hex");

        const user = await prisma.user.findUnique({
          where: { id: userId },
        });

        if (!user || user.verificationToken !== hashedToken) {
          throw new Error("Invalid or expired auto-login token");
        }

        if (!user.passwordResetExpires || new Date() > user.passwordResetExpires) {
          await prisma.user.update({
            where: { id: userId },
            data: {
              verificationToken: null,
              passwordResetExpires: null,
            },
          });
          throw new Error("Invalid or expired auto-login token");
        }

        assertCurrentAppAccess(user);

        // Clear the one-time token
        await prisma.user.update({
          where: { id: userId },
          data: {
            verificationToken: null,
            passwordResetExpires: null,
          },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          avatar: user.avatar,
          isNewUser: false,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      // Handle Google OAuth sign-in
      if (account?.provider === "google") {
        try {
          const { isNew } = await upsertGoogleUser({
            email: user.email!,
            name: user.name || "User",
            avatar: user.image || null,
          });
          (user as any).isNewUser = isNew;

          return true;
        } catch (error) {
          console.error("Error during Google sign-in:", error);
          if (error instanceof AppAccessError) {
            return buildLoginRedirectUrl(error.message, error.loginUrl);
          }
          return buildLoginRedirectUrl("Unable to sign in with Google.");
        }
      }

      return true;
    },
    async jwt({ token, user, account, trigger, session }) {
      // On initial sign-in, fetch user from database
      if (account && user) {
        let dbUser = null;
        if (user.email) {
          dbUser = await prisma.user.findFirst({
            where: {
              email: {
                equals: normalizeEmail(user.email),
                mode: "insensitive",
              },
            },
          });
        }
        // Fallback: look up by user.id (for auto-login or users without email)
        if (!dbUser && user.id) {
          dbUser = await prisma.user.findUnique({
            where: { id: user.id },
          });
        }

        if (dbUser) {
          token.id = dbUser.id;
          token.avatar = dbUser.avatar;
          token.credits = dbUser.credits;
          token.language = dbUser.language || "en";
          token.role = dbUser.role;
          token.schoolId = dbUser.schoolId;
        }

        // Determine isNewUser
        if (account.provider === "google") {
          // For Google OAuth web flow, check if account was just created
          token.isNewUser = dbUser
            ? (Date.now() - new Date(dbUser.createdAt).getTime()) < 60_000
            : false;
        } else {
          // For credentials providers (auto-login, google-id-token)
          token.isNewUser = (user as any).isNewUser === true;
        }
      }

      if (!account && !user && token.id && token.schoolId === undefined) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: {
            avatar: true,
            credits: true,
            language: true,
            role: true,
            schoolId: true,
          },
        });

        if (dbUser) {
          token.avatar = dbUser.avatar;
          token.credits = dbUser.credits;
          token.language = dbUser.language || "en";
          token.role = dbUser.role;
          token.schoolId = dbUser.schoolId;
        }
      }

      // Handle updates to the session
      if (trigger === "update" && session) {
        if (session.name !== undefined) token.name = session.name;
        if (session.avatar !== undefined) token.avatar = session.avatar;
        if (session.language !== undefined) token.language = session.language;
        if (session.isNewUser !== undefined) token.isNewUser = session.isNewUser;
        if (session.schoolId !== undefined) token.schoolId = session.schoolId;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        // Use data already stored in the JWT — no DB queries needed.
        // Token is populated during sign-in (jwt callback) and updated
        // via trigger === "update" when user data changes.
        session.user.id = (token.id as string) || (token.sub as string);
        session.user.avatar = token.avatar as string | null;
        session.user.language = (token.language as string) || "en";
        session.user.isNewUser = (token.isNewUser as boolean) || false;
        session.user.schoolId = (token.schoolId as string | null | undefined) ?? null;
        (session.user as any).credits = token.credits as number;
        session.user.role = token.role as string | undefined;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  secret: process.env.NEXTAUTH_SECRET,
};

export const getAuthSession = () => getServerSession(authOptions);
