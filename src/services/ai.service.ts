import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import type { ScrapedData, ExtractedBusinessData } from '../types/index.js';

const client = new Anthropic({ apiKey: config.api.anthropic });

export class AIService {
  async extractBusinessData(scrapedData: ScrapedData, businessName: string, location?: string): Promise<ExtractedBusinessData> {
    const prompt = `You are a business data extraction specialist. Analyze the scraped data and extract normalized business information.

Business Name: ${businessName}
Location: ${location || 'Unknown'}

Scraped Data:
${JSON.stringify(scrapedData, null, 2)}

Extract and return a JSON object with this structure:
{
  "business": { "name": "", "tagline": "", "descriptionShort": "", "descriptionLong": "", "yearEstablished": "", "businessType": "restaurant|trades|professional|retail|creative|health|general" },
  "services": [{ "name": "", "description": "", "icon": "emoji" }],
  "uniqueSellingPoints": ["", "", ""],
  "testimonials": [{ "quote": "", "author": "", "rating": 5, "source": "" }],
  "contact": { "phone": "", "email": "", "address": "", "city": "", "state": "", "zip": "", "country": "" },
  "hours": { "Monday": "9am - 5pm" },
  "socialLinks": { "facebook": "", "instagram": "", "twitter": "", "linkedin": "" },
  "rating": { "score": 4.5, "count": 100 },
  "imagery": { "logo": "", "hero": "", "gallery": [] },
  "dataQuality": { "completenessScore": 0, "missingCritical": [], "missingNiceToHave": [], "sourcesUsed": [], "confidence": "high|medium|low" }
}

Rules:
1. Use actual data, don't invent facts
2. Generate tagline/descriptions if not found based on business type
3. Include all testimonials found (max 10)
4. Rate data quality honestly

Return ONLY valid JSON.`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    if (content.type !== 'text') throw new Error('Unexpected response type');

    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');

    const extracted = JSON.parse(jsonMatch[0]) as ExtractedBusinessData;
    logger.info('Business data extracted', { businessName: extracted.business.name, qualityScore: extracted.dataQuality.completenessScore });
    return extracted;
  }

  async fillGaps(extractedData: ExtractedBusinessData): Promise<ExtractedBusinessData> {
    const missing = [...extractedData.dataQuality.missingCritical, ...extractedData.dataQuality.missingNiceToHave];
    if (missing.length === 0 || extractedData.dataQuality.completenessScore >= 80) return extractedData;

    const prompt = `You are a professional copywriter for small business websites.

Current Data:
${JSON.stringify(extractedData, null, 2)}

Missing Fields: ${missing.join(', ')}

Generate content to fill gaps. Rules:
1. Never invent factual claims
2. Expand generic services with typical offerings for this business type
3. Keep tone professional but friendly

Return JSON with ONLY fields that need filling:
{ "business": { ... }, "services": [...], "uniqueSellingPoints": [...] }`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    if (content.type !== 'text') return extractedData;

    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return extractedData;

    const gapContent = JSON.parse(jsonMatch[0]);
    const merged = this.deepMerge(extractedData, gapContent);
    merged.dataQuality.completenessScore = Math.min(100, extractedData.dataQuality.completenessScore + 15);

    logger.info('Gap filling complete', { newScore: merged.dataQuality.completenessScore });
    return merged;
  }

  async generateWebsite(businessData: ExtractedBusinessData): Promise<string> {
    const colorSchemes: Record<string, { primary: string; secondary: string }> = {
      trades: { primary: '#2563eb', secondary: '#1e40af' },
      restaurant: { primary: '#dc2626', secondary: '#991b1b' },
      professional: { primary: '#1e3a5a', secondary: '#0f172a' },
      health: { primary: '#0d9488', secondary: '#065f46' },
      creative: { primary: '#7c3aed', secondary: '#5b21b6' },
      retail: { primary: '#059669', secondary: '#047857' },
      general: { primary: '#3b82f6', secondary: '#1d4ed8' },
    };

    const colors = colorSchemes[businessData.business.businessType] || colorSchemes.general;
    const location = businessData.contact.city && businessData.contact.state
      ? `${businessData.contact.city}, ${businessData.contact.state}`
      : businessData.contact.city || '';

    const prompt = `Create a stunning, SEO-optimized single-page website HTML for this business:

${JSON.stringify(businessData, null, 2)}

CRITICAL SEO & LLM SEARCHABILITY REQUIREMENTS:

1. HEAD SECTION - Include ALL of these:
   - <title> with business name, primary service, and location
   - <meta name="description"> (150-160 chars, compelling, includes location)
   - <meta name="keywords"> with relevant business keywords
   - <meta name="author" content="${businessData.business.name}">
   - <meta name="robots" content="index, follow, max-image-preview:large">
   - <link rel="canonical" href="/">

   Open Graph tags:
   - og:title, og:description, og:type="website", og:locale="en_US"
   - og:site_name="${businessData.business.name}"

   Twitter Card tags:
   - twitter:card="summary_large_image", twitter:title, twitter:description

2. JSON-LD STRUCTURED DATA - Include in <script type="application/ld+json">:
   - LocalBusiness schema with: @type based on business type, name, description, address, telephone, openingHours, aggregateRating, geo coordinates if available
   - BreadcrumbList schema
   - FAQPage schema with 3-5 relevant FAQs about the business

3. SEMANTIC HTML STRUCTURE:
   - Use <header>, <nav>, <main>, <article>, <section>, <aside>, <footer>
   - Each section needs proper <h1>, <h2>, <h3> hierarchy (only ONE h1)
   - Use <address> for contact info
   - All images need descriptive alt text

4. LLM-FRIENDLY CONTENT:
   - Clear, factual statements about services and business
   - Include specific details: service areas, specializations, experience
   - Use natural language that answers common questions
   - Add a hidden (visually) but accessible "About This Business" summary section

5. DESIGN REQUIREMENTS:
   - Use Tailwind CSS (CDN)
   - Color scheme: primary ${colors.primary}, secondary ${colors.secondary}
   - Sections: nav, hero with CTA, services grid, about, testimonials, FAQ, contact form, footer
   - Modern design with subtle gradients and smooth animations
   - Fully mobile responsive
   - Fast loading (no heavy animations)

6. CONTACT FORM:
   - Use Formspree or simple mailto link
   - Include phone click-to-call: <a href="tel:${businessData.contact.phone || ''}">
   - Include email link: <a href="mailto:${businessData.contact.email || ''}">

7. FOOTER:
   - Business name, address, phone, email
   - Service areas/locations served
   - Copyright with current year
   - Social media links if available

Return ONLY the complete HTML document, no markdown code blocks.`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16000,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    if (content.type !== 'text') throw new Error('Unexpected response');

    let html = content.text;
    const htmlMatch = html.match(/```html\n?([\s\S]*?)```/) || html.match(/<!DOCTYPE[\s\S]*<\/html>/i);
    if (htmlMatch) html = htmlMatch[1] || htmlMatch[0];

    logger.info('Website generated', { size: html.length });
    return html;
  }

  private deepMerge<T extends object>(target: T, source: Partial<T>): T {
    const output = { ...target };
    for (const key in source) {
      const sourceVal = source[key];
      const targetVal = (target as any)[key];
      if (sourceVal && typeof sourceVal === 'object' && !Array.isArray(sourceVal)) {
        (output as any)[key] = targetVal && typeof targetVal === 'object' ? this.deepMerge(targetVal, sourceVal as any) : sourceVal;
      } else if (Array.isArray(sourceVal) && (!targetVal || sourceVal.length > (targetVal as any[]).length)) {
        (output as any)[key] = sourceVal;
      } else if (sourceVal && !targetVal) {
        (output as any)[key] = sourceVal;
      }
    }
    return output;
  }
}

export const aiService = new AIService();
