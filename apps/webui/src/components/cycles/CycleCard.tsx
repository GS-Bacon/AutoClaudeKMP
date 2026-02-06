import { Link } from 'react-router-dom';
import type { CycleSummary, CycleType } from '../../api/types';
import { Badge } from '../common/Badge';

interface CycleCardProps {
  cycle: CycleSummary;
}

function getCycleTypeInfo(cycleType?: CycleType): { icon: string; label: string } {
  switch (cycleType) {
    case 'research':
      return { icon: '🔬', label: 'Research' };
    case 'optimize':
      return { icon: '⚡', label: 'Optimize' };
    case 'refactor':
      return { icon: '🔨', label: 'Refactor' };
    case 'repair':
    default:
      return { icon: '🔧', label: 'Repair' };
  }
}

export function CycleCard({ cycle }: CycleCardProps) {
  const formatTime = (timeString: string) => {
    try {
      const date = new Date(timeString);
      return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return timeString;
    }
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${minutes}m ${secs}s`;
  };

  const typeInfo = getCycleTypeInfo(cycle.cycleType);

  return (
    <Link
      to={`/cycles/${cycle.cycleId}`}
      className="block bg-white border border-gray-200 rounded-lg p-4 hover:border-blue-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{typeInfo.icon}</span>
          <span className="font-mono text-sm text-gray-700">{cycle.cycleId}</span>
          <Badge variant="default">{typeInfo.label}</Badge>
        </div>
        <Badge variant={cycle.success ? 'success' : 'error'}>
          {cycle.success ? 'Success' : 'Failed'}
        </Badge>
      </div>

      <div className="flex items-center gap-4 text-sm text-gray-500">
        <span>{formatTime(cycle.startTime)}</span>
        <span className="text-gray-300">|</span>
        <span>{formatDuration(cycle.duration)}</span>
        <span className="text-gray-300">|</span>
        <span className={cycle.issueCount > 0 ? 'text-red-500' : ''}>
          {cycle.issueCount} issues
        </span>
        <span className="text-gray-300">|</span>
        <span className={cycle.changeCount > 0 ? 'text-green-600' : ''}>
          {cycle.changeCount} changes
        </span>
      </div>
    </Link>
  );
}
