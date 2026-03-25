import type { UserRole } from '../modules/auth/types';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        role: UserRole;
        department?: string | null;
        name?: string | null;
        email?: string | null;
      };
    }
  }
}

export {};

