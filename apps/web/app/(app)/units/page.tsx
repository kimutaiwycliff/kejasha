'use client';
import { useState } from 'react';
import { SearchBox } from '@/components/detail';
import { FilterSelect } from '@/components/filter-select';
import { PageHeader } from '@/components/page-header';
import { PropertyPicker } from '@/components/portfolio/property-picker';
import { UnitTable, type UnitFilter } from '@/components/portfolio/unit-table';
import { useDebounced } from '@/lib/hooks';

const MODES = [
  { value: '', label: 'All lettings' },
  { value: 'long_term', label: 'Long-term' },
  { value: 'short_stay', label: 'Short-stay' },
];

export default function UnitsPage() {
  const [q, setQ] = useState('');
  const [propertyId, setPropertyId] = useState<string>();
  const [mode, setMode] = useState<UnitFilter['mode']>();
  const query = useDebounced(q.trim());
  return (
    <>
      <PageHeader
        title="Units"
        description="Every unit across your properties. Add units from a property."
      />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <SearchBox value={q} onChange={setQ} placeholder="Search by code or name" />
        <PropertyPicker value={propertyId} onChange={setPropertyId} />
        <FilterSelect label="Letting" options={MODES} value={mode} onChange={setMode} />
      </div>
      <UnitTable
        filter={{
          ...(query ? { q: query } : {}),
          ...(propertyId ? { propertyId } : {}),
          ...(mode ? { mode } : {}),
        }}
      />
    </>
  );
}
