export enum GoalStatus {
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELED = 'CANCELED',
  PAUSED = 'PAUSED',
}

export enum GoalType {
  SAVE_MONEY = 'SAVE_MONEY',
  LIMIT_EXPENSES = 'LIMIT_EXPENSES',
  CUSTOM = 'CUSTOM',
}

export enum GoalRecurringType {
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  YEARLY = 'YEARLY',
}
