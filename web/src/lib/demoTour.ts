/**
 * Copyright 2026 Software Karkhana authors
 * Licensed under the Apache License, Version 2.0.
 *
 * The guided tour of the demo workspace: one step per screen, grouped by the
 * job a team does (plan, build, verify, ship, learn). Progress lives in
 * localStorage so a refresh resumes, and is sent with the demo on sign-up.
 */
import type { ScreenId } from '../types/factory';

export interface TourStep {
  id: string;
  group: string;
  screen: ScreenId;
  /** data-tour value of the element to highlight; the main area when absent. */
  target?: string;
  title: string;
  body: string;
  /** What to try right now, in this demo. */
  tryIt: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'overview', group: 'Plan', screen: 'workspace_home', target: 'nav-workspace_home',
    title: 'Overview: your factory at a glance',
    body: 'Products, projects, pull requests and feature ideas for the whole workspace on one page, plus a quick way to add a product or project.',
    tryIt: 'Look at the four counters, then use Quick Real-Time Creation to add a product.',
  },
  {
    id: 'products', group: 'Plan', screen: 'products', target: 'nav-products',
    title: 'Products: group related work',
    body: 'A product holds its projects, feature ideas, people and knowledge. This demo workspace is Arcwell Health, building a prior-authorization product (ClearAuth).',
    tryIt: 'Open the ClearAuth product to see its ideas, scans and idea groups.',
  },
  {
    id: 'ideas', group: 'Plan', screen: 'products', target: 'main',
    title: 'Feature ideas: from raw idea to approved work',
    body: 'Inside a product, ideas are drafted, evaluated and sent for approval. Five ideas here sit at different stages, so you can see each state.',
    tryIt: 'Open an idea waiting for approval and read its evaluation.',
  },
  {
    id: 'projects', group: 'Plan', screen: 'projects', target: 'nav-projects',
    title: 'Project Hub: set up and run a project',
    body: 'Every approved idea becomes a project with a lead, a team and stations (developer, QA, security, release). Members only see the stations they are given.',
    tryIt: 'Open the ClearAuth project, then look at Team and Settings.',
  },
  {
    id: 'reviews', group: 'Plan', screen: 'approvals', target: 'nav-approvals',
    title: 'Reviews: decisions waiting for you',
    body: 'Approvals and review requests assigned to you land here, so nothing waits in someone else\'s inbox.',
    tryIt: 'Open an item and approve or send it back with a comment.',
  },
  {
    id: 'chat', group: 'Plan', screen: 'team_chat', target: 'nav-team_chat',
    title: 'Team Chat: talk where the work is',
    body: 'Channels per workspace and project, with mentions and notifications. Sample conversations are already here.',
    tryIt: 'Open a channel and post a message.',
  },
  {
    id: 'engineering', group: 'Build', screen: 'developer_dashboard', target: 'nav-developer_dashboard',
    title: 'Engineering and AI agents: build a story',
    body: 'Ready stories are listed with a Build button. An AI coding agent works in a sandbox, runs the test suites and opens a pull request. Here it uses a prepared change so no repository or API key is needed.',
    tryIt: 'Press Build on a Ready story and watch the phases and test suites turn green.',
  },
  {
    id: 'prs', group: 'Build', screen: 'pull_requests', target: 'nav-pull_requests',
    title: 'Pull requests and AI code review',
    body: 'Each change gets a diff, line-level review comments from the reviewer agent, a security scan and approvals from people. Three PRs are open or merged in this workspace.',
    tryIt: 'Open the open PR, triage a review comment, then approve it.',
  },
  {
    id: 'architecture', group: 'Build', screen: 'system_design', target: 'nav-system_design',
    title: 'System Architecture and decisions',
    body: 'Architecture decision records (ADRs) keep the why behind design choices next to the code that follows them.',
    tryIt: 'Open an ADR and see its status and consequences.',
  },
  {
    id: 'design', group: 'Build', screen: 'prototype_studio', target: 'nav-prototype_studio',
    title: 'Design System: screens and tokens',
    body: 'Designers keep prototypes, flows and design tokens with the project, so engineers build from the same source.',
    tryIt: 'Browse the design screens of the project.',
  },
  {
    id: 'qa', group: 'Verify', screen: 'qa_dashboard', target: 'nav-qa_dashboard',
    title: 'QA Verification: sign off with evidence',
    body: 'Test scenarios per story, defects found, and a sign-off that is recorded in the ledger. A story is not Done until QA says so.',
    tryIt: 'Open the QA queue and look at a scenario and a defect.',
  },
  {
    id: 'security', group: 'Verify', screen: 'security_dashboard', target: 'nav-security_dashboard',
    title: 'Security and Assurance',
    body: 'Scans of the base code and of each pull request, findings by severity, and a gate that blocks a release while serious findings are open. Four findings are seeded.',
    tryIt: 'Open a finding, read the fix guidance and change its state.',
  },
  {
    id: 'cicd', group: 'Ship', screen: 'pipeline_studio', target: 'nav-pipeline_studio',
    title: 'CI/CD pipelines and deployments',
    body: 'Pipelines and deployment readiness for the project. Actions that need GitHub are disabled in the demo and ask you to sign up.',
    tryIt: 'Read the pipeline and deployment status.',
  },
  {
    id: 'releases', group: 'Ship', screen: 'release_dashboard', target: 'nav-release_dashboard',
    title: 'Releases: one gate before shipping',
    body: 'A release gathers merged work, test results and open risks, and lists blockers. Approving it needs a real repository, so the demo shows the evidence only.',
    tryIt: 'Open the release and read its blockers and notes.',
  },
  {
    id: 'incidents', group: 'Learn', screen: 'feedback_inbox', target: 'nav-feedback_inbox',
    title: 'Incidents and triage',
    body: 'Bugs and incidents from QA and production, with severity, owner and the fix task they created.',
    tryIt: 'Open a bug and follow it to its fix.',
  },
  {
    id: 'knowledge', group: 'Learn', screen: 'knowledge_hub', target: 'nav-knowledge_hub',
    title: 'Knowledge Base: what the team learned',
    body: 'Learnings captured from merged work and documents the AI can search. Uploading and AI chat need an account.',
    tryIt: 'Read a learning captured from a merged pull request.',
  },
  {
    id: 'governance', group: 'Learn', screen: 'rule_governance', target: 'nav-rule_governance',
    title: 'Factory Governance',
    body: 'The rules the process engine enforces: who may approve, which gates are required, and what is recorded in the audit ledger.',
    tryIt: 'Read a rule and the audit trail it creates.',
  },
];

export const TOUR_MINUTES = 5;
const KEY = 'karkhana_demo_tour';

export type TourStatus = 'welcome' | 'running' | 'paused' | 'done';
export interface TourProgress {
  status: TourStatus;
  index: number;
  completed: string[];
  skipped: boolean;
}

const fresh = (): TourProgress => ({ status: 'welcome', index: 0, completed: [], skipped: false });

export function loadTour(): TourProgress {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && typeof raw.index === 'number' && Array.isArray(raw.completed)) {
      return { ...fresh(), ...raw, index: Math.min(Math.max(raw.index, 0), TOUR_STEPS.length - 1) };
    }
  } catch {
    /* corrupt entry: start over */
  }
  return fresh();
}

export function saveTour(t: TourProgress): void {
  localStorage.setItem(KEY, JSON.stringify(t));
}

export function clearTour(): void {
  localStorage.removeItem(KEY);
}

/** The shape the server stores on claim. */
export function tourForClaim(): { completed: string[]; lastStep: string; finished: boolean; skipped: boolean } | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  const t = loadTour();
  return {
    completed: t.completed,
    lastStep: TOUR_STEPS[t.index]?.id ?? '',
    finished: t.status === 'done' && !t.skipped,
    skipped: t.skipped,
  };
}
