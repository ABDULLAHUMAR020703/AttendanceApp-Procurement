import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';

export const authRouter = Router();

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.auth });
});

