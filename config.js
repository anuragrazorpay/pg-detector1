export const config = {
  timeout: 35000,
  maxRetries: 2,
  headless: false, // set true for stealth mode
  slowMo: 100, // ms between actions
  evidenceDir: './evidence',
  geminiModel: 'models/gemini-1.5-pro-latest', // update as needed
  maxElements: 35 // LLM prompt efficiency
};
