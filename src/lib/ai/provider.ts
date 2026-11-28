import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type ImageFormat,
} from '@aws-sdk/client-bedrock-runtime';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';

export type AIProviderName = 'gemini' | 'bedrock' | 'agnes';

export type SupportedImageMimeType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/jpg'
  | 'image/webp'
  | 'image/gif';

export interface GenerateStructuredJSONParams<T> {
  systemPrompt: string;
  userPrompt: string;
  imageBase64?: string;
  imageMimeType?: SupportedImageMimeType;
  schema: z.ZodType<T>;
  providerOverride?: AIProviderName;
}

export class AIProviderError extends Error {
  public readonly provider: AIProviderName;
  public readonly code:
    | 'INVALID_INPUT'
    | 'PROVIDER_NOT_CONFIGURED'
    | 'UPSTREAM_ERROR'
    | 'INVALID_JSON_OUTPUT'
    | 'SCHEMA_VALIDATION_FAILED';

  constructor(
    provider: AIProviderName,
    code: AIProviderError['code'],
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'AIProviderError';
    this.provider = provider;
    this.code = code;
  }
}

const SECRET_PLACEHOLDERS = ['your-gemini-', 'your-aws-', 'your-agnes-', 'placeholder', 'changeme'];
const MAX_BASE64_LENGTH = 14_000_000; // ~10 MB binary image cap

function isRealValue(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length < 6) return false;
  const lower = trimmed.toLowerCase();
  return !SECRET_PLACEHOLDERS.some((p) => lower.includes(p));
}

export function resolveActiveProvider(override?: AIProviderName): AIProviderName {
  if (override === 'bedrock' || override === 'gemini' || override === 'agnes') return override;
  const raw = (process.env.AI_PROVIDER ?? 'gemini').trim().toLowerCase();
  if (raw === 'bedrock') return 'bedrock';
  if (raw === 'agnes') return 'agnes';
  return 'gemini';
}

export interface AIProviderStatus {
  activeProvider: AIProviderName;
  geminiConfigured: boolean;
  geminiModelId: string;
  agnesConfigured: boolean;
  agnesBaseUrl: string;
  agnesModelId: string;
  bedrockConfigured: boolean;
  awsRegion: string;
  bedrockModelId: string;
  s3BucketConfigured: boolean;
}

/**
 * Returns non-secret AI configuration diagnostics for /api/health.
 */
export function getAIProviderStatus(): AIProviderStatus {
  return {
    activeProvider: resolveActiveProvider(),
    geminiConfigured: isRealValue(process.env.GEMINI_API_KEY),
    geminiModelId: process.env.GEMINI_MODEL_ID?.trim() || 'gemini-2.5-flash',
    agnesConfigured: isRealValue(process.env.AGNES_API_KEY),
    agnesBaseUrl: (process.env.AGNES_BASE_URL?.trim() || 'https://apihub.agnes-ai.com/v1').replace(/\/+$/, ''),
    agnesModelId: process.env.AGNES_MODEL_ID?.trim() || 'agnes-2.5-flash',
    bedrockConfigured:
      isRealValue(process.env.AWS_ACCESS_KEY_ID) &&
      isRealValue(process.env.AWS_SECRET_ACCESS_KEY),
    awsRegion: process.env.AWS_REGION?.trim() || 'ap-southeast-1',
    bedrockModelId: process.env.BEDROCK_MODEL_ID?.trim() || 'apac.amazon.nova-lite-v1:0',
    s3BucketConfigured: isRealValue(process.env.AWS_S3_BUCKET),
  };
}

function stripDataUrlPrefix(base64: string): string {
  const commaIdx = base64.indexOf(',');
  if (base64.startsWith('data:') && commaIdx !== -1) {
    return base64.slice(commaIdx + 1).trim();
  }
  return base64.trim();
}

function mapMimeToBedrockFormat(mimeType: SupportedImageMimeType): ImageFormat {
  switch (mimeType) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpeg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
  }
}

/**
 * Extracts a JSON object or array from model text output (handling markdown code fences).
 */
export function extractJsonString(rawText: string): string {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new SyntaxError('Model returned empty text response.');
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch && fencedMatch[1]) {
    return fencedMatch[1].trim();
  }

  const firstObj = trimmed.indexOf('{');
  const firstArr = trimmed.indexOf('[');
  const start =
    firstObj === -1
      ? firstArr
      : firstArr === -1
        ? firstObj
        : Math.min(firstObj, firstArr);

  if (start === -1) {
    return trimmed;
  }

  const closingChar = trimmed[start] === '{' ? '}' : ']';
  const end = trimmed.lastIndexOf(closingChar);
  if (end > start) {
    return trimmed.slice(start, end + 1);
  }
  return trimmed.slice(start);
}

async function invokeBedrockConverse(params: {
  systemPrompt: string;
  userPrompt: string;
  cleanBase64?: string;
  imageMimeType: SupportedImageMimeType;
}): Promise<string> {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
  const sessionToken = process.env.AWS_SESSION_TOKEN?.trim();
  const region = process.env.AWS_REGION?.trim() || 'ap-southeast-1';
  const modelId = process.env.BEDROCK_MODEL_ID?.trim() || 'apac.amazon.nova-lite-v1:0';

  if (!isRealValue(accessKeyId) || !isRealValue(secretAccessKey) || !accessKeyId || !secretAccessKey) {
    throw new AIProviderError(
      'bedrock',
      'PROVIDER_NOT_CONFIGURED',
      'AWS Bedrock credentials are not configured in .env.local (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY).'
    );
  }

  const client = new BedrockRuntimeClient({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken ? { sessionToken } : {}),
    },
  });

  const content: ContentBlock[] = [];
  if (params.cleanBase64) {
    const binaryBytes = new Uint8Array(Buffer.from(params.cleanBase64, 'base64'));
    content.push({
      image: {
        format: mapMimeToBedrockFormat(params.imageMimeType),
        source: { bytes: binaryBytes },
      },
    });
  }
  content.push({
    text: `${params.userPrompt}\n\nIMPORTANT: Return ONLY valid JSON with no markdown commentary.`,
  });

  const command = new ConverseCommand({
    modelId,
    system: [{ text: params.systemPrompt }],
    messages: [{ role: 'user', content }],
    inferenceConfig: {
      temperature: 0.1,
      maxTokens: 2048,
    },
  });

  const response = await client.send(command);
  const blocks = response.output?.message?.content ?? [];
  return blocks
    .map((block) => ('text' in block && typeof block.text === 'string' ? block.text : ''))
    .join('\n')
    .trim();
}

async function invokeGeminiGenerate(params: {
  systemPrompt: string;
  userPrompt: string;
  cleanBase64?: string;
  imageMimeType: SupportedImageMimeType;
}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!isRealValue(apiKey) || !apiKey) {
    throw new AIProviderError(
      'gemini',
      'PROVIDER_NOT_CONFIGURED',
      'Google Gemini credentials are not configured in .env.local (GEMINI_API_KEY).'
    );
  }

  const useEnterprise = process.env.GEMINI_USE_VERTEX?.trim().toLowerCase() === 'true';
  const ai = new GoogleGenAI(
    useEnterprise ? { enterprise: true, apiKey } : { apiKey, apiVersion: 'v1beta' }
  );
  const model = process.env.GEMINI_MODEL_ID?.trim() || 'gemini-2.5-flash';

  const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [];
  if (params.cleanBase64) {
    parts.push({
      inlineData: {
        data: params.cleanBase64,
        mimeType: params.imageMimeType === 'image/jpg' ? 'image/jpeg' : params.imageMimeType,
      },
    });
  }
  parts.push({ text: params.userPrompt });

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts }],
    config: {
      systemInstruction: params.systemPrompt,
      responseMimeType: 'application/json',
      temperature: 0.1,
      ...(model.includes('2.5-flash') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  });

  return (response.text ?? '').trim();
}

async function invokeAgnesChatCompletions(params: {
  systemPrompt: string;
  userPrompt: string;
  cleanBase64?: string;
  imageMimeType: SupportedImageMimeType;
}): Promise<string> {
  const apiKey = process.env.AGNES_API_KEY?.trim();
  const baseUrl = (process.env.AGNES_BASE_URL?.trim() || 'https://apihub.agnes-ai.com/v1').replace(/\/+$/, '');
  const model = process.env.AGNES_MODEL_ID?.trim() || 'agnes-2.5-flash';

  if (!isRealValue(apiKey) || !apiKey) {
    throw new AIProviderError(
      'agnes',
      'PROVIDER_NOT_CONFIGURED',
      'Agnes AI credentials are not configured in .env.local (AGNES_API_KEY).'
    );
  }

  const normalizedMime = params.imageMimeType === 'image/jpg' ? 'image/jpeg' : params.imageMimeType;
  const userText = `${params.userPrompt}\n\nIMPORTANT: Return ONLY valid JSON with no markdown commentary.`;
  const userContent = params.cleanBase64
    ? [
        { type: 'image_url', image_url: { url: `data:${normalizedMime};base64,${params.cleanBase64}` } },
        { type: 'text', text: userText },
      ]
    : userText;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 2048,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: userContent },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new AIProviderError(
      'agnes',
      'UPSTREAM_ERROR',
      `Agnes AI HTTP ${response.status}: ${errBody.slice(0, 200) || response.statusText}`
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('\n')
      .trim();
  }
  return '';
}

function isProviderConfigured(provider: AIProviderName): boolean {
  if (provider === 'gemini') return isRealValue(process.env.GEMINI_API_KEY);
  if (provider === 'agnes') return isRealValue(process.env.AGNES_API_KEY);
  return (
    isRealValue(process.env.AWS_ACCESS_KEY_ID) &&
    isRealValue(process.env.AWS_SECRET_ACCESS_KEY)
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, provider: AIProviderName): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new AIProviderError(
          provider,
          'UPSTREAM_ERROR',
          `AI request timed out after ${Math.round(timeoutMs / 1000)}s.`
        )
      );
    }, timeoutMs);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function invokeProviderAndValidate<T>(params: {
  provider: AIProviderName;
  enrichedSystemPrompt: string;
  userPrompt: string;
  cleanBase64?: string;
  imageMimeType: SupportedImageMimeType;
  schema: z.ZodType<T>;
}): Promise<T> {
  const { provider, enrichedSystemPrompt, userPrompt, cleanBase64, imageMimeType, schema } = params;
  let rawOutput: string;
  try {
    const callPromise =
      provider === 'bedrock'
        ? invokeBedrockConverse({
            systemPrompt: enrichedSystemPrompt,
            userPrompt,
            cleanBase64,
            imageMimeType,
          })
        : provider === 'agnes'
          ? invokeAgnesChatCompletions({
              systemPrompt: enrichedSystemPrompt,
              userPrompt,
              cleanBase64,
              imageMimeType,
            })
          : invokeGeminiGenerate({
              systemPrompt: enrichedSystemPrompt,
              userPrompt,
              cleanBase64,
              imageMimeType,
            });
    rawOutput = await withTimeout(callPromise, 20_000, provider);
  } catch (err) {
    if (err instanceof AIProviderError) throw err;
    throw new AIProviderError(
      provider,
      'UPSTREAM_ERROR',
      err instanceof Error ? err.message : 'Upstream AI model invocation failed.',
      { cause: err }
    );
  }

  let parsedJson: unknown;
  try {
    const jsonCandidate = extractJsonString(rawOutput);
    parsedJson = JSON.parse(jsonCandidate);
  } catch (err) {
    throw new AIProviderError(
      provider,
      'INVALID_JSON_OUTPUT',
      'AI model response did not contain valid JSON.',
      { cause: err }
    );
  }

  const validation = schema.safeParse(parsedJson);
  if (!validation.success) {
    throw new AIProviderError(
      provider,
      'SCHEMA_VALIDATION_FAILED',
      `AI JSON failed Zod schema validation: ${validation.error.message}`,
      { cause: validation.error }
    );
  }

  return validation.data;
}

/**
 * Unified multimodal structured JSON helper supporting AWS Bedrock (ConverseCommand),
 * Google Gemini (@google/genai), and Agnes AI (OpenAI-compatible), strictly validated against a Zod schema.
 */
export async function generateStructuredJSON<T>(
  params: GenerateStructuredJSONParams<T>
): Promise<T> {
  const provider = resolveActiveProvider(params.providerOverride);

  if (typeof window !== 'undefined') {
    throw new AIProviderError(
      provider,
      'INVALID_INPUT',
      'generateStructuredJSON() must only execute on the server.'
    );
  }

  const systemPrompt = params.systemPrompt?.trim();
  const userPrompt = params.userPrompt?.trim();
  if (!systemPrompt || !userPrompt) {
    throw new AIProviderError(
      provider,
      'INVALID_INPUT',
      'Both systemPrompt and userPrompt must be non-empty strings.'
    );
  }

  const imageMimeType: SupportedImageMimeType = params.imageMimeType ?? 'image/png';
  let cleanBase64: string | undefined;
  if (params.imageBase64 !== undefined) {
    cleanBase64 = stripDataUrlPrefix(params.imageBase64);
    if (!cleanBase64) {
      throw new AIProviderError(provider, 'INVALID_INPUT', 'Provided imageBase64 payload is empty.');
    }
    if (cleanBase64.length > MAX_BASE64_LENGTH) {
      throw new AIProviderError(
        provider,
        'INVALID_INPUT',
        'Image payload exceeds maximum 10MB serverless limit.'
      );
    }
  }

  let jsonSchemaHint = '';
  try {
    jsonSchemaHint = `\n\nSTRICT JSON OUTPUT SCHEMA (return ONLY a valid JSON object matching every required key and enum):\n${JSON.stringify(z.toJSONSchema(params.schema, { unrepresentable: 'any' }))}`;
  } catch {
    jsonSchemaHint = '';
  }
  const enrichedSystemPrompt = `${systemPrompt}${jsonSchemaHint}`;

  const candidates: AIProviderName[] = params.providerOverride
    ? [provider]
    : [
        provider,
        ...(['gemini', 'agnes', 'bedrock'] as const).filter(
          (p) => p !== provider && isProviderConfigured(p)
        ),
      ];

  let lastError: AIProviderError | null = null;
  for (const candidate of candidates) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await invokeProviderAndValidate({
          provider: candidate,
          enrichedSystemPrompt,
          userPrompt,
          cleanBase64,
          imageMimeType,
          schema: params.schema,
        });
      } catch (err) {
        const aiErr =
          err instanceof AIProviderError
            ? err
            : new AIProviderError(
                candidate,
                'UPSTREAM_ERROR',
                err instanceof Error ? err.message : 'Upstream AI model invocation failed.',
                { cause: err }
              );
        lastError = aiErr;
        if (aiErr.code === 'PROVIDER_NOT_CONFIGURED' || aiErr.code === 'INVALID_INPUT') {
          break;
        }
        if (attempt < 2) {
          const delayMs = attempt === 0 ? 400 : 900;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
  }

  throw (
    lastError ??
    new AIProviderError(provider, 'UPSTREAM_ERROR', 'Upstream AI model invocation failed.')
  );
}
