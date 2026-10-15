import {
  BookOpen, ChartBar, Code, Cpu, GitPullRequest, House, Lightbulb, Notebook, SealCheck, Circle,
  type Icon,
} from '@phosphor-icons/react';

const MAP: Record<string, Icon> = {
  home: House, idea: Lightbulb, gate: SealCheck, code: Code, review: GitPullRequest,
  chart: ChartBar, book: BookOpen, ledger: Notebook, system: Cpu,
};
export function NavIcon({ name }: { name: string }) {
  const C = MAP[name] ?? Circle;
  return <C size={18} weight="regular" aria-hidden />;
}
