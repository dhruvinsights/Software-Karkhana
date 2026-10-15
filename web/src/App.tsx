import React, { useEffect, useState } from 'react';
import { factoryStore, FactoryState } from './store/factoryStore';
import { AppShell } from './components/shell/AppShell';
import { MarketingLandingPage } from './components/marketing/MarketingLandingPage';
import { AuthModal } from './components/auth/AuthModal';
import { OnboardingWizard } from './components/auth/OnboardingWizard';

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
  const [authModalOpen, setAuthModalOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = factoryStore.subscribe((newState) => {
      setState(newState);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // ---------------------------------------------------------------------------
  // EXPERIENCE A: THE PUBLIC WEBSITE (MARKETING & PRODUCT DISCOVERY)
  // ---------------------------------------------------------------------------
  const isMarketingScreen =
    state.currentScreen === 'landing' ||
    state.currentScreen === 'how_it_works' ||
    state.currentScreen === 'capabilities' ||
    state.currentScreen === 'solutions' ||
    state.currentScreen === 'research';

  if (isMarketingScreen) {
    return (
      <>
        <MarketingLandingPage
          onGetStarted={() => factoryStore.startOnboarding()}
          onSignIn={() => setAuthModalOpen(true)}
        />
        <AuthModal
          isOpen={authModalOpen}
          onClose={() => setAuthModalOpen(false)}
          onStartOnboarding={() => factoryStore.startOnboarding()}
          onSuccessAuth={() => factoryStore.setScreen('workspace_home')}
        />
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // PROGRESSIVE SLACK-STYLE ONBOARDING WIZARD
  // ---------------------------------------------------------------------------
  if (state.currentScreen === 'onboarding') {
    return (
      <OnboardingWizard
        onComplete={() => factoryStore.setScreen('workspace_home')}
        onCancel={() => factoryStore.setScreen('landing')}
      />
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

  return <AppShell state={state}>{renderCurrentView()}</AppShell>;
}
