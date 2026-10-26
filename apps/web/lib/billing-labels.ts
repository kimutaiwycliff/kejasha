export const SUB_STATUS = {
  incomplete: { label: 'Not paid yet', tone: 'destructive' },
  trialing: { label: 'Trial', tone: 'secondary' },
  active: { label: 'Active', tone: 'default' },
  past_due: { label: 'Payment overdue', tone: 'destructive' },
  suspended: { label: 'Suspended', tone: 'destructive' },
  cancelled: { label: 'Cancelled', tone: 'outline' },
} as const;
