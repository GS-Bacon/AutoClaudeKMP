import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useCycleDetail } from '../api/hooks/useCycles';
import { CycleStats } from '../components/cycles/CycleStats';
import { Spinner } from '../components/common/Spinner';
import { Badge } from '../components/common/Badge';
import { MarkdownRenderer } from '../components/common/MarkdownRenderer';

export function CycleDetailPage() {
  const { cycleId } = useParams<{ cycleId: string }>();
  const { cycle, loading, error } = useCycleDetail(cycleId);

  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['issues', 'changes'])
  );

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        {error}
      </div>
    );
  }

  if (!cycle) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center text-gray-500">
        Cycle not found
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <Link
          to="/cycles"
          className="text-blue-600 hover:text-blue-800 text-sm mb-2 inline-block"
        >
          ← Back to cycles
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">
          Cycle: <span className="font-mono">{cycle.cycleId}</span>
        </h1>
      </div>

      <div className="mb-6">
        <CycleStats cycle={cycle} />
      </div>

      {/* Issues Section */}
      <CollapsibleSection
        title={`Issues Detected (${cycle.issues.length})`}
        expanded={expandedSections.has('issues')}
        onToggle={() => toggleSection('issues')}
        hasContent={cycle.issues.length > 0}
      >
        <div className="space-y-2">
          {cycle.issues.map((issue, idx) => (
            <IssueItem key={idx} issue={issue} />
          ))}
        </div>
      </CollapsibleSection>

      {/* Changes Section */}
      <CollapsibleSection
        title={`Changes Made (${cycle.changes.length})`}
        expanded={expandedSections.has('changes')}
        onToggle={() => toggleSection('changes')}
        hasContent={cycle.changes.length > 0}
      >
        <div className="space-y-2">
          {cycle.changes.map((change, idx) => (
            <div key={idx} className="flex items-center gap-2 text-sm">
              <span className="text-gray-400">•</span>
              <code className="text-gray-700">{change.file}</code>
              <Badge
                variant={
                  change.changeType === 'create'
                    ? 'success'
                    : change.changeType === 'delete'
                    ? 'error'
                    : 'info'
                }
              >
                {change.changeType}
              </Badge>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* Troubles Section */}
      <CollapsibleSection
        title={`Troubles (${cycle.troubles.length})`}
        expanded={expandedSections.has('troubles')}
        onToggle={() => toggleSection('troubles')}
        hasContent={cycle.troubles.length > 0}
      >
        <div className="space-y-2">
          {cycle.troubles.map((trouble, idx) => (
            <div key={idx} className="flex items-start gap-2 text-sm">
              <Badge variant="warning">{trouble.type}</Badge>
              <span className="text-gray-700">{trouble.message}</span>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* Token Usage */}
      {cycle.tokenUsage && (
        <div className="mt-4 bg-gray-50 border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Token Usage</h3>
          <div className="flex gap-4 text-sm">
            <span>
              Input: <strong>{cycle.tokenUsage.input.toLocaleString()}</strong>
            </span>
            <span>
              Output: <strong>{cycle.tokenUsage.output.toLocaleString()}</strong>
            </span>
          </div>
        </div>
      )}

      {/* Full Log Section */}
      {cycle.rawContent && (
        <CollapsibleSection
          title="Full Log"
          expanded={expandedSections.has('rawContent')}
          onToggle={() => toggleSection('rawContent')}
          hasContent={true}
        >
          <div className="max-h-[600px] overflow-y-auto">
            <MarkdownRenderer content={cycle.rawContent} />
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}

interface CollapsibleSectionProps {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  hasContent: boolean;
  children: React.ReactNode;
}

function CollapsibleSection({
  title,
  expanded,
  onToggle,
  hasContent,
  children,
}: CollapsibleSectionProps) {
  return (
    <div className="border border-gray-200 rounded-lg mb-4 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <span className="font-medium text-gray-700">{title}</span>
        <span className="text-gray-400">{expanded ? '▼' : '▶'}</span>
      </button>
      {expanded && (
        <div className="p-4 bg-white">
          {hasContent ? (
            children
          ) : (
            <p className="text-gray-400 text-sm">None</p>
          )}
        </div>
      )}
    </div>
  );
}

interface IssueItemProps {
  issue: {
    type: 'error' | 'warn' | 'info';
    message: string;
    context?: string;
  };
}

function IssueItem({ issue }: IssueItemProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="text-sm">
      <div className="flex items-start gap-2">
        <Badge
          variant={
            issue.type === 'error'
              ? 'error'
              : issue.type === 'warn'
              ? 'warning'
              : 'info'
          }
        >
          {issue.type}
        </Badge>
        <span className="text-gray-700 flex-1">{issue.message}</span>
        {issue.context && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-blue-600 hover:text-blue-800 text-xs"
          >
            {expanded ? 'Hide' : 'Show'} details
          </button>
        )}
      </div>
      {expanded && issue.context && (
        <pre className="mt-2 p-2 bg-gray-100 rounded text-xs text-gray-600 overflow-x-auto">
          {issue.context}
        </pre>
      )}
    </div>
  );
}
