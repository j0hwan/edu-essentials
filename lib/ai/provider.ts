import { AI_MAX_INPUT_CHARS, AI_MAX_OUTPUT_TOKENS } from "./contracts";

export type Part = { text?: string; thought?: boolean; thoughtSignature?: string; functionCall?: { name: string; args: unknown }; functionResponse?: { name: string; response: unknown } };
export type Content = { role: "user" | "model"; parts: Part[] };
export type ToolDeclaration = { name: string; description: string; parameters: Record<string, unknown> };
export type ModelResult = { content: Content; inputTokens: number; outputTokens: number };
export interface AiProvider { generate(system: string, contents: Content[], declarations: ToolDeclaration[]): Promise<ModelResult> }

export class ProviderError extends Error {
  constructor(public status: number, message: string, public retryable = false, public upstreamStatus?: number) { super(message); }
}
export class GeminiProvider implements AiProvider {
  constructor(private key: string, private model: string, private fetcher: typeof fetch = fetch) {}
  async generate(system: string, contents: Content[], declarations: ToolDeclaration[]): Promise<ModelResult> {
    if (!this.key) throw new ProviderError(503, "AI is not configured.");
    const body = { systemInstruction: { parts: [{ text: system }] }, contents,
      ...(declarations.length ? { tools: [{ functionDeclarations: declarations.map(({ parameters, ...d }) => ({ ...d, parametersJsonSchema: parameters })) }] } : {}),
      generationConfig: { maxOutputTokens: AI_MAX_OUTPUT_TOKENS } };
    if (new TextEncoder().encode(JSON.stringify(body)).byteLength > AI_MAX_INPUT_CHARS) throw new ProviderError(413, "This conversation needs a shorter question or a new conversation.");
    let response: Response;
    try { response = await this.fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
      method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": this.key }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000),
    }); } catch (error) {
      const timeout = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
      throw new ProviderError(timeout ? 504 : 503, timeout ? "Gemini took too long to respond. Please retry shortly." : "Could not connect to Gemini. Please retry shortly.", true);
    }
    if (!response.ok) {
      if (response.status === 429) throw new ProviderError(429, "Gemini's request quota is exhausted. Wait for the quota to reset and try again.", false, 429);
      if ([401, 403].includes(response.status)) throw new ProviderError(502, "Gemini rejected the server API key or its permissions. The administrator needs to check the Gemini key.", false, response.status);
      if (response.status >= 500 || response.status === 408) throw new ProviderError(503, "Google Gemini is temporarily busy or unavailable. Please try again shortly. No academic changes were made.", true, response.status);
      throw new ProviderError(502, "Gemini rejected the model request. The administrator needs to check the model configuration.", false, response.status);
    }
    const data = await response.json() as { candidates?: { content?: Content; finishReason?: string }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } };
    const candidate = data.candidates?.[0];
    if (!candidate?.content?.parts?.length || (candidate.finishReason && candidate.finishReason !== "STOP")) throw new ProviderError(422, "The model did not produce a complete answer. Try a narrower question.");
    return { content: { role: "model", parts: candidate.content.parts }, inputTokens: data.usageMetadata?.promptTokenCount ?? 0, outputTokens: (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0) };
  }
}

export async function embedText(key: string, model: string, text: string, query = false): Promise<number[]> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent`, {
    method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ content: { parts: [{ text: `${query ? "Retrieve documents relevant to this query" : "Represent this document for retrieval"}: ${text}` }] }, outputDimensionality: 768 }),
  });
  if (!response.ok) throw new ProviderError(response.status, "Document search embedding is unavailable.");
  const result = await response.json() as { embedding?: { values?: number[] } };
  const values = result.embedding?.values;
  if (!values || values.length !== 768 || values.some((n) => !Number.isFinite(n))) throw new Error("Invalid embedding response.");
  return values;
}
