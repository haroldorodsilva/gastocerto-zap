import { CategoryType } from '../types/category.types';
import { BaseEntity } from './base.entity';

export class Budget extends BaseEntity {
  accountId: string;
  name: string;
  yearMonth: string;
  categoryId?: string;
  subCategoryId?: string;
  budgetTemplateId?: string;
  plannedAmount: number;
  spent: number;
  remaining: number;
  percentageUsed: number;
  type: `${CategoryType}`;
}

export class BudgetRelations extends Budget {}
