module.exports = {
    checkoutPlatforms: {
        shiprocket: {
            name: 'Shiprocket Checkout',
            patterns: [
                'shiprocket.checkout',
                'shiprocket-checkout',
                'sr-checkout',
                'shiprocket.co.in/checkout'
            ],
            selectors: ['[data-shiprocket-checkout]', '.shiprocket-checkout-container'],
            scripts: ['checkout.shiprocket.in', 'shiprocket-checkout.min.js']
        },
        gokwik: {
            name: 'GoKwik',
            patterns: [
                'gokwik.co',
                'api.gokwik.co',
                'gokwik-checkout'
            ],
            selectors: ['.gokwik-checkout', '[data-gokwik]'],
            scripts: ['checkout.gokwik.co', 'gokwik-client.js']
        },
        razorpayCheckout: {
            name: 'Razorpay Checkout',
            patterns: [
                'checkout.razorpay.com',
                'razorpay.co',
                'rzp_checkout'
            ],
            selectors: ['.razorpay-checkout-frame', '[data-razorpay]'],
            scripts: ['checkout.razorpay.com/v1', 'razorpay.js']
        },
        simpl: {
            name: 'Simpl Checkout',
            patterns: [
                'getsimpl.com',
                'simpl-checkout',
                'simpl.co.in'
            ],
            selectors: ['.simpl-checkout', '[data-simpl]'],
            scripts: ['checkout.getsimpl.com', 'simpl-checkout.js']
        },
        shopify: {
            name: 'Shopify Checkout',
            patterns: [
                'shopify.com/checkout',
                'checkout.shopify'
            ],
            selectors: ['[data-shopify="checkout"]', '.shopify-checkout'],
            scripts: ['checkout.shopify.com', 'shopify_pay.js']
        },
        payu: {
            name: 'PayU Checkout',
            patterns: [
                'payu.in',
                'checkout.payu',
                'payumoney'
            ],
            selectors: ['.payu-checkout', '[data-payu]'],
            scripts: ['checkout.payu.in', 'payu_checkout.js']
        },
        cashfree: {
            name: 'Cashfree Checkout',
            patterns: [
                'cashfree.com/checkout',
                'payments.cashfree'
            ],
            selectors: ['.cashfree-payment-frame', '[data-cashfree]'],
            scripts: ['checkout.cashfree.com', 'cashfree.js']
        },
        phonepe: {
            name: 'PhonePe Checkout',
            patterns: [
                'phonepe.com/checkout',
                'api.phonepe.com'
            ],
            selectors: ['.phonepe-checkout-frame', '[data-phonepe]'],
            scripts: ['checkout.phonepe.com', 'phonepe-sdk.js']
        },
        juspay: {
            name: 'Juspay',
            patterns: [
                'juspay.in',
                'api.juspay.in'
            ],
            selectors: ['.juspay-checkout', '[data-juspay]'],
            scripts: ['checkout.juspay.in', 'juspay-sdk.js']
        },
        magento: {
            name: 'Magento Checkout',
            patterns: [
                'checkout/onepage',
                'magento-checkout'
            ],
            selectors: ['[data-mage-init]', '.checkout-payment-method'],
            scripts: ['Magento_Checkout', 'checkout-data.js']
        },
        ccavenue: {
            name: 'CCAvenue Checkout',
            patterns: [
                'ccavenue.com',
                'secure.ccavenue.com'
            ],
            selectors: ['.ccavenue-checkout', '[data-ccavenue]'],
            scripts: ['checkout.ccavenue.com', 'ccavenue.js']
        },
        paypal: {
            name: 'PayPal Checkout',
            patterns: [
                'paypal.com/checkout',
                'paypalobjects.com'
            ],
            selectors: ['[data-paypal-checkout]', '.paypal-button'],
            scripts: ['www.paypal.com/sdk', 'paypal-checkout.js']
        }
    }
};
