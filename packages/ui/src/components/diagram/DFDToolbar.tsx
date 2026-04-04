/**
 * DFDToolbar — toggle pills for trust boundaries, protocol/payload labels, and risk overlays.
 */
import React from 'react';
import { T } from '../../theme';

interface DFDToolbarProps {
  showBoundaries: boolean;
  showRisks: boolean;
  showProtocols: boolean;
  onToggleBoundaries: () => void;
  onToggleRisks: () => void;
  onToggleProtocols: () => void;
  isPlaybackActive?: boolean;
  onTogglePlayback?: () => void;
  flowCount?: number;
}

export function DFDToolbar({
  showBoundaries,
  showRisks,
  showProtocols,
  onToggleBoundaries,
  onToggleRisks,
  onToggleProtocols,
  isPlaybackActive = false,
  onTogglePlayback,
  flowCount = 0,
}: DFDToolbarProps) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '6px 8px',
      background: 'rgba(255,255,255,0.92)',
      backdropFilter: 'blur(6px)',
      borderRadius: 10,
      border: `1px solid ${T.stone200}`,
      boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
    }}>
      <span style={{ fontSize: 9, fontWeight: 700, color: T.stone400, textTransform: 'uppercase', letterSpacing: '0.06em', paddingRight: 4 }}>
        Layers
      </span>
      <div style={{ width: 1, height: 14, background: T.stone200 }} />
      <TogglePill
        active={showBoundaries}
        onClick={onToggleBoundaries}
        label="Trust Boundaries"
        color={T.orange}
        activeColor={T.orangeHigh}
        activeBg={T.orangeLight}
        activeBorder={T.orangeHighBorder}
        icon={
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="3" strokeDasharray="4 2"/>
          </svg>
        }
      />
      <TogglePill
        active={showProtocols}
        onClick={onToggleProtocols}
        label="Protocols & Payload"
        color={T.indigo}
        activeColor={T.indigo}
        activeBg={T.purpleLight}
        activeBorder={T.purpleBorder}
        icon={
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 9h8M8 13h6M3 5l1-1h16l1 1v14l-1 1H4l-1-1V5z"/>
          </svg>
        }
      />
      <TogglePill
        active={showRisks}
        onClick={onToggleRisks}
        label="Risk Overlay"
        color={T.red}
        activeColor={T.red}
        activeBg={T.redLight}
        activeBorder={T.redBorder}
        icon={
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        }
      />

      {onTogglePlayback && flowCount > 0 && (
        <>
          <div style={{ width: 1, height: 14, background: T.stone200 }} />
          <PlayButton active={isPlaybackActive} onClick={onTogglePlayback} flowCount={flowCount} />
        </>
      )}
    </div>
  );
}

interface TogglePillProps {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  color: string;
  activeColor: string;
  activeBg: string;
  activeBorder: string;
}

function TogglePill({ active, onClick, label, icon, color, activeColor, activeBg, activeBorder }: TogglePillProps) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '3px 8px', borderRadius: 6,
        fontSize: 10, fontWeight: 600,
        border: `1px solid ${active ? activeBorder : T.stone200}`,
        background: active ? activeBg : T.stone50,
        color: active ? activeColor : T.stone400,
        cursor: 'pointer',
        transition: 'all 0.15s',
        boxShadow: active ? `0 1px 3px ${color}22` : 'none',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ color: active ? activeColor : T.stone300, display: 'flex', alignItems: 'center' }}>{icon}</span>
      {label}
    </button>
  );
}

function PlayButton({ active, onClick, flowCount }: { active: boolean; onClick: () => void; flowCount: number }) {
  return (
    <button
      onClick={onClick}
      title={active ? 'Exit flow playback' : `Play flow (${flowCount} steps)`}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '3px 10px', borderRadius: 6,
        fontSize: 10, fontWeight: 700,
        border: `1px solid ${active ? 'rgba(249,115,22,0.4)' : T.stone200}`,
        background: active
          ? `linear-gradient(135deg, ${T.orange} 0%, ${T.red} 100%)`
          : `linear-gradient(135deg, ${T.stone900} 0%, ${T.stone800} 100%)`,
        color: active ? T.white : T.stone200,
        cursor: 'pointer',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: active ? '0 2px 10px rgba(249,115,22,0.4)' : '0 1px 4px rgba(0,0,0,0.15)',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        letterSpacing: '-0.01em',
      }}
    >
      {active ? (
        <>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
          </svg>
          Playing
        </>
      ) : (
        <>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
          Play Flow
        </>
      )}
    </button>
  );
}
