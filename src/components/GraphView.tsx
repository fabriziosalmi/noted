import { useEffect, useRef, useCallback } from 'react';
import type { NoteFile } from '../store/useStore';

interface GraphViewProps {
  notes: NoteFile[];
  noteLinksIndex: Record<string, string[]>;
  activeNoteName: string | null;
  onOpenNote: (name: string) => void;
  accentColor?: string;
}

interface Node {
  id: string;       // note name (relPath)
  label: string;    // display name
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;   // total links in+out
  radius: number;
}

interface Edge {
  source: string;
  target: string;
}

const K_REPEL  = 6000;
const K_SPRING = 0.04;
const L_REST   = 110;
const DAMPING  = 0.82;
const GRAVITY  = 0.015;
const MIN_R    = 5;
const MAX_R    = 14;

function buildGraph(notes: NoteFile[], linksIndex: Record<string, string[]>) {
  const noteSet = new Set(notes.map(n => n.name));
  const degreeMap: Record<string, number> = {};

  const edges: Edge[] = [];
  for (const [src, targets] of Object.entries(linksIndex)) {
    if (!noteSet.has(src)) continue;
    for (const tgt of targets) {
      const resolved = noteSet.has(tgt) ? tgt
        : noteSet.has(`${tgt}.md`) ? `${tgt}.md`
        : null;
      if (!resolved || resolved === src) continue;
      edges.push({ source: src, target: resolved });
      degreeMap[src]  = (degreeMap[src]  ?? 0) + 1;
      degreeMap[resolved] = (degreeMap[resolved] ?? 0) + 1;
    }
  }

  const maxDeg = Math.max(1, ...Object.values(degreeMap));
  const nodes: Node[] = notes.map((n, i) => {
    const angle = (i / notes.length) * Math.PI * 2;
    const r = 200 + Math.random() * 60;
    const deg = degreeMap[n.name] ?? 0;
    return {
      id: n.name,
      label: n.name.replace(/\.md$/, '').replace(/_/g, ' ').split('/').pop() ?? n.name,
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r,
      vx: 0, vy: 0,
      degree: deg,
      radius: MIN_R + ((deg / maxDeg) ** 0.5) * (MAX_R - MIN_R),
    };
  });

  return { nodes, edges };
}

export function GraphView({ notes, noteLinksIndex, activeNoteName, onOpenNote, accentColor = '#6366f1' }: GraphViewProps) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const stateRef   = useRef<{
    nodes: Node[]; edges: Edge[];
    pan: { x: number; y: number }; zoom: number;
    drag: { nodeId: string | null; startX: number; startY: number; nodeStartX: number; nodeStartY: number } | null;
    panDrag: { startX: number; startY: number; panStart: { x: number; y: number } } | null;
    hovered: string | null;
    animId: number;
    running: boolean;
  } | null>(null);

  const hexToRgb = (hex: string) => {
    const clean = hex.startsWith('#') ? hex.slice(1) : hex;
    const r = parseInt(clean.slice(0, 2), 16) || 99;
    const g = parseInt(clean.slice(2, 4), 16) || 102;
    const b = parseInt(clean.slice(4, 6), 16) || 241;
    return { r, g, b };
  };

  const draw = useCallback(() => {
    const s = stateRef.current;
    const canvas = canvasRef.current;
    if (!s || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width, H = canvas.height;
    const isDark = document.documentElement.classList.contains('dark');
    const isSepia = document.documentElement.classList.contains('sepia');
    const rgb = hexToRgb(accentColor);

    ctx.clearRect(0, 0, W, H);
    if (isDark) {
      const bgGrad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.85);
      bgGrad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0.08)`);
      bgGrad.addColorStop(1, '#050508');
      ctx.fillStyle = bgGrad;
    } else if (isSepia) {
      const bgGrad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.85);
      bgGrad.addColorStop(0, '#fbf3e0');
      bgGrad.addColorStop(1, '#f3e6c9');
      ctx.fillStyle = bgGrad;
    } else {
      const bgGrad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.85);
      bgGrad.addColorStop(0, '#ffffff');
      bgGrad.addColorStop(1, '#f8f9fa');
      ctx.fillStyle = bgGrad;
    }
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W / 2 + s.pan.x, H / 2 + s.pan.y);
    ctx.scale(s.zoom, s.zoom);

    // Draw background grid in world coordinates
    const left = (-W / 2 - s.pan.x) / s.zoom;
    const right = (W / 2 - s.pan.x) / s.zoom;
    const top = (-H / 2 - s.pan.y) / s.zoom;
    const bottom = (H / 2 - s.pan.y) / s.zoom;

    const gridSpacing = 100;
    const startX = Math.floor(left / gridSpacing) * gridSpacing;
    const endX = Math.ceil(right / gridSpacing) * gridSpacing;
    const startY = Math.floor(top / gridSpacing) * gridSpacing;
    const endY = Math.ceil(bottom / gridSpacing) * gridSpacing;

    ctx.beginPath();
    ctx.strokeStyle = isDark
      ? 'rgba(255, 255, 255, 0.035)'
      : isSepia
      ? 'rgba(139, 94, 60, 0.045)'
      : 'rgba(0, 0, 0, 0.03)';
    ctx.lineWidth = 1 / s.zoom;

    for (let x = startX; x <= endX; x += gridSpacing) {
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
    }
    for (let y = startY; y <= endY; y += gridSpacing) {
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
    }
    ctx.stroke();

    const nodeMap = new Map(s.nodes.map(n => [n.id, n]));

    // Edges - Fading opacity gradients
    for (const e of s.edges) {
      const a = nodeMap.get(e.source), b = nodeMap.get(e.target);
      if (!a || !b) continue;

      const isHighlighted = a.id === activeNoteName || b.id === activeNoteName || a.id === s.hovered || b.id === s.hovered;

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);

      const edgeGrad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      if (isHighlighted) {
        const aIsKey = a.id === activeNoteName || a.id === s.hovered;
        const bIsKey = b.id === activeNoteName || b.id === s.hovered;

        if (aIsKey && bIsKey) {
          edgeGrad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0.85)`);
          edgeGrad.addColorStop(0.5, `rgba(${rgb.r},${rgb.g},${rgb.b},0.4)`);
          edgeGrad.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0.85)`);
        } else if (aIsKey) {
          edgeGrad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0.85)`);
          edgeGrad.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0.05)`);
        } else {
          edgeGrad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0.05)`);
          edgeGrad.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0.85)`);
        }
        ctx.strokeStyle = edgeGrad;
        ctx.lineWidth = 1.8 / s.zoom;
      } else {
        edgeGrad.addColorStop(0, isDark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(0, 0, 0, 0.14)');
        edgeGrad.addColorStop(0.5, isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)');
        edgeGrad.addColorStop(1, isDark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(0, 0, 0, 0.14)');
        ctx.strokeStyle = edgeGrad;
        ctx.lineWidth = 1.0 / s.zoom;
      }
      ctx.stroke();
    }

    // Nodes - Glowing radial gradients
    for (const n of s.nodes) {
      const isActive  = n.id === activeNoteName;
      const isHovered = n.id === s.hovered;
      const r = n.radius * (isHovered ? 1.35 : 1);

      // Draw subtle halo rings for active or hovered nodes
      if (isActive || isHovered) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 1.5, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.15)`;
        ctx.lineWidth = 1.5 / s.zoom;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);

      let fillStyle: string | CanvasGradient;
      if (isActive) {
        const activeGrad = ctx.createRadialGradient(n.x, n.y, r * 0.05, n.x, n.y, r);
        activeGrad.addColorStop(0, '#ffffff');
        activeGrad.addColorStop(0.15, accentColor);
        activeGrad.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0.3)`);
        fillStyle = activeGrad;

        ctx.shadowColor = accentColor;
        ctx.shadowBlur = 14 / s.zoom;
      } else if (isHovered) {
        const hoverGrad = ctx.createRadialGradient(n.x, n.y, r * 0.05, n.x, n.y, r);
        hoverGrad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},1)`);
        hoverGrad.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0.2)`);
        fillStyle = hoverGrad;

        ctx.shadowColor = accentColor;
        ctx.shadowBlur = 10 / s.zoom;
      } else if (n.degree > 0) {
        const degGrad = ctx.createRadialGradient(n.x, n.y, r * 0.1, n.x, n.y, r);
        degGrad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0.95)`);
        degGrad.addColorStop(0.65, `rgba(${rgb.r},${rgb.g},${rgb.b},0.8)`);
        degGrad.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0.55)`);
        fillStyle = degGrad;
        ctx.shadowBlur = 0;
      } else {
        const orphanGrad = ctx.createRadialGradient(n.x, n.y, r * 0.1, n.x, n.y, r);
        orphanGrad.addColorStop(0, isDark ? 'rgba(255, 255, 255, 0.45)' : 'rgba(0, 0, 0, 0.35)');
        orphanGrad.addColorStop(1, isDark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.15)');
        fillStyle = orphanGrad;
        ctx.shadowBlur = 0;
      }

      ctx.fillStyle = fillStyle;
      ctx.fill();
      ctx.shadowBlur = 0;

      if (isActive || isHovered) {
        ctx.strokeStyle = isActive ? '#ffffff' : accentColor;
        ctx.lineWidth = (isActive ? 1.5 : 1.0) / s.zoom;
        ctx.stroke();
      }
    }

    // Labels for hovered / active / high-degree nodes - Translucent backing bubbles
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Determine visibility threshold based on zoom level:
    // - Zoomed in (zoom > 1.2): show labels for all connected nodes (degree >= 1)
    // - Medium zoom (zoom > 0.75): show labels for nodes with degree >= 2
    // - Zoomed out (zoom <= 0.75): only show labels for highly connected nodes (degree >= 3)
    const threshold = s.zoom > 1.2 ? 1 : s.zoom > 0.75 ? 2 : 3;

    for (const n of s.nodes) {
      const isKey = n.id === s.hovered || n.id === activeNoteName;
      const show = isKey || (n.degree >= threshold && s.zoom > 0.55);
      if (!show) continue;

      // Compute dynamic opacity based on zoom and degree:
      // Active and hovered nodes are always fully visible.
      // Other nodes fade out smoothly as zoom decreases.
      let labelOpacity = 1.0;
      if (!isKey) {
        if (n.degree < 2) {
          labelOpacity = Math.max(0, Math.min(0.75, (s.zoom - 0.85) * 2));
        } else {
          labelOpacity = Math.max(0.2, Math.min(0.85, (s.zoom - 0.45) * 1.5));
        }
      }

      if (labelOpacity <= 0.08) continue;
      
      const fontSize = Math.max(9, Math.min(13, 11 / s.zoom));
      ctx.font = `${n.id === activeNoteName ? '600' : '400'} ${fontSize}px system-ui, sans-serif`;
      
      const textWidth = ctx.measureText(n.label).width;
      const textX = n.x;
      const textY = n.y + n.radius + fontSize + 9 / s.zoom;

      const paddingX = 8 / s.zoom;
      const paddingY = 4 / s.zoom;
      const pillW = textWidth + paddingX * 2;
      const pillH = fontSize + paddingY * 2;
      const pillX = textX - pillW / 2;
      const pillY = textY - fontSize / 2 - paddingY - 0.5 / s.zoom;
      const pillR = pillH / 2;

      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(pillX, pillY, pillW, pillH, pillR);
      } else {
        ctx.rect(pillX, pillY, pillW, pillH);
      }

      ctx.fillStyle = isDark
        ? `rgba(10, 10, 12, ${0.80 * labelOpacity})`
        : `rgba(255, 255, 255, ${0.85 * labelOpacity})`;
      ctx.fill();

      ctx.strokeStyle = n.id === activeNoteName
        ? `rgba(${rgb.r},${rgb.g},${rgb.b},${0.5 * labelOpacity})`
        : (isDark ? `rgba(255, 255, 255, ${0.12 * labelOpacity})` : `rgba(0, 0, 0, ${0.08 * labelOpacity})`);
      ctx.lineWidth = 1 / s.zoom;
      ctx.stroke();

      ctx.fillStyle = n.id === activeNoteName
        ? (isDark ? `rgba(255, 255, 255, ${labelOpacity})` : `rgba(0, 0, 0, ${labelOpacity})`)
        : (isDark ? `rgba(255, 255, 255, ${0.85 * labelOpacity})` : `rgba(0, 0, 0, ${0.8 * labelOpacity})`);
      ctx.fillText(n.label, textX, textY);
    }

    ctx.restore();
  }, [activeNoteName, accentColor]);

  // Below this max-velocity threshold the simulation is considered settled
  // and the RAF loop pauses to stop burning CPU. Drag/zoom re-kicks it.
  const COOLDOWN_VEL_SQ = 0.05 * 0.05;
  // Hard cap on physics nodes per frame. Above this we skip the O(n²)
  // repulsion pass entirely (springs+gravity still run) so a 2000-note
  // vault doesn't lock the UI thread.
  const REPULSION_NODE_CAP = 600;

  const tick = useCallback(() => {
    const s = stateRef.current;
    if (!s || !s.running) return;

    const { nodes, edges } = s;
    const cx = 0, cy = 0;

    // Reset forces
    for (const n of nodes) { n.vx *= DAMPING; n.vy *= DAMPING; }

    // Gravity toward center
    for (const n of nodes) {
      n.vx += (cx - n.x) * GRAVITY;
      n.vy += (cy - n.y) * GRAVITY;
    }

    // Repulsion (O(n²)) — only run for graphs under the cap.
    if (nodes.length <= REPULSION_NODE_CAP) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const dist2 = dx * dx + dy * dy + 1;
          const force = K_REPEL / dist2;
          const dist = Math.sqrt(dist2);
          nodes[i].vx -= (dx / dist) * force;
          nodes[i].vy -= (dy / dist) * force;
          nodes[j].vx += (dx / dist) * force;
          nodes[j].vy += (dy / dist) * force;
        }
      }
    }

    // Spring attraction for edges
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    for (const e of edges) {
      const a = nodeMap.get(e.source), b = nodeMap.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = K_SPRING * (dist - L_REST);
      const fx = (dx / dist) * force, fy = (dy / dist) * force;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }

    // Apply velocities (skip dragged node) and track max kinetic energy.
    let maxVelSq = 0;
    for (const n of nodes) {
      if (s.drag?.nodeId === n.id) continue;
      n.x += n.vx;
      n.y += n.vy;
      const v2 = n.vx * n.vx + n.vy * n.vy;
      if (v2 > maxVelSq) maxVelSq = v2;
    }

    draw();

    // Stop the RAF once the system settles; interaction handlers re-kick it.
    if (maxVelSq < COOLDOWN_VEL_SQ && !s.drag && !s.panDrag) {
      s.running = false;
      return;
    }
    s.animId = requestAnimationFrame(tick);
  }, [draw, COOLDOWN_VEL_SQ]);

  const kickSimulation = useCallback(() => {
    const s = stateRef.current;
    if (!s) return;
    if (s.running) return;
    s.running = true;
    s.animId = requestAnimationFrame(tick);
  }, [tick]);

  // Initialize / re-init when notes/links change
  useEffect(() => {
    const { nodes, edges } = buildGraph(notes, noteLinksIndex);
    if (stateRef.current) {
      cancelAnimationFrame(stateRef.current.animId);
    }
    stateRef.current = {
      nodes, edges,
      pan: { x: 0, y: 0 }, zoom: 1,
      drag: null, panDrag: null,
      hovered: null,
      animId: 0,
      running: true,
    };
    stateRef.current.animId = requestAnimationFrame(tick);

    return () => {
      if (stateRef.current) {
        stateRef.current.running = false;
        cancelAnimationFrame(stateRef.current.animId);
      }
    };
  }, [notes, noteLinksIndex, tick]);

  // Resize observer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width  = canvas.offsetWidth  * devicePixelRatio;
      canvas.height = canvas.offsetHeight * devicePixelRatio;
      canvas.style.width  = `${canvas.offsetWidth}px`;
      canvas.style.height = `${canvas.offsetHeight}px`;
      draw();
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  const getNodeAt = useCallback((ex: number, ey: number) => {
    const s = stateRef.current;
    const canvas = canvasRef.current;
    if (!s || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const W = canvas.width / devicePixelRatio, H = canvas.height / devicePixelRatio;
    const wx = (ex - rect.left - W / 2 - s.pan.x) / s.zoom;
    const wy = (ey - rect.top  - H / 2 - s.pan.y) / s.zoom;
    for (const n of s.nodes) {
      const dx = n.x - wx, dy = n.y - wy;
      if (dx * dx + dy * dy < (n.radius + 4) ** 2) return n;
    }
    return null;
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const s = stateRef.current;
    if (!s) return;
    const node = getNodeAt(e.clientX, e.clientY);
    if (node) {
      s.drag = { nodeId: node.id, startX: e.clientX, startY: e.clientY, nodeStartX: node.x, nodeStartY: node.y };
    } else {
      s.panDrag = { startX: e.clientX, startY: e.clientY, panStart: { ...s.pan } };
    }
    kickSimulation();
  }, [getNodeAt, kickSimulation]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const s = stateRef.current;
    if (!s) return;

    if (s.drag) {
      const node = s.nodes.find(n => n.id === s.drag!.nodeId);
      if (node) {
        node.x = s.drag.nodeStartX + (e.clientX - s.drag.startX) / s.zoom;
        node.y = s.drag.nodeStartY + (e.clientY - s.drag.startY) / s.zoom;
        node.vx = 0; node.vy = 0;
        kickSimulation();
      }
    } else if (s.panDrag) {
      s.pan.x = s.panDrag.panStart.x + (e.clientX - s.panDrag.startX);
      s.pan.y = s.panDrag.panStart.y + (e.clientY - s.panDrag.startY);
      // Pan doesn't change physics — just redraw, no need to kick.
      draw();
    } else {
      const hit = getNodeAt(e.clientX, e.clientY);
      const prev = s.hovered;
      s.hovered = hit?.id ?? null;
      if (s.hovered !== prev) draw();
      if (canvasRef.current) canvasRef.current.style.cursor = hit ? 'pointer' : 'grab';
    }
  }, [getNodeAt, draw, kickSimulation]);

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    const s = stateRef.current;
    if (!s) return;
    const wasDragging = s.drag && (
      Math.abs(e.clientX - s.drag.startX) > 3 || Math.abs(e.clientY - s.drag.startY) > 3
    );
    if (s.drag && !wasDragging && s.drag.nodeId) {
      onOpenNote(s.drag.nodeId);
    }
    s.drag = null;
    s.panDrag = null;
    // After release, give the system a few frames to settle around the new position.
    kickSimulation();
  }, [onOpenNote, kickSimulation]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    const s = stateRef.current;
    if (!s) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    s.zoom = Math.max(0.2, Math.min(4, s.zoom * factor));
    draw();
  }, [draw]);

  const onDoubleClick = useCallback(() => {
    const s = stateRef.current;
    if (!s) return;
    s.pan = { x: 0, y: 0 };
    s.zoom = 1;
    draw();
  }, [draw]);

  if (notes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-gray-400 dark:text-gray-500 p-6 text-center">
        No notes yet. Create some notes and link them with [[wikilinks]].
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-3 py-1.5 text-[10px] text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700 flex items-center gap-3">
        <span>{notes.length} notes</span>
        <span className="opacity-50">·</span>
        <span>scroll to zoom · drag to pan · click to open · dbl-click to reset</span>
      </div>
      <canvas
        ref={canvasRef}
        className="flex-1 w-full h-full"
        style={{ cursor: 'grab' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => {
          const s = stateRef.current;
          if (s) { s.drag = null; s.panDrag = null; s.hovered = null; }
        }}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
      />
    </div>
  );
}
