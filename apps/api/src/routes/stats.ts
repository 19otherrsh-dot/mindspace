import { Router } from 'express';
import { requireAuth } from '../middleware/auth.ts';
import { getStatsSummary } from '../services/stats.ts';

export const statsRouter = Router();

/** GET /stats — everything the Stats dashboard renders (screen 14). */
statsRouter.get('/', requireAuth, async (req, res) => {
  const user = req.user!;
  res.json(await getStatsSummary(user.id, user.timezone));
});
