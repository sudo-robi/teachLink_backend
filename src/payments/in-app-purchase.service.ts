import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MobilePaymentsService, MobilePaymentProvider, IMobilePurchasePayload, IMobileSubscriptionPayload } from './mobilePayments.service';
import { Subscription, SubscriptionStatus } from './entities/subscription.entity';
import { Payment, PaymentStatus } from './entities/payment.entity';
import { User } from '../users/entities/user.entity';

export enum InAppProductType {
  CONSUMABLE = 'consumable',
  NON_CONSUMABLE = 'non-consumable',
  SUBSCRIPTION = 'subscription',
}

export interface IInAppProduct {
  id: string;
  productId: string;
  type: InAppProductType;
  title: string;
  description: string;
  price: number;
  currency: string;
}

export interface IPurchaseResult {
  success: boolean;
  orderId?: string;
  error?: string;
}

@Injectable()
export class InAppPurchaseService {
  private readonly logger = new Logger(InAppPurchaseService.name);
  private readonly products: Map<string, IInAppProduct>;

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly mobilePaymentsService: MobilePaymentsService,
  ) {
    this.products = new Map();
    this.initializeProducts();
  }

  private initializeProducts(): void {
    this.products.set('premium_monthly', {
      id: 'premium_monthly',
      productId: 'premium_monthly',
      type: InAppProductType.SUBSCRIPTION,
      title: 'Premium Monthly',
      description: 'Access all premium features',
      price: 9.99,
      currency: 'USD',
    });
  }

  async processPurchase(payload: IMobilePurchasePayload): Promise<IPurchaseResult> {
    const { productId, transactionId, userId } = payload;

    const product = this.products.get(productId);
    if (!product) {
      return { success: false, error: 'Product not found' };
    }

    const result = await this.mobilePaymentsService.processPurchase(payload);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    if (product.type === InAppProductType.SUBSCRIPTION) {
      return await this.createOrUpdateSubscription(userId, product, result.paymentId);
    }

    await this.recordPayment(userId, product, result.paymentId);

    return {
      success: true,
      orderId: result.paymentId,
    };
  }

  async processSubscriptionPurchase(
    payload: IMobileSubscriptionPayload,
  ): Promise<IPurchaseResult> {
    const { productId, transactionId, userId, expiryDate } = payload;

    const product = this.products.get(productId);
    if (!product) {
      return { success: false, error: 'Product not found' };
    }

    const result = await this.mobilePaymentsService.processSubscription({
      ...payload,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return await this.createOrUpdateSubscription(userId, product, result.paymentId);
  }

  private async createOrUpdateSubscription(
    userId: string,
    product: IInAppProduct,
    paymentId: string,
  ): Promise<IPurchaseResult> {
    let subscription = await this.subscriptionRepository.findOne({
      where: { user: { id: userId } },
    });

    if (subscription) {
      subscription.status = SubscriptionStatus.ACTIVE;
      subscription.provider = 'mobile';
      subscription.providerSubscriptionId = paymentId;
    } else {
      subscription = this.subscriptionRepository.create({
        user: { id: userId } as User,
        status: SubscriptionStatus.ACTIVE,
        provider: 'mobile',
        providerSubscriptionId: paymentId,
        planId: product.productId,
        planName: product.title,
        billingCycle: 'monthly',
      });
    }

    await this.subscriptionRepository.save(subscription);

    return {
      success: true,
      orderId: paymentId,
    };
  }

  private async recordPayment(
    userId: string,
    product: IInAppProduct,
    paymentId: string,
  ): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const payment = this.paymentRepository.create({
      user,
      amount: product.price * 100,
      currency: product.currency.toLowerCase(),
      status: PaymentStatus.COMPLETED,
      provider: 'mobile',
      providerPaymentId: paymentId,
    });

    await this.paymentRepository.save(payment);
  }

  async getUserSubscription(userId: string): Promise<Subscription | null> {
    return this.subscriptionRepository.findOne({
      where: { user: { id: userId } },
    });
  }

  async restorePurchases(userId: string): Promise<IInAppProduct[]> {
    const purchases = await this.mobilePaymentsService.restorePurchases(userId);
    return purchases.map(id => this.products.get(id)).filter(Boolean) as IInAppProduct[];
  }

  getProducts(): IInAppProduct[] {
    return Array.from(this.products.values());
  }
}