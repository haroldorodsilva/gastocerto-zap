import { TransactionOrigin, TransactionStatus, TransactionType } from '../types/transaction.types';
import { BaseEntity } from './base.entity';
import { Categories } from './categories.entity';
import { SubCategories } from './sub-categories.entity';
import { TransactionFixed } from './transactions-fixed.entity';
import { CreditCard } from './credit-card.entity';
import { CreditCardInvoice } from './credit-card-invoices.entity';
import { Banks } from './banks.entity';

export enum EntityNotificationStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
  DISABLED = 'DISABLED',
}

export type Bank = Banks;

export class Transactions extends BaseEntity {
  dueDate: Date;
  type: `${TransactionType}`;
  origin: `${TransactionOrigin}`;
  status: `${TransactionStatus}`;
  amount: number;
  originalAmount?: number;
  invoiceClosingDate?: Date;
  bankId: string;
  accountId: string;
  categoryId: string;
  description?: string;
  observation?: string;
  installment?: number;
  installmentTotal?: number;
  installmentsId?: string;
  transactionFixedId?: string;
  subCategoryId?: string;
  creditCardId?: string;
  creditCardInvoiceId?: string;
  isInvoiceAdjustment?: boolean;
  notificationStatus?: EntityNotificationStatus;
}

export class TransactionsRelations extends Transactions {
  category?: Partial<Categories>;
  bank?: Partial<Bank>;
  transactionFixed?: TransactionFixed;
  subCategory?: SubCategories;
  creditCard?: CreditCard;
  creditCardInvoice?: Pick<
    CreditCardInvoice,
    'id' | 'yearMonth' | 'status' | 'dueDate' | 'closingDate'
  >;
}
