import React, { Suspense, lazy, useEffect, useState } from 'react';
import { factoryStore, FactoryState } from './store/factoryStore';
import { stashPendingInvite, takeInviteFromUrl } from './lib/invites';
import { ChatPage } from './components/chat/ChatPage';

// Every screen is its own chunk: the marketing page (WebGL/GSAP), auth flow and each
// station view load on first use, so the entry bundle stays small.
const AppShell = lazy(() => import('./components/shell/AppShell').then((m) => ({ default: m.AppShell })));
const MarketingLandingPage = lazy(() => import('./components/marketing/MarketingLandingPage').then((m) => ({ default: m.MarketingLandingPage })));
const AuthScreen = lazy(() => import('./components/auth/AuthScreen').then((m) => ({ default: m.AuthScreen })));
const WorkspaceChooser = lazy(() => import('./components/auth/WorkspaceChooser').then((m) => ({ default: m.WorkspaceChooser })));
const CreateWorkspaceModal = lazy(() => import('./components/auth/CreateWorkspaceModal').then((m) => ({ default: m.CreateWorkspaceModal })));
const DreamTransitionScreen = lazy(() => import('./components/auth/DreamTransitionScreen').then((m) => ({ default: m.DreamTransitionScreen })));
const GuidedTutorialOverlay = lazy(() => import('./components/workspace/GuidedTutorialOverlay').then((m) => ({ default: m.GuidedTutorialOverlay })));
const WorkspaceHomeView = lazy(() => import('./components/views/WorkspaceHomeView').then((m) => ({ default: m.WorkspaceHomeView })));
const IdeaValidationView = lazy(() => import('./components/views/IdeaValidationView').then((m) => ({ default: m.IdeaValidationView })));
const ExecutivePortfolioView = lazy(() => import('./components/views/ExecutivePortfolioView').then((m) => ({ default: m.ExecutivePortfolioView })));
const ProjectHubView = lazy(() => import('./components/views/ProjectHubView').then((m) => ({ default: m.ProjectHubView })));
const PlanningRoadmapView = lazy(() => import('./components/views/PlanningRoadmapView').then((m) => ({ default: m.PlanningRoadmapView })));
const EpicDashboard = lazy(() => import('./components/views/EpicDashboard').then((m) => ({ default: m.EpicDashboard })));
const ArchitectureStudioView = lazy(() => import('./components/views/ArchitectureStudioView').then((m) => ({ default: m.ArchitectureStudioView })));
const SecurityAppSecView = lazy(() => import('./components/views/SecurityAppSecView').then((m) => ({ default: m.SecurityAppSecView })));
const WorkflowAdminView = lazy(() => import('./components/views/WorkflowAdminView').then((m) => ({ default: m.WorkflowAdminView })));
const ProductWorkspaceView = lazy(() => import('./components/views/ProductWorkspaceView').then((m) => ({ default: m.ProductWorkspaceView })));
const ProductSetupView = lazy(() => import('./components/views/ProductSetupView').then((m) => ({ default: m.ProductSetupView })));
const ProjectScoped = lazy(() => import('./components/views/WorkspaceScreens').then((m) => ({ default: m.ProjectScoped })));
const KnowledgeScreen = lazy(() => import('./components/views/WorkspaceScreens').then((m) => ({ default: m.KnowledgeScreen })));
const GovernanceScreen = lazy(() => import('./components/views/WorkspaceScreens').then((m) => ({ default: m.GovernanceScreen })));
const IncidentsPanel = lazy(() => import('./components/views/WorkspaceScreens').then((m) => ({ default: m.IncidentsPanel })));
const ProjectDesignPanel = lazy(() => import('./components/views/ProjectDesignPanel').then((m) => ({ default: m.ProjectDesignPanel })));
const DevWorkspace = lazy(() => import('./components/stations/DevWorkspace').then((m) => ({ default: m.DevWorkspace })));
const QAWorkspace = lazy(() => import('./components/stations/QAWorkspace').then((m) => ({ default: m.QAWorkspace })));
const DesignerDashboardView = lazy(() => import('./components/views/DesignerDashboardView').then((m) => ({ default: m.DesignerDashboardView })));
const ProjectBuildPanel = lazy(() => import('./components/views/ProjectBuildPanel').then((m) => ({ default: m.ProjectBuildPanel })));
const ProjectPipelinePanel = lazy(() => import('./components/views/ProjectDeliveryPanels').then((m) => ({ default: m.ProjectPipelinePanel })));
const ProjectReleasePanel = lazy(() => import('./components/views/ProjectDeliveryPanels').then((m) => ({ default: m.ProjectReleasePanel })));
const PRReviewPanel = lazy(() => import('./components/views/PRReviewPanel'));
const ProjectLaunchView = lazy(() => import('./components/views/ProjectLaunchView').then((m) => ({ default: m.ProjectLaunchView })));
const ReviewerSpaceView = lazy(() => import('./components/views/ReviewerSpaceView').then((m) => ({ default: m.ReviewerSpaceView })));

const ScreenFallback: React.FC = () => (
  <div role="status" aria-live="polite" className="min-h-screen w-full flex items-center justify-center bg-[#07070B] text-xs font-mono text-slate-400">
    Loading…
  </div>
);

const ViewFallback: React.FC = () => (
  <div role="status" aria-live="polite" className="py-16 text-center text-xs font-mono text-slate-400">
    Loading…
  </div>
);

const COMING_SOON_NAMES: Record<string, string> = {
  devops: 'CI/CD Pipelines',
  release: 'Releases & Canary',
  feedback: 'Incidents & Triage',
  knowledge: 'Knowledge Base & Governance',
};

export default function App() {
  const [state, setState] = useState<FactoryState>(factoryStore.getState());
  const [createWorkspaceModalOpen, setCreateWorkspaceModalOpen] = useState(false);
  const [showDreamTransition, setShowDreamTransition] = useState(false);
  const [pendingWorkspaceName, setPendingWorkspaceName] = useState('Nexus Engineering');
  const [showTutorial, setShowTutorial] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);

  const launchDemo = async () => {
    setDemoLoading(true);
    setDemoError(null);
    try {
      await factoryStore.startDemo();
      factoryStore.setScreen('workspace_home');
    } catch (e) {
      setDemoError(e instanceof Error ? e.message : 'Could not start the demo. Please try again.');
    } finally {
      setDemoLoading(false);
    }
  };

  // Demo visitor chooses to keep their work: leave the sandbox (its token is kept for the claim) and sign up.
  const signUpFromDemo = () => {
    factoryStore.signOut();
    factoryStore.setScreen('signin');
  };

  useEffect(() => {
    const unsubscribe = factoryStore.subscribe((newState) => {
      setState(newState);
    });

    // 1. Initial Session Restore & Data Sync
    factoryStore.syncSessionFromServer();

    // 2. Invite links: /?invite=TOKEN. Remember it, then accept once signed in.
    const inviteToken = takeInviteFromUrl();
    if (inviteToken) {
      stashPendingInvite(inviteToken);
      if (localStorage.getItem('karkhana_jwt_token')) {
        void factoryStore.syncSessionFromServer().then(() => factoryStore.acceptPendingInvite());
      } else {
        factoryStore.setScreen('signin');
      }
    }

    return () => {
      unsubscribe();
    };
  }, []);

  // ---------------------------------------------------------------------------
  // TRANSITION: DREAM / DIM-TO-APPEAR EFFECT
  // ---------------------------------------------------------------------------
  if (showDreamTransition) {
    return (
      <Suspense fallback={<ScreenFallback />}>
      <DreamTransitionScreen
        workspaceName={pendingWorkspaceName}
        onFinish={() => {
          setShowDreamTransition(false);
          factoryStore.setScreen('workspace_home');
          setShowTutorial(true);
        }}
      />
      </Suspense>
    );
  }

  // ---------------------------------------------------------------------------
  // EXPERIENCE A: THE PUBLIC WEBSITE (MARKETING & PRODUCT DISCOVERY)
  // ---------------------------------------------------------------------------
  const isMarketingScreen =
    state.currentScreen === 'landing' ||
    state.currentScreen === 'how_it_works' ||
    state.currentScreen === 'capabilities' ||
    state.currentScreen === 'solutions' ||
    state.currentScreen === 'research';

  if (isMarketingScreen && state.authStatus === 'guest') {
    return (
      <Suspense fallback={<ScreenFallback />}>
        <MarketingLandingPage
          onGetStarted={() => void launchDemo()}
          onSignIn={() => factoryStore.setScreen('signin')}
          getStartedBusy={demoLoading}
          getStartedError={demoError}
        />
      </Suspense>
    );
  }

  // ---------------------------------------------------------------------------
  // UNIFIED EMAIL ENTRY & AUTHENTICATION SCREEN
  // ---------------------------------------------------------------------------
  if (state.currentScreen === 'signin' || (state.authStatus === 'guest' && !isMarketingScreen)) {
    return (
      <Suspense fallback={<ScreenFallback />}>
        <AuthScreen
          onSuccessAuthenticated={() => {
            factoryStore.setScreen('workspace_chooser');
          }}
          onCancel={() => factoryStore.setScreen('landing')}
        />
      </Suspense>
    );
  }

  // ---------------------------------------------------------------------------
  // WORKSPACE CHOOSER & ENROLLED HUBS
  // ---------------------------------------------------------------------------
  if (state.currentScreen === 'workspace_chooser') {
    return (
      <Suspense fallback={<ScreenFallback />}>
        <WorkspaceChooser
          state={state}
          onOpenWorkspace={(id, name) => {
            factoryStore.switchWorkspace(id);
            setPendingWorkspaceName(name);
            setShowDreamTransition(true);
          }}
          onCreateNewWorkspace={() => setCreateWorkspaceModalOpen(true)}
          onSignOut={() => factoryStore.signOut()}
        />
        <CreateWorkspaceModal
          state={state}
          isOpen={createWorkspaceModalOpen}
          onClose={() => setCreateWorkspaceModalOpen(false)}
          onWorkspaceCreated={(createdId, createdName) => {
            setCreateWorkspaceModalOpen(false);
            setPendingWorkspaceName(createdName);
            setShowDreamTransition(true);
          }}
        />
      </Suspense>
    );
  }

  // ---------------------------------------------------------------------------
  // EXPERIENCE B: THE AUTHENTICATED WORKSPACE SHELL
  // ---------------------------------------------------------------------------
  const renderCurrentView = () => {
    switch (state.currentScreen) {
      case 'workspace_home':
      case 'products':
      case 'product_settings':
        return <WorkspaceHomeView state={state} />;

      case 'product_create':
        return <ProductSetupView state={state} />;

      case 'team_chat':
        return <ChatPage />;

      case 'product_detail':
      case 'ideaq':
        return <ProductWorkspaceView state={state} />;

      case 'ideas':
      case 'idea_detail':
      case 'idea_generate':
      case 'idea_compare':
      case 'research_evidence':
      case 'idea_report':
        return <IdeaValidationView state={state} />;

      case 'approvals':
      case 'approval_detail':
        return <ReviewerSpaceView state={state} />;

      case 'portfolio':
      case 'project_health':
      case 'approval_policy':
        return <ExecutivePortfolioView state={state} />;

      case 'project_launch':
        return <ProjectLaunchView state={state} />;

      case 'projects':
      case 'project_detail':
      case 'project_create':
      case 'project_onboarding':
      case 'project_team':
      case 'project_settings':
        return <ProjectHubView state={state} />;

      case 'epics':
      case 'epic_detail':
        return <EpicDashboard state={state} />;

      case 'roadmap':
      case 'issues':
      case 'issue_detail':
      case 'board':
      case 'milestones':
      case 'decisions':
        return <PlanningRoadmapView state={state} />;

      case 'designer_dashboard':
      case 'prototype_studio':
      case 'flow_map':
      case 'design_review':
      case 'design_tokens':
        return <ProjectScoped state={state} title="Design" render={(id) => <DesignerDashboardView projectId={id} />} />;

      case 'architecture_dashboard':
      case 'system_design':
      case 'adrs':
      case 'api_registry':
      case 'risk_map':
        return <ArchitectureStudioView state={state} />;

      case 'developer_dashboard':
      case 'task_detail':
      case 'repo_explorer':
      case 'agent_run':
      case 'pull_requests':
      case 'ai_code_review':
      case 'dependencies':
      case 'dev_handoff':
        return (
          <ProjectScoped
            state={state}
            title="Engineering"
            render={(id) => (
              <div className="space-y-6">
                <DevWorkspace projectId={id} projectCode={state.projects.find((p) => p.id === id)?.code ?? 'prj'} />
                <PRReviewPanel projectId={id} token={state.token ?? ''} />
              </div>
            )}
          />
        );

      case 'qa_dashboard':
      case 'feature_test':
      case 'test_plan_generator':
      case 'manual_execution':
      case 'automation_workspace':
      case 'defects':
      case 'qa_signoff':
        return (
          <ProjectScoped
            state={state}
            title="QA"
            render={(id) => <QAWorkspace projectId={id} projectCode={state.projects.find((p) => p.id === id)?.code ?? 'prj'} />}
          />
        );

      case 'security_dashboard':
      case 'assessment_builder':
      case 'security_execution':
      case 'finding_detail':
      case 'security_policies':
        return <SecurityAppSecView state={state} />;

      case 'devops_dashboard':
      case 'pipeline_studio':
      case 'infra_manager':
      case 'deployment_readiness':
      case 'deployment_history':
        return <ProjectScoped state={state} title="CI/CD pipelines" render={(id) => <ProjectPipelinePanel projectId={id} />} />;

      case 'release_dashboard':
      case 'release_detail':
      case 'release_notes':
      case 'release_signoff':
      case 'release_execution':
        return <ProjectScoped state={state} title="Releases" render={(id) => <ProjectReleasePanel projectId={id} />} />;

      case 'feedback_inbox':
      case 'feedback_detail':
      case 'public_portal':
      case 'incidents':
        return <ProjectScoped state={state} title="Incidents and bugs" render={(id) => <IncidentsPanel projectId={id} />} />;

      case 'knowledge_hub':
      case 'learning_capture':
      case 'skills_library':
      case 'memory_inspector':
        return <KnowledgeScreen />;

      case 'rule_governance':
        return <GovernanceScreen />;

      case 'workflow_templates':
      case 'workflow_designer':
      case 'integrations':
      case 'models':
      case 'admin_settings':
      case 'audit_explorer':
        return <WorkflowAdminView state={state} />;

      default:
        return <WorkspaceHomeView state={state} />;
    }
  };


  return (
    <Suspense fallback={<ScreenFallback />}>
      {state.currentUser?.is_guest && (
        <div className="fixed top-0 inset-x-0 z-[60] flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-3 py-1.5 bg-emerald-500/15 border-b border-emerald-400/30 text-xs text-emerald-200 backdrop-blur">
          <span>You are in a demo workspace with sample data. Nothing here is saved to an account.</span>
          <button onClick={signUpFromDemo} className="font-semibold text-white underline underline-offset-2 cursor-pointer">
            Sign up free to create your workspace
          </button>
        </div>
      )}
      <AppShell state={state}>
        <Suspense fallback={<ViewFallback />}>{renderCurrentView()}</Suspense>
      </AppShell>
      {showTutorial && (
        <GuidedTutorialOverlay
          isOpen={showTutorial}
          onClose={() => setShowTutorial(false)}
        />
      )}
    </Suspense>
  );
}
