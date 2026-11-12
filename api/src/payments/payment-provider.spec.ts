import { createHmac } from 'node:crypto';
import { DemoPaymentProvider, RazorpayProvider } from './payment-provider';

describe('payment providers', () => {
  it('razorpay verifies a valid signature and rejects a forged one', async () => {
    const p = new RazorpayProvider('key', 'secret');
    const signature = createHmac('sha256', 'secret').update('order_1|pay_1').digest('hex');
    expect(await p.verify({ orderId: 'order_1', paymentId: 'pay_1', signature })).toBe(true);
    expect(await p.verify({ orderId: 'order_1', paymentId: 'pay_2', signature })).toBe(false);
    expect(await p.verify({ orderId: 'order_1', paymentId: 'pay_1' })).toBe(false);
  });

  it('demo only accepts demo ids', async () => {
    const p = new DemoPaymentProvider();
    const order = await p.createOrder({ amountMinor: 50000, currency: 'INR' });
    expect(await p.verify({ orderId: order.orderId, paymentId: 'demo_pay_1' })).toBe(true);
    expect(await p.verify({ orderId: 'order_real', paymentId: 'demo_pay_1' })).toBe(false);
  });
});
