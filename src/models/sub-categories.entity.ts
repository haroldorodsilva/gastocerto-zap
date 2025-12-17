import { BaseEntity } from "./base.entity";
import { Categories } from "./categories.entity";

export class SubCategories extends BaseEntity {
  name: string;
  categoryId: string;
}

export class SubCategoriesRelations extends SubCategories {
  category: Categories;
}
