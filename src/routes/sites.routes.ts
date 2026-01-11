import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { databaseService } from '../services/database.service.js';
import logger from '../utils/logger.js';

const router = Router();

/**
 * GET /api/sites
 * List all sites
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const sites = await databaseService.getAllSites();
    res.json({
      sites: sites.map(site => ({
        id: site.id,
        jobId: site.job_id,
        name: site.name,
        location: site.location,
        url: site.url,
        previewUrl: site.preview_url,
        deployed: site.deployed,
        qualityScore: site.quality_score,
        createdAt: site.created_at,
        updatedAt: site.updated_at,
      })),
    });
  } catch (error) {
    logger.error('Failed to list sites', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to list sites' });
  }
});

/**
 * GET /api/sites/:id
 * Get site by ID
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const site = await databaseService.getSiteById(id);

    if (!site) {
      return res.status(404).json({ error: 'Site not found' });
    }

    res.json({
      id: site.id,
      jobId: site.job_id,
      name: site.name,
      location: site.location,
      url: site.url,
      previewUrl: site.preview_url,
      deployed: site.deployed,
      qualityScore: site.quality_score,
      businessData: site.business_data,
      createdAt: site.created_at,
      updatedAt: site.updated_at,
    });
  } catch (error) {
    logger.error('Failed to get site', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get site' });
  }
});

/**
 * DELETE /api/sites/:id
 * Delete a site
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = await databaseService.deleteSite(id);

    if (!deleted) {
      return res.status(404).json({ error: 'Site not found' });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete site', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to delete site' });
  }
});

/**
 * GET /api/sites/:id/leads
 * Get leads for a site
 */
router.get('/:id/leads', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const leads = await databaseService.getLeadsBySiteId(id);

    res.json({
      leads: leads.map(lead => ({
        id: lead.id,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        message: lead.message,
        source: lead.source,
        createdAt: lead.created_at,
      })),
    });
  } catch (error) {
    logger.error('Failed to get leads', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get leads' });
  }
});

// Lead submission validation
const leadSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Valid email is required'),
  phone: z.string().optional(),
  message: z.string().optional(),
  source: z.string().optional(),
});

/**
 * POST /api/sites/:id/leads
 * Submit a lead for a site
 */
router.post('/:id/leads', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const validation = leadSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.flatten(),
      });
    }

    const site = await databaseService.getSiteById(id);
    if (!site) {
      return res.status(404).json({ error: 'Site not found' });
    }

    const lead = await databaseService.createLead({
      siteId: id,
      ...validation.data,
    });

    logger.info('Lead captured', { siteId: id, email: lead.email });

    res.status(201).json({
      id: lead.id,
      message: 'Lead submitted successfully',
    });
  } catch (error) {
    logger.error('Failed to submit lead', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to submit lead' });
  }
});

export default router;
