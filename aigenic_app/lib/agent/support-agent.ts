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
  });
}
