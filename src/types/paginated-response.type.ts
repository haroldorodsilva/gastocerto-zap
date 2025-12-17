export interface PaginatedResponse<T> {
  data: Array<T>;
  count: number;
}
