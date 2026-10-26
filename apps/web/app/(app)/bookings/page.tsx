'use client';
import { Input } from '@kejasha/ui/components/input';
import { Label } from '@kejasha/ui/components/label';
import { CalendarDays, Plus } from 'lucide-react';
import { useState } from 'react';
import { FilterSelect } from '@/components/filter-select';
import { LinkButton } from '@/components/link-button';
import { PageHeader } from '@/components/page-header';
import { BookingTable, type BookingFilter } from '@/components/shortstay/booking-table';
import { todayNairobi } from '@/lib/format';
import { BOOKING_SOURCE_LABEL, BOOKING_STATUS_LABEL, options } from '@/lib/labels';

const STATUSES = [{ value: '', label: 'Any status' }, ...options(BOOKING_STATUS_LABEL)];
const SOURCES = [{ value: '', label: 'Any channel' }, ...options(BOOKING_SOURCE_LABEL)];

export default function BookingsPage() {
  const [from, setFrom] = useState(todayNairobi());
  const [status, setStatus] = useState<BookingFilter['status']>();
  const [source, setSource] = useState<BookingFilter['source']>();
  return (
    <>
      <PageHeader
        title="Bookings"
        description="Short stays from every channel, in one list."
        actions={
          <>
            <LinkButton variant="outline" href="/calendar">
              <CalendarDays /> Calendar
            </LinkButton>
            <LinkButton href="/bookings/new">
              <Plus /> New booking
            </LinkButton>
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="from">Staying from</Label>
          <Input
            id="from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="sm:w-44"
          />
        </div>
        <FilterSelect label="Status" options={STATUSES} value={status} onChange={setStatus} />
        <FilterSelect label="Channel" options={SOURCES} value={source} onChange={setSource} />
      </div>
      <BookingTable
        filter={{
          ...(from ? { from } : {}),
          ...(status ? { status } : {}),
          ...(source ? { source } : {}),
        }}
      />
    </>
  );
}
