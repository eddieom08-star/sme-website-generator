import { sql } from '@vercel/postgres';
import logger from '../utils/logger.js';

export interface DbSite {
  id: string;
  job_id: string;
  name: string;
  location: string | null;
  url: string | null;
  preview_url: string | null;
  deployed: boolean;
  quality_score: number;
  business_data: Record<string, unknown> | null;
  html_content: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface DbLead {
  id: string;
  site_id: string;
  name: string;
  email: string;
  phone: string | null;
  message: string | null;
  source: string | null;
  created_at: Date;
}

export interface DbJob {
  id: string;
  site_id: string | null;
  status: string;
  progress: number;
  current_step: string | null;
  error: string | null;
  scraped_data: Record<string, unknown> | null;
  extracted_data: Record<string, unknown> | null;
  started_at: Date;
  completed_at: Date | null;
}

export class DatabaseService {
  private initialized = false;

  /**
   * Initialize database schema
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Create sites table
      await sql`
        CREATE TABLE IF NOT EXISTS sites (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          job_id VARCHAR(255) UNIQUE NOT NULL,
          name VARCHAR(255) NOT NULL,
          location VARCHAR(255),
          url TEXT,
          preview_url TEXT,
          deployed BOOLEAN DEFAULT false,
          quality_score INTEGER DEFAULT 0,
          business_data JSONB,
          html_content TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `;

      // Create leads table
      await sql`
        CREATE TABLE IF NOT EXISTS leads (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255) NOT NULL,
          phone VARCHAR(50),
          message TEXT,
          source VARCHAR(100),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `;

      // Create jobs table for tracking generation progress
      await sql`
        CREATE TABLE IF NOT EXISTS jobs (
          id VARCHAR(255) PRIMARY KEY,
          site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
          status VARCHAR(50) NOT NULL DEFAULT 'pending',
          progress INTEGER DEFAULT 0,
          current_step TEXT,
          error TEXT,
          scraped_data JSONB,
          extracted_data JSONB,
          started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          completed_at TIMESTAMP WITH TIME ZONE
        )
      `;

      // Create indexes
      await sql`CREATE INDEX IF NOT EXISTS idx_sites_job_id ON sites(job_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_leads_site_id ON leads(site_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`;

      this.initialized = true;
      logger.info('Database initialized successfully');
    } catch (error) {
      logger.error('Database initialization failed', { error: (error as Error).message });
      throw error;
    }
  }

  // ========== SITES ==========

  async createSite(data: {
    jobId: string;
    name: string;
    location?: string;
    url?: string;
    previewUrl?: string;
    deployed?: boolean;
    qualityScore?: number;
    businessData?: Record<string, unknown>;
    htmlContent?: string;
  }): Promise<DbSite> {
    const result = await sql`
      INSERT INTO sites (job_id, name, location, url, preview_url, deployed, quality_score, business_data, html_content)
      VALUES (
        ${data.jobId},
        ${data.name},
        ${data.location || null},
        ${data.url || null},
        ${data.previewUrl || null},
        ${data.deployed || false},
        ${data.qualityScore || 0},
        ${JSON.stringify(data.businessData || null)},
        ${data.htmlContent || null}
      )
      RETURNING *
    `;
    return this.mapSite(result.rows[0]);
  }

  async getSiteById(id: string): Promise<DbSite | null> {
    const result = await sql`SELECT * FROM sites WHERE id = ${id}`;
    return result.rows.length > 0 ? this.mapSite(result.rows[0]) : null;
  }

  async getSiteByJobId(jobId: string): Promise<DbSite | null> {
    const result = await sql`SELECT * FROM sites WHERE job_id = ${jobId}`;
    return result.rows.length > 0 ? this.mapSite(result.rows[0]) : null;
  }

  async getAllSites(): Promise<DbSite[]> {
    const result = await sql`SELECT * FROM sites ORDER BY created_at DESC`;
    return result.rows.map(row => this.mapSite(row));
  }

  async updateSite(id: string, data: Partial<{
    name: string;
    location: string;
    url: string;
    previewUrl: string;
    deployed: boolean;
    qualityScore: number;
    businessData: Record<string, unknown>;
    htmlContent: string;
  }>): Promise<DbSite | null> {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (data.name !== undefined) updates.push(`name = $${values.push(data.name)}`);
    if (data.location !== undefined) updates.push(`location = $${values.push(data.location)}`);
    if (data.url !== undefined) updates.push(`url = $${values.push(data.url)}`);
    if (data.previewUrl !== undefined) updates.push(`preview_url = $${values.push(data.previewUrl)}`);
    if (data.deployed !== undefined) updates.push(`deployed = $${values.push(data.deployed)}`);
    if (data.qualityScore !== undefined) updates.push(`quality_score = $${values.push(data.qualityScore)}`);
    if (data.businessData !== undefined) updates.push(`business_data = $${values.push(JSON.stringify(data.businessData))}`);
    if (data.htmlContent !== undefined) updates.push(`html_content = $${values.push(data.htmlContent)}`);

    if (updates.length === 0) return this.getSiteById(id);

    updates.push(`updated_at = NOW()`);

    const result = await sql.query(
      `UPDATE sites SET ${updates.join(', ')} WHERE id = $${values.push(id)} RETURNING *`,
      values
    );
    return result.rows.length > 0 ? this.mapSite(result.rows[0]) : null;
  }

  async deleteSite(id: string): Promise<boolean> {
    const result = await sql`DELETE FROM sites WHERE id = ${id}`;
    return (result.rowCount ?? 0) > 0;
  }

  // ========== LEADS ==========

  async createLead(data: {
    siteId: string;
    name: string;
    email: string;
    phone?: string;
    message?: string;
    source?: string;
  }): Promise<DbLead> {
    const result = await sql`
      INSERT INTO leads (site_id, name, email, phone, message, source)
      VALUES (
        ${data.siteId}::uuid,
        ${data.name},
        ${data.email},
        ${data.phone || null},
        ${data.message || null},
        ${data.source || null}
      )
      RETURNING *
    `;
    return this.mapLead(result.rows[0]);
  }

  async getLeadsBySiteId(siteId: string): Promise<DbLead[]> {
    const result = await sql`
      SELECT * FROM leads WHERE site_id = ${siteId}::uuid ORDER BY created_at DESC
    `;
    return result.rows.map(row => this.mapLead(row));
  }

  async getLeadsBySiteJobId(jobId: string): Promise<DbLead[]> {
    const result = await sql`
      SELECT l.* FROM leads l
      JOIN sites s ON l.site_id = s.id
      WHERE s.job_id = ${jobId}
      ORDER BY l.created_at DESC
    `;
    return result.rows.map(row => this.mapLead(row));
  }

  // ========== JOBS ==========

  async createJob(id: string): Promise<DbJob> {
    const result = await sql`
      INSERT INTO jobs (id, status, progress, started_at)
      VALUES (${id}, 'pending', 0, NOW())
      RETURNING *
    `;
    return this.mapJob(result.rows[0]);
  }

  async getJob(id: string): Promise<DbJob | null> {
    const result = await sql`SELECT * FROM jobs WHERE id = ${id}`;
    return result.rows.length > 0 ? this.mapJob(result.rows[0]) : null;
  }

  async updateJob(id: string, data: Partial<{
    siteId: string;
    status: string;
    progress: number;
    currentStep: string;
    error: string;
    scrapedData: Record<string, unknown>;
    extractedData: Record<string, unknown>;
    completedAt: Date;
  }>): Promise<DbJob | null> {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (data.siteId !== undefined) updates.push(`site_id = $${values.push(data.siteId)}::uuid`);
    if (data.status !== undefined) updates.push(`status = $${values.push(data.status)}`);
    if (data.progress !== undefined) updates.push(`progress = $${values.push(data.progress)}`);
    if (data.currentStep !== undefined) updates.push(`current_step = $${values.push(data.currentStep)}`);
    if (data.error !== undefined) updates.push(`error = $${values.push(data.error)}`);
    if (data.scrapedData !== undefined) updates.push(`scraped_data = $${values.push(JSON.stringify(data.scrapedData))}`);
    if (data.extractedData !== undefined) updates.push(`extracted_data = $${values.push(JSON.stringify(data.extractedData))}`);
    if (data.completedAt !== undefined) updates.push(`completed_at = $${values.push(data.completedAt.toISOString())}`);

    if (updates.length === 0) return this.getJob(id);

    const result = await sql.query(
      `UPDATE jobs SET ${updates.join(', ')} WHERE id = $${values.push(id)} RETURNING *`,
      values
    );
    return result.rows.length > 0 ? this.mapJob(result.rows[0]) : null;
  }

  async cleanupOldJobs(maxAgeHours: number = 24): Promise<number> {
    const result = await sql`
      DELETE FROM jobs
      WHERE started_at < NOW() - INTERVAL '${maxAgeHours} hours'
      AND status IN ('complete', 'failed')
    `;
    return result.rowCount ?? 0;
  }

  // ========== HELPERS ==========

  private mapSite(row: Record<string, unknown>): DbSite {
    return {
      id: row.id as string,
      job_id: row.job_id as string,
      name: row.name as string,
      location: row.location as string | null,
      url: row.url as string | null,
      preview_url: row.preview_url as string | null,
      deployed: row.deployed as boolean,
      quality_score: row.quality_score as number,
      business_data: row.business_data as Record<string, unknown> | null,
      html_content: row.html_content as string | null,
      created_at: new Date(row.created_at as string),
      updated_at: new Date(row.updated_at as string),
    };
  }

  private mapLead(row: Record<string, unknown>): DbLead {
    return {
      id: row.id as string,
      site_id: row.site_id as string,
      name: row.name as string,
      email: row.email as string,
      phone: row.phone as string | null,
      message: row.message as string | null,
      source: row.source as string | null,
      created_at: new Date(row.created_at as string),
    };
  }

  private mapJob(row: Record<string, unknown>): DbJob {
    return {
      id: row.id as string,
      site_id: row.site_id as string | null,
      status: row.status as string,
      progress: row.progress as number,
      current_step: row.current_step as string | null,
      error: row.error as string | null,
      scraped_data: row.scraped_data as Record<string, unknown> | null,
      extracted_data: row.extracted_data as Record<string, unknown> | null,
      started_at: new Date(row.started_at as string),
      completed_at: row.completed_at ? new Date(row.completed_at as string) : null,
    };
  }
}

export const databaseService = new DatabaseService();
