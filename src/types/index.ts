export interface GenerationRequest {
  businessName: string;
  location?: string;
  googleMapsUrl?: string;
  websiteUrl?: string;
  facebookUrl?: string;
  instagramUrl?: string;
  linkedinUrl?: string;
  additionalInfo?: string;
}

export interface ScrapedData {
  google?: GooglePlaceData;
  website?: WebsiteData;
  facebook?: FacebookData;
  instagram?: InstagramData;
}

export interface GooglePlaceData {
  name?: string;
  address?: string;
  phone?: string;
  rating?: number;
  reviewCount?: number;
  reviews?: Review[];
  hours?: Record<string, string>;
  types?: string[];
  photos?: string[];
  website?: string;
  description?: string;
}

export interface WebsiteData {
  title?: string;
  description?: string;
  content?: string;
  services?: string[];
  about?: string;
  contact?: ContactInfo;
  images?: string[];
}

export interface FacebookData {
  name?: string;
  about?: string;
  description?: string;
  category?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  hours?: Record<string, string>;
  posts?: SocialPost[];
  reviews?: Review[];
  followerCount?: number;
}

export interface InstagramData {
  username?: string;
  fullName?: string;
  bio?: string;
  followerCount?: number;
  postCount?: number;
  posts?: SocialPost[];
  website?: string;
}

export interface SocialPost {
  text?: string;
  date?: string;
  likes?: number;
  imageUrl?: string;
}

export interface Review {
  author: string;
  rating: number;
  text: string;
  date?: string;
  source: 'google' | 'facebook' | 'yelp' | 'other';
}

export interface ContactInfo {
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

export interface ExtractedBusinessData {
  business: {
    name: string;
    tagline?: string;
    descriptionShort?: string;
    descriptionLong?: string;
    yearEstablished?: string;
    businessType: BusinessType;
  };
  services: Service[];
  uniqueSellingPoints: string[];
  testimonials: Testimonial[];
  contact: ContactInfo;
  hours?: Record<string, string>;
  socialLinks: SocialLinks;
  rating?: { score: number; count: number };
  imagery: { logo?: string; hero?: string; gallery: string[] };
  dataQuality: DataQuality;
}

export type BusinessType = 'restaurant' | 'trades' | 'professional' | 'retail' | 'creative' | 'health' | 'general';

export interface Service {
  name: string;
  description?: string;
  icon?: string;
  price?: string;
}

export interface Testimonial {
  quote: string;
  author: string;
  rating?: number;
  source?: string;
  date?: string;
}

export interface SocialLinks {
  facebook?: string;
  instagram?: string;
  twitter?: string;
  linkedin?: string;
  youtube?: string;
  tiktok?: string;
}

export interface DataQuality {
  completenessScore: number;
  missingCritical: string[];
  missingNiceToHave: string[];
  sourcesUsed: string[];
  confidence: 'high' | 'medium' | 'low';
}

export interface GeneratedSite {
  html: string;
  css?: string;
  metadata: { title: string; description: string; sections: string[] };
}

export interface DeploymentResult {
  success: boolean;
  url?: string;
  previewUrl?: string;
  projectId?: string;
  deploymentId?: string;
  error?: string;
}

export interface GenerationResult {
  id: string;
  status: 'pending' | 'scraping' | 'processing' | 'generating' | 'deploying' | 'complete' | 'failed';
  progress: number;
  currentStep?: string;
  scrapedData?: ScrapedData;
  extractedData?: ExtractedBusinessData;
  generatedSite?: GeneratedSite;
  deployment?: DeploymentResult;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
}

export interface JobStatus {
  id: string;
  status: GenerationResult['status'];
  progress: number;
  currentStep?: string;
  result?: { siteUrl?: string; previewUrl?: string; qualityScore?: number };
  error?: string;
}
