export const SUB_STATUS = {
  incomplete: { label: 'Not paid yet', tone: 'destructive' },
  trialing: { label: 'Trial', tone: 'info' },
  active: { label: 'Active', tone: 'success' },
  past_due: { label: 'Payment overdue', tone: 'destructive' },
  suspended: { label: 'Suspended', tone: 'destructive' },
  cancelled: { label: 'Cancelled', tone: 'outline' },
} as const;
