import { NextFunction, Request, RequestHandler, Response } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { ApiResponse } from "../utils/ApiResponse.js";

// Match your JWT payload structure EXACTLY
export interface AuthPayload extends JwtPayload {
  user_id: string;
  full_name: string;
  email: string;
  role_id: string;
  role: string;
  company_id: string;
  company_name: string;
}

// ✅ Middleware to verify JWT token from cookies
const verifyToken: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const token = req.cookies?.token;

  if (!token) {
    res
      .status(401)
      .json(new ApiResponse(401, null, "Access denied. No token provided."));
    return;
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.SECRET_KEY as string
    ) as AuthPayload;
    req.user = decoded;
    next();
  } catch (error) {
    res
      .status(403)
      .json(new ApiResponse(403, null, "Invalid or expired token."));
  }
};

// ✅ Middleware for role-based authorization
const authorize = (...allowedRoles: string[]): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(403).json(new ApiResponse(403, null, "Unauthorized access."));
      return;
    }

    const { role_id, role } = req.user;

    // Check both role_id and role string
    if (!allowedRoles.includes(role_id) && !allowedRoles.includes(role)) {
      res
        .status(403)
        .json(
          new ApiResponse(403, null, "Forbidden. Insufficient permissions.")
        );
      return;
    }

    next();
  };
};

export { authorize, verifyToken };

