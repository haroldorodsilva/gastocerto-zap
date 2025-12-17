import { BankType } from "../types/bank.types";
import { BaseEntity } from "./base.entity";
import { Accounts } from "./accounts.entity";

export class Banks extends BaseEntity {
  name: string;
  balance: number;
  excludeFromBalance: boolean;
  isPrimary?: boolean;
  description?: string;
  icon?: string;
  type: `${BankType}`;
  accountId: string;
  initialBalance: number;
}

export class BanksRelations extends Banks {
  account: Accounts;
}
