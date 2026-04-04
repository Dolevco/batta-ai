import { useState, useEffect, memo } from 'react';
import { Card, Typography, theme } from 'antd';
import { 
  CodeOutlined, 
  MinusCircleOutlined, 
  PlusCircleOutlined, 
  CheckCircleOutlined 
} from '@ant-design/icons';
import { VisualizationComponentProps } from '../types';
import { getParameters, getResult, getReason } from './utils';

const { Text } = Typography;

interface DiffLine {
  type: 'removed' | 'added' | 'unchanged';
  content: string;
  lineNum?: number;
}

function ModifyFileVisualizationComponent({ event }: VisualizationComponentProps) {
  const { token: antToken } = theme.useToken();
  const [visible, setVisible] = useState(false);
  const [revealedLines, setRevealedLines] = useState(0);
  const [scanProgress, setScanProgress] = useState(0);
  const [showDiff, setShowDiff] = useState(false);

  // Extract data using utility functions
  const parameters = getParameters(event.data);
  const reason = getReason(event.data);
  const result = getResult(event.data) || {};
  
  const fileName = parameters.path || parameters.file || event.objectName || 'file';
  const explanation = parameters.explanation || (event.data as any)?.explanation || (event.data as any)?.comment;
  
  // Extract diff from parameters or result
  let diffData = parameters.diff;
  
  // Fallback: check if diff is at the top level (legacy)
  if (!diffData && (event.data as any)?.diff) {
    diffData = (event.data as any).diff;
  }
  
  // Check if we have old_string and new_string (search_and_replace format)
  if (!diffData && parameters.old_string && parameters.new_string) {
    const oldStr = parameters.old_string;
    const newStr = parameters.new_string;
    // Create a simple diff representation
    diffData = {
      removed: oldStr.split('\n'),
      added: newStr.split('\n')
    };
  }
  
  // Check if we have oldString and newString (replace_string_in_file format)
  if (!diffData && parameters.oldString && parameters.newString) {
    const oldStr = parameters.oldString;
    const newStr = parameters.newString;
    diffData = {
      removed: oldStr.split('\n'),
      added: newStr.split('\n')
    };
  }
  
  // Check result for diff information
  if (!diffData && result.diff) {
    diffData = result.diff;
  } else if (!diffData && result.changes) {
    diffData = result.changes;
  }
  
  if (!diffData) {
    diffData = [];
  }
  
  // Parse diff data into structured lines
  const parseDiff = (): DiffLine[] => {
    // Handle object format with removed/added arrays
    if (diffData && typeof diffData === 'object' && !Array.isArray(diffData)) {
      const lines: DiffLine[] = [];
      if (diffData.removed && Array.isArray(diffData.removed)) {
        diffData.removed.forEach((line: string) => {
          lines.push({ type: 'removed', content: line });
        });
      }
      if (diffData.added && Array.isArray(diffData.added)) {
        diffData.added.forEach((line: string) => {
          lines.push({ type: 'added', content: line });
        });
      }
      return lines;
    }
    
    // Handle array format
    if (Array.isArray(diffData)) {
      return diffData.map((item: any) => ({
        type: item.type || 'unchanged',
        content: item.content || item,
        lineNum: item.lineNum,
      }));
    }
    
    // Handle SEARCH/REPLACE format from replace_in_file tool
    if (typeof diffData === 'string' && diffData.includes('------- SEARCH')) {
      const lines: DiffLine[] = [];
      
      // Extract the content between markers
      const searchMatch = diffData.match(/------- SEARCH\n([\s\S]*?)\n=======/);
      const replaceMatch = diffData.match(/=======\n([\s\S]*?)\n\+\+\+\+\+\+\+ REPLACE/);
      
      // Process SEARCH section (removed lines)
      if (searchMatch && searchMatch[1]) {
        const searchContent = searchMatch[1];
        const searchLines = searchContent.split('\n');
        searchLines.forEach(line => {
          lines.push({ type: 'removed', content: line });
        });
      }
      
      // Process REPLACE section (added lines)
      if (replaceMatch && replaceMatch[1]) {
        const replaceContent = replaceMatch[1];
        const replaceLines = replaceContent.split('\n');
        replaceLines.forEach(line => {
          lines.push({ type: 'added', content: line });
        });
      }
      
      return lines;
    }
    
    // Fallback: simple string diff with - and + prefixes
    if (typeof diffData === 'string') {
      const lines = diffData.split('\n').map(line => {
        if (line.startsWith('-')) return { type: 'removed' as const, content: line.substring(1) };
        if (line.startsWith('+')) return { type: 'added' as const, content: line.substring(1) };
        return { type: 'unchanged' as const, content: line };
      });
      return lines;
    }
    
    return [];
  };

  const diffLines = parseDiff();

  useEffect(() => {
    setTimeout(() => setVisible(true), 100);
    
    // Scanning animation
    const scanDuration = 800;
    const scanSteps = 50;
    const scanInterval = scanDuration / scanSteps;
    
    let currentScan = 0;
    const scanTimer = setInterval(() => {
      currentScan++;
      setScanProgress((currentScan / scanSteps) * 100);
      
      if (currentScan >= scanSteps) {
        clearInterval(scanTimer);
        // Show diff after scan
        setTimeout(() => setShowDiff(true), 200);
      }
    }, scanInterval);
    
    return () => clearInterval(scanTimer);
  }, []);

  useEffect(() => {
    if (!showDiff) return;
    
    // Reveal diff lines progressively
    const duration = Math.max(1200, diffLines.length * 60);
    const steps = diffLines.length;
    const stepDuration = duration / steps;
    
    let currentStep = 0;
    const interval = setInterval(() => {
      currentStep++;
      setRevealedLines(currentStep);
      
      if (currentStep >= steps) {
        clearInterval(interval);
      }
    }, stepDuration);
    
    return () => clearInterval(interval);
  }, [diffLines.length, showDiff]);

  const stats = diffLines.reduce((acc, line) => {
    if (line.type === 'added') acc.added++;
    if (line.type === 'removed') acc.removed++;
    return acc;
  }, { added: 0, removed: 0 });

  return (
    <div style={{ 
      opacity: visible ? 1 : 0, 
      transition: 'opacity 0.5s ease-in',
      marginBottom: 16,
    }}>
      <Card 
        size="small"
        style={{ 
          backgroundColor: '#0a0a0a',
          border: `1px solid ${antToken.colorBorder}`,
          borderRadius: 6,
        }}
      >
        {/* File Header - Enhanced */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 10, 
          marginBottom: 16,
          paddingBottom: 12,
          borderBottom: `2px solid ${antToken.colorBorderSecondary}`,
        }}>
          <div style={{
            padding: 6,
            backgroundColor: 'rgba(250, 173, 20, 0.1)',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <CodeOutlined style={{ color: '#faad14', fontSize: 18 }} />
          </div>
          
          <div style={{ flex: 1 }}>
            <Text strong style={{ fontSize: 14, color: '#fff', display: 'block' }}>
              Modifying File
            </Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {fileName}
            </Text>
            {reason && (
              <Text type="secondary" style={{ fontSize: 11, fontStyle: 'italic', display: 'block', marginTop: 4 }}>
                {reason}
              </Text>
            )}
          </div>
          
          {showDiff && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 4,
                padding: '4px 8px',
                backgroundColor: 'rgba(82, 196, 26, 0.1)',
                borderRadius: 4,
              }}>
                <PlusCircleOutlined style={{ color: '#52c41a', fontSize: 12 }} />
                <Text style={{ color: '#52c41a', fontSize: 12, fontWeight: 500 }}>
                  {stats.added}
                </Text>
              </div>
              
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 4,
                padding: '4px 8px',
                backgroundColor: 'rgba(255, 77, 79, 0.1)',
                borderRadius: 4,
              }}>
                <MinusCircleOutlined style={{ color: '#ff4d4f', fontSize: 12 }} />
                <Text style={{ color: '#ff4d4f', fontSize: 12, fontWeight: 500 }}>
                  {stats.removed}
                </Text>
              </div>
            </div>
          )}
        </div>

        {/* Explanation (if available) */}
        {explanation && (
          <div style={{
            padding: 10,
            backgroundColor: 'rgba(22, 119, 255, 0.08)',
            borderRadius: 4,
            marginBottom: 12,
            borderLeft: `3px solid ${antToken.colorPrimary}`,
          }}>
            <Text style={{ fontSize: 12, color: antToken.colorTextSecondary, fontStyle: 'italic' }}>
              {explanation}
            </Text>
          </div>
        )}

        {/* Scanning phase */}
        {!showDiff && (
          <div style={{ padding: '16px 0' }}>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
              Analyzing changes...
            </Text>
            <div style={{
              height: 3,
              backgroundColor: antToken.colorBgLayout,
              borderRadius: 2,
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                width: `${scanProgress}%`,
                backgroundColor: antToken.colorPrimary,
                transition: 'width 0.1s linear',
              }} />
            </div>
          </div>
        )}

        {/* Enhanced Diff View */}
        {showDiff && (
          <div style={{
            backgroundColor: '#0d0d0d',
            borderRadius: 6,
            border: '1px solid rgba(255, 255, 255, 0.08)',
            maxHeight: '60vh',
            overflow: 'auto',
          }}>
            {/* Diff toolbar */}
            <div style={{
              padding: '10px 16px',
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace' }}>
                DIFF VIEW
              </Text>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {diffLines.length} lines
              </Text>
            </div>

            {/* Diff lines */}
            <div style={{ padding: 6 }}>
              {diffLines.slice(0, revealedLines).map((line, idx) => {
                let bgColor = 'transparent';
                let borderColor = 'transparent';
                let textColor = '#d4d4d4';
                let icon = null;
                let prefix = '';

                if (line.type === 'removed') {
                  bgColor = 'rgba(255, 77, 79, 0.12)';
                  borderColor = '#ff4d4f';
                  textColor = '#ff7875';
                  icon = <MinusCircleOutlined style={{ fontSize: 11, marginRight: 8, color: '#ff4d4f' }} />;
                  prefix = '- ';
                } else if (line.type === 'added') {
                  bgColor = 'rgba(82, 196, 26, 0.12)';
                  borderColor = '#52c41a';
                  textColor = '#73d13d';
                  icon = <PlusCircleOutlined style={{ fontSize: 11, marginRight: 8, color: '#52c41a' }} />;
                  prefix = '+ ';
                } else {
                  textColor = '#8c8c8c';
                  prefix = '  ';
                }

                return (
                  <div
                    key={idx}
                    style={{
                      padding: '8px 12px',
                      backgroundColor: bgColor,
                      borderLeft: `3px solid ${borderColor}`,
                      color: textColor,
                      marginBottom: 1,
                      display: 'flex',
                      alignItems: 'flex-start',
                      fontFamily: '"SF Mono", Monaco, Consolas, "Courier New", monospace',
                      fontSize: 13,
                      lineHeight: 1.7,
                      animation: 'diffSlideIn 0.25s ease-out',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    {icon}
                    <span style={{ 
                      whiteSpace: 'pre-wrap', 
                      wordBreak: 'break-word',
                      flex: 1,
                    }}>
                      {prefix}{line.content || ' '}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Status footer */}
        {event.status === 'completed' && showDiff && revealedLines >= diffLines.length && (
          <div style={{ 
            marginTop: 12, 
            padding: 8,
            backgroundColor: 'rgba(82, 196, 26, 0.08)',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
            <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 14 }} />
            <Text style={{ fontSize: 12, color: '#52c41a', fontWeight: 500 }}>
              Changes applied successfully
            </Text>
          </div>
        )}
      </Card>

      <style>{`
        @keyframes diffSlideIn {
          from { 
            opacity: 0; 
            transform: translateX(-4px);
          }
          to { 
            opacity: 1; 
            transform: translateX(0);
          }
        }
      `}</style>
    </div>
  );
}

export default memo(ModifyFileVisualizationComponent);
