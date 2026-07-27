import type { DecodedIdToken } from "firebase-admin/auth";
import type { Logger } from "pino";

declare global {
  namespace Express {
    interface Request {
      auth: DecodedIdToken;
      id: string;
      log: Logger;
    }
  }
}

export {};
