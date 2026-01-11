import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import * as cheerio from 'cheerio';

const app = express();

// Middleware
app.use(cors());
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(express.json({ limit: '10mb' }));

// In-memory job store
const jobs = new Map<string, any>();

// Anthropic client
const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Validation schema
const generateRequestSchema = z.object({
  businessName: z.string().min(1, 'Business name is required'),
  location: z.string().optional(),
  googleMapsUrl: z.string().url().optional().or(z.literal('')),
  websiteUrl: z.string().url().optional().or(z.literal('')),
  facebookUrl: z.string().url().optional().or(z.literal('')),
  instagramUrl: z.string().optional(),
  linkedinUrl: z.string().url().optional().or(z.literal('')),
  additionalInfo: z.string().optional(),
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Generate endpoint
app.post('/api/generate', async (req, res) => {
  try {
    const validation = generateRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Validation failed', details: validation.error.flatten() });
    }

    const request = validation.data;
    const jobId = uuidv4();

    jobs.set(jobId, {
      id: jobId,
      status: 'pending',
      progress: 0,
      startedAt: new Date(),
    });

    // Start async generation
    runGeneration(jobId, request);

    res.status(202).json({
      jobId,
      message: 'Generation started',
      statusUrl: `/api/jobs/${jobId}`,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Job status endpoint
app.get('/api/jobs/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    currentStep: job.currentStep,
    result: job.deployment?.success ? {
      siteUrl: job.deployment.url,
      previewUrl: job.deployment.previewUrl,
      qualityScore: job.extractedData?.dataQuality?.completenessScore,
    } : undefined,
    error: job.error,
  });
});

// Preview endpoint
app.get('/api/jobs/:jobId/preview', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).send('<h1>Job not found</h1>');

  if (!job.generatedSite?.html) {
    return res.status(202).send(`
      <html>
        <head><meta http-equiv="refresh" content="2"></head>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1>Generating website...</h1>
          <p>Status: ${job.status} (${job.progress}%)</p>
          <p>${job.currentStep || 'Processing...'}</p>
        </body>
      </html>
    `);
  }

  res.setHeader('Content-Type', 'text/html');
  res.send(job.generatedSite.html);
});

// Generation logic
async function runGeneration(jobId: string, request: any) {
  const job = jobs.get(jobId);
  if (!job) return;

  try {
    // Step 1: Scraping
    job.status = 'scraping';
    job.progress = 10;
    job.currentStep = 'Scraping data sources...';

    const scrapedData: any = { additionalInfo: request.additionalInfo };

    // Scrape Google Maps if provided
    if (request.googleMapsUrl) {
      try {
        const response = await axios.get(request.googleMapsUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          maxRedirects: 5,
          timeout: 10000,
        });
        const $ = cheerio.load(response.data);
        scrapedData.google = {
          name: $('meta[property="og:title"]').attr('content') || request.businessName,
          description: $('meta[property="og:description"]').attr('content'),
        };
      } catch {}
    }

    // Scrape website if provided
    if (request.websiteUrl) {
      try {
        const response = await axios.get(request.websiteUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 10000,
        });
        const $ = cheerio.load(response.data);
        scrapedData.website = {
          title: $('title').text(),
          description: $('meta[name="description"]').attr('content'),
          content: $('body').text().substring(0, 5000),
        };
      } catch {}
    }

    job.scrapedData = scrapedData;
    job.progress = 30;

    // Step 2: AI Extraction
    job.status = 'processing';
    job.progress = 40;
    job.currentStep = 'Extracting business information...';

    const extractionPrompt = `You are a business data extraction specialist. Analyze and extract business info.

Business Name: ${request.businessName}
Location: ${request.location || 'Unknown'}

Scraped Data:
${JSON.stringify(scrapedData, null, 2)}

Return JSON:
{
  "business": { "name": "", "tagline": "", "descriptionShort": "", "descriptionLong": "", "businessType": "general" },
  "services": [{ "name": "", "description": "", "icon": "emoji" }],
  "uniqueSellingPoints": ["", "", ""],
  "testimonials": [{ "quote": "", "author": "", "rating": 5 }],
  "contact": { "phone": "", "email": "", "address": "", "city": "", "state": "" },
  "hours": { "Monday": "9am - 5pm" },
  "rating": { "score": 4.5, "count": 100 },
  "dataQuality": { "completenessScore": 0, "confidence": "medium" }
}`;

    const extractionResponse = await anthropicClient.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: extractionPrompt }],
    });

    const extractedText = extractionResponse.content[0].type === 'text' ? extractionResponse.content[0].text : '';
    const jsonMatch = extractedText.match(/\{[\s\S]*\}/);
    const extractedData = jsonMatch ? JSON.parse(jsonMatch[0]) : { business: { name: request.businessName }, dataQuality: { completenessScore: 50 } };

    job.extractedData = extractedData;
    job.progress = 60;

    // Step 3: Generate Website
    job.status = 'generating';
    job.progress = 70;
    job.currentStep = 'Generating website...';

    const colors = { primary: '#3b82f6', secondary: '#1d4ed8' };
    const generatePrompt = `Create a stunning, SEO-optimized single-page website HTML for:

${JSON.stringify(extractedData, null, 2)}

Requirements:
- Use Tailwind CSS CDN
- Color scheme: primary ${colors.primary}, secondary ${colors.secondary}
- Include: nav, hero, services, about, testimonials, contact form, footer
- Mobile responsive
- JSON-LD structured data
- Meta tags for SEO

Return ONLY the complete HTML document.`;

    const generateResponse = await anthropicClient.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16000,
      messages: [{ role: 'user', content: generatePrompt }],
    });

    let html = generateResponse.content[0].type === 'text' ? generateResponse.content[0].text : '';
    const htmlMatch = html.match(/```html\n?([\s\S]*?)```/) || html.match(/<!DOCTYPE[\s\S]*<\/html>/i);
    if (htmlMatch) html = htmlMatch[1] || htmlMatch[0];

    job.generatedSite = { html };
    job.progress = 85;

    // Step 4: Deploy to Vercel
    job.status = 'deploying';
    job.progress = 90;
    job.currentStep = 'Deploying to Vercel...';

    const projectName = request.businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 50);

    try {
      const deployResponse = await axios.post(
        'https://api.vercel.com/v13/deployments',
        {
          name: projectName,
          target: 'production',
          files: [
            { file: 'index.html', data: Buffer.from(html).toString('base64'), encoding: 'base64' },
            { file: 'robots.txt', data: Buffer.from(`User-agent: *\nAllow: /`).toString('base64'), encoding: 'base64' },
          ],
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.VERCEL_TOKEN}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        }
      );

      job.deployment = {
        success: true,
        url: `https://${deployResponse.data.url}`,
        previewUrl: `https://${projectName}.vercel.app`,
      };
    } catch (deployError: any) {
      job.deployment = {
        success: false,
        error: deployError.message,
      };
    }

    job.status = job.deployment?.success ? 'complete' : 'failed';
    job.progress = 100;
    job.currentStep = job.deployment?.success ? 'Deployment complete!' : 'Deployment failed';
    job.completedAt = new Date();

  } catch (err: any) {
    job.status = 'failed';
    job.error = err.message;
    job.completedAt = new Date();
  }
}

export default app;
