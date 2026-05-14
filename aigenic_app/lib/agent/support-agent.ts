import { streamText, stepCountIs, type ModelMessage } from 'ai';
import { supportModel } from './model';
import { buildSupportTools, type SupportToolContext } from './tools';
import { buildSystemPrompt, type SystemPromptInput } from './system-prompt';

export interface RunSupportAgentOptions {
  context: SupportToolContext;
  prompt: SystemPromptInput;
  history: ModelMessage[];
  abortSignal?: AbortSignal;
}

/**
 * Returns a streaming `streamText` result the route handler can hand to the
 * widget over SSE. We cap the agent at 8 tool-loop steps — enough room for
 * search → read → answer (plus a re-search) without runaway costs.
 */
export function runSupportAgent({
  context,
  prompt,
  history,
  abortSignal,
}: RunSupportAgentOptions) {
  return streamText({
    model: supportModel,
    system: buildSystemPrompt(prompt),
    messages: history,
    tools: buildSupportTools(context),
    stopWhen: stepCountIs(8),
    temperature: 0.3,
    abortSignal,
    // OpenRouter's deepseek-v4-flash routing is flaky on cold first calls
    // (EPIPE/ECONNRESET from a stale upstream). The default of 2 retries
    // often isn't enough to escape a bad provider — bumping to 4 trades a
    // few seconds of worst-case latency for a much higher success rate on
    // the first message of a session.
    maxRetries: 4,
  });
}
