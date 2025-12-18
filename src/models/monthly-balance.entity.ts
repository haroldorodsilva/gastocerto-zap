import { Accounts } from './accounts.entity';

export class MonthlyBalance {
  id: string;
  yearMonth: string;
  startingBalance?: number;
  balance: number;
  incomeTotal: number;
  paidIncomeTotal?: number;
  expenseTotal: number;
  paidExpenseTotal?: number;
  finalBalance: number;
  cardInvoicesTotal: number;
  predictedFinalBalance?: number;
  predictedAt?: Date;
  accountId: string;
  createdAt: Date;
  updatedAt: Date;
}

export class MonthlyBalanceRelations extends MonthlyBalance {
  account: Accounts;
}
