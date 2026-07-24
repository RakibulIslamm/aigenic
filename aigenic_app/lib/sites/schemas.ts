import { z } from 'zod';

export const createSiteSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  domain: z
    .string()
    .trim()
    .min(1, 'Domain is required')
    .max(500)
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    }, 'Must be a full URL, e.g. https://example.com'),
  escalationEmail: z.string().trim().email('Enter a valid email'),
  maxPages: z.coerce.number().int().min(50).max(2000).default(1000),
});

export const updateSiteSchema = z.object({
  name: z.string().trim().min(1).max(100),
  domain: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    }, 'Must be a full URL'),
  escalationEmail: z.string().trim().email(),
  primaryColor: z
    .string()
    .trim()
    .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Must be a hex color like #7c5cff'),
  greeting: z.string().trim().min(1).max(280),
  botName: z.string().trim().min(1).max(50),
});

export const DEFAULT_WIDGET_CONFIG = {
  primaryColor: '#7c5cff',
  greeting: "Hey! I'm here to help. Ask me anything about us.",
  botName: 'Support',
} as const;
