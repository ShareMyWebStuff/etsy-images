'use client';

import { useState } from 'react';
import { DatabaseBackup } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { BackupTableCount } from '@/lib/database-backup';

type BackupClientProps = {
  initialTables: BackupTableCount[];
};

type BackupResponse = {
  tables?: BackupTableCount[];
  error?: string;
};

function formatCount(value: string) {
  return BigInt(value).toLocaleString();
}

export function BackupClient({ initialTables }: BackupClientProps) {
  const [tables, setTables] = useState(initialTables);
  const [isCreating, setIsCreating] = useState(false);

  async function handleCreateBackup() {
    setIsCreating(true);

    try {
      const response = await fetch('/api/admin/backup', { method: 'POST' });
      const payload = (await response.json()) as BackupResponse;

      if (!response.ok || !payload.tables) {
        throw new Error(payload.error ?? 'Unable to create the database backup.');
      }

      setTables(payload.tables);
      toast.success('Database backup created.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to create the database backup.');
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Database Backup</CardTitle>
          <CardDescription>
            Replace the contents of every backup table with a fresh copy of its source table.
          </CardDescription>
        </div>
        <Button type="button" onClick={handleCreateBackup} disabled={isCreating}>
          <DatabaseBackup className="h-4 w-4" aria-hidden="true" />
          {isCreating ? 'Creating Backup...' : 'Create Backup'}
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source table</TableHead>
              <TableHead>Backup table</TableHead>
              <TableHead className="text-right">Source rows</TableHead>
              <TableHead className="text-right">Backup rows</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tables.map((table) => (
              <TableRow key={table.tableName}>
                <TableCell className="font-medium">{table.tableName}</TableCell>
                <TableCell>{table.backupTableName}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCount(table.sourceRowCount)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCount(table.backupRowCount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
