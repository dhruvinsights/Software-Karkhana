import React, { useState } from 'react';
import {
  Sparkles,
  ArrowRight,
  ArrowLeft,
  X,
  CheckCircle2,
  Layers,
  Terminal,
  Shield,
  Server,
  Workflow,
  Radio,
  Sliders,
} from 'lucide-react';

interface GuidedTutorialOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

const TOUR_STEPS = [
  {
    step: 1,
    title: 'Factory Overview & Products',
    icon: Layers,
    description:
      'This is your command center. Track end-to-end delivery metrics across all software products, enrolled microservices, and active autonomous agents.',
    highlightLabel: 'Navigation: Overview & Products',
  },
  {
    step: 2,
    title: 'Idea Validation Studio (Feasibility Radar)',
    icon: Sparkles,
    description:
      'Submit raw feature concepts. Google Gemini AI runs instant multi-dimensional feasibility audits (Technical, UX, Scalability, Risk) and scores viability out of 100 before committing engineering capacity.',
    highlightLabel: 'Navigation: Idea Lab',
  },
  {
    step: 3,
    title: 'Agile Roadmap & Kanban Decomposition',
    icon: Workflow,
    description:
      'Promote validated ideas directly into structured Epics and user stories with verbatim acceptance criteria. Drag and drop work items across real-time Kanban columns.',
    highlightLabel: 'Navigation: Planning & Agile Board',
  },
  {
    step: 4,
    title: 'Engineering & Autonomous Coding Agents',
    icon: Terminal,
    description:
      'Dispatch autonomous coding workers into isolated container sandboxes. Review CodeRabbit-style AST pull request audits with line-level diff suggestions before merging.',
    highlightLabel: 'Navigation: Engineering & Agents',
  },
  {
    step: 5,
    title: 'QA Verification & AppSec Security',
    icon: Shield,
    description:
      'Generate automated test plans from user stories, run manual test matrices, and execute continuous SAST AST security scans against real CVE and OSV vulnerability feeds.',
    highlightLabel: 'Navigation: QA & Security',
  },
  {
    step: 6,
    title: 'CI/CD Pipelines & Quorum Releases',
    icon: Radio,
    description:
      'Construct multi-stage DAG pipelines, enforce 4-eye multi-role quorum sign-offs, and trigger automated canary rollouts with instant rollback thresholds.',
    highlightLabel: 'Navigation: CI/CD & Releases',
  },
  {
    step: 7,
    title: 'AI Factory Companion & Direct Operations',
    icon: Sliders,
    description:
      'Your persistent workspace companion is grounded in active project context. Ask questions, generate architecture decisions, or reconfigure dashboard layouts on demand.',
    highlightLabel: 'Top Bar: AI Companion Button',
  },
];

export const GuidedTutorialOverlay: React.FC<GuidedTutorialOverlayProps> = ({
  isOpen,
  onClose,
}) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  if (!isOpen) return null;

  const currentStep = TOUR_STEPS[currentStepIndex];
  const StepIcon = currentStep.icon;
  const isLast = currentStepIndex === TOUR_STEPS.length - 1;

  const handleNext = () => {
    if (isLast) {
      onClose();
    } else {
      setCurrentStepIndex((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in select-none">
      <div className="relative w-full max-w-lg bg-[#0a0d16] border border-[#075bff]/40 rounded-3xl shadow-2xl overflow-hidden p-6 sm:p-8 text-white animate-scale-in">
        {/* Glow ambient header */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#075bff]/10 rounded-full blur-3xl pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 text-slate-400 hover:text-white rounded-xl bg-white/5 hover:bg-white/10 transition-colors z-20 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="relative z-10 space-y-6">
          {/* Header & Step progress */}
          <div className="flex items-center justify-between pb-4 border-b border-white/10">
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase font-mono tracking-widest text-[#075bff] font-semibold px-2 py-0.5 rounded bg-[#075bff]/15 border border-[#075bff]/30">
                Guided Factory Tour
              </span>
              <span className="text-xs text-slate-400 font-mono">
                {currentStep.step} / {TOUR_STEPS.length}
              </span>
            </div>

            <div className="flex gap-1">
              {TOUR_STEPS.map((_, idx) => (
                <div
                  key={idx}
                  className={`h-1.5 w-4 rounded-full transition-all ${
                    idx === currentStepIndex
                      ? 'bg-[#075bff] w-6'
                      : idx < currentStepIndex
                      ? 'bg-emerald-500'
                      : 'bg-white/15'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Station Icon & Title */}
          <div className="space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-[#075bff]/20 border border-[#075bff]/40 flex items-center justify-center text-[#075bff] shadow-lg shadow-[#075bff]/20">
              <StepIcon className="w-6 h-6" />
            </div>

            <h3 className="text-xl font-bold tracking-tight text-white">
              {currentStep.title}
            </h3>

            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-light">
              {currentStep.description}
            </p>
          </div>

          {/* Station Target Pill */}
          <div className="p-3 bg-[#06080e] rounded-xl border border-white/10 flex items-center gap-2 text-xs font-mono text-[#5B8FFF]">
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span>Target: {currentStep.highlightLabel}</span>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              Skip Tutorial
            </button>

            <div className="flex items-center gap-2">
              {currentStepIndex > 0 && (
                <button
                  type="button"
                  onClick={handlePrev}
                  className="px-4 py-2.5 bg-white/5 hover:bg-white/10 text-slate-300 font-medium rounded-xl text-xs transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleNext}
                className="px-5 py-2.5 bg-[#075bff] hover:bg-[#075bff]/90 text-white font-semibold rounded-xl text-xs transition-all shadow-lg shadow-[#075bff]/25 flex items-center gap-2 cursor-pointer"
              >
                <span>{isLast ? 'Complete Tour' : 'Next Station'}</span>
                {isLast ? <CheckCircle2 className="w-3.5 h-3.5" /> : <ArrowRight className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
