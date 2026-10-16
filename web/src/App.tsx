import React, { useEffect, useState } from 'react';
import { factoryStore, FactoryState } from './store/factoryStore';
import { AppShell } from './components/shell/AppShell';
import { MarketingLandingPage } from './components/marketing/MarketingLandingPage';
import { AuthScreen } from './components/auth/AuthScreen';
import { WorkspaceChooser } from './components/auth/WorkspaceChooser';
import { CreateWorkspaceModal } from './components/auth/CreateWorkspaceModal';
import { DreamTransitionScreen } from './components/auth/DreamTransitionScreen';
import { GuidedTutorialOverlay } from './components/workspace/GuidedTutorialOverlay';

import { WorkspaceHomeView } from './components/views/WorkspaceHomeView';
import { IdeaValidationView } from './components/views/IdeaValidationView';
import { ExecutivePortfolioView } from './components/views/ExecutivePortfolioView';
import { ProjectHubView } from './components/views/ProjectHubView';
import { PlanningRoadmapView } from './components/views/PlanningRoadmapView';
import { DesignStudioView } from './components/views/DesignStudioView';
import { ArchitectureStudioView } from './components/views/ArchitectureStudioView';
import { DeveloperWorkspaceView } from './components/views/DeveloperWorkspaceView';
import { QAVerificationView } from './components/views/QAVerificationView';
import { SecurityAppSecView } from './components/views/SecurityAppSecView';
import { DevOpsPipelinesView } from './components/views/DevOpsPipelinesView';
import { ReleaseManagementView } from './components/views/ReleaseManagementView';
import { FeedbackIncidentsView } from './components/views/FeedbackIncidentsView';
import { KnowledgeLearningView } from './components/views/KnowledgeLearningView';
import { WorkflowAdminView } from './components/views/WorkflowAdminView';
import { ProductWorkspaceView } from './components/views/ProductWorkspaceView';

export default function App() {
  const [state, setState] = useState<FactoryState>(factoryStore.getState());
  const [createWorkspaceModalOpen, setCreateWorkspaceModalOpen] = useState(false);
  const [showDreamTransition, setShowDreamTransition] = useState(false);
  const [pendingWorkspaceName, setPendingWorkspaceName] = useState('Nexus Engineering');
  const [showTutorial, setShowTutorial] = useState(false);

  useEffect(() => {
    const unsubscribe = factoryStore.subscribe((newState) => {
      setState(newState);
    });

    // 1. Initial Session Restore & Data Sync
    factoryStore.syncSessionFromServer();

    // 2. Parse URL parameters for workspace/project invite links
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const joinWs = urlParams.get('join_workspace') || urlParams.get('invite_workspace');
      const token = urlParams.get('token');
      const role = urlParams.get('role');
      const joinProject = urlParams.get('join_project');

      if (joinWs || token || joinProject) {
        const pendingInvite = {
          workspaceId: joinWs,
          token,
          role: role || 'developer',
          projectId: joinProject,
        };

        const currentToken = localStorage.getItem('karkhana_jwt_token');
        if (currentToken) {
          // If already authenticated, directly enroll
          fetch('/api/workspaces/join', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${currentToken}`,
            },
            body: JSON.stringify({
              workspace_id: joinWs,
              token: token,
              role: role || 'developer',
            }),
          })
            .then((r) => r.json())
            .then((data) => {
              if (data.status === 'ok' && data.workspace) {
                factoryStore.switchWorkspace(data.workspace.id);
                if (joinProject) {
                  factoryStore.selectProject(joinProject);
                  factoryStore.setScreen('projects');
                }
              }
            })
            .catch((e) => console.warn('Auto-join workspace error:', e));
        } else {
          // Not logged in: store pending invite and prompt login
          localStorage.setItem('karkhana_pending_invite', JSON.stringify(pendingInvite));
          factoryStore.setScreen('signin');
        }
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
      <DreamTransitionScreen
        workspaceName={pendingWorkspaceName}
        onFinish={() => {
          setShowDreamTransition(false);
          factoryStore.setScreen('workspace_home');
          setShowTutorial(true);
        }}
      />
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
      <MarketingLandingPage
        onGetStarted={() => factoryStore.setScreen('signin')}
        onSignIn={() => factoryStore.setScreen('signin')}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // UNIFIED EMAIL ENTRY & AUTHENTICATION SCREEN
  // ---------------------------------------------------------------------------
  if (state.currentScreen === 'signin' || (state.authStatus === 'guest' && !isMarketingScreen)) {
    return (
      <AuthScreen
        onSuccessAuthenticated={() => {
          factoryStore.setScreen('workspace_chooser');
        }}
        onCancel={() => factoryStore.setScreen('landing')}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // WORKSPACE CHOOSER & ENROLLED HUBS
  // ---------------------------------------------------------------------------
  if (state.currentScreen === 'workspace_chooser') {
    return (
      <>
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
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // EXPERIENCE B: THE AUTHENTICATED WORKSPACE SHELL
  // ---------------------------------------------------------------------------
  const renderCurrentView = () => {
    switch (state.currentScreen) {
      case 'workspace_home':
      case 'products':
      case 'product_create':
      case 'product_settings':
        return <WorkspaceHomeView state={state} />;

      case 'product_detail':
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
      case 'portfolio':
      case 'project_health':
      case 'approval_policy':
        return <ExecutivePortfolioView state={state} />;

      case 'projects':
      case 'project_detail':
      case 'project_create':
      case 'project_onboarding':
      case 'project_team':
      case 'project_settings':
        return <ProjectHubView state={state} />;

      case 'roadmap':
      case 'epics':
      case 'epic_detail':
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
        return <DesignStudioView state={state} />;

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
        return <DeveloperWorkspaceView state={state} />;

      case 'qa_dashboard':
      case 'feature_test':
      case 'test_plan_generator':
      case 'manual_execution':
      case 'automation_workspace':
      case 'defects':
      case 'qa_signoff':
        return <QAVerificationView state={state} />;

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
        return <DevOpsPipelinesView state={state} />;

      case 'release_dashboard':
      case 'release_detail':
      case 'release_notes':
      case 'release_signoff':
      case 'release_execution':
        return <ReleaseManagementView state={state} />;

      case 'feedback_inbox':
      case 'feedback_detail':
      case 'public_portal':
      case 'incidents':
        return <FeedbackIncidentsView state={state} />;

      case 'knowledge_hub':
      case 'learning_capture':
      case 'rule_governance':
      case 'skills_library':
      case 'memory_inspector':
        return <KnowledgeLearningView state={state} />;

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
    <>
      <AppShell state={state}>{renderCurrentView()}</AppShell>
      <GuidedTutorialOverlay
        isOpen={showTutorial}
        onClose={() => setShowTutorial(false)}
      />
    </>
  );
}
