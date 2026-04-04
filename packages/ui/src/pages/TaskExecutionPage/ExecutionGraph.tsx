import { useEffect, useRef, useState } from 'react';
import ReactFlow, { Controls, Background, MiniMap, Node, Edge } from 'reactflow';
import 'reactflow/dist/style.css';
import { theme } from 'antd';

interface Props {
  nodes: Node[];
  edges: Edge[];
  nodeTypes: any;
}

export default function ExecutionGraph({ nodes, edges, nodeTypes }: Props) {
  // container ref to observe size changes
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [sizeSig, setSizeSig] = useState(0);
  const [rfInstance, setRfInstance] = useState<any>(null);
  const { token } = theme.useToken();

  // Observe container size changes and bump a signal to trigger fitView
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      setSizeSig(s => s + 1);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Fit view when the React Flow instance is ready, or when nodes/edges/size change
  useEffect(() => {
    if (!rfInstance) return;
    // slight debounce to allow layout to settle
    const t = setTimeout(() => {
      try {
        rfInstance.fitView({ padding: 0.2 });
      } catch (e) {
        // no-op
      }
    }, 50);
    return () => clearTimeout(t);
  }, [rfInstance, nodes.length, edges.length, sizeSig]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', background: token.colorBgLayout, border: `1px solid ${token.colorBorder}`, borderRadius: 8, overflow: 'hidden' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={inst => setRfInstance(inst)}
        attributionPosition="bottom-left"
        proOptions={{ hideAttribution: true }}
      >
        <Controls style={{ backgroundColor: token.colorBgContainer, border: `1px solid ${token.colorBorder}` }} />
        <MiniMap nodeColor={token.colorPrimary} maskColor={token.colorBorder} style={{ backgroundColor: token.colorBgContainer, border: `1px solid ${token.colorBorder}`, height: 75, width: 100 }} />
        <Background color={token.colorBorder} gap={16} />
      </ReactFlow>
    </div>
  );
}
