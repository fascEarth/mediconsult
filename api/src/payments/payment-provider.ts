import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface CreatedOrder {
  provider: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  /** Public key / client data the browser checkout needs. */
  clientData: Record<string, unknown>;
}

export interface PaymentConfirmation {
  orderId: string;
  paymentId: string;
  signature?: string;
}

export interface PaymentProvider {
  readonly name: string;
  createOrder(input: { amountMinor: number; currency: string; receipt: string }): Promise<CreatedOrder>;
  verify(input: PaymentConfirmation): Promise<boolean>;
  refund(paymentId: string, amountMinor: number): Promise<boolean>;
}

/** Demo: no money moves. Used for public demos and local dev. */
export class DemoPaymentProvider implements PaymentProvider {
  readonly name = 'demo';
  async createOrder(input: { amountMinor: number; currency: string }) {
    return { provider: this.name, orderId: `demo_order_${randomBytes(8).toString('hex')}`, amountMinor: input.amountMinor, currency: input.currency, clientData: { demo: true } };
  }
  async verify(input: PaymentConfirmation) {
    return input.orderId.startsWith('demo_order_') && input.paymentId.startsWith('demo_pay_');
  }
  async refund() {
    return true;
  }
}

/** Razorpay (India). Checkout.js on the client; signature verified here. */
export class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay';
  constructor(private readonly keyId: string, private readonly keySecret: string) {}

  private get auth() {
    return 'Basic ' + Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
  }

  async createOrder(input: { amountMinor: number; currency: string; receipt: string }) {
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: this.auth },
      body: JSON.stringify({ amount: input.amountMinor, currency: input.currency, receipt: input.receipt }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Razorpay order failed: ${res.status}`);
    const order = (await res.json()) as { id: string };
    return { provider: this.name, orderId: order.id, amountMinor: input.amountMinor, currency: input.currency, clientData: { keyId: this.keyId } };
  }

  async verify(input: PaymentConfirmation) {
    if (!input.signature) return false;
    const expected = createHmac('sha256', this.keySecret).update(`${input.orderId}|${input.paymentId}`).digest('hex');
    const a = Buffer.from(expected), b = Buffer.from(input.signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async refund(paymentId: string, amountMinor: number) {
    const res = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refund`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: this.auth },
      body: JSON.stringify({ amount: amountMinor }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  }
}

export function createPaymentProvider(): PaymentProvider {
  if (process.env.PAYMENT_PROVIDER === 'razorpay') {
    const id = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET;
    if (!id || !secret) throw new Error('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET required');
    return new RazorpayProvider(id, secret);
  }
  return new DemoPaymentProvider();
}
