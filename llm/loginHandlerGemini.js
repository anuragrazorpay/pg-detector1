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
You are a web automation agent analyzing a checkout login/signup flow. First check if this is a platform-powered checkout (e.g., Gokwik, Razorpay Checkout) or custom checkout.
Then advise whether to proceed as guest (if available) or fill login credentials.

IMPORTANT: For platform checkouts, prefer guest/social login options over credential login.

Return ONLY a JSON object like:
{
  "platformIndicators": {
    "detected": false,           // or true if platform checkout detected
    "platform": null,           // platform name if detected
    "confidence": 0            // 0-1 confidence score
  },
  "loginStrategy": {
    "type": "guest" | "login" | "social",  // preferred login method
    "reason": "Guest checkout available",   // why this method was chosen
    "selectors": {                         // relevant selectors
      "guestButton": ".guest-checkout",    // if guest flow
      "usernameField": "#email",          // if login flow
      "passwordField": "#password",
      "loginButton": "#login",
      "socialButton": ".google-login"      // if social login flow
    }
  }
}

Here are the visible form elements:
${JSON.stringify(loginArr, null, 2)}
`;

  try {
    const model = genAI.getGenerativeModel({ model: config.geminiModel });
    const result = await model.generateContent(prompt);
    const response = await result.response.text();

    // Extract first JSON object from anywhere in the text
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
    
    // Validate response format
    if (obj && obj.platformIndicators && obj.loginStrategy) {
      return obj;
    }
    throw new Error('Gemini returned invalid format: ' + response);
  } catch (err) {
    console.error('Gemini login handler returned unexpected format:', err.message);
    return null;
  }
}
