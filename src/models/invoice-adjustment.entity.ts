import { BaseEntity } from './base.entity';
import { CreditCardInvoiceRelations } from './credit-card-invoices.entity';
import { BanksRelations } from './banks.entity';

export type InvoiceAdjustmentType = 'REFUND' | 'ADVANCE';

export class InvoiceAdjustment extends BaseEntity {
  creditCardInvoiceId: string;
  type: InvoiceAdjustmentType; // REFUND (estorno) or ADVANCE (adiantamento)
  amount: number;
  description?: string;
  bankId?: string; // only for ADVANCE
  transactionId?: string | null; // transaction created for ADVANCE (nullable)
  paymentDate?: Date;
}

export class InvoiceAdjustmentRelations extends InvoiceAdjustment {
  creditCardInvoice?: CreditCardInvoiceRelations;
  bank?: BanksRelations;
}
