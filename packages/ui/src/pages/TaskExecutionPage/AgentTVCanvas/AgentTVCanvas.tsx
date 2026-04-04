import { useState, useEffect, useRef, memo } from 'react';
import { Card, Empty, theme, Slider } from 'antd';
import { CaretLeftOutlined, CaretRightOutlined } from '@ant-design/icons';
import { ToolVisualizationEvent, WorkspaceArtifact } from './types';
import { VisualizationRegistry, defaultRegistry } from './VisualizationRegistry';

interface AgentTVCanvasProps {
  events: ToolVisualizationEvent[];
  registry?: VisualizationRegistry;
}

// Memoized artifact component to prevent unnecessary re-renders
const ArtifactRenderer = memo(({ artifact }: { artifact: WorkspaceArtifact }) => {
  const Component = artifact.component;
  return <Component event={artifact.event} />;
});

ArtifactRenderer.displayName = 'ArtifactRenderer';

export default function AgentTVCanvas({ events, registry = defaultRegistry }: AgentTVCanvasProps) {
  const { token } = theme.useToken();
  const [artifacts, setArtifacts] = useState<WorkspaceArtifact[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const processedEventIds = useRef(new Set<string>());
  const autoAdvanceRef = useRef(true);
  const lastEventCountRef = useRef(events.length);

  // Reset artifacts when events are cleared (new execution starts)
  useEffect(() => {
    if (events.length === 0 && lastEventCountRef.current > 0) {
      // Events were cleared - reset artifacts
      setArtifacts([]);
      setCurrentStep(0);
      processedEventIds.current.clear();
      autoAdvanceRef.current = true;
    }
    lastEventCountRef.current = events.length;
  }, [events.length]);

  useEffect(() => {
    // Process new events and add them to workspace (chronologically)
    events.forEach((event, eventIndex) => {
      // Skip if already processed
      if (processedEventIds.current.has(event.id)) {
        return;
      }

      // Check if we have a visualization for this action
      const component = registry.getComponent(event.semanticAction);
      if (!component) {
        console.warn(`No visualization for semantic action: ${event.semanticAction}`);
        return;
      }

      // Add hesitation delay before showing artifact (simulate human thinking/working)
      // Vary the delay based on the action type for more realism
      let baseDelay = 400;
      if (event.semanticAction === 'read_file') {
        baseDelay = 300; // Quick to start reading
      } else if (event.semanticAction === 'write_file' || event.semanticAction === 'modify_file') {
        baseDelay = 500; // Take a moment before editing
      } else if (event.semanticAction === 'run_command') {
        baseDelay = 350; // Commands run quickly
      } else if (event.semanticAction === 'query_data') {
        baseDelay = 450; // Data queries need thinking
      }
      
      const hesitation = baseDelay + Math.random() * 200; // Add variance
      
      setTimeout(() => {
        const artifact: WorkspaceArtifact = {
          id: event.id,
          type: event.semanticAction,
          component,
          event,
          timestamp: eventIndex, // Use original event order instead of Date.now()
        };

        setArtifacts(prev => {
          // Add and sort by timestamp to maintain chronological order from chain of thoughts
          const newArtifacts = [...prev, artifact].sort((a, b) => a.timestamp - b.timestamp);
          // Auto-advance to the latest step if user hasn't manually navigated
          if (autoAdvanceRef.current) {
            setCurrentStep(newArtifacts.length - 1);
          }
          return newArtifacts;
        });
        processedEventIds.current.add(event.id);
      }, hesitation);
    });
  }, [events, registry]);

  // Update existing artifacts when event status changes
  useEffect(() => {
    setArtifacts(prev => 
      prev.map(artifact => {
        const updatedEvent = events.find(e => e.id === artifact.id);
        if (updatedEvent && updatedEvent.status !== artifact.event.status) {
          return { ...artifact, event: updatedEvent };
        }
        return artifact;
      })
    );
  }, [events]);

  const handlePrevious = () => {
    autoAdvanceRef.current = false;
    setCurrentStep(prev => Math.max(0, prev - 1));
  };

  const handleNext = () => {
    autoAdvanceRef.current = false;
    setCurrentStep(prev => Math.min(artifacts.length - 1, prev + 1));
  };

  const handleTimelineChange = (value: number) => {
    autoAdvanceRef.current = false;
    setCurrentStep(value);
  };

  const currentArtifact = artifacts[currentStep];

  return (
    <Card 
      style={{ 
        width: '100%',
        flex: 1,
        backgroundColor: token.colorBgContainer,
        borderLeft: `1px solid ${token.colorBorder}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
      bodyStyle={{ 
        flex: 1, 
        display: 'flex', 
        flexDirection: 'column',
        padding: 0,
        overflow: 'hidden',
      }}
    >
      {/* Canvas workspace - Single step view */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: 16,
        scrollBehavior: 'smooth',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
      }}>
        {artifacts.length === 0 ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            minHeight: 200,
          }}>
            <Empty 
              description="Waiting for agent to start working..."
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          </div>
        ) : currentArtifact ? (
          <div style={{ width: '100%', animation: 'fadeIn 0.3s ease-in' }}>
            <ArtifactRenderer artifact={currentArtifact} />
          </div>
        ) : null}
      </div>

      {/* Navigation bar at bottom */}
      {artifacts.length > 0 && (
        <div style={{
          padding: '16px',
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          backgroundColor: token.colorBgContainer,
          flexShrink: 0,
        }}>
          {/* Timeline controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Previous button */}
            <div 
              onClick={handlePrevious}
              style={{
                width: 28,
                height: 28,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 4,
                backgroundColor: currentStep === 0 ? token.colorBgLayout : token.colorBgTextHover,
                cursor: currentStep === 0 ? 'not-allowed' : 'pointer',
                opacity: currentStep === 0 ? 0.4 : 1,
                transition: 'all 0.2s',
              }}
            >
              <CaretLeftOutlined style={{ 
                fontSize: 14, 
                color: currentStep === 0 ? token.colorTextDisabled : token.colorText,
              }} />
            </div>

            {/* Timeline slider */}
            <div style={{ flex: 1, paddingLeft: 8, paddingRight: 8 }}>
              <Slider
                min={0}
                max={artifacts.length - 1}
                value={currentStep}
                onChange={handleTimelineChange}
                tooltip={{ 
                  formatter: (value) => `Step ${(value || 0) + 1}/${artifacts.length}`,
                }}
                styles={{
                  track: { backgroundColor: token.colorPrimary },
                  rail: { backgroundColor: token.colorBgLayout },
                }}
              />
            </div>

            {/* Next button */}
            <div 
              onClick={handleNext}
              style={{
                width: 28,
                height: 28,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 4,
                backgroundColor: currentStep === artifacts.length - 1 ? token.colorBgLayout : token.colorBgTextHover,
                cursor: currentStep === artifacts.length - 1 ? 'not-allowed' : 'pointer',
                opacity: currentStep === artifacts.length - 1 ? 0.4 : 1,
                transition: 'all 0.2s',
              }}
            >
              <CaretRightOutlined style={{ 
                fontSize: 14, 
                color: currentStep === artifacts.length - 1 ? token.colorTextDisabled : token.colorText,
              }} />
            </div>
          </div>

          {/* Step counter */}
          <div style={{ 
            textAlign: 'center',
            fontSize: 11, 
            color: token.colorTextSecondary,
            marginTop: 8,
            fontWeight: 500,
          }}>
            Step {currentStep + 1} of {artifacts.length}
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </Card>
  );
}
