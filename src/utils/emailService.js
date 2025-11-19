// src/utils/emailService.js
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import logger from './logger.js';

dotenv.config();

const FROM = process.env.EMAIL_FROM ;
const PASS = process.env.EMAIL_PASS ;

if (!FROM || !PASS) {
  logger.warn('Email service: EMAIL_FROM or EMAIL_PASS not provided in env. Email sending will fail until set.');
}


const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,               // SSL port
  secure: true,            // true = use SSL/TLS
  auth: {
    user: FROM,
    pass: PASS,
  },
});


/**
 * Generic send email
 * mail: { to, subject, text, html, attachments }
 */
export const sendEmail = async ({ to, subject, text, html, attachments = [] }) => {
  const mailOptions = {
    from: FROM,
    to,
    subject,
    text,
    html,
    attachments,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info('Email sent', { to, subject, messageId: info.messageId });
    return info;
  } catch (err) {
    // log full error object but avoid dumping secrets
    logger.error('Email send failed', { to, subject, error: err?.message || err });
    throw err;
  }
};

/**
 * Send invoice email with attachment buffer
 * { to, invoiceBuffer, invoiceName = 'invoice.pdf', subject, text }
 */
export const sendInvoiceEmail = async ({ to, invoiceBuffer, invoiceName = 'invoice.pdf', subject, text }) => {
  return sendEmail({
    to,
    subject: subject || 'Your Invoice',
    text: text || 'Please find your invoice attached.',
    attachments: [{ filename: invoiceName, content: invoiceBuffer }],
  });
};

export default { sendEmail, sendInvoiceEmail };
