import { mkdir, stat } from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const categoriesDirectory = 'D:\\Etsy\\EtsyListings';

type CreateCategoryRequest = {
  name?: unknown;
  description?: unknown;
};

async function directoryExists(directoryPath: string) {
  try {
    const entry = await stat(directoryPath);
    return entry.isDirectory();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateCategoryRequest;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';

    if (!name) {
      return NextResponse.json({ error: 'Category name is required.' }, { status: 400 });
    }

    if (name.length > 50) {
      return NextResponse.json({ error: 'Category name must be 50 characters or fewer.' }, { status: 400 });
    }

    if (description.length > 1000) {
      return NextResponse.json({ error: 'Description must be 1000 characters or fewer.' }, { status: 400 });
    }

    if (/[\\/:*?"<>|]/.test(name)) {
      return NextResponse.json({ error: 'Category name contains characters that cannot be used in a folder name.' }, { status: 400 });
    }

    const categoryPath = path.join(categoriesDirectory, name);

    if (!categoryPath.startsWith(categoriesDirectory)) {
      return NextResponse.json({ error: 'Invalid category name.' }, { status: 400 });
    }

    if (await directoryExists(categoryPath)) {
      return NextResponse.json({ error: 'Category already exists locally.' }, { status: 409 });
    }

    const existingCategory = await prisma.myCategory.findUnique({
      where: {
        name,
      },
    });

    if (existingCategory) {
      return NextResponse.json({ error: 'Category already exists in the database.' }, { status: 409 });
    }

    await mkdir(categoryPath);

    const category = await prisma.myCategory.create({
      data: {
        name,
        description,
      },
      select: {
        id: true,
        name: true,
        description: true,
      },
    });

    return NextResponse.json({ category }, { status: 201 });
  } catch (error) {
    console.error('Failed to create category:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to create category.' },
      { status: 500 }
    );
  }
}
