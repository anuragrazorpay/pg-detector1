// llm/visionNavigator.js
import axios from 'axios';
import fs from 'fs';

const VISION_API_URL = process.env.VISION_LLM_URL || 'https://your-llm-endpoint/vision-navigator';

export async function suggestNextActionWithVisionLLM(screenshotPath, html, action = 'checkout') {
  // Read screenshot as base64
  const imageBase64 = fs.readFileSync(screenshotPath, { encoding: 'base64' });

  const prompt = `
You are an expert e-commerce navigator. Given the following screenshot and HTML after the user clicked "${action}":
a) Is there a modal, popup, or overlay visible?
b) If yes, what action should be taken to proceed to checkout?
c) If not, what is the next best step (e.g., click "Cart" icon, "Checkout", etc.)?
d) For every step, give the button/link text and, if possible, match it to a DOM selector or HTML snippet.
If multiple options, describe unique features (position, color, icon, etc.).
ALWAYS output an explicit actionable selector or button to click. NEVER say "proceed as usual".
  `.trim();

  try {
    const resp = await axios.post(
      VISION_API_URL,
      {
        prompt,
        image: imageBase64,
        html,
      },
      { timeout: 60000 }
    );
    // Expect response: { selector: "...", buttonText: "...", htmlHint: "...", description: "..." }
    return resp.data;
  } catch (err) {
    console.error('Vision LLM call failed', err.message);
    return null;
  }
}
