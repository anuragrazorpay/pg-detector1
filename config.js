export const config = {
  timeout: 35000,
  maxRetries: 5,
  headless: true, // set true for stealth mode
  slowMo: 50, // ms between actions
  evidenceDir: './evidence',
  geminiModel: 'gemini-pro', // update as needed
  maxElements: 35 // LLM prompt efficiency
};
