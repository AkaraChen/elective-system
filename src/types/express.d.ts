declare module "express-session" {
  interface SessionData {
    userId: number;
    isAdmin: number;
  }
}
