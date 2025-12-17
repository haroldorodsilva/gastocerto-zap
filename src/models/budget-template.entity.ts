import { CategoryType } from "../types/category.types";
import { BaseEntity } from "./base.entity";

export class BudgetTemplate extends BaseEntity {
  accountId: string;
  name: string;
  categoryId?: string;
  subCategoryId?: string;
  defaultAmount: number;
  type: `${CategoryType}`;
}

export class BudgetTemplateRelations extends BudgetTemplate {}
