import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { apiRouter } from './routes';

export function createApp() {
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: false, // disable CSP for now to allow API calls
    }),
  );
  app.use(
    cors({
      origin: '*', // allow all for now (can restrict later)
    }),
  );
  app.use(
    pinoHttp({
      level: env.NODE_ENV === 'development' ? 'debug' : 'info',
    }),
  );

  app.use(express.json({ limit: '10mb' }));

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api', apiRouter);
  app.use(errorHandler);

  return app;
}

