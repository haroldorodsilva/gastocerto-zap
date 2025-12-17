import { BaseEntity } from "./base.entity";
import { GoalRecurringType, GoalStatus, GoalType } from "../types/goal.types";
import { Categories } from "./categories.entity";
import { SubCategories } from "./sub-categories.entity";

export class Goal extends BaseEntity {
  accountId: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  progress: number;
  categoryId?: string;
  subCategoryId?: string;
  startDate?: Date;
  endDate?: Date;
  status: `${GoalStatus}`;
  type: `${GoalType}`;
  recurring?: boolean;
  recurringType?: `${GoalRecurringType}`;
  autoRenew?: boolean;

  // Campos de controle de notificações
  lastMilestoneNotified?: number;
  milestone25Sent?: boolean;
  milestone50Sent?: boolean;
  milestone75Sent?: boolean;
  milestone100Sent?: boolean;
  deadlineAlertSent?: boolean;
  stagnationAlertSent?: boolean;

  // Data de conclusão da meta (quando currentAmount >= targetAmount)
  achievedAt?: Date;
  // Data do último alerta enviado (para evitar spam)
  lastAlertSentAt?: Date;

  category?: Categories;
  subCategory?: SubCategories;
}

export class GoalRelations extends Goal {}
