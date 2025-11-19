// src/utils/logger.js
import winston from 'winston';

// Log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack }) => {
    return stack
      ? `[${timestamp}] ${level.toUpperCase()}: ${message}\n${stack}`
      : `[${timestamp}] ${level.toUpperCase()}: ${message}`;
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: 'info',
  format: logFormat,
  transports: [
    // Console log
    new winston.transports.Console({
      format: winston.format.colorize({ all: true })
    }),

    // File log for errors
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error'
    }),

    // File log for all logs
    new winston.transports.File({
      filename: 'logs/combined.log'
    })
  ],
});

// If in development, show all logs with colors
if (process.env.NODE_ENV !== 'production') {
  logger.level = 'debug';
}

export default logger;
