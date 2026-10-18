import React from 'react';

/** Catches a crashed screen and offers a way back instead of a blank page. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('[ui] screen crashed', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="min-h-screen w-full flex items-center justify-center bg-[#07070B] px-6 text-center">
        <div className="max-w-md space-y-4">
          <p className="text-lg font-semibold text-white">Something went wrong on this screen.</p>
          <p className="text-sm text-slate-400">Your work is saved. Reload the page to pick up where you left off; if it keeps happening, let us know.</p>
          <div className="flex justify-center gap-3 pt-2">
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg bg-[#075BFF] hover:bg-[#2a74ff] text-sm font-medium text-white cursor-pointer"
            >
              Reload
            </button>
            <button
              onClick={() => { window.location.href = '/'; }}
              className="px-4 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-sm text-white cursor-pointer"
            >
              Go to home
            </button>
          </div>
        </div>
      </div>
    );
  }
}
