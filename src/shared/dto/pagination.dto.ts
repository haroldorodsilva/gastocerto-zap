import { OrderSort } from '../../types/order.type';

export interface IPagination {
  page: number;
  limit: number;
  skip: number;
  orderBy?: string;
  orderSort?: OrderSort;
}

export interface PaginationMetaDto {
  total: number;
  lastPage: number;
  currentPage: number;
  perPage: number;
}

export interface PaginationResponseDto<T> {
  meta: PaginationMetaDto;
  data: T[];
}
