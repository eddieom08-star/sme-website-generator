import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';

import { config } from './config/index.js';
import apiRoutes from './routes/api.routes.js';
import sitesRoutes from './routes/sites.routes.js';
import logger from './utils/logger.js';
import { generatorService } from './services/generator.service.js';
import { databaseService } from './services/database.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Trust proxy (for Render, Heroku, etc.)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.tailwindcss.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// CORS
app.use(cors({
  origin: config.server.isDev ? '*' : process.env.ALLOWED_ORIGINS?.split(','),
  methods: ['GET', 'POST'],
}));

// Request logging
app.use(morgan('combined', {
  stream: { write: (message) => logger.info(message.trim()) },
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// API routes
app.use('/api', apiRoutes);
app.use('/api/sites', sitesRoutes);

// Serve static frontend
app.use(express.static(path.join(__dirname, '../public')));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// Cleanup interval
setInterval(() => {
  generatorService.cleanupOldJobs();
}, 300000); // Every 5 minutes

// Start server
const PORT = config.server.port;

async function startServer() {
  // Initialize database if connection string is available
  if (process.env.POSTGRES_URL) {
    try {
      await databaseService.initialize();
      logger.info('📦 Database connected');
    } catch (error) {
      logger.warn('⚠️ Database initialization failed, using in-memory storage', {
        error: (error as Error).message,
      });
    }
  } else {
    logger.info('📦 No database configured, using in-memory storage');
  }

  app.listen(PORT, () => {
    logger.info(`🚀 Server running on port ${PORT}`);
    logger.info(`📊 Environment: ${config.server.nodeEnv}`);
    logger.info(`🔗 Health check: http://localhost:${PORT}/api/health`);
  });
}

startServer();

export default app;
