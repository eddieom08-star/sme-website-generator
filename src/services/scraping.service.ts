import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import type { WebsiteData, FacebookData, InstagramData, GooglePlaceData, ScrapedData } from '../types/index.js';

const TIMEOUT = 30000;

export class ScrapingService {
  async scrapeAll(params: {
    businessName: string;
    location?: string;
    googleMapsUrl?: string;
    websiteUrl?: string;
    facebookUrl?: string;
    instagramUrl?: string;
  }): Promise<ScrapedData> {
    const results: ScrapedData = {};
    const promises: Promise<void>[] = [];

    // Prefer Google Maps URL over API if provided
    if (params.googleMapsUrl) {
      promises.push(
        this.scrapeGoogleMapsUrl(params.googleMapsUrl)
          .then(data => { results.google = data; })
          .catch(err => logger.warn('Google Maps URL scrape failed', { error: err.message }))
      );
    } else if (config.api.googlePlaces && params.businessName) {
      promises.push(
        this.scrapeGooglePlaces(params.businessName, params.location)
          .then(data => { results.google = data; })
          .catch(err => logger.warn('Google Places failed', { error: err.message }))
      );
    }

    if (params.websiteUrl) {
      promises.push(
        this.scrapeWebsite(params.websiteUrl)
          .then(data => { results.website = data; })
          .catch(err => logger.warn('Website scrape failed', { error: err.message }))
      );
    }

    if (params.facebookUrl) {
      promises.push(
        this.scrapeFacebook(params.facebookUrl)
          .then(data => { results.facebook = data; })
          .catch(err => logger.warn('Facebook failed', { error: err.message }))
      );
    }

    if (params.instagramUrl) {
      promises.push(
        this.scrapeInstagram(params.instagramUrl)
          .then(data => { results.instagram = data; })
          .catch(err => logger.warn('Instagram failed', { error: err.message }))
      );
    }

    await Promise.all(promises);
    return results;
  }

  async scrapeGoogleMapsUrl(url: string): Promise<GooglePlaceData> {
    logger.info('Scraping Google Maps URL', { url });

    // Follow redirects to get final URL
    const response = await axios.get(url, {
      timeout: TIMEOUT,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    const $ = cheerio.load(response.data);
    const result: GooglePlaceData = {};

    // Extract from meta tags
    const ogTitle = $('meta[property="og:title"]').attr('content');
    const ogDescription = $('meta[property="og:description"]').attr('content');
    const ogImage = $('meta[property="og:image"]').attr('content');

    if (ogTitle) {
      result.name = ogTitle.split(' - ')[0].trim();
    }
    if (ogDescription) {
      result.description = ogDescription;
      // Try to extract address from description
      const addressMatch = ogDescription.match(/(?:located at|address:|at)\s*([^.]+)/i);
      if (addressMatch) {
        result.address = addressMatch[1].trim();
      }
    }
    if (ogImage) {
      result.photos = [ogImage];
    }

    // Try to extract JSON-LD structured data
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const json = JSON.parse($(el).html() || '{}');
        if (json['@type'] === 'LocalBusiness' || json['@type']?.includes?.('Business')) {
          result.name = result.name || json.name;
          result.address = result.address || json.address?.streetAddress ||
            (typeof json.address === 'string' ? json.address : undefined);
          result.phone = result.phone || json.telephone;
          result.rating = result.rating || json.aggregateRating?.ratingValue;
          result.reviewCount = result.reviewCount || json.aggregateRating?.reviewCount;
          result.website = result.website || json.url;
          result.description = result.description || json.description;

          // Extract hours if available
          if (json.openingHoursSpecification) {
            result.hours = {};
            const specs = Array.isArray(json.openingHoursSpecification)
              ? json.openingHoursSpecification
              : [json.openingHoursSpecification];
            for (const spec of specs) {
              const days = Array.isArray(spec.dayOfWeek) ? spec.dayOfWeek : [spec.dayOfWeek];
              for (const day of days) {
                const dayName = day.replace('https://schema.org/', '').replace('http://schema.org/', '');
                result.hours[dayName] = `${spec.opens} - ${spec.closes}`;
              }
            }
          }
        }
      } catch {
        // Ignore JSON parse errors
      }
    });

    // Extract phone from page content
    if (!result.phone) {
      const phoneMatch = response.data.match(/(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
      if (phoneMatch) {
        result.phone = phoneMatch[0];
      }
    }

    // Try to extract rating from page
    if (!result.rating) {
      const ratingMatch = response.data.match(/(\d+\.?\d*)\s*(?:stars?|rating)/i);
      if (ratingMatch) {
        result.rating = parseFloat(ratingMatch[1]);
      }
    }

    // Extract reviews count
    if (!result.reviewCount) {
      const reviewMatch = response.data.match(/(\d+(?:,\d+)?)\s*reviews?/i);
      if (reviewMatch) {
        result.reviewCount = parseInt(reviewMatch[1].replace(',', ''), 10);
      }
    }

    logger.info('Google Maps URL scraped', {
      name: result.name,
      hasAddress: !!result.address,
      hasPhone: !!result.phone,
      hasRating: !!result.rating,
    });

    return result;
  }

  async scrapeGooglePlaces(businessName: string, location?: string): Promise<GooglePlaceData> {
    if (!config.api.googlePlaces) throw new Error('Google API not configured');

    const query = location ? `${businessName} ${location}` : businessName;
    const findRes = await axios.get('https://maps.googleapis.com/maps/api/place/findplacefromtext/json', {
      params: { input: query, inputtype: 'textquery', fields: 'place_id,name', key: config.api.googlePlaces },
      timeout: TIMEOUT,
    });

    if (!findRes.data.candidates?.length) return {};

    const detailsRes = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', {
      params: {
        place_id: findRes.data.candidates[0].place_id,
        fields: 'name,formatted_address,formatted_phone_number,opening_hours,reviews,website,rating,user_ratings_total,types,editorial_summary',
        key: config.api.googlePlaces,
      },
      timeout: TIMEOUT,
    });

    const r = detailsRes.data.result || {};
    const hours: Record<string, string> = {};
    r.opening_hours?.weekday_text?.forEach((line: string) => {
      const [day, time] = line.split(': ');
      if (day && time) hours[day] = time;
    });

    return {
      name: r.name,
      address: r.formatted_address,
      phone: r.formatted_phone_number,
      rating: r.rating,
      reviewCount: r.user_ratings_total,
      reviews: (r.reviews || []).map((rev: any) => ({
        author: rev.author_name,
        rating: rev.rating,
        text: rev.text,
        date: rev.relative_time_description,
        source: 'google' as const,
      })),
      hours,
      types: r.types,
      website: r.website,
      description: r.editorial_summary?.overview,
    };
  }

  async scrapeWebsite(url: string): Promise<WebsiteData> {
    if (config.api.firecrawl) {
      try {
        const res = await axios.post('https://api.firecrawl.dev/v1/scrape', { url, formats: ['markdown'] }, {
          headers: { Authorization: `Bearer ${config.api.firecrawl}` },
          timeout: 60000,
        });
        return { content: res.data.data?.markdown || res.data.markdown, title: res.data.data?.title };
      } catch (err) {
        logger.warn('Firecrawl failed, using direct scrape');
      }
    }

    const res = await axios.get(url, { timeout: TIMEOUT, headers: { 'User-Agent': 'SMEWebsiteGenerator/1.0' } });
    const $ = cheerio.load(res.data);

    return {
      title: $('title').text() || $('meta[property="og:title"]').attr('content'),
      description: $('meta[name="description"]').attr('content'),
      content: $('main, article, .content, body').text().substring(0, 5000),
      contact: {
        phone: res.data.match(/(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/)?.[0],
        email: res.data.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)?.[0],
      },
    };
  }

  async scrapeFacebook(url: string): Promise<FacebookData> {
    if (!config.api.apify) return {};
    try {
      const res = await axios.post(
        'https://api.apify.com/v2/acts/apify~facebook-pages-scraper/run-sync-get-dataset-items',
        { startUrls: [{ url }], maxPosts: 10 },
        { params: { token: config.api.apify }, timeout: 120000 }
      );
      const d = Array.isArray(res.data) ? res.data[0] : res.data;
      return d ? { name: d.name, about: d.about, description: d.description, phone: d.phone, email: d.email, website: d.website } : {};
    } catch (err) {
      logger.error('Facebook scrape error', { error: (err as Error).message });
      return {};
    }
  }

  async scrapeInstagram(urlOrUsername: string): Promise<InstagramData> {
    if (!config.api.apify) return {};
    let username = urlOrUsername.includes('instagram.com')
      ? urlOrUsername.match(/instagram\.com\/([^\/\?]+)/)?.[1] || urlOrUsername
      : urlOrUsername;
    username = username.replace('@', '');

    try {
      const res = await axios.post(
        'https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items',
        { usernames: [username] },
        { params: { token: config.api.apify }, timeout: 120000 }
      );
      const d = Array.isArray(res.data) ? res.data[0] : res.data;
      return d ? { username: d.username, fullName: d.fullName, bio: d.biography, followerCount: d.followersCount, website: d.externalUrl } : {};
    } catch (err) {
      logger.error('Instagram scrape error', { error: (err as Error).message });
      return {};
    }
  }
}

export const scrapingService = new ScrapingService();
