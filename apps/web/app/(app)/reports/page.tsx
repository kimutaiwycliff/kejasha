'use client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kejasha/ui/components/tabs';
import { PageHeader } from '@/components/page-header';
import {
  CollectionsTab,
  OccupancyTab,
  RentRollTab,
  StatementsTab,
} from '@/components/reports/tabs';

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        title="Reports"
        description="Owner statements, rent roll, collections and occupancy."
      />
      <Tabs defaultValue="statements">
        <TabsList className="mb-4 w-full justify-start overflow-x-auto">
          <TabsTrigger value="statements">Owner statements</TabsTrigger>
          <TabsTrigger value="rent-roll">Rent roll</TabsTrigger>
          <TabsTrigger value="collections">Collections</TabsTrigger>
          <TabsTrigger value="occupancy">Occupancy</TabsTrigger>
        </TabsList>
        <TabsContent value="statements">
          <StatementsTab />
        </TabsContent>
        <TabsContent value="rent-roll">
          <RentRollTab />
        </TabsContent>
        <TabsContent value="collections">
          <CollectionsTab />
        </TabsContent>
        <TabsContent value="occupancy">
          <OccupancyTab />
        </TabsContent>
      </Tabs>
    </>
  );
}
