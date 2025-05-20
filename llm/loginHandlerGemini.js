import dotenv from 'dotenv';
dotenv.config();

import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from '../config.js';

const model = genAI.getGenerativeModel({ model: config.geminiModel });

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

  const model = genAI.getGenerativeModel({ model: config.geminiModel });
  const result = await model.generateContent(prompt);
  const response = await result.response.text();
  let json = response.trim();
  if (json.startsWith("```")) {
    json = json.replace(/```(json)?/g, '').trim();
  }
  try {
    const obj = JSON.parse(json);
    if (typeof obj === 'object') return obj;
    throw new Error('Not an object');
  } catch {
    console.error('Gemini login handler returned unexpected format:', response);
    return null;
  }
}
