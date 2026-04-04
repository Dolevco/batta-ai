import { useState, useEffect } from 'react';
import { Card, Typography, Tree } from 'antd';
import {
  FolderOutlined,
  FileOutlined,
  DownOutlined
} from '@ant-design/icons';
import { VisualizationComponentProps } from '../types';
import type { DataNode } from 'antd/es/tree';
import { getParameters, getResult, getReason } from './utils';
import { T } from '../../../../theme';

const { Text } = Typography;
const { DirectoryTree } = Tree;

export default function ListFilesVisualization({ event }: VisualizationComponentProps) {
  const [visible, setVisible] = useState(false);
  const [treeData, setTreeData] = useState<DataNode[]>([]);

  // Extract data using utility functions
  const parameters = getParameters(event.data);
  const reason = getReason(event.data);
  
  const path = parameters.path || (event.data as any)?.path || '.';
  const recursive = parameters.recursive || (event.data as any)?.recursive;
  
  // Extract result - the actual file list
  const result = getResult(event.data) || [];
  
  // Result should be an array of file paths
  const files = Array.isArray(result) ? result : [];
  const totalFiles = files.length;

  useEffect(() => {
    setTimeout(() => setVisible(true), 100);
    
    if (files.length > 0 && event.status === 'completed') {
      // Build tree structure from paths
      // Files ending with / are directories
      const tree: DataNode[] = [];
      
      files.forEach((file: any) => {
        let filePath = typeof file === 'string' ? file : file.name || file.path || String(file);
        
        // Check if it's a directory (ends with /)
        const isDirectory = filePath.endsWith('/');
        if (isDirectory) {
          filePath = filePath.slice(0, -1); // Remove trailing slash for processing
        }
        
        const parts = filePath.split('/').filter((p: string) => p); // Remove empty parts
        
        if (parts.length === 0) return;
        
        let currentLevel = tree;
        
        parts.forEach((part: string, idx: number) => {
          const isLastPart = idx === parts.length - 1;
          const isFile = isLastPart && !isDirectory;
          const key = parts.slice(0, idx + 1).join('/');
          const existingNode = currentLevel.find((node) => node.key === key);
          
          if (existingNode) {
            currentLevel = existingNode.children as DataNode[];
          } else {
            const newNode: DataNode = {
              title: part,
              key: key,
              isLeaf: isFile,
              children: isFile ? undefined : [],
              icon: isFile ? <FileOutlined /> : <FolderOutlined />
            };
            currentLevel.push(newNode);
            if (!isFile) {
              currentLevel = newNode.children as DataNode[];
            }
          }
        });
      });
      setTreeData(tree);
    }
  }, [files, event.status]);

  return (
    <div style={{ 
      opacity: visible ? 1 : 0, 
      transition: 'opacity 0.5s ease-in',
      marginBottom: 16,
    }}>
      <Card 
        size="small"
        style={{ 
          backgroundColor: '#1e1e1e',
          border: '1px solid #333',
          borderRadius: 4,
          overflow: 'hidden'
        }}
        bodyStyle={{ padding: 0 }}
      >
        {/* Explorer Header */}
        <div style={{
          padding: '8px 12px',
          backgroundColor: '#252526',
          borderBottom: '1px solid #333',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
           <div style={{ flex: 1 }}>
             <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#BBBBBB', textTransform: 'uppercase' }}>Explorer</Text>
             {reason && (
               <div style={{ marginTop: 4 }}>
                 <Text style={{ fontSize: 11, color: '#666', fontStyle: 'italic' }}>
                   {reason}
                 </Text>
               </div>
             )}
           </div>
           <Text style={{ fontSize: 12, color: '#666' }}>{totalFiles} files</Text>
        </div>
        
        {/* File Tree */}
        <div style={{ padding: 0, maxHeight: '55vh', overflow: 'auto', backgroundColor: '#1e1e1e' }}>
          {treeData.length > 0 ? (
            <DirectoryTree
              treeData={treeData}
              defaultExpandAll
              switcherIcon={<DownOutlined />}
              style={{
                backgroundColor: 'transparent',
                color: '#CCCCCC',
                fontSize: 14,
                fontFamily: 'system-ui'
              }}
              selectable={false}
            />
          ) : (
            <div style={{ padding: 16, textAlign: 'center' }}>
              {event.status === 'in_progress' ? (
                <Text type="secondary">Scanning {path}...</Text>
              ) : (
                 <Text type="secondary">No files found</Text>
              )}
            </div>
          )}
        </div>
        
        {/* Parameter Info */}
        <div style={{
           padding: '5px 10px', 
           backgroundColor: '#007acc', 
           color: T.white,
           fontSize: 12
        }}>
           ls {recursive ? '-R' : ''} {path}
        </div>
      </Card>
      
      <style>{`
        .ant-tree .ant-tree-node-content-wrapper {
            transition: none !important;
        }
        .ant-tree .ant-tree-node-content-wrapper:hover {
            background-color: #2a2d2e !important;
        }
        .ant-tree.ant-tree-directory .ant-tree-treenode-selected:before {
            background-color: #37373d !important;
        }
        .ant-tree .ant-tree-switcher {
           color: #666;
        }
      `}</style>
    </div>
  );
}
