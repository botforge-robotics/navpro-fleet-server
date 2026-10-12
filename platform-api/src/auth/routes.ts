import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "../db/pool";
import { HttpError, asyncHandler } from "../http/errors";
import type { Role } from "../models";
import { signToken } from "./jwt";
import { writeAudit } from "./middleware";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  role: Role;
};

export const authRouter = Router();

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { username, password } = loginSchema.parse(req.body);
    const { rows } = await pool.query<UserRow>(
      "SELECT id, username, password_hash, role FROM users WHERE username = $1",
      [username],
    );
    const user = rows[0];
    if (user === undefined || !(await bcrypt.compare(password, user.password_hash))) {
      throw new HttpError(401, "invalid credentials");
    }
    const token = signToken(user.id, user.username, [user.role]);
    await writeAudit(user.username, "login", "/api/v1/auth/login");
    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role },
    });
  }),
);
