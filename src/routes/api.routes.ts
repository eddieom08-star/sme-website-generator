import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { generatorService } from '../services/generator.service.js';
import logger from '../utils/logger.js';

const router = Router();

// Validation schema
const generateRequestSchema = z.object({
  businessName: z.string().min(1, 'Business name is required'),
  location: z.string().optional(),
  googleMapsUrl: z.string().url().optional().or(z.literal('')),
  websiteUrl: z.string().url().optional().or(z.literal('')),
  facebookUrl: z.string().url().optional().or(z.literal('')),
  instagramUrl: z.string().optional(), // Can be URL or @username
  linkedinUrl: z.string().url().optional().or(z.literal('')),
  additionalInfo: z.string().optional(),
});

/**
 * POST /api/generate
 * Start a new website generation job
 */
router.post('/generate', async (req: Request, res: Response) => {
  try {
    // Validate request
    const validation = generateRequestSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.flatten(),
      });
    }
    
    const request = validation.data;
    
    // Clean up empty strings
    const cleanedRequest = {
      businessName: request.businessName,
      location: request.location || undefined,
      googleMapsUrl: request.googleMapsUrl || undefined,
      websiteUrl: request.websiteUrl || undefined,
      facebookUrl: request.facebookUrl || undefined,
      instagramUrl: request.instagramUrl || undefined,
      linkedinUrl: request.linkedinUrl || undefined,
      additionalInfo: request.additionalInfo || undefined,
    };
    
    logger.info('Starting generation', { businessName: cleanedRequest.businessName });
    
    // Start generation job
    const jobId = await generatorService.startGeneration(cleanedRequest);
    
    res.status(202).json({
      jobId,
      message: 'Generation started',
      statusUrl: `/api/jobs/${jobId}`,
    });
    
  } catch (err) {
    logger.error('Generate endpoint error', { error: (err as Error).message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/jobs/:jobId
 * Get job status
 */
router.get('/jobs/:jobId', (req: Request, res: Response) => {
  const { jobId } = req.params;
  
  const status = generatorService.getJobStatus(jobId);
  
  if (!status) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  res.json(status);
});

/**
 * GET /api/jobs/:jobId/result
 * Get full job result
 */
router.get('/jobs/:jobId/result', (req: Request, res: Response) => {
  const { jobId } = req.params;
  
  const result = generatorService.getJobResult(jobId);
  
  if (!result) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  if (result.status !== 'complete' && result.status !== 'failed') {
    return res.status(202).json({ 
      message: 'Job still in progress',
      status: result.status,
      progress: result.progress,
    });
  }
  
  res.json(result);
});

/**
 * GET /api/jobs/:jobId/preview
 * Preview generated HTML locally
 */
router.get('/jobs/:jobId/preview', (req: Request, res: Response) => {
  const { jobId } = req.params;

  const result = generatorService.getJobResult(jobId);

  if (!result) {
    return res.status(404).send('<h1>Job not found</h1>');
  }

  if (!result.generatedSite?.html) {
    return res.status(202).send(`
      <html>
        <head><meta http-equiv="refresh" content="2"></head>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1>Generating website...</h1>
          <p>Status: ${result.status} (${result.progress}%)</p>
          <p>${result.currentStep || 'Processing...'}</p>
          <p><small>This page will refresh automatically</small></p>
        </body>
      </html>
    `);
  }

  res.setHeader('Content-Type', 'text/html');
  res.send(result.generatedSite.html);
});

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

export default router;
