// src/routes/authRoutes.js
import express from 'express';
import {
  register,
  login,
  getMe,
  updateProfile,
  updatePassword,
  logout,
} from '../controllers/authController.js';
import { protect } from '../middleware/auth.js';
import validation from '../middleware/validation.js';

const router = express.Router();

/**
 * Public
 */
router.post('/register', validation.validateSignup, register);
router.post('/login', validation.validateLogin, login);

/**
 * Protected
 */
router.get('/me', protect, getMe);
router.put('/profile', protect, validation.validateOptionalEmail, updateProfile);
router.put('/password', protect, validation.checkValidation, updatePassword);
router.post('/logout', protect, logout);

export default router;
