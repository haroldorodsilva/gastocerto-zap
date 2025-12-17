export abstract class BaseEntity {
  id: string;
  deletedAt?: Date;
  createdAt!: Date;
  updatedAt!: Date;
}
