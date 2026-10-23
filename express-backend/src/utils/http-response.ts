import type { Response } from "express";

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export const sendSuccess = <T>(res: Response, data: T, statusCode = 200, meta?: PaginationMeta) =>
  res.status(statusCode).json(meta ? { success: true, data, meta } : { success: true, data });
