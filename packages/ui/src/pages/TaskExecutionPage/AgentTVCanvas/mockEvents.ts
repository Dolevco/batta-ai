/**
 * Example mock events to demonstrate AgentTVCanvas visualization transitions
 * 
 * These events simulate a typical agent workflow:
 * 1. Reading a configuration file
 * 2. Analyzing the data
 * 3. Writing a new file
 * 4. Modifying an existing file
 * 5. Running validation commands
 * 6. Committing changes to git
 */

import { ToolVisualizationEvent } from './types';

export const mockVisualizationEvents: ToolVisualizationEvent[] = [
  // Event 1: Read configuration file
  {
    id: 'event-1',
    semanticAction: 'read_file',
    objectName: 'config/settings.json',
    data: {
      content: `{
  "name": "My Application",
  "version": "1.0.0",
  "features": {
    "authentication": true,
    "logging": true
  }
}`,
      highlightedLines: [4, 5],
      startLine: 1,
    },
    status: 'in_progress',
  },

  // Event 2: Query data
  {
    id: 'event-2',
    semanticAction: 'query_data',
    objectName: 'Data Analysis',
    data: {
      substeps: [
        'Loading configuration',
        'Parsing JSON structure',
        'Validating schema',
        'Extracting features',
      ],
      result: 'Found 2 enabled features',
      count: 2,
    },
    status: 'in_progress',
  },

  // Event 3: Write new documentation file
  {
    id: 'event-3',
    semanticAction: 'write_file',
    objectName: 'docs/FEATURES.md',
    data: {
      content: `# Features

## Authentication
The application includes built-in authentication support.

## Logging
Comprehensive logging is enabled for debugging and monitoring.

## Configuration
Features can be toggled in config/settings.json`,
    },
    status: 'in_progress',
  },

  // Event 4: Modify existing file
  {
    id: 'event-4',
    semanticAction: 'modify_file',
    objectName: 'package.json',
    data: {
      diff: [
        { type: 'unchanged', content: '  "name": "my-app",' },
        { type: 'removed', content: '  "version": "0.9.0",' },
        { type: 'added', content: '  "version": "1.0.0",' },
        { type: 'unchanged', content: '  "description": "Application"' },
        { type: 'added', content: '  "features": ["auth", "logging"]' },
      ],
      comment: 'Updated version to 1.0.0 and added features list',
    },
    status: 'in_progress',
  },

  // Event 5: Run validation command
  {
    id: 'event-5',
    semanticAction: 'run_command',
    objectName: 'Validation Check',
    data: {
      command: 'npm test',
      substeps: [
        'Installing dependencies',
        'Running test suite',
        'Checking code coverage',
        'Generating report',
      ],
      result: 'All tests passed ✓',
    },
    status: 'in_progress',
  },

  // Event 6: Commit changes
  {
    id: 'event-6',
    semanticAction: 'git_commit',
    objectName: 'git commit',
    data: {
      message: 'feat: release version 1.0.0 with authentication and logging features',
      additions: 45,
      deletions: 12,
      filesChanged: 3,
    },
    status: 'in_progress',
  },
];

/**
 * Usage example:
 * 
 * ```tsx
 * import { AgentTVCanvas } from './AgentTVCanvas';
 * import { mockVisualizationEvents } from './mockEvents';
 * 
 * function DemoPage() {
 *   const [events, setEvents] = useState<ToolVisualizationEvent[]>([]);
 * 
 *   // Simulate events arriving progressively
 *   useEffect(() => {
 *     mockVisualizationEvents.forEach((event, index) => {
 *       setTimeout(() => {
 *         setEvents(prev => [...prev, event]);
 *         
 *         // Mark as completed after a delay
 *         setTimeout(() => {
 *           setEvents(prev => prev.map(e => 
 *             e.id === event.id ? { ...e, status: 'completed' } : e
 *           ));
 *         }, 2000);
 *       }, index * 3000);
 *     });
 *   }, []);
 * 
 *   return <AgentTVCanvas events={events} />;
 * }
 * ```
 */
