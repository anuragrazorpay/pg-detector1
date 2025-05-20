export const config = {
  timeout: 35000,
  maxRetries: 5,
  headless: false, // set true for stealth mode
  slowMo: 50, // ms between actions
  evidenceDir: './evidence',
  geminiModel: 'gemini-1.5-pro-latest', // update as needed
  maxElements: 35 // LLM prompt efficiency
};
