import { useState, useEffect, useCallback } from 'react'
import { 
  Globe, 
  Facebook, 
  Instagram, 
  Loader2, 
  CheckCircle2, 
  XCircle,
  ExternalLink,
  Rocket,
  Sparkles,
  Building2
} from 'lucide-react'

// Types
interface JobProgress {
  stage: string
  message: string
  progress_percent: number
  timestamp: string
}

interface Job {
  id: string
  status: 'pending' | 'scraping' | 'extracting' | 'generating' | 'deploying' | 'completed' | 'failed'
  progress: JobProgress[]
  current_stage?: string
  generated_site?: {
    html: string
    sections_included: string[]
  }
  deployment?: {
    url: string
    production_url: string
  }
  error?: string
}

// API functions
const API_BASE = '/api'

async function createJob(data: {
  business_name: string
  location?: string
  website_url?: string
  facebook_url?: string
  instagram_url?: string
}): Promise<{ job: Job }> {
  const response = await fetch(`${API_BASE}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) throw new Error('Failed to create job')
  return response.json()
}

async function getJob(jobId: string): Promise<{ job: Job }> {
  const response = await fetch(`${API_BASE}/jobs/${jobId}`)
  if (!response.ok) throw new Error('Failed to get job')
  return response.json()
}

async function deployJob(jobId: string): Promise<{ job: Job }> {
  const response = await fetch(`${API_BASE}/jobs/${jobId}/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  if (!response.ok) throw new Error('Failed to deploy')
  return response.json()
}

// Progress stages with labels
const STAGES = {
  pending: { label: 'Starting', icon: Loader2 },
  scraping: { label: 'Scraping Data', icon: Globe },
  extracting: { label: 'Analyzing with AI', icon: Sparkles },
  generating: { label: 'Generating Website', icon: Building2 },
  deploying: { label: 'Deploying', icon: Rocket },
  completed: { label: 'Complete', icon: CheckCircle2 },
  failed: { label: 'Failed', icon: XCircle },
}

function App() {
  // Form state
  const [businessName, setBusinessName] = useState('')
  const [location, setLocation] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [facebookUrl, setFacebookUrl] = useState('')
  const [instagramUrl, setInstagramUrl] = useState('')
  
  // Job state
  const [job, setJob] = useState<Job | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  
  // Poll for job updates
  useEffect(() => {
    if (!job || job.status === 'completed' || job.status === 'failed') return
    
    const interval = setInterval(async () => {
      try {
        const { job: updatedJob } = await getJob(job.id)
        setJob(updatedJob)
      } catch (err) {
        console.error('Failed to poll job', err)
      }
    }, 2000)
    
    return () => clearInterval(interval)
  }, [job?.id, job?.status])
  
  // Handle form submission
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!businessName.trim()) {
      setError('Business name is required')
      return
    }
    
    setIsLoading(true)
    setError(null)
    setJob(null)
    
    try {
      const { job: newJob } = await createJob({
        business_name: businessName.trim(),
        location: location.trim() || undefined,
        website_url: websiteUrl.trim() || undefined,
        facebook_url: facebookUrl.trim() || undefined,
        instagram_url: instagramUrl.trim() || undefined,
      })
      setJob(newJob)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setIsLoading(false)
    }
  }, [businessName, location, websiteUrl, facebookUrl, instagramUrl])
  
  // Handle deploy
  const handleDeploy = useCallback(async () => {
    if (!job) return
    
    setIsLoading(true)
    try {
      const { job: updatedJob } = await deployJob(job.id)
      setJob(updatedJob)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deployment failed')
    } finally {
      setIsLoading(false)
    }
  }, [job])
  
  // Get current progress percentage
  const progressPercent = job?.progress?.length 
    ? job.progress[job.progress.length - 1].progress_percent 
    : 0
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-6">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-primary-100 rounded-lg">
              <Sparkles className="w-6 h-6 text-primary-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">SME Website Generator</h1>
              <p className="text-sm text-gray-500">Create beautiful websites from your social presence</p>
            </div>
          </div>
        </div>
      </header>
      
      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-2 gap-8">
          {/* Input Form */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-6">Business Information</h2>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Business Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Business Name *
                </label>
                <input
                  type="text"
                  className="input"
                  placeholder="Acme Coffee Shop"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  disabled={isLoading || (job && job.status !== 'completed' && job.status !== 'failed')}
                />
              </div>
              
              {/* Location */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Location
                </label>
                <input
                  type="text"
                  className="input"
                  placeholder="San Francisco, CA"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  disabled={isLoading || (job && job.status !== 'completed' && job.status !== 'failed')}
                />
                <p className="text-xs text-gray-500 mt-1">Used for Google Business lookup</p>
              </div>
              
              {/* Website */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Globe className="w-4 h-4 inline mr-1" />
                  Website URL
                </label>
                <input
                  type="url"
                  className="input"
                  placeholder="https://example.com"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  disabled={isLoading || (job && job.status !== 'completed' && job.status !== 'failed')}
                />
              </div>
              
              {/* Facebook */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Facebook className="w-4 h-4 inline mr-1" />
                  Facebook Page
                </label>
                <input
                  type="url"
                  className="input"
                  placeholder="https://facebook.com/yourbusiness"
                  value={facebookUrl}
                  onChange={(e) => setFacebookUrl(e.target.value)}
                  disabled={isLoading || (job && job.status !== 'completed' && job.status !== 'failed')}
                />
              </div>
              
              {/* Instagram */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Instagram className="w-4 h-4 inline mr-1" />
                  Instagram
                </label>
                <input
                  type="text"
                  className="input"
                  placeholder="@yourbusiness or URL"
                  value={instagramUrl}
                  onChange={(e) => setInstagramUrl(e.target.value)}
                  disabled={isLoading || (job && job.status !== 'completed' && job.status !== 'failed')}
                />
              </div>
              
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {error}
                </div>
              )}
              
              <button
                type="submit"
                className="btn-primary w-full flex items-center justify-center"
                disabled={isLoading || (job && job.status !== 'completed' && job.status !== 'failed')}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5 mr-2" />
                    Generate Website
                  </>
                )}
              </button>
            </form>
          </div>
          
          {/* Progress & Results */}
          <div className="space-y-6">
            {/* Progress Card */}
            {job && (
              <div className="card">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Generation Progress</h2>
                
                {/* Progress Bar */}
                <div className="mb-6">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-gray-600">
                      {STAGES[job.status]?.label || job.status}
                    </span>
                    <span className="text-gray-900 font-medium">{progressPercent}%</span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-500 ${
                        job.status === 'failed' ? 'bg-red-500' : 
                        job.status === 'completed' ? 'bg-green-500' : 'bg-primary-500'
                      }`}
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
                
                {/* Stage Steps */}
                <div className="space-y-3">
                  {Object.entries(STAGES).slice(0, -1).map(([key, { label, icon: Icon }]) => {
                    const isActive = job.status === key
                    const isComplete = ['scraping', 'extracting', 'generating', 'deploying', 'completed']
                      .indexOf(job.status) > ['scraping', 'extracting', 'generating', 'deploying', 'completed'].indexOf(key)
                    
                    return (
                      <div 
                        key={key}
                        className={`flex items-center p-3 rounded-lg transition-colors ${
                          isActive ? 'bg-primary-50 border border-primary-200' :
                          isComplete ? 'bg-green-50 border border-green-200' :
                          'bg-gray-50 border border-gray-200'
                        }`}
                      >
                        <Icon className={`w-5 h-5 mr-3 ${
                          isActive ? 'text-primary-600 animate-pulse' :
                          isComplete ? 'text-green-600' :
                          'text-gray-400'
                        }`} />
                        <span className={`text-sm font-medium ${
                          isActive ? 'text-primary-700' :
                          isComplete ? 'text-green-700' :
                          'text-gray-500'
                        }`}>
                          {label}
                        </span>
                        {isComplete && (
                          <CheckCircle2 className="w-4 h-4 ml-auto text-green-600" />
                        )}
                      </div>
                    )
                  })}
                </div>
                
                {/* Error State */}
                {job.status === 'failed' && (
                  <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                    <div className="flex items-center text-red-700">
                      <XCircle className="w-5 h-5 mr-2" />
                      <span className="font-medium">Generation Failed</span>
                    </div>
                    {job.error && (
                      <p className="text-sm text-red-600 mt-2">{job.error}</p>
                    )}
                  </div>
                )}
                
                {/* Success State */}
                {job.status === 'completed' && job.generated_site && (
                  <div className="mt-4 space-y-4">
                    <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                      <div className="flex items-center text-green-700">
                        <CheckCircle2 className="w-5 h-5 mr-2" />
                        <span className="font-medium">Website Generated!</span>
                      </div>
                    </div>
                    
                    <div className="flex gap-3">
                      <button
                        className="btn-secondary flex-1 flex items-center justify-center"
                        onClick={() => setShowPreview(true)}
                      >
                        <ExternalLink className="w-4 h-4 mr-2" />
                        Preview
                      </button>
                      
                      {!job.deployment && (
                        <button
                          className="btn-primary flex-1 flex items-center justify-center"
                          onClick={handleDeploy}
                          disabled={isLoading}
                        >
                          {isLoading ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <Rocket className="w-4 h-4 mr-2" />
                          )}
                          Deploy to Vercel
                        </button>
                      )}
                    </div>
                    
                    {job.deployment && (
                      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="flex items-center text-blue-700 mb-2">
                          <Rocket className="w-5 h-5 mr-2" />
                          <span className="font-medium">Deployed!</span>
                        </div>
                        <a 
                          href={job.deployment.production_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline text-sm flex items-center"
                        >
                          {job.deployment.production_url}
                          <ExternalLink className="w-3 h-3 ml-1" />
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            
            {/* Empty State */}
            {!job && (
              <div className="card text-center py-12">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Building2 className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  Ready to Generate
                </h3>
                <p className="text-gray-500 max-w-sm mx-auto">
                  Enter your business details and we'll scrape your online presence 
                  to create a beautiful, modern website.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
      
      {/* Preview Modal */}
      {showPreview && job?.generated_site && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-gray-900">Preview</h3>
              <button
                onClick={() => setShowPreview(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>
            <iframe
              srcDoc={job.generated_site.html}
              className="w-full h-[80vh] border-0"
              title="Website Preview"
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default App
