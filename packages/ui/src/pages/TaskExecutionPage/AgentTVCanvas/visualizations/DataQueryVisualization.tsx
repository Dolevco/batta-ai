import { useState, useEffect } from 'react';
import { Card, Typography, theme } from 'antd';
import { 
  GlobalOutlined,
  SearchOutlined,
  CheckCircleOutlined
} from '@ant-design/icons';
import { VisualizationComponentProps } from '../types';
import { getParameters, getResult, getReason, getToolName, getMessage, isSuccess } from './utils';

const { Text } = Typography;

export default function DataQueryVisualization({ event }: VisualizationComponentProps) {
  const { token: antToken } = theme.useToken();
  const [visible, setVisible] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [revealedItems, setRevealedItems] = useState(0);

  // Extract data using utility functions
  const parameters = getParameters(event.data);
  const toolName = getToolName(event.data);
  const reason = getReason(event.data);
  const result = getResult(event.data) || {};
  const success = isSuccess(event.data);
  const message = getMessage(event.data);
  
  // Check for truncated content (e.g., long file reads)
  const toolUseData = event.data?.toolUse;
  const toolResultData = event.data?.toolResult;
  const metadata = 
    (toolResultData as any)?.metadata || 
    (toolUseData as any)?.metadata || 
    (result as any)?.metadata;
  
  const isTruncated = metadata?.truncated || (message && message.includes('too long'));
  const totalLines = metadata?.lines;
  const preview = 
    (toolResultData as any)?.preview || 
    (toolUseData as any)?.preview || 
    metadata?.preview || 
    (typeof result === 'string' && isTruncated ? result : '');
  
  // Handle different result structures
  let resultCount = 0;
  let resultItems: any[] = [];
  
  if (typeof result === 'object') {
    if (Array.isArray(result)) {
      // Direct array result
      resultCount = result.length;
      resultItems = result;
    } else if (result.users && Array.isArray(result.users)) {
      resultCount = result.matchedUsers || result.users.length;
      resultItems = result.users;
    } else if (result.count !== undefined) {
      resultCount = result.count;
    } else if (result.results && Array.isArray(result.results)) {
      resultCount = result.results.length;
      resultItems = result.results;
    } else if (result.assessment) {
      // MDC assessment details
      resultCount = 1;
      resultItems = [result.assessment];
      if (result.subAssessments && Array.isArray(result.subAssessments)) {
        resultCount += result.subAssessments.length;
        resultItems = resultItems.concat(result.subAssessments);
      }
    } else {
      // If result is an object but not structured, treat it as single result
      resultCount = Object.keys(result).length > 0 ? 1 : 0;
    }
  }

  // Animation for visibility
  useEffect(() => {
    setTimeout(() => setVisible(true), 100);
    
    if (event.status === 'completed') {
      setTimeout(() => setShowResult(true), 300);
      
      if (resultItems.length > 0) {
        resultItems.forEach((_, index) => {
          setTimeout(() => {
            setRevealedItems(index + 1);
          }, 500 + index * 100);
        });
      } else {
        // Show result even if no items (for JSON display)
        setTimeout(() => setRevealedItems(1), 500);
      }
    }
  }, [event.status, resultItems.length]);

  // Use toolUse reason as the search query (primary) or fallback to parameters
  let searchQuery = reason || parameters.query || parameters.search || parameters.type || toolName.replace(/([A-Z])/g, ' $1').trim();
  
  // Remove "to" or "To" at the beginning and capitalize the following word (same as ChainOfThoughts)
  if (searchQuery) {
    searchQuery = searchQuery.replace(/^[Tt]o\s+(\w)/, (_match: string, firstChar: string) => firstChar.toUpperCase());
  }

  return (
    <div style={{ 
      opacity: visible ? 1 : 0, 
      transition: 'opacity 0.5s ease-in',
      marginBottom: 16,
    }}>
      <Card 
        size="small"
        style={{ 
          backgroundColor: antToken.colorBgContainer,
          border: `1px solid ${antToken.colorBorder}`,
          borderRadius: 24,
          overflow: 'hidden',
          boxShadow: antToken.boxShadowSecondary
        }}
        bodyStyle={{ padding: 0 }}
      >
        {/* Google-like Search Bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 20px',
          borderBottom: `1px solid ${antToken.colorBorder}`
        }}>
          <SearchOutlined style={{ fontSize: 18, color: antToken.colorTextTertiary }} />
          <Text style={{ 
            flex: 1, 
            fontSize: 14,
            color: event.status === 'completed' ? antToken.colorText : antToken.colorTextSecondary
          }}>
            {searchQuery}
          </Text>
          {event.status === 'in_progress' && (
            <GlobalOutlined spin style={{ fontSize: 18, color: antToken.colorPrimary }} />
          )}
          {event.status === 'completed' && (
            <CheckCircleOutlined style={{ fontSize: 18, color: antToken.colorSuccess }} />
          )}
        </div>

        {/* Result Count & Status */}
        {event.status === 'completed' && showResult && (
          <div style={{ 
            padding: '12px 20px', 
            fontSize: 13,
            color: antToken.colorTextSecondary,
            borderBottom: `1px solid ${antToken.colorBorderSecondary}`
          }}>
            {message ? (
              <>
                <span style={{ color: success ? antToken.colorSuccess : antToken.colorError }}>
                  {message}
                </span>
                {resultCount > 0 && (
                  <span style={{ marginLeft: 8 }}>
                    - {resultCount.toLocaleString()} result{resultCount !== 1 ? 's' : ''}
                  </span>
                )}
              </>
            ) : (
              <>
                About {resultCount.toLocaleString()} result{resultCount !== 1 ? 's' : ''} 
                <span style={{ marginLeft: 8, color: antToken.colorTextTertiary }}>
                  ({(Math.random() * 0.5 + 0.1).toFixed(2)} seconds)
                </span>
              </>
            )}
          </div>
        )}

        {/* Results Area */}
        <div style={{ 
          padding: event.status === 'in_progress' ? '40px 20px' : '16px 20px',
          minHeight: 200, 
          maxHeight: '60vh', 
          overflow: 'auto',
          backgroundColor: antToken.colorBgContainer
        }}>
          {event.status === 'in_progress' ? (
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column',
              alignItems: 'center', 
              justifyContent: 'center', 
              gap: 16,
              minHeight: 150
            }}>
              <GlobalOutlined spin style={{ fontSize: 32, color: antToken.colorPrimary }} />
              <Text type="secondary">Searching...</Text>
            </div>
          ) : showResult && (
            <div>
              {/* Show preview for truncated content */}
              {isTruncated && preview ? (
                <div>
                  {/* Truncation Notice */}
                  {totalLines && (
                    <div style={{ 
                      padding: '10px 14px',
                      backgroundColor: antToken.colorInfoBg,
                      borderRadius: 8,
                      marginBottom: 12,
                      fontSize: 13,
                      color: antToken.colorInfoText
                    }}>
                      Showing preview of first ~100 lines (file has {totalLines} lines total)
                    </div>
                  )}
                  
                  {/* Preview Content */}
                  <div style={{ 
                    fontFamily: 'monospace', 
                    fontSize: 13,
                    backgroundColor: antToken.colorBgLayout,
                    padding: 14,
                    borderRadius: 8,
                    maxHeight: '55vh',
                    overflow: 'auto',
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word'
                  }}>
                    <pre style={{ margin: 0, color: antToken.colorText }}>
                      {preview}
                    </pre>
                  </div>
                </div>
              ) : resultItems && resultItems.length > 0 ? (
                <div>
                  {resultItems.slice(0, revealedItems).map((item, idx) => {
                    // Determine title and key fields for better display
                    const title = item.displayName || item.name || item.id || item.title || `Result ${idx + 1}`;
                    const isAssessment = item.status || item.severity || item.assessment;
                    
                    return (
                      <div 
                        key={idx} 
                        style={{ 
                          marginBottom: 24,
                          padding: '12px 0',
                          borderBottom: idx < revealedItems - 1 ? `1px solid ${antToken.colorBorderSecondary}` : 'none',
                          animation: 'fadeIn 0.3s ease-in'
                        }}
                      >
                        {/* Result Entry - Google style */}
                        <div style={{ marginBottom: 4 }}>
                          <Text style={{ 
                            fontSize: 14, 
                            color: antToken.colorPrimary,
                            fontWeight: 400,
                            textDecoration: 'underline',
                            cursor: 'pointer'
                          }}>
                            {title}
                          </Text>
                        </div>
                        
                        {/* Result Details */}
                        <div style={{ 
                          fontSize: 13,
                          color: antToken.colorText,
                          lineHeight: 1.6
                        }}>
                          {isAssessment ? (
                            // Special rendering for assessments
                            <>
                              {item.severity && (
                                <div style={{ marginBottom: 4 }}>
                                  <span style={{ 
                                    padding: '2px 8px', 
                                    borderRadius: 4,
                                    fontSize: 11,
                                    fontWeight: 500,
                                    backgroundColor: item.severity === 'High' ? 'rgba(255, 77, 79, 0.1)' : 
                                                    item.severity === 'Medium' ? 'rgba(250, 173, 20, 0.1)' : 'rgba(24, 144, 255, 0.1)',
                                    color: item.severity === 'High' ? antToken.colorError : 
                                          item.severity === 'Medium' ? antToken.colorWarning : antToken.colorInfo
                                  }}>
                                    {item.severity}
                                  </span>
                                  {item.status && (
                                    <span style={{ 
                                      marginLeft: 8,
                                      padding: '2px 8px', 
                                      borderRadius: 4,
                                      fontSize: 11,
                                      fontWeight: 500,
                                      backgroundColor: item.status === 'Unhealthy' ? 'rgba(255, 77, 79, 0.1)' : 'rgba(82, 196, 26, 0.1)',
                                      color: item.status === 'Unhealthy' ? antToken.colorError : antToken.colorSuccess
                                    }}>
                                      {item.status}
                                    </span>
                                  )}
                                </div>
                              )}
                              {item.description && (
                                <div style={{ color: antToken.colorTextSecondary, fontSize: 13, marginTop: 4 }}>
                                  {String(item.description).replace(/<br\s*\/?>/gi, ' ').substring(0, 250)}
                                  {String(item.description).length > 250 ? '...' : ''}
                                </div>
                              )}
                              {item.resourceId && (
                                <div style={{ color: antToken.colorSuccess, fontSize: 12, marginTop: 4 }}>
                                  {item.resourceId}
                                </div>
                              )}
                              {item.Package && (
                                <div style={{ marginTop: 8, fontSize: 12 }}>
                                  <span style={{ color: antToken.colorTextSecondary }}>Package:</span> <span style={{ fontFamily: 'monospace', color: antToken.colorText }}>{item.Package}</span>
                                  {item.VulnerableVersionRange && (
                                    <span style={{ marginLeft: 8, color: antToken.colorError }}>
                                      ({item.VulnerableVersionRange})
                                    </span>
                                  )}
                                </div>
                              )}
                              {item.CVSSScore && (
                                <div style={{ marginTop: 4, fontSize: 12, color: antToken.colorTextSecondary }}>
                                  CVSS Score: <span style={{ fontWeight: 500, color: antToken.colorText }}>{item.CVSSScore}</span>
                                </div>
                              )}
                            </>
                          ) : (
                            // Default rendering for other items
                            Object.entries(item)
                              .filter(([key]) => key !== 'id' && key !== 'description' && key !== 'displayName' && key !== 'name') // Don't show these twice
                              .slice(0, 5)
                              .map(([key, value]) => (
                              <div key={key} style={{ marginBottom: 2 }}>
                                <span style={{ fontWeight: 500, color: antToken.colorTextSecondary }}>{key}:</span>{' '}
                                <span style={{ color: antToken.colorText }}>
                                  {typeof value === 'object' 
                                    ? JSON.stringify(value).substring(0, 100) + (JSON.stringify(value).length > 100 ? '...' : '')
                                    : String(value).substring(0, 200) + (String(value).length > 200 ? '...' : '')
                                  }
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : typeof result === 'object' && Object.keys(result).length > 0 ? (
                // Render as JSON for non-array results
                <div style={{ 
                  fontFamily: 'monospace', 
                  fontSize: 13,
                  backgroundColor: antToken.colorBgLayout,
                  padding: 14,
                  borderRadius: 8,
                  maxHeight: '55vh',
                  overflow: 'auto',
                  lineHeight: 1.6
                }}>
                  <pre style={{ margin: 0, color: antToken.colorText }}>
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: 40 }}>
                  <Text type="secondary">No results found</Text>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
      
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
