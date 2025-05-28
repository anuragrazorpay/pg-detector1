pg-detector1-main — Universal Payment Gateway Detector
Overview
pg-detector1-main is an automation tool that identifies payment gateway integrations on any e-commerce website.
It combines Playwright (for browser automation) and LLMs (GPT-4o/Gemini) for smart DOM navigation, simulating a real user's cart-to-checkout journey, and extracting all technical evidence of payment solutions present on the site.

Features
Automated Cart/Checkout Simulation:
Uses Playwright to add items to cart, fill checkout forms, and reach the payment page as a real user would.

AI-Powered Navigation:
LLMs help identify UI elements (add to cart, checkout), solve popups, CAPTCHAs, and login walls.

Payment Gateway Detection:
Identifies payment scripts, iframes, and branding for Razorpay, Stripe, PayU, CCAvenue, and more.

Evidence Collection:
Saves screenshots, raw HTML, and network logs to /evidence/<runid>/ for audit/compliance.

JSON Reporting:
Outputs a machine-readable report of gateways found, evidence paths, and errors.

Extensible:
Easy to plug in proxies, new heuristics, and alternate LLMs (Azure, Gemini, etc.).

Architecture & Main Components
File/Folder	Purpose
.env	API keys and secrets (e.g., OpenAI).
index.js	Entry point. Receives URL, runs main workflow, outputs JSON.
config.js	App-wide configs (timeouts, API base URLs, etc.).
userAgents.js	Pool of user-agents for browser session randomization.
package.json	Project dependencies and scripts.
README.md	Short project readme and quickstart.
automation/	
├── playwrightRunner.js	Orchestrates full simulation (cart, checkout, payment page discovery).
├── checkoutFormFiller.js	Autofills checkout forms with fake/test data.
├── heuristics.js	Core logic to parse scripts, iframes, network for PG detection.
├── evidence.js	Stores screenshots, logs, HTML dumps for evidence.
├── captchaHandler.js	Handles/solves basic CAPTCHAs using LLM/heuristics.
├── popupHandler.js	Detects and closes popups and overlays.
llm/	
├── domSelectorGemini.js	LLM routines to find selectors for UI elements.
├── optionFillingGemini.js	Handles option selections (e.g., size, color).
├── loginHandlerGemini.js	Detects login screens, automates dummy login if required.
├── popupHandlerGemini.js	LLM-powered overlay/popup handling.
├── visionNavigator.js	(Likely for visual navigation using screenshots & LLM vision models)

How It Works (Step-by-Step Flow)
Run the Script

bash
Copy
Edit
node index.js <target_website_url>
Main Entry (index.js):

Grabs the input URL from command line.

Calls runCartSimulation(url) (from automation/playwrightRunner.js).

Cart & Checkout Simulation

Launches a browser (Playwright).

Navigates to the product page.

Uses LLM modules to:

Find and click “Add to Cart”.

Solve popups or overlays if they appear.

Proceed to the checkout page.

Autofills shipping, email, and address fields (checkoutFormFiller.js).

Handles logins and CAPTCHAs with dedicated modules.

Navigates up to the payment gateway page.

Payment Gateway Detection

Scripts/Iframes: Scans for known gateway scripts, iframes, and endpoints (heuristics.js).

Visual/Network Clues: Looks for payment logos, API calls, and branding.

Collects screenshots and evidence throughout.

Result Output

All evidence is saved in /evidence/<runid>/.

Prints a final structured JSON object with:

Detected payment gateways

All evidence links

Scripts, selectors, iframes found

Error logs if any

Example Output
json
Copy
Edit
{
  "url": "https://example.com",
  "gateways_detected": ["Razorpay", "PayU"],
  "evidence": {
    "screenshots": ["evidence/12345/home.png", "evidence/12345/checkout.png"],
    "scripts": ["https://checkout.razorpay.com/v1/checkout.js"],
    "iframes": ["https://secure.payu.in/_payment"]
  },
  "errors": [],
  "logs": ["Reached payment page", "Filled out address form", ...]
}
Extending the Tool
Proxies:
To evade geo-blocks or stricter bot protections, add proxy logic in playwrightRunner.js.

New Payment Gateway Detection:
Update heuristics.js to recognize more gateways by signature scripts/iframes/dom.

Alternate LLMs:
Replace logic in llm/ modules with Gemini or Azure calls as needed.

Bulk Scanning:
Wrap the entrypoint in a script to process multiple URLs from a file.

Developer Setup
Clone & Install

bash
Copy
Edit
git clone <repo_url>
cd pg-detector1-main
npm install
Set API Keys
Create a .env file with:

ini
Copy
Edit
OPENAI_API_KEY=sk-...
# Other keys as needed
Run Detection

bash
Copy
Edit
node index.js https://targetsite.com
Project Strengths
Automates what would otherwise be hours of manual work.

AI-augmented navigation: Works on most modern e-commerce UIs without custom rules.

Audit Trail: Full evidence for every claim.

Highly extensible: New gateways, proxies, and LLMs can be plugged in.

Troubleshooting
Bot detection/captcha issues:
Update user-agents, add proxies, or tweak LLM logic.

LLM API errors:
Check .env and OpenAI usage limits.

Element not found:
Improve selector heuristics in llm/domSelectorGemini.js.
