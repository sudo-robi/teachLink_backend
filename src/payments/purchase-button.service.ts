import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InAppPurchaseService, IInAppProduct, IPurchaseResult } from './in-app-purchase.service';
import { MobilePaymentsService, IMobilePurchasePayload } from './mobilePayments.service';
import { Payment, PaymentStatus } from './entities/payment.entity';

export interface PurchaseButtonRequest {
  productId: string;
  userId: string;
}

export interface PurchaseButtonResponse {
  success: boolean;
  orderId?: string;
  error?: string;
  product?: IInAppProduct;
}

@Injectable()
export class PurchaseButtonService {
  private readonly logger = new Logger(PurchaseButtonService.name);

  constructor(
    private readonly inAppPurchaseService: InAppPurchaseService,
    private readonly mobilePaymentsService: MobilePaymentsService,
  ) {}

  async initiatePurchase(request: PurchaseButtonRequest): Promise<PurchaseButtonResponse> {
    const { productId, userId } = request;

    const products = this.inAppPurchaseService.getProducts();
    const product = products.find(p => p.productId === productId);

    if (!product) {
      return {
        success: false,
        error: 'Product not found',
      };
    }

    return {
      success: true,
      product,
    };
  }

  async confirmPurchase(payload: IMobilePurchasePayload): Promise<PurchaseButtonResponse> {
    try {
      const result = await this.inAppPurchaseService.processPurchase(payload);

      if (!result.success) {
        return {
          success: false,
          error: result.error,
        };
      }

      return {
        success: true,
        orderId: result.orderId,
      };
    } catch (error) {
      this.logger.error('Purchase confirmation failed', error);
      return {
        success: false,
        error: 'Purchase failed',
      };
    }
  }

  async getProduct(productId: string): Promise<IInAppProduct | null> {
    const products = this.inAppPurchaseService.getProducts();
    return products.find(p => p.productId === productId) || null;
  }

  async restorePurchases(userId: string): Promise<IInAppProduct[]> {
    return this.inAppPurchaseService.restorePurchases(userId);
  }
}