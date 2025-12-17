import { UserRoles } from "../types/roles.type";
import { BaseEntity } from "./base.entity";
import { UserAccount } from "./user-account.entity";

export class User extends BaseEntity {
  name: string;
  email: string;
  password?: string; // Opcional para usuários Google
  refreshToken?: string;
  avatar?: string; // URL do avatar
  provider?: string; // "LOCAL" | "GOOGLE"
  providerId?: string; // ID do Google (sub)
  role: UserRoles;
  cellPhone?: string;
  isActive?: boolean;
  isAccountPrivacy?: boolean;
  lastLoginAt?: Date;
}

export class UserRelations extends User {
  userAccounts?: UserAccount[];
}
