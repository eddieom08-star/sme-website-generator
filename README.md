# SME Website Generator

A production-ready application that scrapes business information from social media and websites, then generates beautiful, modern websites using AI and deploys them to Vercel.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React)                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │ Input Form  │  │  Progress   │  │   Preview   │                 │
│  │             │  │   Tracker   │  │   & Deploy  │                 │
│  └─────────────┘  └─────────────┘  └─────────────┘                 │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      BACKEND API (FastAPI)                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │
│  │  /scrape    │  │  /generate  │  │  /deploy    │  │  /status  │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   SCRAPER     │    │   AI ENGINE   │    │   DEPLOYER    │
│   SERVICE     │    │   SERVICE     │    │   SERVICE     │
│               │    │               │    │               │
│ • Firecrawl   │    │ • Claude API  │    │ • Vercel API  │
│ • Apify       │    │ • 21st.dev    │    │ • DNS Config  │
│ • Google API  │    │ • Templates   │    │               │
└───────────────┘    └───────────────┘    └───────────────┘
```

## Features

- **Multi-source scraping**: Facebook, Instagram, Google Business, existing websites
- **AI-powered content extraction**: Uses Claude to normalize and enhance business data
- **Beautiful UI generation**: Integrates with 21st.dev MCP for modern components
- **One-click deployment**: Automatic Vercel deployment with custom domain support
- **Progress tracking**: Real-time status updates via WebSocket
- **Job queue**: Background processing with Redis for reliability

## Tech Stack

- **Backend**: Python 3.11+ / FastAPI
- **Frontend**: React 18 / TypeScript / Tailwind CSS
- **Database**: PostgreSQL (job tracking) + Redis (queue)
- **AI**: Anthropic Claude API
- **Scraping**: Firecrawl, Apify
- **Deployment**: Vercel API
- **Hosting**: Render.com

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 18+
- Redis (for job queue)
- PostgreSQL (optional, for persistence)

### Environment Variables

```bash
# API Keys
ANTHROPIC_API_KEY=sk-ant-...
FIRECRAWL_API_KEY=fc-...
APIFY_API_TOKEN=apify_api_...
VERCEL_TOKEN=...
GOOGLE_PLACES_API_KEY=...

# Optional
REDIS_URL=redis://localhost:6379
DATABASE_URL=postgresql://...
```

### Installation

```bash
# Clone the repo
git clone https://github.com/yourusername/sme-website-generator.git
cd sme-website-generator

# Backend
cd backend
python -m venv venv
source venv/bin/activate  # or `venv\Scripts\activate` on Windows
pip install -r requirements.txt

# Frontend
cd ../frontend
npm install

# Run both
# Terminal 1 - Backend
cd backend && uvicorn app.main:app --reload

# Terminal 2 - Frontend
cd frontend && npm run dev
```

### Docker

```bash
docker-compose up -d
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/jobs` | POST | Create new website generation job |
| `/api/jobs/{id}` | GET | Get job status and results |
| `/api/jobs/{id}/preview` | GET | Get generated HTML preview |
| `/api/jobs/{id}/deploy` | POST | Deploy to Vercel |
| `/api/health` | GET | Health check |
| `/ws/jobs/{id}` | WS | Real-time job updates |

## Project Structure

```
sme-website-generator/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py              # FastAPI app entry
│   │   ├── config.py            # Settings & env vars
│   │   ├── models/              # Pydantic models
│   │   ├── api/                 # API routes
│   │   ├── services/            # Business logic
│   │   │   ├── scraper.py       # Scraping service
│   │   │   ├── ai_engine.py     # Claude integration
│   │   │   ├── component_gen.py # 21st.dev integration
│   │   │   └── deployer.py      # Vercel deployment
│   │   ├── templates/           # HTML templates
│   │   └── utils/               # Helpers
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   └── services/
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml
├── render.yaml                  # Render deployment config
└── README.md
```

## Deployment to Render

1. Fork this repository
2. Create a new Web Service on Render
3. Connect your GitHub repo
4. Render will auto-detect the `render.yaml` configuration
5. Add your environment variables in Render dashboard
6. Deploy!

## License

MIT
