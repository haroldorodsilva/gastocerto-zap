import { CategoryType } from "../types/category.types";
import { BaseEntity } from "./base.entity";
import { SubCategories } from "./sub-categories.entity";

export class Categories extends BaseEntity {
  name: string;
  type: `${CategoryType}`;
  color?: string;
  icon?: string;
  accountId: string;
}

export class CategoriesRelations extends Categories {
  subCategories?: SubCategories[];
}
