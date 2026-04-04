import { useState, useEffect } from 'react';
import { Card, Typography, theme, Tag, Progress } from 'antd';
import { SearchOutlined, FileOutlined, LoadingOutlined } from '@ant-design/icons';
import { VisualizationComponentProps } from '../types';
import { getParameters, getResult, getReason } from './utils';

const { Text } = Typography;

interface SearchMatch {
  file: string;
  line: number;
  content: string;
}

export default function SearchFilesVisualization({ event }: VisualizationComponentProps) {
  const { token: antToken } = theme.useToken();
  const [visible, setVisible] = useState(false);
  const [searching, setSearching] = useState(true);
  const [searchProgress, setSearchProgress] = useState(0);
  const [revealedMatches, setRevealedMatches] = useState<Set<number>>(new Set());

  // Extract data using utility functions
  const parameters = getParameters(event.data);
  const reason = getReason(event.data);
  const result = getResult(event.data) || [];
  
  const query = parameters.query || parameters.regex || (event.data as any)?.query || 'search';
  const isRegex = parameters.isRegexp || parameters.is_regex || false;
  const includePattern = parameters.includePattern || parameters.include_pattern || '';
  
  // Parse matches from result
  const matches: SearchMatch[] = [];
  
  if (Array.isArray(result)) {
    result.forEach((item: any) => {
      if (item.file && item.line && item.content) {
        matches.push({
          file: item.file,
          line: item.line,
          content: item.content.trim(),
        });
      }
    });
  }

  const totalMatches = matches.length;

  useEffect(() => {
    setTimeout(() => setVisible(true), 100);
    
    // Simulate search animation with progress
    const searchDuration = 1200;
    const steps = 60;
    const stepDuration = searchDuration / steps;
    
    let currentStep = 0;
    const searchInterval = setInterval(() => {
      currentStep++;
      setSearchProgress((currentStep / steps) * 100);
      
      if (currentStep >= steps) {
        clearInterval(searchInterval);
        setSearching(false);
      }
    }, stepDuration);

    // Reveal matches with stagger
    if (event.status === 'completed' && matches.length > 0) {
      matches.forEach((_, index) => {
        setTimeout(() => {
          setRevealedMatches(prev => new Set([...prev, index]));
        }, searchDuration + index * 80);
      });
    }
    
    return () => clearInterval(searchInterval);
  }, [event.status, matches.length]);

  const highlightMatch = (text: string, searchTerm: string) => {
    if (!searchTerm || !text) return text;
    
    try {
      const regex = isRegex ? new RegExp(searchTerm, 'gi') : new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const parts = text.split(regex);
      const matches = text.match(regex) || [];
      
      return (
        <>
          {parts.map((part, i) => (
            <span key={i}>
              {part}
              {matches[i] && (
                <span style={{
                  backgroundColor: 'rgba(187, 128, 9, 0.4)',
                  color: '#e6edf3',
                  padding: '0 2px',
                  borderRadius: 2,
                }}>
                  {matches[i]}
                </span>
              )}
            </span>
          ))}
        </>
      );
    } catch {
      return text;
    }
  };

  return (
    <div style={{ 
      opacity: visible ? 1 : 0, 
      transition: 'opacity 0.4s ease-in',
    }}>
      <Card 
        size="small"
        style={{ 
          backgroundColor: '#0a0a0a',
          border: `1px solid ${antToken.colorBorder}`,
          borderRadius: 6,
        }}
        bodyStyle={{ padding: 0 }}
      >
        {/* Header */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 10, 
          padding: '12px 16px',
          borderBottom: `1px solid ${antToken.colorBorderSecondary}`,
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
        }}>
          <SearchOutlined style={{ color: antToken.colorPrimary, fontSize: 16 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text strong style={{ fontSize: 13, color: '#fff' }}>Search Files</Text>
            {reason && (
              <div style={{ marginTop: 4, marginBottom: 4 }}>
                <Text type="secondary" style={{ fontSize: 11, fontStyle: 'italic' }}>
                  {reason}
                </Text>
              </div>
            )}
            <div style={{ marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <code style={{ 
                fontSize: 11, 
                fontFamily: 'monospace',
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                padding: '2px 6px',
                borderRadius: 3,
                color: antToken.colorTextSecondary,
              }}>
                {query}
              </code>
              {isRegex && (
                <Tag color="blue" style={{ fontSize: 10, margin: 0, padding: '0 6px' }}>
                  regex
                </Tag>
              )}
              {includePattern && (
                <Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>
                  in: {includePattern}
                </Text>
              )}
            </div>
          </div>
          {searching ? (
            <div style={{ 
              fontSize: 11, 
              color: antToken.colorPrimary,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <LoadingOutlined />
              Searching...
            </div>
          ) : (
            <Tag color={totalMatches > 0 ? 'success' : 'default'} style={{ margin: 0 }}>
              {totalMatches} match{totalMatches !== 1 ? 'es' : ''}
            </Tag>
          )}
        </div>

        {/* Searching progress */}
        {searching && (
          <div style={{ padding: '12px 16px', backgroundColor: 'rgba(0, 0, 0, 0.3)' }}>
            <Progress 
              percent={Math.round(searchProgress)} 
              size="small"
              strokeColor={antToken.colorPrimary}
              trailColor="rgba(255, 255, 255, 0.05)"
              showInfo={false}
            />
          </div>
        )}

        {/* Search Results */}
        <div style={{
          minHeight: searching ? 0 : 100,
          maxHeight: '60vh',
          overflow: 'auto',
        }}>
          {!searching && matches.length === 0 && (
            <div style={{
              padding: '24px 16px',
              textAlign: 'center',
            }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                No matches found
              </Text>
            </div>
          )}
          
          {!searching && matches.length > 0 && (
            <div style={{ padding: '4px 0' }}>
              {matches.map((match, index) => (
                <div 
                  key={index}
                  style={{
                    opacity: revealedMatches.has(index) ? 1 : 0,
                    transform: revealedMatches.has(index) ? 'translateY(0)' : 'translateY(-8px)',
                    transition: 'all 0.3s ease',
                    margin: '6px 8px',
                    backgroundColor: 'rgba(0, 0, 0, 0.3)',
                    borderRadius: 4,
                    border: `1px solid ${antToken.colorBorderSecondary}`,
                    overflow: 'hidden',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(56, 139, 253, 0.08)';
                    e.currentTarget.style.borderColor = 'rgba(56, 139, 253, 0.3)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.3)';
                    e.currentTarget.style.borderColor = antToken.colorBorderSecondary;
                  }}
                >
                  {/* File path header */}
                  <div style={{
                    padding: '6px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    borderBottom: `1px solid ${antToken.colorBorderSecondary}`,
                  }}>
                    <FileOutlined style={{ color: '#8b949e', fontSize: 12 }} />
                    <Text style={{ 
                      color: '#58a6ff',
                      fontSize: 12,
                      fontFamily: 'monospace',
                      flex: 1,
                    }}>
                      {match.file}
                    </Text>
                    <Text style={{ 
                      color: '#8b949e',
                      fontSize: 11,
                      fontFamily: 'monospace',
                    }}>
                      Line {match.line}
                    </Text>
                  </div>
                  
                  {/* Match content */}
                  <div style={{
                    padding: '10px 14px',
                    fontFamily: 'monospace',
                  }}>
                    <pre style={{ 
                      margin: 0, 
                      color: antToken.colorTextSecondary,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontSize: 12,
                      lineHeight: 1.7,
                    }}>
                      {highlightMatch(match.content, query)}
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
