// src/routes/planRoutes.js
import express from 'express';
import { getPlans, getPlanById } from '../controllers/planController.js';
import validation from '../middleware/validation.js';

const router = express.Router();

/**
 * Public endpoints only — plans are fixed (Basic/Standard/Premium)
 */
router.get('/', getPlans);
router.get('/:id', validation.validateObjectId('id'), getPlanById);

export default router;
