/**
 * FlowPlaybackControls — floating HUD for animated data-flow playback.
 *
 * Shows step number, flow label, from/to nodes, protocol, encryption status,
 * and prev/next/play/pause controls.
 */
import React, { useEffect, useRef } from 'react';
import type { DFDFlow, DFDActor, DFDProcess, DFDDataStore } from '../../types';
import { T } from '../../theme';

export interface FlowPlaybackControlsProps {
  flows: DFDFlow[];
  actors: DFDActor[];
  processes: DFDProcess[];
  dataStores: DFDDataStore[];
  currentStep: number;          // 0-based index into flows
  isPlaying: boolean;
  onStepChange: (step: number) => void;
  onPlayPause: () => void;
  onClose: () => void;
}

function nodeLabel(
  id: string,
  actors: DFDActor[],
  processes: DFDProcess[],
  dataStores: DFDDataStore[],
): string {
  return (
    actors.find((a) => a.id === id)?.label ??
    processes.find((p) => p.id === id)?.label ??
    dataStores.find((d) => d.id === id)?.label ??
    id
  );
}

export function FlowPlaybackControls({
  flows,
  actors,
  processes,
  dataStores,
  currentStep,
  isPlaying,
  onStepChange,
  onPlayPause,
  onClose,
}: FlowPlaybackControlsProps) {
  const flow = flows[currentStep];
  const total = flows.length;
  const progressRef = useRef<HTMLDivElement>(null);

  // Pulse animation reset on step change
  useEffect(() => {
    const el = progressRef.current;
    if (!el) return;
    el.style.transition = 'none';
    el.style.width = '0%';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transition = 'width 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
        el.style.width = `${((currentStep + 1) / total) * 100}%`;
      });
    });
  }, [currentStep, total]);

  if (!flow) return null;

  const fromLabel = nodeLabel(flow.from, actors, processes, dataStores);
  const toLabel   = nodeLabel(flow.to,   actors, processes, dataStores);

  const isEncrypted = flow.encrypted;
  const crossesTB   = flow.crossesTrustBoundary;
  const hasAuth     = flow.authenticationRequired;

  // Semantic accent color for the active flow
  const accentColor = isEncrypted ? T.emerald : crossesTB ? T.orangeHigh : T.orange;
  const accentBg    = isEncrypted ? T.emeraldLight : crossesTB ? T.orangeHighLight : T.orangeLight;
  const accentBorder= isEncrypted ? T.emeraldBorder : crossesTB ? T.orangeHighBorder : T.orangeBorder;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 72,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 100,
        animation: 'fp-slide-up 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          background: T.white,
          border: `1px solid ${T.stone200}`,
          borderRadius: 16,
          boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
          overflow: 'hidden',
          minWidth: 480,
          maxWidth: 560,
        }}
      >
        {/* Progress bar */}
        <div style={{ height: 3, background: T.stone100, position: 'relative' }}>
          <div
            ref={progressRef}
            style={{
              height: '100%',
              width: `${((currentStep + 1) / total) * 100}%`,
              background: `linear-gradient(90deg, ${accentColor} 0%, ${isEncrypted ? '#34D399' : '#FBBF24'} 100%)`,
              borderRadius: '0 2px 2px 0',
              boxShadow: `0 0 6px ${accentColor}55`,
            }}
          />
        </div>

        <div style={{ padding: '14px 18px 16px' }}>
          {/* Top row: step badge + title + close */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            {/* Step badge */}
            <div
              key={currentStep}
              style={{
                width: 32, height: 32, borderRadius: '50%',
                background: accentColor,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 900, color: T.white,
                flexShrink: 0,
                boxShadow: `0 2px 10px ${accentColor}44`,
                animation: 'fp-badge-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            >
              {currentStep + 1}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 13, fontWeight: 700, color: T.stone900,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                letterSpacing: '-0.01em',
              }}>
                {flow.label || `Flow ${currentStep + 1}`}
              </div>
              <div style={{ fontSize: 10, color: T.stone400, marginTop: 1 }}>
                Step {currentStep + 1} of {total}
              </div>
            </div>

            {/* Status pills */}
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {isEncrypted && (
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '2px 7px',
                  borderRadius: 9999, color: T.emerald,
                  background: T.emeraldLight,
                  border: `1px solid ${T.emeraldBorder}`,
                  letterSpacing: '0.04em',
                }}>
                  TLS
                </span>
              )}
              {hasAuth && (
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '2px 7px',
                  borderRadius: 9999, color: T.blue,
                  background: T.blueLight,
                  border: `1px solid ${T.blueBorder}`,
                  letterSpacing: '0.04em',
                }}>
                  AUTHN
                </span>
              )}
              {crossesTB && (
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '2px 7px',
                  borderRadius: 9999, color: T.orangeHigh,
                  background: T.orangeHighLight,
                  border: `1px solid ${T.orangeHighBorder}`,
                  letterSpacing: '0.04em',
                }}>
                  BOUNDARY
                </span>
              )}
            </div>

            {/* Close */}
            <button
              onClick={onClose}
              title="Exit flow playback"
              style={{
                width: 24, height: 24,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 6, background: T.stone100,
                border: `1px solid ${T.stone200}`,
                color: T.stone500, cursor: 'pointer',
                fontSize: 14, lineHeight: 1, flexShrink: 0,
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = T.stone200; (e.currentTarget as HTMLButtonElement).style.color = T.stone700; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = T.stone100; (e.currentTarget as HTMLButtonElement).style.color = T.stone500; }}
            >
              ×
            </button>
          </div>

          {/* Flow path visualization */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 0,
            padding: '10px 14px',
            background: accentBg,
            borderRadius: 10,
            border: `1px solid ${accentBorder}`,
            marginBottom: 12,
          }}>
            <NodeChip label={fromLabel} role="source" accentColor={accentColor} />

            {/* Animated arrow + protocol */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '0 8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%' }}>
                <div style={{ flex: 1, height: 1.5, background: `${accentColor}40`, borderRadius: 1 }} />
                <span
                  style={{
                    fontSize: 14,
                    animation: 'fp-flow-arrow 1.2s ease-in-out infinite',
                    color: accentColor,
                  }}
                >
                  →
                </span>
                <div style={{ flex: 1, height: 1.5, background: `${accentColor}40`, borderRadius: 1 }} />
              </div>
              {flow.protocol && (
                <span style={{
                  fontSize: 9, fontWeight: 700, color: accentColor,
                  fontFamily: 'monospace', letterSpacing: '0.06em',
                  opacity: 0.75,
                }}>
                  {flow.protocol.toUpperCase()}
                </span>
              )}
            </div>

            <NodeChip label={toLabel} role="target" accentColor={accentColor} />
          </div>

          {/* Data types */}
          {flow.dataTypes.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
              <span style={{ fontSize: 9, color: T.stone400, alignSelf: 'center', marginRight: 2, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
                Data:
              </span>
              {flow.dataTypes.map((dt) => (
                <span key={dt} style={{
                  fontSize: 9, fontWeight: 600, padding: '2px 7px',
                  borderRadius: 9999, color: T.stone600,
                  background: T.stone100,
                  border: `1px solid ${T.stone200}`,
                }}>
                  {dt}
                </span>
              ))}
            </div>
          )}

          {/* Step dot navigation */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, marginBottom: 12 }}>
            {flows.map((_, i) => (
              <button
                key={i}
                onClick={() => onStepChange(i)}
                title={flows[i].label || `Step ${i + 1}`}
                style={{
                  width: i === currentStep ? 20 : 6,
                  height: 6,
                  borderRadius: 3,
                  background: i === currentStep
                    ? accentColor
                    : i < currentStep
                      ? `${accentColor}55`
                      : T.stone200,
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  flexShrink: 0,
                }}
              />
            ))}
          </div>

          {/* Transport controls */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <ControlButton
              onClick={() => onStepChange(0)}
              disabled={currentStep === 0}
              title="Go to first step"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/>
              </svg>
            </ControlButton>

            <ControlButton
              onClick={() => onStepChange(Math.max(0, currentStep - 1))}
              disabled={currentStep === 0}
              title="Previous step"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
              </svg>
            </ControlButton>

            {/* Play/Pause — primary */}
            <button
              onClick={onPlayPause}
              title={isPlaying ? 'Pause' : 'Play'}
              style={{
                width: 44, height: 44, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: accentColor,
                border: 'none', cursor: 'pointer',
                color: T.white,
                boxShadow: `0 4px 14px ${accentColor}55`,
                transition: 'transform 0.15s, box-shadow 0.15s',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.08)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 6px 20px ${accentColor}77`; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 4px 14px ${accentColor}55`; }}
            >
              {isPlaying ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              )}
            </button>

            <ControlButton
              onClick={() => onStepChange(Math.min(total - 1, currentStep + 1))}
              disabled={currentStep === total - 1}
              title="Next step"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
              </svg>
            </ControlButton>

            <ControlButton
              onClick={() => onStepChange(total - 1)}
              disabled={currentStep === total - 1}
              title="Go to last step"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z"/>
              </svg>
            </ControlButton>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

function NodeChip({ label, role, accentColor }: { label: string; role: 'source' | 'target'; accentColor: string }) {
  const isSource = role === 'source';
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: isSource ? 'flex-start' : 'flex-end',
      maxWidth: 140, flexShrink: 0,
    }}>
      <div style={{
        fontSize: 9, fontWeight: 700,
        color: isSource ? accentColor : T.blue,
        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3,
        opacity: 0.7,
      }}>
        {isSource ? 'From' : 'To'}
      </div>
      <div style={{
        fontSize: 11, fontWeight: 700, color: T.stone900,
        padding: '5px 9px',
        background: T.white,
        border: `1px solid ${isSource ? accentColor : T.blueBorder}44`,
        borderRadius: 7,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        maxWidth: 140,
        letterSpacing: '-0.01em',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}>
        {label}
      </div>
    </div>
  );
}

function ControlButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 32, height: 32, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: T.stone100,
        border: `1px solid ${T.stone200}`,
        color: disabled ? T.stone300 : T.stone500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all 0.15s',
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        if (!disabled) { (e.currentTarget as HTMLButtonElement).style.background = T.stone200; (e.currentTarget as HTMLButtonElement).style.color = T.stone700; }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = T.stone100;
        (e.currentTarget as HTMLButtonElement).style.color = disabled ? T.stone300 : T.stone500;
      }}
    >
      {children}
    </button>
  );
}
