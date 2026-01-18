import { config } from '../config/index.js';
import logger from '../utils/logger.js';

interface BusinessInfo {
  businessName: string;
  location?: string;
  additionalInfo?: string;
}

interface AgentConfig {
  agentId: string;
  agentName: string;
  voiceId: string;
  llmWebsocketUrl?: string;
  webhookUrl?: string;
}

interface CreateAgentRequest {
  businessInfo: BusinessInfo;
  agentType: 'voice' | 'chat';
  voiceId?: string;
}

interface CreateAgentResponse {
  success: boolean;
  agent?: AgentConfig;
  embedCode?: string;
  error?: string;
}

function generateAgentPrompt(business: BusinessInfo): string {
  const businessName = business.businessName;
  const location = business.location ? ` in ${business.location}` : '';
  const additionalContext = business.additionalInfo
    ? `\n\n## Additional Context\n${business.additionalInfo}`
    : '';

  return `## Identity
You are a friendly and professional AI receptionist for ${businessName}${location}. You help callers with inquiries, provide information about the business, and assist with scheduling or directing calls.

## Style
- Warm, professional, and helpful
- Speak naturally and conversationally
- Keep responses concise (under 2 sentences when possible)
- Be patient with callers who need clarification

## Greeting
"Hello, thank you for calling ${businessName}. How can I help you today?"

## Core Capabilities
1. Answer general questions about the business
2. Collect caller information (name, phone, reason for call)
3. Help schedule callbacks or appointments
4. Direct urgent matters appropriately

## Information Collection
When a caller has a specific inquiry, collect:
- Caller's name
- Best callback number
- Reason for their call
- Preferred callback time (if applicable)

## Response Guidelines
- If you don't know something specific, offer to have someone call them back
- For urgent matters, acknowledge the urgency and assure prompt follow-up
- Always end calls professionally: "Is there anything else I can help you with?"

## Boundaries
- Don't make promises about specific services or pricing
- Don't share confidential business information
- Transfer to a human if the caller requests it${additionalContext}`;
}

function generateEmbedCode(agentId: string, agentType: 'voice' | 'chat'): string {
  if (agentType === 'chat') {
    return `<!-- Retell AI Chat Widget -->
<script src="https://cdn.retellai.com/chat-embed.js"></script>
<script>
  RetellChat.init({
    agentId: "${agentId}",
    position: "bottom-right"
  });
</script>`;
  }

  return `<!-- Retell AI Voice Widget -->
<script src="https://cdn.retellai.com/voice-embed.js"></script>
<script>
  RetellVoice.init({
    agentId: "${agentId}",
    buttonText: "Call Us",
    position: "bottom-right"
  });
</script>`;
}

class RetellService {
  private apiKey: string | undefined;
  private baseUrl = 'https://api.retellai.com';

  constructor() {
    this.apiKey = config.api.retell;
  }

  async createAgent(request: CreateAgentRequest): Promise<CreateAgentResponse> {
    if (!this.apiKey) {
      return {
        success: false,
        error: 'Retell API key not configured',
      };
    }

    try {
      const prompt = generateAgentPrompt(request.businessInfo);
      const agentName = `${request.businessInfo.businessName} Receptionist`;

      // Create LLM configuration first
      const llmResponse = await fetch(`${this.baseUrl}/create-retell-llm`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          general_prompt: prompt,
          begin_message: `Hello, thank you for calling ${request.businessInfo.businessName}. How can I help you today?`,
          model: 'claude-3-5-sonnet-latest',
        }),
      });

      if (!llmResponse.ok) {
        const errorData = await llmResponse.json().catch(() => ({}));
        logger.error('Failed to create Retell LLM', { error: errorData });
        return {
          success: false,
          error: `Failed to create LLM configuration: ${llmResponse.statusText}`,
        };
      }

      const llmData = await llmResponse.json();

      // Create the agent with the LLM
      const agentResponse = await fetch(`${this.baseUrl}/create-agent`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_name: agentName,
          voice_id: request.voiceId || '11labs-Adrian',
          llm_websocket_url: llmData.llm_websocket_url,
          language: 'en-US',
          response_engine: {
            type: 'retell-llm',
            llm_id: llmData.llm_id,
          },
        }),
      });

      if (!agentResponse.ok) {
        const errorData = await agentResponse.json().catch(() => ({}));
        logger.error('Failed to create Retell agent', { error: errorData });
        return {
          success: false,
          error: `Failed to create agent: ${agentResponse.statusText}`,
        };
      }

      const agentData = await agentResponse.json();
      const embedCode = generateEmbedCode(agentData.agent_id, request.agentType);

      logger.info('Retell agent created successfully', {
        agentId: agentData.agent_id,
        businessName: request.businessInfo.businessName,
      });

      return {
        success: true,
        agent: {
          agentId: agentData.agent_id,
          agentName: agentName,
          voiceId: request.voiceId || '11labs-Adrian',
          llmWebsocketUrl: llmData.llm_websocket_url,
        },
        embedCode,
      };

    } catch (error) {
      logger.error('Retell service error', { error: (error as Error).message });
      return {
        success: false,
        error: `Service error: ${(error as Error).message}`,
      };
    }
  }

  async listVoices(): Promise<{ voices: Array<{ id: string; name: string }> }> {
    if (!this.apiKey) {
      return { voices: [] };
    }

    try {
      const response = await fetch(`${this.baseUrl}/list-voices`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        return { voices: [] };
      }

      const data = await response.json();
      return { voices: data };
    } catch {
      return { voices: [] };
    }
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }
}

export const retellService = new RetellService();
