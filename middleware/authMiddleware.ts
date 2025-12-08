import { NextFunction, Request, RequestHandler, Response } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { ApiResponse } from "../utils/ApiResponse.js";

// JWT Payload structure for Notification System
export interface AuthPayload extends JwtPayload {
  user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: "super-admin" | "admin" | "user";
  department_id: string;
  sub_department_id?: string;
  is_active: boolean;
}

// Middleware to verify JWT token from cookies
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

    // Set req.user with decoded payload
    req.user = {
      user_id: decoded.user_id,
      first_name: decoded.first_name,
      last_name: decoded.last_name,
      email: decoded.email,
      role: decoded.role,
      department_id: decoded.department_id,
      sub_department_id: decoded.sub_department_id,
      is_active: decoded.is_active,
    };

    next();
  } catch (error) {
    res
      .status(403)
      .json(new ApiResponse(403, null, "Invalid or expired token."));
  }
};

// Middleware for role-based authorization
const authorize = (...allowedRoles: string[]): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(403).json(new ApiResponse(403, null, "Unauthorized access."));
      return;
    }

    const { role } = req.user;

    // Check if user's role is in allowed roles
    if (!allowedRoles.includes(role)) {
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
