import { useMemo, useState } from 'react';
import { useCurrentNode, useNavigateTo } from '@stores/tourStore';
import type { Hotspot } from '../../types/tour';

const SVG_SIZE = 120;
const CENTER = SVG_SIZE / 2;
const MIN_ARROW = 20;
const MAX_ARROW = 45;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getArrowLength(distanceMeters: number): number {
  const safeDistance = Math.max(distanceMeters, 1);
  const scaled = MAX_ARROW * (120 / (safeDistance + 120));
  return clamp(scaled, MIN_ARROW, MAX_ARROW);
}

function getArrowColor(distanceMeters: number): string {
  if (distanceMeters < 100) {
    return '#a6e3a1';
  }
  if (distanceMeters < 300) {
    return '#f9e2af';
  }
  return '#89b4fa';
}

function arrowEndPoint(yawDegrees: number, length: number): { x: number; y: number } {
  const radians = (yawDegrees * Math.PI) / 180;
  const x = CENTER + Math.sin(radians) * length;
  const y = CENTER - Math.cos(radians) * length;
  return { x, y };
}

function tooltipText(hotspot: Hotspot): string {
  return `${hotspot.target_name} · ${hotspot.distance_m.toFixed(0)} m`;
}

export function HotspotCompass() {
  const currentNode = useCurrentNode();
  const navigateTo = useNavigateTo();
  const [hovered, setHovered] = useState<string | null>(null);

  const hotspots = useMemo(() => currentNode?.hotspots ?? [], [currentNode]);

  if (!currentNode || hotspots.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-auto relative flex h-32 w-32 items-center justify-center rounded-full border border-white/10 bg-black/45 backdrop-blur-xl">
      <svg viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`} width="120" height="120" role="img" aria-label="Hotspot direction compass">
        <defs>
          <marker id="hotspot-arrow-head" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L7,3.5 L0,7 z" fill="currentColor" />
          </marker>
        </defs>

        <circle cx={CENTER} cy={CENTER} r={50} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />

        <text x={CENTER} y={14} textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.5)">N</text>
        <text x={CENTER} y={116} textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.5)">S</text>
        <text x={112} y={CENTER + 3} textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.5)">E</text>
        <text x={8} y={CENTER + 3} textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.5)">W</text>

        {hotspots.map((hotspot) => {
          const length = getArrowLength(hotspot.distance_m);
          const end = arrowEndPoint(hotspot.yaw, length);
          const color = getArrowColor(hotspot.distance_m);
          const key = `${hotspot.target_id}-${hotspot.yaw}`;

          return (
            <g
              key={key}
              onMouseEnter={() => setHovered(key)}
              onMouseLeave={() => setHovered((prev) => (prev === key ? null : prev))}
              onFocus={() => setHovered(key)}
              onBlur={() => setHovered((prev) => (prev === key ? null : prev))}
              onClick={() => navigateTo(hotspot.target_id)}
              className="cursor-pointer"
            >
              <title>{tooltipText(hotspot)}</title>
              <line
                x1={CENTER}
                y1={CENTER}
                x2={end.x}
                y2={end.y}
                stroke={color}
                strokeWidth="2.2"
                markerEnd="url(#hotspot-arrow-head)"
                style={{ color }}
              />
              <circle cx={end.x} cy={end.y} r="2" fill={color} />
            </g>
          );
        })}

        <circle cx={CENTER} cy={CENTER} r={5} fill="rgba(255,255,255,0.85)" />
      </svg>

      {hovered ? (
        <div className="pointer-events-none absolute -top-10 left-1/2 w-max max-w-56 -translate-x-1/2 rounded-lg border border-white/15 bg-black/75 px-2 py-1 text-xs text-slate-100 shadow-lg">
          {(() => {
            const hotspot = hotspots.find((item) => `${item.target_id}-${item.yaw}` === hovered);
            return hotspot ? tooltipText(hotspot) : '';
          })()}
        </div>
      ) : null}
    </div>
  );
}
