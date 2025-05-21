import dotenv from 'dotenv';
dotenv.config();

import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from '../config.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * @param {Array} loginArr - Array of visible form/input/button elements with selector, text, etc.
 * @returns {Promise<Object>} - { type: "guest" | "login", selector: string, creds: {username, password} }
 */
export async function suggestLoginStrategyWithGemini(loginArr) {
  if (!loginArr.length) return null;
  const prompt = `
You are a web automation agent. The following visible elements suggest a login or signup flow.
Based on the elements, advise whether to proceed as guest (if a guest/continue button is present) or to fill login credentials (if required).
Return ONLY as a JSON object like:
{ "type": "guest", "selector": ".guest-checkout-btn" }
or
{ "type": "login", "usernameSelector": "#email", "passwordSelector": "#password", "loginBtnSelector": "#login", "creds": { "username": "test@example.com", "password": "test1234" } }

Here are the elements:
${JSON.stringify(loginArr, null, 2)}
`;

  try {
    const model = genAI.getGenerativeModel({ model: config.geminiModel });
    const result = await model.generateContent(prompt);
    const response = await result.response.text();

    // Extract first JSON object from anywhere in the text (even if LLM returns extra junk)
    let json = response.trim();
    // Remove code blocks
    if (json.startsWith("```")) json = json.replace(/```(json)?/g, '').trim();

    // Try to extract JSON object from mixed content
    let obj = null;
    try {
      obj = JSON.parse(json);
    } catch {
      // Fallback: greedy regex for first {...} block
      const match = json.match(/{[\s\S]*}/);
      if (match) {
        try { obj = JSON.parse(match[0]); } catch {}
      }
    }
    if (obj && typeof obj === 'object') return obj;

    throw new Error('Gemini returned invalid format: ' + response);
  } catch (err) {
    console.error('Gemini login handler returned unexpected format:', err.message);
    return null;
  }
}
