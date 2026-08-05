import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.get("/login", (_req: Request, res: Response) => {
  res.render("login", { title: "登录" });
});

router.get("/", requireAuth, (req: Request, res: Response) => {
  if (req.session.isAdmin) {
    return res.redirect("/admin/courses");
  }
  res.redirect("/courses");
});

export default router;
