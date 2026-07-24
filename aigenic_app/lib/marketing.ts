/**
 * Single source of truth for drift-prone marketing facts. The landing page
 * (hero badge, FAQ, metrics) renders from here and the README cites the same
 * values — update them here, never hand-type them in copy. Plan availability
 * and pricing already live in `lib/billing/plans.ts`; model wiring imports
 * SUPPORT_MODEL_ID from this file so the landing page never pulls in the AI
 * client.
 */

/** OpenRouter model id the support agent actually ships with. */
export const SUPPORT_MODEL_ID = 'deepseek/deepseek-v4-flash';

/** Human-readable model name for badges and FAQ copy. */
export const SUPPORT_MODEL_NAME = 'DeepSeek V4 Flash';

/**
 * Approximate gzipped size of the built widget bundle (public/widget.js).
 * Re-measure after widget changes: `pnpm --dir widget size` → bytes ÷ 1024.
 */
export const WIDGET_GZIP_KB = 12;
