'use client';
import { LinkButton } from '@/components/link-button';
import { CalendarClock, Plus } from 'lucide-react';
import { useState } from 'react';
import { FilterSelect } from '@/components/filter-select';
import { LeaseTable, type LeaseFilter } from '@/components/leasing/lease-table';
import { PageHeader } from '@/components/page-header';
import { PropertyPicker } from '@/components/portfolio/property-picker';
import { useCan } from '@/lib/hooks';

const STATUSES = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'terminated', label: 'Ended' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function LeasesPage() {
  const canCreate = useCan('manager');
  const [status, setStatus] = useState<LeaseFilter['status']>('active');
  const [propertyId, setPropertyId] = useState<string>();
  return (
    <>
      <PageHeader
        title="Leases"
        description="Who rents which unit, on what terms."
        actions={
          <>
            <LinkButton variant="outline" href="/leases/calendar">
              <CalendarClock /> Calendar
            </LinkButton>
            {canCreate && (
              <LinkButton href="/leases/new">
                <Plus /> New lease
              </LinkButton>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <FilterSelect label="Status" options={STATUSES} value={status} onChange={setStatus} />
        <PropertyPicker value={propertyId} onChange={setPropertyId} />
      </div>
      <LeaseTable
        filter={{ ...(status ? { status } : {}), ...(propertyId ? { propertyId } : {}) }}
      />
    </>
  );
}
