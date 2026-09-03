export const LLM_OUTPUT_TOKENS = {
  providerDefault: 8_192,
  providerPreflight: 4_096,
  capture: 8_192,
  judge: 4_096,
  compress: 8_192,
  meetingPreflight: 8_192,
  recommendation: 8_192,
} as const;

export const LLM_REQUEST_TIMEOUT_MS = 60_000;
