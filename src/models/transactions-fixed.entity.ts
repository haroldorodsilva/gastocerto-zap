import { TransactionFrequency, TransactionType } from "../types/transaction.types";
import { BaseEntity } from "./base.entity";

export class TransactionFixed extends BaseEntity {
  dueDate: Date;
  type: `${TransactionType}`;
  frequency: `${TransactionFrequency}`;
  amount: number;
  bankId: string;
  accountId: string;
  categoryId: string;
  description?: string;
  observation?: string;
  subCategoryId?: string;
  creditCardId?: string;
}
