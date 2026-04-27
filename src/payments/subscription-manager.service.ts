import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InAppPurchaseService, IInAppProduct } from './in-app-purchase.service';
import { Subscription, SubscriptionStatus } from './entities/subscription.entity';
import { MobilePaymentsService, IMobileSubscriptionPayload } from './mobilePayments.service';

export interface SubscriptionPlan {
  id: string;
  productId: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  interval: 'monthly' | 'yearly';
  features: string[];
}

export interface SubscriptionManagerResponse {
  success: boolean;
  subscription?: Subscription;
  plans?: SubscriptionPlan[];
  error?: string;
}

@Injectable()
export class SubscriptionManagerService {
  private readonly logger = new Logger(SubscriptionManagerService.name);
  private readonly plans: SubscriptionPlan[];

  constructor(
    private readonly inAppPurchaseService: InAppPurchaseService,
    private readonly mobilePaymentsService: MobilePaymentsService,
  ) {
    this.plans = this.initializePlans();
  }

  private initializePlans(): SubscriptionPlan[] {
    return [
      {
        id: 'premium_monthly',
        productId: 'premium_monthly',
        name: 'Premium Monthly',
        description: 'Access all premium features with monthly billing',
        price: 9.99,
        currency: 'USD',
        interval: 'monthly',
        features: ['All courses', 'No ads', 'Priority support'],
      },
      {
        id: 'premium_yearly',
        productId: 'premium_yearly',
        name: 'Premium Yearly',
        description: 'Access all premium features with yearly billing',
        price: 79.99,
        currency: 'USD',
        interval: 'yearly',
        features: ['All courses', 'No ads', 'Priority support', '20% savings'],
      },
    ];
  }

  async getUserSubscription(userId: string): Promise<SubscriptionManagerResponse> {
    try {
      const subscription = await this.inAppPurchaseService.getUserSubscription(userId);

      if (!subscription) {
        return {
          success: true,
          subscription: null,
          plans: this.plans,
        };
      }

      return {
        success: true,
        subscription,
        plans: this.plans,
      };
    } catch (error) {
      this.logger.error('Failed to get user subscription', error);
      return {
        success: false,
        error: 'Failed to retrieve subscription',
      };
    }
  }

  async subscribe(
    userId: string,
    planId: string,
  ): Promise<SubscriptionManagerResponse> {
    const plan = this.plans.find(p => p.id === planId);
    if (!plan) {
      return {
        success: false,
        error: 'Plan not found',
      };
    }

    const payload: IMobileSubscriptionPayload = {
      productId: plan.productId,
      transactionId: `txn_${Date.now()}`,
      receipt: '',
      userId,
      expiryDate: this.calculateExpiryDate(plan.interval),
    };

    const result = await this.mobilePaymentsService.processSubscription(payload);

    if (!result.success) {
      return {
        success: false,
        error: result.error,
      };
    }

    const subscription = await this.inAppPurchaseService.getUserSubscription(userId);

    return {
      success: true,
      subscription: subscription || undefined,
    };
  }

  async cancelSubscription(userId: string): Promise<SubscriptionManagerResponse> {
    try {
      const subscription = await this.inAppPurchaseService.getUserSubscription(userId);

      if (!subscription) {
        return {
          success: false,
          error: 'No active subscription found',
        };
      }

      subscription.status = SubscriptionStatus.CANCELLED;
      subscription.canceledAt = new Date();

      return {
        success: true,
        subscription,
      };
    } catch (error) {
      this.logger.error('Failed to cancel subscription', error);
      return {
        success: false,
        error: 'Failed to cancel subscription',
      };
    }
  }

  async restorePurchases(userId: string): Promise<SubscriptionManagerResponse> {
    try {
      const purchases = await this.inAppPurchaseService.restorePurchases(userId);

      if (purchases.length === 0) {
        return {
          success: true,
          plans: this.plans,
        };
      }

      return {
        success: true,
        plans: this.plans,
      };
    } catch (error) {
      this.logger.error('Failed to restore purchases', error);
      return {
        success: false,
        error: 'Failed to restore purchases',
      };
    }
  }

  getPlans(): SubscriptionPlan[] {
    return this.plans;
  }

  private calculateExpiryDate(interval: 'monthly' | 'yearly'): string {
    const date = new Date();
    if (interval === 'monthly') {
      date.setMonth(date.getMonth() + 1);
    } else {
      date.setFullYear(date.getFullYear() + 1);
    }
    return date.toISOString();
  }
}