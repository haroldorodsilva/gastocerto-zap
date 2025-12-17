import { BaseEntity } from "./base.entity";
import { UserAccount } from "./user-account.entity";

export class Accounts extends BaseEntity {
  name: string;
  enabled: boolean;
}

export class AccountsRelations extends Accounts {
  userAccounts?: UserAccount[];
}

// Public shapes returned by API (omit sensitive user fields)
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  cellPhone?: string | null;
  isActive?: boolean | null;
  isAccountPrivacy?: boolean | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  lastLoginAt?: Date | null;
  deletedAt?: Date | null;
  role?: string | null;
}

export interface PublicUserAccount {
  id: string;
  userId: string;
  accountId: string;
  role: string;
  isCreator?: boolean;
  isPrimary?: boolean;
  createdAt: Date;
  deletedAt?: Date | null;
  user?: PublicUser;
}

export interface AccountsRelationsPublic extends Accounts {
  userAccounts?: PublicUserAccount[];
}
