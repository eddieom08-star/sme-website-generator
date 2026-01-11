import axios from 'axios';
import crypto from 'crypto';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import type { DeploymentResult } from '../types/index.js';

const VERCEL_API = 'https://api.vercel.com';

export class VercelService {
  private headers: Record<string, string>;
  
  constructor() {
    this.headers = {
      'Authorization': `Bearer ${config.vercel.token}`,
      'Content-Type': 'application/json',
    };
  }
  
  /**
   * Deploy a website to Vercel
   */
  async deploy(
    html: string,
    projectName: string,
    businessData?: any
  ): Promise<DeploymentResult> {
    try {
      // Sanitize project name
      const sanitizedName = this.sanitizeProjectName(projectName);

      // Create or get project
      const projectId = await this.ensureProject(sanitizedName);

      // Prepare files
      const files = this.prepareFiles(html, sanitizedName, businessData);
      
      // Create deployment
      const deployment = await this.createDeployment(projectId, sanitizedName, files);
      
      // Wait for deployment to be ready
      const finalStatus = await this.waitForDeployment(deployment.id);
      
      if (finalStatus.readyState === 'READY') {
        logger.info('Deployment successful', {
          url: finalStatus.url,
          projectId,
          deploymentId: deployment.id,
        });

        return {
          success: true,
          url: `https://${finalStatus.url}`,
          previewUrl: `https://${sanitizedName}.vercel.app`,
          projectId,
          deploymentId: deployment.id,
        };
      } else {
        const errMsg = finalStatus.errorMessage || finalStatus.readyState;
        throw new Error(`Deployment failed: ${errMsg}`);
      }
      
    } catch (err) {
      const error = err as Error;
      logger.error('Vercel deployment failed', { error: error.message });
      
      return {
        success: false,
        error: error.message,
      };
    }
  }
  
  /**
   * Sanitize project name for Vercel
   */
  private sanitizeProjectName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50);
  }
  
  /**
   * Ensure project exists, create if not
   */
  private async ensureProject(name: string): Promise<string> {
    try {
      // Try to create project
      const response = await axios.post(
        `${VERCEL_API}/v9/projects`,
        {
          name,
          framework: null,
        },
        { headers: this.headers }
      );
      
      logger.info('Created new Vercel project', { name, id: response.data.id });
      return response.data.id;
      
    } catch (err: any) {
      // If project exists, get it
      if (err.response?.status === 409 || err.response?.data?.error?.code === 'project_exists') {
        try {
          const getResponse = await axios.get(
            `${VERCEL_API}/v9/projects/${name}`,
            { headers: this.headers }
          );
          
          logger.info('Using existing Vercel project', { name, id: getResponse.data.id });
          return getResponse.data.id;
          
        } catch {
          // If we can't get the project, just use the name as ID
          return name;
        }
      }
      
      throw err;
    }
  }
  
  /**
   * Prepare files for deployment
   */
  private prepareFiles(html: string, projectName: string, businessData?: any): Array<{
    file: string;
    data: string;
    encoding: string;
  }> {
    // Main HTML
    const htmlBuffer = Buffer.from(html, 'utf-8');

    // Vercel config - use rewrites instead of routes (can't mix routes with headers)
    const vercelConfig = JSON.stringify({
      version: 2,
      rewrites: [
        { source: '/(.*)', destination: '/index.html' },
      ],
      headers: [
        {
          source: '/(.*)',
          headers: [
            { key: 'X-Content-Type-Options', value: 'nosniff' },
            { key: 'X-Frame-Options', value: 'DENY' },
            { key: 'X-XSS-Protection', value: '1; mode=block' },
          ],
        },
      ],
    }, null, 2);

    // Robots.txt - include llms.txt for AI crawlers
    const robotsTxt = `User-agent: *
Allow: /
Sitemap: https://${projectName}.vercel.app/sitemap.xml

# LLM Crawlers
User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: Anthropic-AI
Allow: /

User-agent: Claude-Web
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Cohere-ai
Allow: /`;

    // Sitemap
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://${projectName}.vercel.app/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`;

    // llms.txt - structured info for LLM crawlers (per llmstxt.org spec)
    const businessName = businessData?.business?.name || projectName;
    const description = businessData?.business?.descriptionLong || businessData?.business?.descriptionShort || '';
    const services = businessData?.services?.map((s: any) => `- ${s.name}: ${s.description}`).join('\n') || '';
    const contact = businessData?.contact || {};
    const address = [contact.address, contact.city, contact.state, contact.zip].filter(Boolean).join(', ');

    const llmsTxt = `# ${businessName}

> ${businessData?.business?.tagline || 'Local Business'}

${description}

## Services
${services || 'Contact us for more information about our services.'}

## Contact Information
${contact.phone ? `- Phone: ${contact.phone}` : ''}
${contact.email ? `- Email: ${contact.email}` : ''}
${address ? `- Address: ${address}` : ''}

## Business Hours
${businessData?.hours ? Object.entries(businessData.hours).map(([day, time]) => `- ${day}: ${time}`).join('\n') : 'Contact us for hours of operation.'}

## About
${businessData?.business?.descriptionLong || description || `${businessName} is a local business serving the community.`}

${businessData?.uniqueSellingPoints?.length ? `## Why Choose Us\n${businessData.uniqueSellingPoints.map((usp: string) => `- ${usp}`).join('\n')}` : ''}

---
Website: https://${projectName}.vercel.app
`;

    return [
      {
        file: 'index.html',
        data: htmlBuffer.toString('base64'),
        encoding: 'base64',
      },
      {
        file: 'vercel.json',
        data: Buffer.from(vercelConfig).toString('base64'),
        encoding: 'base64',
      },
      {
        file: 'robots.txt',
        data: Buffer.from(robotsTxt).toString('base64'),
        encoding: 'base64',
      },
      {
        file: 'sitemap.xml',
        data: Buffer.from(sitemap).toString('base64'),
        encoding: 'base64',
      },
      {
        file: 'llms.txt',
        data: Buffer.from(llmsTxt).toString('base64'),
        encoding: 'base64',
      },
    ];
  }
  
  /**
   * Create a deployment
   */
  private async createDeployment(
    projectId: string,
    projectName: string,
    files: Array<{ file: string; data: string; encoding: string }>
  ): Promise<{ id: string; url: string }> {
    const response = await axios.post(
      `${VERCEL_API}/v13/deployments`,
      {
        name: projectName,
        project: projectId,
        target: 'production',
        files,
        projectSettings: {
          framework: null,
        },
      },
      {
        headers: this.headers,
        timeout: 60000,
      }
    );
    
    logger.info('Deployment created', { 
      id: response.data.id, 
      url: response.data.url,
    });
    
    return {
      id: response.data.id,
      url: response.data.url,
    };
  }
  
  /**
   * Wait for deployment to be ready
   */
  private async waitForDeployment(
    deploymentId: string,
    maxWaitMs: number = 120000
  ): Promise<{ readyState: string; url: string; errorMessage?: string }> {
    const startTime = Date.now();
    const pollIntervalMs = 3000;

    while (Date.now() - startTime < maxWaitMs) {
      const response = await axios.get(
        `${VERCEL_API}/v13/deployments/${deploymentId}`,
        { headers: this.headers }
      );

      const { readyState, url, errorMessage, errorCode, errorStep } = response.data;

      logger.debug('Deployment status check', { deploymentId, readyState, errorMessage, errorCode });

      if (readyState === 'READY') {
        return { readyState, url };
      }

      if (readyState === 'ERROR') {
        const errDetails = errorMessage || errorCode || errorStep || 'Unknown error';
        logger.error('Deployment error details', { deploymentId, errorMessage, errorCode, errorStep });
        return { readyState, url, errorMessage: errDetails };
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error('Deployment timeout');
  }
  
  /**
   * Delete a project (for cleanup)
   */
  async deleteProject(projectId: string): Promise<void> {
    try {
      await axios.delete(
        `${VERCEL_API}/v9/projects/${projectId}`,
        { headers: this.headers }
      );
      logger.info('Project deleted', { projectId });
    } catch (err) {
      logger.warn('Failed to delete project', { projectId, error: (err as Error).message });
    }
  }
}

export const vercelService = new VercelService();
