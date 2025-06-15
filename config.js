export const config = {
  timeout: 35000,
  maxRetries: 5,
  headless: true, // set true for stealth mode
  slowMo: 50, // ms between actions
  evidenceDir: './evidence',
  geminiModel: 'gemini-2.0-flash', // update as needed
  maxElements: 35, // LLM prompt efficiency

  // --- Platform Detection Configuration ---
  platformDetectionConfig: {
    // Time to wait for platform/gateway detection after interactions
    detectionTimeout: 8000,
    
    // Minimum confidence score (0-1) for platform detection
    minConfidenceScore: 0.8,
    
    // List of known platforms and their detection patterns
    knownPlatforms: [
      {
        name: "Gokwik Checkout",
        priority: 1,
        domains: ["gokwik.co", "gwk.to", "gokwik.in"],
        selectors: [".gokwik-checkout", "[data-gokwik]", "#gokwik-frame", ".gwk-checkout-container"],
        apis: ["api.gokwik.co", "pay.gokwik.com"]
      },
      {
        name: "Razorpay Checkout",
        priority: 1,
        domains: ["checkout.razorpay.com"],
        selectors: ["#razorpay-checkout-frame", ".razorpay-checkout-frame", "[data-razorpay]"],
        apis: ["api.razorpay.com/v1/checkout"]
      },
      {
        name: "PayU Checkout",
        priority: 1,
        domains: ["checkout.payu.in", "secure.payu.in"],
        selectors: ["#payu-checkout-frame", "#PayUModal", "[data-payu]"],
        apis: ["secure.payu.in/_payment"]
      },
      {
        name: "Cashfree Checkout",
        priority: 1,
        domains: ["checkout.cashfree.com"],
        selectors: ["#cashfree-frame", ".cashfree-payment-frame"],
        apis: ["api.cashfree.com/pg"]
      }
    ],
    
    // Network request patterns that confirm active checkout
    confirmationPatterns: {
      gokwik: ["/checkout/init", "/pay/process"],
      razorpay: ["/v1/checkout", "/payment/validate"],
      payu: ["/_payment", "/processTransaction"],
      cashfree: ["/pg/orders", "/pg/process"]
    }
  },

  // --- Test Data for Autofill & Vision/LLM flows ---
  testData: {
    name: 'John Doe',
    email: 'utube.115111@gmail.com',
    password: 'utube115111@',
    phone: '9090119090',
    countryCode: '+91',
    addressLine1: 'flat no 104, B block',
    addressLine2: 'Splendid Lakedews, Vittasandra Main Rd, Begur',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560068',
    country: 'India'
  }
};
