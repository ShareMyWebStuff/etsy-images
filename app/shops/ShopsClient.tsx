'use client';

import { Check, X } from 'lucide-react';
import { Tree, type NodeRendererProps } from 'react-arborist';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type FileNode = {
  id: string;
  name: string;
  children?: FileNode[];
};

const directory: FileNode[] = [
  {
    id: 'cosy-house-prints',
    name: 'CosyHousePrints',
    children: [
      {
        id: 'dinosaurs',
        name: 'Dinosaurs',
        children: [],
      },
      {
        id: 'bugs',
        name: 'Bugs',
        children: [
          {
            id: 'ants',
            name: 'Ants',
            children: [],
          },
          {
            id: 'flys',
            name: 'Flys',
            children: [],
          },
          {
            id: 'spider',
            name: 'Spider',
            children: [
              {
                id: 'downloads',
                name: 'Downloads',
                children: [],
              },
              {
                id: 'image-1',
                name: 'image1.jpeg',
              },
              {
                id: 'image-2',
                name: 'image2.jpeg',
              },
            ],
          },
        ],
      },
    ],
  },
];

function DirectoryRow({ node, style }: NodeRendererProps<FileNode>) {
  const isFolder = !node.isLeaf;

  return (
    <div
      style={{
        ...style,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        paddingRight: 8,
        cursor: 'pointer',
        background: node.isSelected ? 'rgba(0, 100, 255, 0.1)' : 'transparent',
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
        fontSize: 14,
      }}
      onClick={(event) => node.handleClick(event)}
    >
      <div style={{ display: 'flex', minWidth: 0, alignItems: 'center', gap: 6 }}>
        {isFolder ? (
          <button
            type="button"
            aria-label={node.isOpen ? `Collapse ${node.data.name}` : `Expand ${node.data.name}`}
            onClick={(event) => {
              event.stopPropagation();
              node.toggle();
            }}
            style={{
              width: 18,
              padding: 0,
              border: 0,
              background: 'transparent',
              cursor: 'pointer',
              font: 'inherit',
            }}
          >
            {node.isOpen ? '-' : '+'}
          </button>
        ) : (
          <span style={{ width: 18 }} />
        )}

        <span>{node.data.name}</span>
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
        {[
          { label: `Mark ${node.data.name} as checked`, icon: Check },
          { label: `Mark ${node.data.name} as unchecked`, icon: X },
          { label: `Confirm ${node.data.name}`, icon: Check },
        ].map(({ label, icon: Icon }) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            onClick={(event) => event.stopPropagation()}
            style={{
              display: 'inline-flex',
              width: 22,
              height: 22,
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid var(--border)',
              borderRadius: 4,
              background: 'var(--card)',
              color: 'var(--foreground)',
              cursor: 'pointer',
            }}
          >
            <Icon size={14} aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}

export function ShopsClient() {
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle>Shops</CardTitle>
        <CardDescription>Local shop directory.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tree
          data={directory}
          width="100%"
          height={280}
          rowHeight={28}
          indent={20}
          openByDefault={false}
          initialOpenState={{
            'cosy-house-prints': true,
            bugs: true,
            spider: true,
          }}
          disableDrag
          disableEdit
        >
          {DirectoryRow}
        </Tree>
      </CardContent>
    </Card>
  );
}
