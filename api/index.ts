import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import * as cheerio from 'cheerio';

const app = express();

// Apify client for design inspiration
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const APIFY_DRIBBBLE_ACTOR = 'practicaltools/dribbble-popular-shots';

interface DesignInspiration {
  title: string;
  imageUrl: string;
  colors: string[];
  tags: string[];
  creator: string;
}

// Fetch design inspiration from Dribbble via Apify (non-blocking with cache)
const inspirationCache = new Map<string, { data: DesignInspiration[]; timestamp: number }>();
const CACHE_TTL = 3600000; // 1 hour

async function fetchDesignInspiration(businessType: string): Promise<DesignInspiration[]> {
  if (!APIFY_TOKEN) return [];

  // Check cache first
  const cached = inspirationCache.get(businessType);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const searchQueries: Record<string, string> = {
    restaurant: 'restaurant website landing page',
    retail: 'ecommerce shop website',
    healthcare: 'medical clinic website',
    professional: 'law firm consulting website',
    creative: 'design agency portfolio',
    beauty: 'salon spa website',
    fitness: 'gym fitness website',
    general: 'small business website',
  };

  const query = searchQueries[businessType] || searchQueries.general;

  try {
    // Start the Apify actor run with webhook (fire and forget approach)
    const runResponse = await axios.post(
      `https://api.apify.com/v2/acts/${APIFY_DRIBBBLE_ACTOR}/runs?token=${APIFY_TOKEN}`,
      {
        startUrls: [{ url: `https://dribbble.com/search/${encodeURIComponent(query)}` }],
        maxItems: 4,
      },
      { timeout: 8000 } // Quick timeout - don't block generation
    );

    const runId = runResponse.data.data.id;

    // Quick poll - only 2 attempts (4 seconds total max)
    for (let i = 0; i < 2; i++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const statusResponse = await axios.get(
          `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`,
          { timeout: 3000 }
        );
        if (statusResponse.data.data.status === 'SUCCEEDED') {
          const datasetResponse = await axios.get(
            `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${APIFY_TOKEN}`,
            { timeout: 3000 }
          );
          const results = datasetResponse.data.slice(0, 4).map((item: any) => ({
            title: item.title || '',
            imageUrl: item.imageUrl || item.image || '',
            colors: item.colors || [],
            tags: item.tags || [],
            creator: item.user?.name || item.creator || '',
          }));
          inspirationCache.set(businessType, { data: results, timestamp: Date.now() });
          return results;
        }
        if (statusResponse.data.data.status === 'FAILED') return [];
      } catch { /* continue */ }
    }

    // If still running, return empty - don't block generation
    return [];
  } catch (error) {
    console.error('Apify fetch failed:', error);
    return [];
  }
}

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
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    features: {
      apifyInspiration: !!APIFY_TOKEN,
      anthropicAI: !!process.env.ANTHROPIC_API_KEY,
      vercelDeploy: !!process.env.VERCEL_TOKEN,
    }
  });
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

// Design system configurations by business type
const designSystems: Record<string, {
  fonts: { display: string; body: string; accent?: string };
  palette: { bg: string; surface: string; text: string; muted: string; primary: string; accent: string };
  style: string;
  heroStyle: string;
  effects: string[];
}> = {
  restaurant: {
    fonts: { display: 'Playfair Display', body: 'Source Sans 3', accent: 'Caveat' },
    palette: { bg: '#1a1814', surface: '#252119', text: '#f5f0e8', muted: '#9c9589', primary: '#c9a227', accent: '#8b2635' },
    style: 'warm-luxury',
    heroStyle: 'full-bleed image with elegant overlay gradient',
    effects: ['subtle grain texture', 'warm glow shadows', 'elegant dividers'],
  },
  retail: {
    fonts: { display: 'Syne', body: 'Work Sans' },
    palette: { bg: '#fafaf9', surface: '#ffffff', text: '#171717', muted: '#737373', primary: '#171717', accent: '#ea580c' },
    style: 'clean-modern',
    heroStyle: 'asymmetric product showcase with bold typography',
    effects: ['crisp shadows', 'hover scale transforms', 'marquee animations'],
  },
  healthcare: {
    fonts: { display: 'Plus Jakarta Sans', body: 'Nunito Sans' },
    palette: { bg: '#f0fdf4', surface: '#ffffff', text: '#14532d', muted: '#6b7280', primary: '#059669', accent: '#0891b2' },
    style: 'calm-professional',
    heroStyle: 'soft gradients with trust-building imagery',
    effects: ['gentle shadows', 'calming transitions', 'rounded corners'],
  },
  professional: {
    fonts: { display: 'Instrument Serif', body: 'Geist' },
    palette: { bg: '#09090b', surface: '#18181b', text: '#fafafa', muted: '#71717a', primary: '#a78bfa', accent: '#22d3ee' },
    style: 'dark-sophisticated',
    heroStyle: 'dramatic typography with subtle gradient mesh',
    effects: ['glass morphism', 'glow effects', 'smooth reveals'],
  },
  creative: {
    fonts: { display: 'Space Grotesk', body: 'Inter Tight' },
    palette: { bg: '#0c0a09', surface: '#1c1917', text: '#fafaf9', muted: '#a8a29e', primary: '#f97316', accent: '#eab308' },
    style: 'bold-editorial',
    heroStyle: 'oversized typography with dynamic grid breaking',
    effects: ['noise overlay', 'dramatic shadows', 'staggered animations'],
  },
  beauty: {
    fonts: { display: 'Cormorant Garamond', body: 'Lato' },
    palette: { bg: '#fdf4ff', surface: '#ffffff', text: '#581c87', muted: '#9ca3af', primary: '#c026d3', accent: '#f472b6' },
    style: 'soft-elegant',
    heroStyle: 'dreamy gradients with elegant serif headlines',
    effects: ['soft blurs', 'delicate shadows', 'fade transitions'],
  },
  fitness: {
    fonts: { display: 'Bebas Neue', body: 'Outfit' },
    palette: { bg: '#0f172a', surface: '#1e293b', text: '#f8fafc', muted: '#94a3b8', primary: '#22c55e', accent: '#eab308' },
    style: 'bold-energetic',
    heroStyle: 'high-contrast with diagonal elements and motion blur',
    effects: ['sharp angles', 'pulse animations', 'bold borders'],
  },
  general: {
    fonts: { display: 'DM Sans', body: 'IBM Plex Sans' },
    palette: { bg: '#ffffff', surface: '#f9fafb', text: '#111827', muted: '#6b7280', primary: '#2563eb', accent: '#7c3aed' },
    style: 'balanced-professional',
    heroStyle: 'clean layout with strong value proposition',
    effects: ['subtle shadows', 'smooth hovers', 'clean transitions'],
  },
};

function getDesignSystem(businessType: string): typeof designSystems.general {
  const type = businessType.toLowerCase();
  if (type.includes('restaurant') || type.includes('food') || type.includes('cafe') || type.includes('bar')) return designSystems.restaurant;
  if (type.includes('retail') || type.includes('shop') || type.includes('store') || type.includes('boutique')) return designSystems.retail;
  if (type.includes('health') || type.includes('medical') || type.includes('dental') || type.includes('clinic')) return designSystems.healthcare;
  if (type.includes('law') || type.includes('consulting') || type.includes('finance') || type.includes('accounting')) return designSystems.professional;
  if (type.includes('design') || type.includes('agency') || type.includes('studio') || type.includes('photo')) return designSystems.creative;
  if (type.includes('salon') || type.includes('spa') || type.includes('beauty') || type.includes('wellness')) return designSystems.beauty;
  if (type.includes('gym') || type.includes('fitness') || type.includes('sport') || type.includes('training')) return designSystems.fitness;
  return designSystems.general;
}

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

    // Scrape Google Maps if provided - enhanced extraction
    if (request.googleMapsUrl) {
      try {
        const response = await axios.get(request.googleMapsUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
          },
          maxRedirects: 5,
          timeout: 15000,
        });

        const $ = cheerio.load(response.data);

        // Basic meta extraction
        const googleData: any = {
          name: $('meta[property="og:title"]').attr('content') || request.businessName,
          description: $('meta[property="og:description"]').attr('content'),
          reviews: [],
          rating: null,
          reviewCount: null,
          address: null,
          phone: null,
          hours: null,
          categories: [],
        };

        // Try to extract embedded JSON data from script tags
        // Google Maps embeds business data in window.APP_INITIALIZATION_STATE or similar
        const scriptTags = $('script').toArray();
        for (const script of scriptTags) {
          const content = $(script).html() || '';

          // Look for review patterns in the page
          // Reviews often appear as arrays with rating, text, author
          const reviewPattern = /\["([^"]{20,500})","[^"]*",(\d),/g;
          let match;
          while ((match = reviewPattern.exec(content)) !== null && googleData.reviews.length < 8) {
            const reviewText = match[1];
            const rating = parseInt(match[2]);
            if (rating >= 1 && rating <= 5 && reviewText.length > 30) {
              googleData.reviews.push({
                text: reviewText.replace(/\\n/g, ' ').replace(/\\"/g, '"').substring(0, 300),
                rating: rating,
              });
            }
          }

          // Extract rating from meta or embedded data
          const ratingMatch = content.match(/(\d\.\d)\s*stars?|rating['":\s]+(\d\.\d)/i);
          if (ratingMatch && !googleData.rating) {
            googleData.rating = parseFloat(ratingMatch[1] || ratingMatch[2]);
          }

          // Extract review count
          const countMatch = content.match(/(\d{1,5})\s*reviews?/i);
          if (countMatch && !googleData.reviewCount) {
            googleData.reviewCount = parseInt(countMatch[1]);
          }

          // Look for phone numbers
          const phoneMatch = content.match(/["'](\+?[\d\s\-()]{10,20})["']/);
          if (phoneMatch && !googleData.phone) {
            googleData.phone = phoneMatch[1].trim();
          }
        }

        // Also try to extract from visible text patterns
        const pageText = $('body').text();

        // Rating from visible text
        if (!googleData.rating) {
          const visibleRating = pageText.match(/(\d\.\d)\s*\(\d+\s*reviews?\)/i);
          if (visibleRating) googleData.rating = parseFloat(visibleRating[1]);
        }

        // Review count from visible text
        if (!googleData.reviewCount) {
          const visibleCount = pageText.match(/\((\d{1,5})\s*reviews?\)/i);
          if (visibleCount) googleData.reviewCount = parseInt(visibleCount[1]);
        }

        scrapedData.google = googleData;
      } catch (err) {
        console.error('Google Maps scraping failed:', err);
      }
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

IMPORTANT: If the scraped Google data contains reviews, convert them into testimonials.
- Use the review text as the quote
- Generate a plausible first name + last initial for the author (e.g., "Sarah M.", "James T.")
- Use the rating from the review (1-5 stars)
- Include up to 6 of the best/most detailed reviews as testimonials

Return JSON (infer businessType from one of: restaurant, retail, healthcare, professional, creative, beauty, fitness, general):
{
  "business": { "name": "", "tagline": "", "descriptionShort": "", "descriptionLong": "", "businessType": "general" },
  "services": [{ "name": "", "description": "", "icon": "emoji" }],
  "uniqueSellingPoints": ["", "", ""],
  "testimonials": [{ "quote": "", "author": "", "rating": 5, "source": "Google" }],
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
    const extractedData = jsonMatch ? JSON.parse(jsonMatch[0]) : { business: { name: request.businessName, businessType: 'general' }, dataQuality: { completenessScore: 50 } };

    job.extractedData = extractedData;
    job.progress = 55;

    // Step 3: Fetch design inspiration from Dribbble (optional)
    job.currentStep = 'Gathering design inspiration...';
    const businessType = extractedData.business?.businessType || 'general';
    const designInspiration = await fetchDesignInspiration(businessType);
    job.progress = 65;

    // Step 4: Generate Website with sophisticated design system
    job.status = 'generating';
    job.progress = 70;
    job.currentStep = 'Crafting distinctive website...';

    const design = getDesignSystem(businessType);

    // Build inspiration context if available
    const inspirationContext = designInspiration.length > 0 ? `
## DESIGN INSPIRATION (from trending Dribbble shots)
Study these references for layout ideas, color combinations, and visual treatments:
${designInspiration.map((d, i) => `${i + 1}. "${d.title}" by ${d.creator}
   - Tags: ${d.tags.slice(0, 5).join(', ')}
   - Color palette hints: ${d.colors.slice(0, 4).join(', ') || 'N/A'}`).join('\n')}

Use these as INSPIRATION only - create something original that captures a similar level of craft.
` : '';

    const generatePrompt = `You are an elite web designer creating a DISTINCTIVE, production-grade single-page website.
AVOID generic "AI-generated" aesthetics. Create something memorable and intentional.

## BUSINESS DATA
${JSON.stringify(extractedData, null, 2)}
${inspirationContext}
## DESIGN SYSTEM (MANDATORY)
Style: ${design.style}
Typography:
- Display/Headlines: "${design.fonts.display}" (Google Fonts)
- Body text: "${design.fonts.body}" (Google Fonts)
${design.fonts.accent ? `- Accent/Handwritten: "${design.fonts.accent}" (Google Fonts)` : ''}

Color Palette (use CSS variables):
--color-bg: ${design.palette.bg}
--color-surface: ${design.palette.surface}
--color-text: ${design.palette.text}
--color-muted: ${design.palette.muted}
--color-primary: ${design.palette.primary}
--color-accent: ${design.palette.accent}

Hero Style: ${design.heroStyle}
Visual Effects: ${design.effects.join(', ')}

## TECHNICAL REQUIREMENTS
1. Use Tailwind CSS CDN with custom config extending the color palette
2. Load Google Fonts for the specified typography
3. Mobile-first responsive design
4. CSS animations: staggered fade-in on scroll, hover micro-interactions
5. Include JSON-LD LocalBusiness structured data
6. Complete meta tags (title, description, og:tags, twitter:cards)

## LAYOUT SECTIONS (in order)
1. **Navigation**: Sticky, minimal, with smooth scroll links. Logo left, links right.
2. **Hero**: ${design.heroStyle}. Bold headline with the tagline. Clear CTA button.
3. **Trust Bar**: Rating stars, review count, key differentiators in a subtle row.
4. **Services/Menu**: Grid or cards showcasing 3-6 key offerings with icons/emojis.
5. **About**: Split layout - compelling story on one side, key stats/highlights on other.
6. **Reviews/Testimonials**: IMPORTANT - Create an eye-catching testimonials section:
   - Use a card-based layout (2-3 columns on desktop, 1 on mobile)
   - Each card should display: star rating (use ★ filled and ☆ empty), the quote in elegant typography, author name, and "Google Review" badge
   - Add subtle background patterns or gradients to make this section visually distinct
   - Include a "See All Reviews" link to Google Maps if rating data exists
   - Use quote marks or decorative elements to frame each testimonial
   - Stagger card heights or use masonry layout for visual interest
7. **Contact**: Two-column - contact info/hours on left, simple form on right.
8. **Footer**: Logo, quick links, social icons, copyright.

## CRITICAL DESIGN RULES
- NO generic blue/purple gradients
- NO predictable symmetrical layouts - use intentional asymmetry
- Typography hierarchy: massive headlines (clamp sizes), comfortable body text
- Generous whitespace - let elements breathe
- Shadows should be atmospheric, not flat drop-shadows
- Buttons: distinctive styling that matches the aesthetic (not generic rounded pills)
- Images: use placeholder divs with background colors (will be replaced later)
- Micro-interactions on hover states for all interactive elements
- REVIEWS ARE SOCIAL PROOF: If testimonials exist, make that section visually prominent with:
  - Large decorative quotation marks (use CSS ::before/::after)
  - Star ratings using golden/yellow color for filled stars
  - Subtle card hover animations (lift/scale)
  - "Verified Google Review" badges with Google colors
  - Overall rating prominently displayed (e.g., "4.8 ★ from 127 reviews")

## OUTPUT
Return ONLY the complete HTML document starting with <!DOCTYPE html>. No markdown, no explanations.`;

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

    // Step 5: Deploy to Vercel
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
