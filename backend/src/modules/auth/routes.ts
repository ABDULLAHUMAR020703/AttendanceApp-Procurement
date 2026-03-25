import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';

export const authRouter = Router();

authRouter.get('/', (_req, res) => {
  res.json({
    message: 'Auth API is working. Use Supabase client for authentication.'
  });
});

authRouter.post('/login', (_req, res) => {
  return res.status(200).json({
    message: 'Login handled via Supabase client. This endpoint is a placeholder.'
  });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.auth });
});

