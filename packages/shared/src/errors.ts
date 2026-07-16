import { z } from 'zod';

/**
 * Public error envelope returned by every non-2xx API response.
 * Production responses never expose internal error details.
 */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
