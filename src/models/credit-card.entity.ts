import { BaseEntity } from "./base.entity";
import { Accounts } from "./accounts.entity";
import { Banks } from "./banks.entity";
import { CreditCardInvoice } from "./credit-card-invoices.entity";
import { Transactions } from "./transactions.entity";

export class CreditCard extends BaseEntity {
  name: string;
  limit: number;
  isPrimary?: boolean;
  icon?: string;
  closingDay: number;
  dueDay: number;
  accountId: string;
  bankId: string;
}

export class CreditCardRelations extends CreditCard {
  bank?: Banks;
  account?: Accounts;
  transactions?: Transactions;
  invoices?: CreditCardInvoice[];
}
