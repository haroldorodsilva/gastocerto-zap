import { UserAccountRoles } from "../types/roles.type";
import { Accounts } from "./accounts.entity";
import { User } from "./user.entity";

export class UserAccount {
  id: string;
  user: User;
  userId: string;
  account?: Accounts;
  accountId: string;
  role: UserAccountRoles;
  isCreator?: boolean;
  isPrimary?: boolean;
  deletedAt?: Date;
  createdAt: Date;
}
