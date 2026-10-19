import NextAuth, { type NextAuthOptions } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { compare } from 'bcryptjs';
import { db } from './db';
import { rateLimit } from './rate-limit';
export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt', maxAge: 3600 },
  providers: [
    Credentials({
      name: 'Email',
      credentials: { email: { type: 'email' }, password: { type: 'password' } },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;
        if (credentials.email.length > 254 || Buffer.byteLength(credentials.password, 'utf8') > 72)
          return null;
        try {
          await rateLimit(`login:${credentials.email.trim().toLowerCase()}`, 10, 900);
        } catch {
          return null;
        }
        const user = await db.user.findUnique({
          where: { email: credentials.email.trim().toLowerCase() },
        });
        if (
          !user ||
          user.suspendedAt ||
          user.isSample ||
          !(await compare(credentials.password, user.passwordHash))
        )
          return null;
        return { id: user.id, email: user.email, authVersion: user.authVersion };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.authVersion = (user as { authVersion?: number }).authVersion;
      }
      if (token.sub) {
        const account = await db.user.findUnique({
          where: { id: token.sub },
          select: { authVersion: true, suspendedAt: true, isSample: true },
        });
        if (
          !account ||
          account.suspendedAt ||
          account.isSample ||
          account.authVersion !== token.authVersion
        )
          delete token.sub;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) (session.user as { id?: string }).id = token.sub;
      return session;
    },
  },
};
export const authHandler = NextAuth(authOptions);
