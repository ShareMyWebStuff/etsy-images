import { NextResponse } from 'next/server';

import { createDatabaseBackup } from '@/lib/database-backup';

export async function POST() {
  try {
    const tables = await createDatabaseBackup();
    return NextResponse.json({ tables });
  } catch (error) {
    console.error('Failed to create database backup:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to create the database backup.' },
      { status: 500 }
    );
  }
}
