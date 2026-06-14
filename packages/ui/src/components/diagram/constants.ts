// ── Diagram design tokens ──────────────────────────────────────────────────────

export const NODE_COLORS: Record<string, { bg: string; border: string; text: string; label: string }> = {
  process:         { bg: '#EFF6FF', border: '#3B82F6', text: '#1E40AF', label: 'Process'        },
  data_store:      { bg: '#F0FDF4', border: '#22C55E', text: '#166534', label: 'Data Store'     },
  external_entity: { bg: '#F9FAFB', border: '#6B7280', text: '#374151', label: 'External Entity' },
  internet:        { bg: '#EFF6FF', border: '#0078D4', text: '#0050a0', label: 'Internet'       },
  service:         { bg: '#FAF5FF', border: '#A855F7', text: '#6B21A8', label: 'Service'        },
  identity:        { bg: '#FFF7ED', border: '#F59E0B', text: '#92400E', label: 'Identity'       },
  trust_boundary:  { bg: 'rgba(251,146,60,0.05)', border: '#FB923C', text: '#9A3412', label: 'Trust Boundary' },
};

export const STRIDE_COLORS: Record<string, { color: string; label: string; letter: string }> = {
  Spoofing:              { color: '#DC2626', label: 'Spoofing',               letter: 'S' },
  Tampering:             { color: '#EA580C', label: 'Tampering',              letter: 'T' },
  Repudiation:           { color: '#D97706', label: 'Repudiation',            letter: 'R' },
  InformationDisclosure: { color: '#2563EB', label: 'Information Disclosure', letter: 'I' },
  DenialOfService:       { color: '#7C3AED', label: 'Denial of Service',      letter: 'D' },
  ElevationOfPrivilege:  { color: '#DB2777', label: 'Elevation of Privilege', letter: 'E' },
};

