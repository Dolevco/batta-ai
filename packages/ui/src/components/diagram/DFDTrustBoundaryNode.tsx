/**
 * DFDTrustBoundaryNode — dashed orange region container.
 * Renders a clearly-labelled trust-boundary zone around child nodes.
 * When `visible` is false the entire overlay is hidden (nodes remain in place).
 */
import type { NodeProps } from 'reactflow';
import { T } from '../../theme';

interface TrustBoundaryData {
  label: string;
  /** Colour theme mapped from TrustBoundaryType:
   *  'external'  → INTERNET
   *  'identity'  → IDENTITY
   *  'service'   → SERVICE  (internal)
   *  'public'    → DATA
   *  'dmz'       → EXTERNAL (third-party)
   *  'internal'  → generic internal (legacy fallback)
   */
  theme?: 'internal' | 'dmz' | 'external' | 'public' | 'identity' | 'service';
  visible?: boolean;
}

const THEME_TOKENS = {
  internal: { border: T.indigo,      bg: 'rgba(99,102,241,0.04)',   label: T.indigo,      labelBg: T.purpleLight,  labelBorder: T.purpleBorder  },
  service:  { border: T.indigo,      bg: 'rgba(99,102,241,0.04)',   label: T.indigo,      labelBg: T.purpleLight,  labelBorder: T.purpleBorder  },
  dmz:      { border: T.orange,      bg: 'rgba(251,146,60,0.04)',   label: T.orangeHigh,  labelBg: T.orangeLight,  labelBorder: T.orangeHighBorder },
  external: { border: T.stone400,    bg: 'rgba(156,163,175,0.03)',  label: T.stone700,    labelBg: T.grayLight,    labelBorder: T.grayBorder    },
  public:   { border: T.green,       bg: 'rgba(34,197,94,0.04)',    label: T.green,       labelBg: T.greenLight,   labelBorder: T.greenBorder   },
  identity: { border: T.purple,      bg: 'rgba(168,85,247,0.04)',   label: T.violet,      labelBg: T.purpleLight,  labelBorder: T.purpleBorder  },
};

export function DFDTrustBoundaryNode({ data }: NodeProps) {
  const d = data as TrustBoundaryData;
  const isVisible = d.visible !== false;
  const theme = d.theme ?? 'internal';
  const t = THEME_TOKENS[theme] ?? THEME_TOKENS.internal;

  if (!isVisible) {
    // Invisible — still occupies layout space so child nodes keep their positions
    return <div style={{ width: '100%', height: '100%' }} />;
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Boundary fill */}
      <div style={{
        position: 'absolute', inset: 0,
        borderRadius: 14,
        border: `1.5px dashed ${t.border}`,
        backgroundColor: t.bg,
        transition: 'opacity 0.25s',
      }} />

      {/* Boundary label tab */}
      <div style={{
        position: 'absolute', top: -13, left: 14,
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '2px 8px 2px 6px',
        borderRadius: 5,
        fontSize: 9, fontWeight: 800,
        letterSpacing: '0.08em',
        textTransform: 'uppercase' as const,
        backgroundColor: t.labelBg,
        color: t.label,
        border: `1px solid ${t.labelBorder}`,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        userSelect: 'none' as const,
        whiteSpace: 'nowrap',
        pointerEvents: 'none' as const,
      }}>
        {/* Small lock icon */}
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke={t.label} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        {d.label}
      </div>
    </div>
  );
}
