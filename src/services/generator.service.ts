import { v4 as uuidv4 } from 'uuid';
import { scrapingService } from './scraping.service.js';
import { aiService } from './ai.service.js';
import { vercelService } from './vercel.service.js';
import { databaseService } from './database.service.js';
import logger from '../utils/logger.js';
import type {
  GenerationRequest,
  GenerationResult,
  JobStatus,
} from '../types/index.js';

// In-memory job store (use Redis in production)
const jobs = new Map<string, GenerationResult>();

export class GeneratorService {
  
  /**
   * Start a new website generation job
   */
  async startGeneration(request: GenerationRequest): Promise<string> {
    const jobId = uuidv4();
    
    const job: GenerationResult = {
      id: jobId,
      status: 'pending',
      progress: 0,
      startedAt: new Date(),
    };
    
    jobs.set(jobId, job);
    
    // Run generation in background
    this.runGeneration(jobId, request).catch(err => {
      logger.error('Generation failed', { jobId, error: err.message });
      this.updateJob(jobId, {
        status: 'failed',
        error: err.message,
        completedAt: new Date(),
      });
    });
    
    return jobId;
  }
  
  /**
   * Get job status
   */
  getJobStatus(jobId: string): JobStatus | null {
    const job = jobs.get(jobId);
    if (!job) return null;
    
    return {
      id: job.id,
      status: job.status,
      progress: job.progress,
      currentStep: job.currentStep,
      result: job.deployment?.success ? {
        siteUrl: job.deployment.url,
        previewUrl: job.deployment.previewUrl,
        qualityScore: job.extractedData?.dataQuality.completenessScore,
      } : undefined,
      error: job.error,
    };
  }
  
  /**
   * Get full job result
   */
  getJobResult(jobId: string): GenerationResult | null {
    return jobs.get(jobId) || null;
  }
  
  /**
   * Run the full generation pipeline
   */
  private async runGeneration(jobId: string, request: GenerationRequest): Promise<void> {
    try {
      // Step 1: Scraping
      this.updateJob(jobId, {
        status: 'scraping',
        progress: 10,
        currentStep: 'Scraping data sources...',
      });
      
      const scrapedData = await scrapingService.scrapeAll({
        businessName: request.businessName,
        location: request.location,
        googleMapsUrl: request.googleMapsUrl,
        websiteUrl: request.websiteUrl,
        facebookUrl: request.facebookUrl,
        instagramUrl: request.instagramUrl,
      });
      
      this.updateJob(jobId, {
        scrapedData,
        progress: 30,
        currentStep: 'Data scraped successfully',
      });
      
      logger.info('Scraping complete', { 
        jobId,
        sourcesFound: {
          google: !!scrapedData.google?.name,
          website: !!scrapedData.website?.content,
          facebook: !!scrapedData.facebook?.name,
          instagram: !!scrapedData.instagram?.username,
        },
      });
      
      // Step 2: AI Extraction
      this.updateJob(jobId, {
        status: 'processing',
        progress: 40,
        currentStep: 'Extracting business information...',
      });
      
      let extractedData = await aiService.extractBusinessData(
        scrapedData,
        request.businessName,
        request.location
      );
      
      this.updateJob(jobId, {
        extractedData,
        progress: 55,
        currentStep: 'Business data extracted',
      });
      
      // Step 3: Gap Filling (if needed)
      if (extractedData.dataQuality.completenessScore < 70) {
        this.updateJob(jobId, {
          progress: 60,
          currentStep: 'Filling data gaps...',
        });
        
        extractedData = await aiService.fillGaps(extractedData);
        
        this.updateJob(jobId, {
          extractedData,
          progress: 70,
          currentStep: 'Data gaps filled',
        });
      }
      
      // Step 4: Website Generation
      this.updateJob(jobId, {
        status: 'generating',
        progress: 75,
        currentStep: 'Generating website...',
      });
      
      const html = await aiService.generateWebsite(extractedData);
      
      this.updateJob(jobId, {
        generatedSite: {
          html,
          metadata: {
            title: extractedData.business.name,
            description: extractedData.business.descriptionShort || '',
            sections: ['hero', 'services', 'about', 'testimonials', 'contact', 'footer'],
          },
        },
        progress: 85,
        currentStep: 'Website generated',
      });
      
      // Step 5: Deployment
      this.updateJob(jobId, {
        status: 'deploying',
        progress: 90,
        currentStep: 'Deploying to Vercel...',
      });
      
      const deployment = await vercelService.deploy(
        html,
        extractedData.business.name,
        extractedData
      );
      
      // Complete
      this.updateJob(jobId, {
        status: deployment.success ? 'complete' : 'failed',
        deployment,
        progress: 100,
        currentStep: deployment.success ? 'Deployment complete!' : 'Deployment failed',
        completedAt: new Date(),
        error: deployment.error,
      });
      
      logger.info('Generation complete', {
        jobId,
        success: deployment.success,
        url: deployment.url,
        qualityScore: extractedData.dataQuality.completenessScore,
      });

      // Save to database if available
      if (process.env.POSTGRES_URL) {
        try {
          await databaseService.createSite({
            jobId,
            name: extractedData.business.name,
            location: request.location,
            url: deployment.url,
            previewUrl: deployment.previewUrl,
            deployed: deployment.success,
            qualityScore: extractedData.dataQuality.completenessScore,
            businessData: extractedData as unknown as Record<string, unknown>,
            htmlContent: html,
          });
          logger.info('Site saved to database', { jobId });
        } catch (dbError) {
          logger.warn('Failed to save site to database', {
            jobId,
            error: (dbError as Error).message,
          });
        }
      }

    } catch (err) {
      throw err;
    }
  }
  
  /**
   * Update job state
   */
  private updateJob(jobId: string, updates: Partial<GenerationResult>): void {
    const job = jobs.get(jobId);
    if (job) {
      Object.assign(job, updates);
      jobs.set(jobId, job);
    }
  }
  
  /**
   * Clean up old jobs (call periodically)
   */
  cleanupOldJobs(maxAgeMs: number = 3600000): void {
    const now = Date.now();
    
    for (const [jobId, job] of jobs.entries()) {
      const age = now - job.startedAt.getTime();
      if (age > maxAgeMs) {
        jobs.delete(jobId);
        logger.debug('Cleaned up old job', { jobId });
      }
    }
  }
}

export const generatorService = new GeneratorService();
