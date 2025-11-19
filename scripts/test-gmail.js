// scripts/test-gmail.js
import dotenv from 'dotenv';
dotenv.config();
import nodemailer from 'nodemailer';

// Validate env
if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
  console.error("Missing GMAIL_USER or GMAIL_APP_PASSWORD in .env");
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,               // SSL port
  secure: true,            // true = use SSL/TLS
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

// test email
(async () => {
  try {
    const info = await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: process.env.TEST_TO,
      subject: "Gmail App Password Test",
      text: "This is a test email sent using Gmail + Node.js + App Password.",
    });

    console.log("✔ Email sent successfully!");
    console.log("Message ID:", info.messageId);
  } catch (err) {
    console.error("✖ Email send failed:");
    console.error(err);
  }
})();
