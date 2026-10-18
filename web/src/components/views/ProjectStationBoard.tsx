import React, { useState } from 'react';
import {
  ArrowLeft, Check, Copy, ListTree, MessageSquare, Radio, Shield, Sparkles, Terminal,
  CheckCircle2, PenTool, Rocket, Users, Workflow,
} from 'lucide-react';
import { createInvite } from '../../lib/invites';
import { GlassCard } from '../reactbits/GlassCard';

export type StationTab =
  | 'overview' | 'plan' | 'design' | 'product' | 'architecture' | 'developer' | 'qa' | 'devops' | 'release'
  | 'security' | 'team_access' | 'comments';

export interface ProjectMemberRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  stations: string[];
  isLead: boolean;
  /** Narrowed by a PM or the project lead to ``stations``; otherwise the whole project. */
  limited?: boolean;
  avatarUrl?: string | null;
}

interface StationDef {
  tab: Exclude<StationTab, 'overview'>;
  /** Backend station id that gates it; null means every member sees it. */
  station: string | null;
  title: string;
  blurb: string;
  Icon: React.ComponentType<{ className?: string }>;
  tone: string;
}

export const STATIONS: StationDef[] = [
  { tab: 'plan', station: 'product', title: 'Plan', blurb: 'Epics and stories from the approved idea', Icon: ListTree, tone: 'text-[#7aa7ff]' },
  { tab: 'design', station: 'design', title: 'Design', blurb: 'API contracts and screen prototypes', Icon: PenTool, tone: 'text-fuchsia-300' },
  { tab: 'product', station: 'product', title: 'Product', blurb: 'Requirements, scope and approvals', Icon: Sparkles, tone: 'text-amber-400' },
  { tab: 'architecture', station: 'architecture', title: 'Architecture', blurb: 'Decisions and design reviews', Icon: Workflow, tone: 'text-[#5B8FFF]' },
  { tab: 'developer', station: 'developer', title: 'Developer', blurb: 'Tasks, agent runs and pull requests', Icon: Terminal, tone: 'text-[#5B8FFF]' },
  { tab: 'qa', station: 'qa', title: 'QA', blurb: 'Test scenarios and release gates', Icon: CheckCircle2, tone: 'text-emerald-400' },
  { tab: 'devops', station: 'devops', title: 'CI/CD', blurb: 'Pipelines and canary releases', Icon: Radio, tone: 'text-blue-400' },
  { tab: 'release', station: 'release', title: 'Release', blurb: 'Release records, approval and GitHub Releases', Icon: Rocket, tone: 'text-emerald-300' },
  { tab: 'security', station: 'security', title: 'Security', blurb: 'Findings, exceptions and governance', Icon: Shield, tone: 'text-rose-400' },
  { tab: 'comments', station: null, title: 'Discussion', blurb: 'Comments and @mentions', Icon: MessageSquare, tone: 'text-[#5B8FFF]' },
  { tab: 'team_access', station: null, title: 'Team and access', blurb: 'Invite people, set stations', Icon: Users, tone: 'text-[#5B8FFF]' },
];

export const stationOf = (tab: StationTab): StationDef | undefined => STATIONS.find((s) => s.tab === tab);

/** People on a station: members holding it. Leads and QA/lead roles act as its reviewers. */
export function stationPeople(members: ProjectMemberRow[], station: string | null) {
  const on = station === null ? members : members.filter((m) => m.stations.includes(station));
  const reviewers = on.filter((m) => m.isLead || m.role === 'lead' || m.role === 'qa');
  return { on, reviewers };
}

const Avatar: React.FC<{ m: ProjectMemberRow; size?: number }> = ({ m, size = 26 }) => (
  <span
    title={`${m.name} · ${m.role}${m.isLead ? ' · lead' : ''}`}
    style={{ width: size, height: size }}
    className="inline-flex items-center justify-center rounded-full bg-gradient-to-br from-[#075BFF] to-blue-600 text-white text-[10px] font-semibold border-2 border-[#0c0e15] -ml-1.5 first:ml-0 overflow-hidden shrink-0"
  >
    {m.avatarUrl ? <img src={m.avatarUrl} alt="" className="w-full h-full object-cover" /> : m.name.charAt(0).toUpperCase()}
  </span>
);

const AvatarStack: React.FC<{ people: ProjectMemberRow[]; max?: number }> = ({ people, max = 5 }) => (
  <div className="flex items-center">
    {people.slice(0, max).map((m) => <Avatar key={m.id} m={m} />)}
    {people.length > max && (
      <span className="ml-1 text-[10px] font-mono text-[#827D8E]">+{people.length - max}</span>
    )}
    {people.length === 0 && <span className="text-[11px] text-[#827D8E]">No one yet</span>}
  </div>
);

interface BoardProps {
  members: ProjectMemberRow[];
  visible: (station: string | null) => boolean;
  counts: Partial<Record<StationTab, string>>;
  onOpen: (tab: StationTab) => void;
}

/** The project home: one card per station, each with its own team. */
export const ProjectStationBoard: React.FC<BoardProps> = ({ members, visible, counts, onOpen }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
    {STATIONS.filter((s) => visible(s.station)).map(({ tab, station, title, blurb, Icon, tone }) => {
      const { on, reviewers } = stationPeople(members, station);
      return (
        <button
          key={tab}
          type="button"
          onClick={() => onOpen(tab)}
          className="text-left p-5 bg-[#0c0e15]/90 border border-white/[0.08] hover:border-[#075BFF]/50 rounded-2xl transition-colors space-y-4 cursor-pointer"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-white">{title}</h3>
              <p className="text-xs text-[#827D8E] mt-0.5">{blurb}</p>
            </div>
            <Icon className={`w-5 h-5 shrink-0 ${tone}`} />
          </div>
          {counts[tab] && <p className="text-xs text-[#B5B1C0] font-mono">{counts[tab]}</p>}
          <div className="space-y-2 pt-3 border-t border-white/[0.06]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wider font-mono text-[#827D8E]">Team</span>
              <AvatarStack people={on} />
            </div>
            {station !== null && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wider font-mono text-[#827D8E]">Reviewers</span>
                <AvatarStack people={reviewers} />
              </div>
            )}
          </div>
        </button>
      );
    })}
  </div>
);

interface BarProps {
  tab: Exclude<StationTab, 'overview'>;
  members: ProjectMemberRow[];
  canInvite: boolean;
  token: string;
  workspaceId: string;
  projectId: string;
  onBack: () => void;
  onOpenTeam: () => void;
}

/** Top of a station screen: way back, who works here, who reviews, invite for this station. */
export const StationBar: React.FC<BarProps> = ({
  tab, members, canInvite, token, workspaceId, projectId, onBack, onOpenTeam,
}) => {
  const def = stationOf(tab);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!def) return null;
  const { on, reviewers } = stationPeople(members, def.station);

  const copyInvite = async () => {
    setError(null);
    try {
      const inv = await createInvite(token, workspaceId, {
        role: 'developer',
        project_id: projectId,
        stations: def.station ? [def.station] : undefined,
      });
      await navigator.clipboard.writeText(inv.inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <GlassCard className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onBack}
          className="p-2 rounded-xl border border-white/[0.08] text-[#827D8E] hover:text-white cursor-pointer shrink-0"
          aria-label="Back to project board"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <def.Icon className={`w-5 h-5 shrink-0 ${def.tone}`} />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">{def.title}</div>
          <div className="text-[11px] text-[#827D8E] truncate">{def.blurb}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider font-mono text-[#827D8E]">Team</span>
          <AvatarStack people={on} />
        </div>
        {def.station !== null && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider font-mono text-[#827D8E]">Reviewers</span>
            <AvatarStack people={reviewers} />
          </div>
        )}
        {canInvite && def.tab !== 'team_access' && (
          <button
            type="button"
            onClick={copyInvite}
            className="px-3 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] text-white text-[11px] font-medium inline-flex items-center gap-1.5 cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Invite link copied' : `Invite to ${def.title}`}
          </button>
        )}
        {canInvite && def.tab !== 'team_access' && (
          <button type="button" onClick={onOpenTeam} className="text-[11px] text-[#5B8FFF] hover:text-white cursor-pointer">
            Manage team
          </button>
        )}
      </div>
      {error && <p className="text-[11px] text-red-400 md:basis-full">{error}</p>}
    </GlassCard>
  );
};

