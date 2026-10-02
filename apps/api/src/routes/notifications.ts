import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.ts';
import { requireAuth } from '../middleware/auth.ts';

export const notificationsRouter = Router();

const tokenSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

notificationsRouter.post('/token', requireAuth, async (req, res, next) => {
  try {
    const { token } = tokenSchema.parse(req.body);

    // Upsert the token for the user, reactivating it if it was previously deactivated
    await pool.query(
      `INSERT INTO push_tokens (user_id, token, is_active)
       VALUES ($1::uuid, $2, TRUE)
       ON CONFLICT (token) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         is_active = TRUE`,
      [req.user!.id, token]
    );

    res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
});
