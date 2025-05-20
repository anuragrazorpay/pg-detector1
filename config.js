export const config = {
  timeout: 35000,
  maxRetries: 5,
  headless: true, // set true for stealth mode
  slowMo: 50, // ms between actions
  evidenceDir: './evidence',
  geminiModel: 'gemini-2.0-flash', // update as needed
  maxElements: 35, // LLM prompt efficiency

  // --- Test Data for Autofill & Vision/LLM flows ---
  testData: {
    name: 'John Doe',
    email: 'utube.115111@gmail.com',
    password: 'utube115111@',
    phone: '9090119090',
    countryCode: '+91',
    address: 'flat no 104, B block',
    addressLine1: 'Splendid Lakedews, Vittasandra Main Rd, Begur',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560068',
    country: 'India'
  }
};
