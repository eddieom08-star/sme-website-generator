import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const configSchema = z.object({
  PORT: z.string().default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  GOOGLE_PLACES_API_KEY: z.string().optional(),
  FIRECRAWL_API_KEY: z.string().optional(),
  APIFY_API_TOKEN: z.string().optional(),
  VERCEL_TOKEN: z.string().min(1, 'VERCEL_TOKEN is required'),
  VERCEL_TEAM_ID: z.string().optional(),
  TWENTY_FIRST_API_KEY: z.string().optional(),
  RATE_LIMIT_WINDOW_MS: z.string().default('900000'),
  RATE_LIMIT_MAX_REQUESTS: z.string().default('10'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

function loadConfig() {
  const result = configSchema.safeParse(process.env);
  
  if (!result.success) {
    console.error('Invalid configuration:', result.error.format());
    process.exit(1);
  }
  
  return {
    server: {
      port: parseInt(result.data.PORT, 10),
      nodeEnv: result.data.NODE_ENV,
      isDev: result.data.NODE_ENV === 'development',
      isProd: result.data.NODE_ENV === 'production',
    },
    api: {
      anthropic: result.data.ANTHROPIC_API_KEY,
      googlePlaces: result.data.GOOGLE_PLACES_API_KEY,
      firecrawl: result.data.FIRECRAWL_API_KEY,
      apify: result.data.APIFY_API_TOKEN,
      twentyFirst: result.data.TWENTY_FIRST_API_KEY,
    },
    vercel: {
      token: result.data.VERCEL_TOKEN,
      teamId: result.data.VERCEL_TEAM_ID,
    },
    rateLimit: {
      windowMs: parseInt(result.data.RATE_LIMIT_WINDOW_MS, 10),
      maxRequests: parseInt(result.data.RATE_LIMIT_MAX_REQUESTS, 10),
    },
    logging: {
      level: result.data.LOG_LEVEL,
    },
  };
}

export const config = loadConfig();
export type Config = typeof config;
