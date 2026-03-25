import type { ErrorRequestHandler } from 'express';
import { AppError } from '../utils/errors';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = err instanceof AppError ? err.statusCode : 500;
  const message = err instanceof AppError ? err.message : 'Internal Server Error';

  const payload: Record<string, unknown> = { message };

  if (err instanceof AppError && err.details !== undefined && err.details !== null) {
    const d = err.details;
    if (typeof d === 'object' && !Array.isArray(d)) {
      Object.assign(payload, d as Record<string, unknown>);
    } else {
      payload.details = d;
    }
  }

  if (process.env.NODE_ENV !== 'production' && err instanceof Error && !(err instanceof AppError && err.details)) {
    payload.debug = err.message;
  }

  res.status(status).json(payload);
};

