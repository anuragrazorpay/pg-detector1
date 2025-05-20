export const config = {
  timeout: 35000,
  maxRetries: 2,
  headless: false, // flip to true for stealth
  slowMo: 100, // ms between actions
  evidenceDir: './evidence',
  openAiModel: 'gpt-4o', // or gpt-4-turbo if 128k context needed
  maxElements: 35 // max interactive elements sent to LLM per page
};
