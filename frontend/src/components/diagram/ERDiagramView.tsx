import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Table as TableIcon,
  Key,
  Link,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Download,
  Search,
  RefreshCw,
  ExternalLink,
  Layers,
} from 'lucide-react';
import * as SchemaService from '../../../bindings/dhub/internal/services/schemaservice';
import { TableStructure, ColumnMeta, ForeignKeyMeta } from '../../../bindings/dhub/internal/driver/models';

export interface ERDiagramViewProps {
  connectionId: string;
  database: string;
  schema: string;
  onOpenTable?: (tableName: string) => void;
}

interface TableNode {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  columns: ColumnMeta[];
  primaryKeys: string[];
  foreignKeys: ForeignKeyMeta[];
}

export const ERDiagramView: React.FC<ERDiagramViewProps> = ({
  connectionId,
  database,
  schema,
  onOpenTable,
}) => {
  const [loading, setLoading] = useState(true);
  const [nodes, setNodes] = useState<TableNode[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [draggingNode, setDraggingNode] = useState<{ name: string; startX: number; startY: number } | null>(null);
  const [hoveredTable, setHoveredTable] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // Load tables and structure
  const loadSchema = async () => {
    setLoading(true);
    try {
      const objects = (await SchemaService.GetObjects(connectionId, database, schema)) || [];
      const tableObjects = objects.filter((o) => o.type === 'table' || !o.type);

      // Fetch structures in parallel
      const structures = await Promise.all(
        tableObjects.map(async (t) => {
          try {
            const struct = await SchemaService.GetTableStructure(connectionId, database, schema, t.name);
            return struct;
          } catch {
            return null;
          }
        })
      );

      // Layout in a multi-column grid
      const CARD_WIDTH = 240;
      const ROW_HEIGHT_UNIT = 22;
      const HEADER_HEIGHT = 38;
      const PADDING_BOTTOM = 12;
      const COLS = 4;
      const GAP_X = 80;
      const GAP_Y = 60;

      const colHeights = new Array(COLS).fill(40);
      const newNodes: TableNode[] = [];

      structures.forEach((struct, idx) => {
        if (!struct) return;
        const colCount = struct.columns?.length || 0;
        const cardHeight = HEADER_HEIGHT + colCount * ROW_HEIGHT_UNIT + PADDING_BOTTOM;

        // Choose column with minimum current height
        let minCol = 0;
        for (let c = 1; c < COLS; c++) {
          if (colHeights[c] < colHeights[minCol]) {
            minCol = c;
          }
        }

        const x = minCol * (CARD_WIDTH + GAP_X) + 40;
        const y = colHeights[minCol];
        colHeights[minCol] += cardHeight + GAP_Y;

        newNodes.push({
          name: struct.name,
          x,
          y,
          width: CARD_WIDTH,
          height: cardHeight,
          columns: struct.columns || [],
          primaryKeys: struct.primaryKeys || [],
          foreignKeys: struct.foreignKeys || [],
        });
      });

      setNodes(newNodes);
    } catch (err) {
      console.warn('Failed to load schema for ER diagram:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (connectionId && database) {
      loadSchema();
    }
  }, [connectionId, database, schema]);

  // Mouse pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0 && (e.target === containerRef.current || (e.target as HTMLElement).tagName === 'svg')) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    } else if (draggingNode) {
      setNodes((prev) =>
        prev.map((n) => {
          if (n.name === draggingNode.name) {
            return {
              ...n,
              x: Math.max(0, n.x + e.movementX / scale),
              y: Math.max(0, n.y + e.movementY / scale),
            };
          }
          return n;
        })
      );
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setDraggingNode(null);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      setScale((s) => Math.max(0.3, Math.min(2.5, s * zoomFactor)));
    }
  };

  // Node position map for fast lookup
  const nodeMap = useMemo(() => {
    const map = new Map<string, TableNode>();
    nodes.forEach((n) => map.set(n.name.toLowerCase(), n));
    return map;
  }, [nodes]);

  // Compute foreign key connections
  const connections = useMemo(() => {
    const list: Array<{
      fromTable: string;
      toTable: string;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      colName: string;
      refCol: string;
    }> = [];

    nodes.forEach((sourceNode) => {
      sourceNode.foreignKeys.forEach((fk) => {
        const targetNode = nodeMap.get((fk.refTable || '').toLowerCase());
        if (!targetNode) return;

        // Find index of column in source node
        const colIdx = sourceNode.columns.findIndex((c) => c.name === fk.columnName);
        const refColIdx = targetNode.columns.findIndex((c) => c.name === fk.refColumn);

        const fromY = sourceNode.y + 38 + (colIdx >= 0 ? colIdx : 0) * 22 + 11;
        const toY = targetNode.y + 38 + (refColIdx >= 0 ? refColIdx : 0) * 22 + 11;

        // Choose left or right anchor based on relative positions
        let fromX = sourceNode.x + sourceNode.width;
        let toX = targetNode.x;
        if (sourceNode.x > targetNode.x) {
          fromX = sourceNode.x;
          toX = targetNode.x + targetNode.width;
        }

        list.push({
          fromTable: sourceNode.name,
          toTable: targetNode.name,
          fromX,
          fromY,
          toX,
          toY,
          colName: fk.columnName,
          refCol: fk.refColumn,
        });
      });
    });

    return list;
  }, [nodes, nodeMap]);

  // Filtered nodes
  const filteredNodes = useMemo(() => {
    if (!searchTerm.trim()) return nodes;
    const term = searchTerm.toLowerCase();
    return nodes.filter(
      (n) => n.name.toLowerCase().includes(term) || n.columns.some((c) => c.name.toLowerCase().includes(term))
    );
  }, [nodes, searchTerm]);

  // Export as SVG
  const handleExportSVG = () => {
    const svgEl = document.getElementById('er-diagram-svg');
    if (!svgEl) return;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svgEl);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${database}_${schema || 'schema'}_erd.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#14151a] text-zinc-400 text-xs gap-2">
        <RefreshCw className="h-4 w-4 animate-spin text-blue-400" />
        <span>Generating Entity Relationship Diagram for [{schema || database}]...</span>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[#14151a] text-zinc-500 text-xs p-6 text-center">
        <Layers className="h-8 w-8 mb-2 opacity-40 text-blue-400" />
        <p className="font-semibold text-zinc-300">No Tables Found</p>
        <p className="text-[11px] text-zinc-500 mt-1">There are no tables available to generate an ER Diagram in schema "{schema || database}".</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
      className="relative flex h-full w-full select-none overflow-hidden bg-[#121317]"
    >
      {/* Background Dot Grid */}
      <svg className="absolute inset-0 h-full w-full pointer-events-none opacity-20">
        <defs>
          <pattern id="dot-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1" fill="#71717a" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dot-grid)" />
      </svg>

      {/* Floating Toolbar */}
      <div className="absolute top-3 left-3 z-30 flex items-center gap-2 rounded-lg border border-[#272932] bg-[#191a20]/90 px-3 py-1.5 shadow-xl backdrop-blur-xs text-xs text-zinc-300">
        <div className="flex items-center gap-1.5">
          <Layers className="h-4 w-4 text-blue-400" />
          <span className="font-semibold text-zinc-100">
            {database}.{schema || 'public'}
          </span>
          <span className="text-[11px] text-zinc-500 font-mono">({nodes.length} tables, {connections.length} relations)</span>
        </div>

        <div className="h-4 w-[1px] bg-[#272932] mx-1" />

        {/* Search */}
        <div className="relative flex items-center">
          <Search className="h-3.5 w-3.5 text-zinc-500 absolute left-2 pointer-events-none" />
          <input
            type="text"
            placeholder="Find table or column..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-40 rounded border border-[#272932] bg-[#14151a] pl-7 pr-2 py-0.5 text-xs text-zinc-200 outline-none focus:border-blue-500"
          />
        </div>

        <div className="h-4 w-[1px] bg-[#272932] mx-1" />

        {/* Zoom Controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setScale((s) => Math.min(2.5, s + 0.15))}
            className="rounded p-1 hover:bg-[#272932] text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Zoom In"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <span className="font-mono text-[11px] text-zinc-400 w-9 text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={() => setScale((s) => Math.max(0.3, s - 0.15))}
            className="rounded p-1 hover:bg-[#272932] text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Zoom Out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => {
              setScale(1);
              setPan({ x: 40, y: 40 });
            }}
            className="rounded p-1 hover:bg-[#272932] text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Reset Zoom & Pan"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="h-4 w-[1px] bg-[#272932] mx-1" />

        {/* Export SVG */}
        <button
          onClick={handleExportSVG}
          className="flex items-center gap-1 rounded bg-[#22242c] px-2 py-1 text-zinc-300 hover:bg-[#2c303c] hover:text-white transition-colors"
          title="Export ER Diagram to SVG"
        >
          <Download className="h-3.5 w-3.5 text-blue-400" />
          <span>Export SVG</span>
        </button>

        <button
          onClick={loadSchema}
          className="rounded p-1 hover:bg-[#272932] text-zinc-400 hover:text-zinc-200 transition-colors"
          title="Refresh Schema"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Main Diagram Area with Scaling & Translation */}
      <div
        className="absolute inset-0 origin-top-left"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
        }}
      >
        {/* SVG Relationship Connector Lines */}
        <svg
          id="er-diagram-svg"
          className="absolute inset-0 pointer-events-none"
          style={{ width: 6000, height: 6000 }}
        >
          <defs>
            <marker
              id="arrowhead"
              markerWidth="8"
              markerHeight="6"
              refX="7"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 8 3, 0 6" fill="#3b82f6" />
            </marker>
            <marker
              id="arrowhead-hover"
              markerWidth="10"
              markerHeight="7"
              refX="8"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="#60a5fa" />
            </marker>
          </defs>

          {connections.map((c, i) => {
            const isHighlighted =
              hoveredTable === c.fromTable.toLowerCase() ||
              hoveredTable === c.toTable.toLowerCase();

            // Cubic bezier curve path for smooth orthogonal feel
            const dx = Math.abs(c.toX - c.fromX) * 0.5;
            const pathData = `M ${c.fromX} ${c.fromY} C ${c.fromX + (c.toX > c.fromX ? dx : -dx)} ${c.fromY}, ${c.toX + (c.toX > c.fromX ? -dx : dx)} ${c.toY}, ${c.toX} ${c.toY}`;

            return (
              <path
                key={i}
                d={pathData}
                fill="none"
                stroke={isHighlighted ? '#60a5fa' : '#3b82f6'}
                strokeWidth={isHighlighted ? 2.5 : 1.5}
                strokeDasharray={isHighlighted ? 'none' : '4 3'}
                opacity={isHighlighted ? 1 : 0.65}
                markerEnd={isHighlighted ? 'url(#arrowhead-hover)' : 'url(#arrowhead)'}
              />
            );
          })}
        </svg>

        {/* Table Cards */}
        {filteredNodes.map((node) => {
          const isHighlighted =
            hoveredTable === node.name.toLowerCase() ||
            connections.some(
              (c) =>
                (c.fromTable.toLowerCase() === hoveredTable && c.toTable.toLowerCase() === node.name.toLowerCase()) ||
                (c.toTable.toLowerCase() === hoveredTable && c.fromTable.toLowerCase() === node.name.toLowerCase())
            );

          return (
            <div
              key={node.name}
              onMouseEnter={() => setHoveredTable(node.name.toLowerCase())}
              onMouseLeave={() => setHoveredTable(null)}
              style={{
                position: 'absolute',
                left: node.x,
                top: node.y,
                width: node.width,
              }}
              className={`rounded-xl border shadow-xl transition-all duration-150 overflow-hidden ${
                isHighlighted
                  ? 'border-blue-500 bg-[#1e2029] ring-2 ring-blue-500/20'
                  : 'border-[#272932] bg-[#191a20] hover:border-zinc-600'
              }`}
            >
              {/* Card Header (Draggable) */}
              <div
                onMouseDown={(e) => {
                  if (e.button === 0) {
                    e.stopPropagation();
                    setDraggingNode({ name: node.name, startX: e.clientX, startY: e.clientY });
                  }
                }}
                className="flex items-center justify-between border-b border-[#272932] bg-[#22242c] px-3 py-2 cursor-grab active:cursor-grabbing select-none"
              >
                <div className="flex items-center gap-2 truncate">
                  <TableIcon className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span className="font-semibold text-xs text-zinc-100 truncate" title={node.name}>
                    {node.name}
                  </span>
                </div>
                {onOpenTable && (
                  <button
                    onClick={() => onOpenTable(node.name)}
                    className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
                    title={`Open ${node.name} Data`}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </button>
                )}
              </div>

              {/* Column List */}
              <div className="divide-y divide-[#272932]/60 py-1 text-[11px] font-mono">
                {node.columns.map((col) => {
                  const isPK = node.primaryKeys.includes(col.name);
                  const isFK = node.foreignKeys.some((f) => f.columnName === col.name);

                  return (
                    <div
                      key={col.name}
                      className="flex items-center justify-between px-3 py-1 hover:bg-white/[0.03] transition-colors"
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        {isPK ? (
                          <Key className="h-3 w-3 text-amber-400 shrink-0" />
                        ) : isFK ? (
                          <Link className="h-3 w-3 text-blue-400 shrink-0" />
                        ) : (
                          <span className="w-3 shrink-0" />
                        )}
                        <span className={`truncate ${isPK ? 'font-bold text-amber-200' : isFK ? 'text-blue-200' : 'text-zinc-300'}`}>
                          {col.name}
                        </span>
                      </div>
                      <span className="text-[10px] text-zinc-500 font-sans shrink-0 ml-2">
                        {col.dataType}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
