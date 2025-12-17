import { CardInvoiceStatus } from "../types/credit-card.types";
import { BaseEntity } from "./base.entity";
import { TransactionsRelations } from "./transactions.entity";
import { CreditCardRelations } from "./credit-card.entity";

export enum EntityNotificationStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
  DISABLED = 'DISABLED'
}

export class CreditCardInvoice extends BaseEntity {
  yearMonth: string;
  // amountGross: original total of invoice (sum of card transactions)
  amountGross: number;
  // amountRefund: total value of refunds/estornos applied to this invoice
  amountRefund: number;
  // amountAdvance: total value of advance payments applied to this invoice
  amountAdvance: number;
  // amountTotal: net total to pay = amountGross - amountRefund - amountAdvance
  amountTotal: number;
  amountPaid: number;
  status: `${CardInvoiceStatus}`;
  creditCardId: string;
  dueDate: Date;
  closingDate: Date;
  notificationStatus?: EntityNotificationStatus;
}

export class CreditCardInvoiceRelations extends CreditCardInvoice {
  creditCard?: CreditCardRelations;
  transactions?: TransactionsRelations[];
}
