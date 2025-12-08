import { Request } from "express";

declare global {
  namespace Express {
    interface Request {
      user?: {
        user_id: string;
        email: string;
        role: "super-admin" | "admin" | "user";
        department_id: string;
        sub_department_id?: string;
        first_name: string;
        last_name: string;
        is_active: boolean;
      };
    }
  }
}
