import { BaseEntity } from "./base.entity";
import { CreditCardInvoiceRelations } from "./credit-card-invoices.entity";
import { BanksRelations } from "./banks.entity";
import { TransactionsRelations } from "./transactions.entity";

export type InvoiceAdjustmentType = "REFUND" | "ADVANCE";

export class InvoiceAdjustment extends BaseEntity {
  creditCardInvoiceId: string;
  type: InvoiceAdjustmentType;
  amount: number;
  description?: string;
  bankId?: string; // Obrigatório apenas para ADVANCE
  transactionId?: string; // Criado automaticamente para ADVANCE
  adjustmentDate: Date;
}

export class InvoiceAdjustmentRelations extends InvoiceAdjustment {
  creditCardInvoice?: CreditCardInvoiceRelations;
  bank?: BanksRelations;
  transaction?: TransactionsRelations; // Transação de débito criada para ADVANCE
}
