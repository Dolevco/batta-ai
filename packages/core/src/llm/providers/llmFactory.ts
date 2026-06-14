import { ILLMApiHandler } from '..';
import { AzureOpenAIClient } from './azureOpenAIClient';
import { OllamaClient } from './ollamaClient';

export type LlmProvider = 'azure-openai' | 'ollama';
export type LlmModelRole = 'large' | 'small';

export interface LlmFactoryOptions {
  modelRole?: LlmModelRole;
}

export function isLlmConfiguredFromEnv(options: LlmFactoryOptions = {}): boolean {
  const provider = getLlmProvider();
  if (!provider) return false;

  if (provider === 'ollama') {
    return Boolean(process.env.OLLAMA_BASE_URL) && Boolean(getOllamaModel(options.modelRole));
  }

  return isAzureLlmConfigured(options.modelRole);
}

export function createLlmClientFromEnv(options: LlmFactoryOptions = {}): ILLMApiHandler | undefined {
  const provider = getLlmProvider();
  if (!provider || !isLlmConfiguredFromEnv(options)) return undefined;

  try {
    if (provider === 'ollama') {
      return new OllamaClient({
        baseUrl: process.env.OLLAMA_BASE_URL!,
        model: getOllamaModel(options.modelRole)!,
        temperature: parseOptionalNumber(process.env.OLLAMA_TEMPERATURE),
        topP: parseOptionalNumber(process.env.OLLAMA_TOP_P),
        numCtx: parseOptionalInteger(process.env.OLLAMA_NUM_CTX),
        timeoutMs: parseOptionalInteger(process.env.OLLAMA_TIMEOUT_MS),
      });
    }

    const useManagedIdentity = process.env.AZURE_OPENAI_AUTH !== 'use_llm_provider_key';
    return new AzureOpenAIClient({
      endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
      apiKey: useManagedIdentity ? undefined : process.env.AZURE_OPENAI_API_KEY,
      deploymentName: getAzureDeployment(options.modelRole)!,
      apiVersion: getAzureApiVersion(options.modelRole),
      useManagedIdentity,
    });
  } catch (error) {
    console.warn('[llm] LLM client disabled:', (error as Error).message);
    return undefined;
  }
}

function getLlmProvider(): LlmProvider | undefined {
  const provider = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (provider === 'ollama' || provider === 'azure-openai') return provider;
  if (provider) {
    console.warn(`[llm] Unsupported LLM_PROVIDER "${provider}"`);
    return undefined;
  }

  return isAzureLlmConfigured() ? 'azure-openai' : undefined;
}

function isAzureLlmConfigured(modelRole: LlmModelRole = 'large'): boolean {
  const useManagedIdentity = process.env.AZURE_OPENAI_AUTH !== 'use_llm_provider_key';
  return Boolean(process.env.AZURE_OPENAI_ENDPOINT) &&
    Boolean(getAzureDeployment(modelRole)) &&
    (useManagedIdentity || Boolean(process.env.AZURE_OPENAI_API_KEY));
}

function getAzureDeployment(modelRole: LlmModelRole = 'large'): string | undefined {
  if (modelRole === 'small') {
    return process.env.AZURE_OPENAI_SMALL_DEPLOYMENT;
  }

  return process.env.AZURE_OPENAI_DEPLOYMENT || process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
}

function getAzureApiVersion(modelRole: LlmModelRole = 'large'): string | undefined {
  if (modelRole === 'small') {
    return process.env.AZURE_OPENAI_SMALL_API_VERSION ||
      process.env.AZURE_OPENAI_API_VERSION ||
      '2024-12-01-preview';
  }

  return process.env.AZURE_OPENAI_API_VERSION;
}

function getOllamaModel(modelRole: LlmModelRole = 'large'): string | undefined {
  if (modelRole === 'small') {
    return process.env.OLLAMA_SMALL_CHAT_MODEL || process.env.OLLAMA_CHAT_MODEL;
  }

  return process.env.OLLAMA_CHAT_MODEL;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
