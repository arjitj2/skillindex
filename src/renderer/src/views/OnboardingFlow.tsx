import { useState, type ReactNode } from 'react';
import { ArrowRight, Check, Folder, GitBranch, Info, X } from 'lucide-react';

import skillIndexMarkCream from '../assets/skill-index-mark-cream.svg';

export interface OnboardingPreferredSourceSelection {
  didChangePreferredSource: boolean;
  preferredSourcePath: string | null;
}

export function OnboardingFlow({
  isCompleting,
  onChoosePreferredSource,
  onComplete,
  universalSkillsPath,
}: {
  isCompleting: boolean;
  onChoosePreferredSource: () => Promise<string | null>;
  onComplete: (selection: OnboardingPreferredSourceSelection) => Promise<void>;
  universalSkillsPath: string;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [preferredSourcePath, setPreferredSourcePath] = useState<string | null>(null);
  const [didChangePreferredSource, setDidChangePreferredSource] = useState(false);
  const [isChoosingPreferredSource, setIsChoosingPreferredSource] = useState(false);

  const choosePreferredSource = async () => {
    setIsChoosingPreferredSource(true);
    try {
      const chosenPath = await onChoosePreferredSource();
      if (chosenPath) {
        setPreferredSourcePath(chosenPath);
        setDidChangePreferredSource(true);
      }
    } finally {
      setIsChoosingPreferredSource(false);
    }
  };

  return (
    <div className="onboarding-stage">
      <div className="onboarding-titlebar">
        <div className="traffic-light traffic-light--red" />
        <div className="traffic-light traffic-light--yellow" />
        <div className="traffic-light traffic-light--green" />
        <div className="onboarding-window-title">Skill Index - Welcome</div>
      </div>

      <div className="onboarding-body">
        <OnboardingRail />
        <main className="onboarding-pane">
          {step === 1 ? (
            <StepOne onContinue={() => setStep(2)} />
          ) : (
            <StepTwo
              isChoosingPreferredSource={isChoosingPreferredSource}
              isCompleting={isCompleting}
              preferredSourcePath={preferredSourcePath}
              universalSkillsPath={universalSkillsPath}
              onBack={() => setStep(1)}
              onChoosePreferredSource={() => {
                void choosePreferredSource();
              }}
              onClearPreferredSource={() => {
                setPreferredSourcePath(null);
                setDidChangePreferredSource(true);
              }}
              onComplete={() => {
                void onComplete({
                  didChangePreferredSource,
                  preferredSourcePath,
                });
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function OnboardingRail() {
  return (
    <aside className="onboarding-rail">
      <div className="onboarding-brand">
        <div className="onboarding-brand-mark" aria-hidden="true">
          <img src={skillIndexMarkCream} alt="" />
        </div>
        <div className="onboarding-brand-name">Skill Index</div>
      </div>

      <h2>Organize and standardize your knowledge across agents.</h2>
      <p className="onboarding-rail-sub">
        Skill Index keeps your skills and MCPs in sync across every coding agent on your machine - Claude, Codex, and whatever comes next.
      </p>

      <div className="onboarding-rail-spacer" />

      <div className="onboarding-pitch-list">
        {[
          {
            detail: 'Runs entirely on your machine. No account, no cloud sync, no telemetry.',
            title: '100% local',
          },
          {
            detail: 'Teach one agent a skill or install an MCP - every agent picks it up.',
            title: 'One shared library',
          },
          {
            detail: 'Spot what is missing, copied, symlinked, or quietly out of sync between agents.',
            title: 'Catch drift early',
          },
        ].map((message) => (
          <div className="onboarding-pitch-item" key={message.title}>
            <div className="onboarding-pitch-title">
              <span aria-hidden="true" />
              <strong>{message.title}</strong>
            </div>
            <p>{message.detail}</p>
          </div>
        ))}
      </div>
    </aside>
  );
}

function StepOne({ onContinue }: { onContinue: () => void }) {
  return (
    <>
      <StepHeader
        label="How it fits together"
        step={1}
        title="How it fits together"
      >
        Each agent on your machine has its own folder. Skill Index gives them a shared library to read from - and reconciles the rest.
      </StepHeader>

      <KnowledgeDiagram />

      <div className="onboarding-pane-spacer" />

      <footer className="onboarding-footer">
        <div className="onboarding-footer-spacer" />
        <button className="onboarding-button onboarding-button--primary" type="button" onClick={onContinue}>
          Continue
          <ArrowRight aria-hidden="true" size={14} />
        </button>
      </footer>
    </>
  );
}

function StepTwo({
  isChoosingPreferredSource,
  isCompleting,
  preferredSourcePath,
  universalSkillsPath,
  onBack,
  onChoosePreferredSource,
  onClearPreferredSource,
  onComplete,
}: {
  isChoosingPreferredSource: boolean;
  isCompleting: boolean;
  preferredSourcePath: string | null;
  universalSkillsPath: string;
  onBack: () => void;
  onChoosePreferredSource: () => void;
  onClearPreferredSource: () => void;
  onComplete: () => void;
}) {
  return (
    <>
      <StepHeader
        label="Where your skills live"
        step={2}
        title="Where your skills live"
      >
        <code>~/.agents</code> is your universal home for skills. If you author skills in a repo you publish, add it as a preferred source for those skills.
      </StepHeader>

      <div className="onboarding-source-stack">
        <div className="onboarding-source-row onboarding-source-row--universal">
          <div className="onboarding-source-icon onboarding-source-icon--dark">
            <Folder aria-hidden="true" size={18} />
          </div>
          <div className="onboarding-source-copy">
            <div className="onboarding-source-title">
              Universal home
              <span className="onboarding-pill">always on</span>
            </div>
            <code>{universalSkillsPath}</code>
            <p>Where every skill lives by default. Set by Skill Index.</p>
          </div>
        </div>

        <div className="onboarding-source-label">
          <span>Preferred sources</span>
          <em>optional</em>
        </div>

        {preferredSourcePath ? (
          <div className="onboarding-source-row onboarding-source-row--added">
            <div className="onboarding-source-icon onboarding-source-icon--accent">
              <GitBranch aria-hidden="true" size={18} />
            </div>
            <div className="onboarding-source-copy">
              <div className="onboarding-source-title">Preferred source</div>
              <code>{preferredSourcePath}</code>
              <p>A repo you author skills in - overrides the universal home for those skills only.</p>
            </div>
            <button
              className="onboarding-small-button onboarding-small-button--primary"
              disabled={isChoosingPreferredSource || isCompleting}
              type="button"
              onClick={onChoosePreferredSource}
            >
              {isChoosingPreferredSource ? 'Choosing...' : 'Browse...'}
            </button>
            <button
              aria-label="Remove preferred source"
              className="onboarding-icon-button"
              disabled={isCompleting}
              type="button"
              onClick={onClearPreferredSource}
            >
              <X aria-hidden="true" size={14} />
            </button>
          </div>
        ) : (
          <button
            className="onboarding-source-row onboarding-source-row--add"
            disabled={isChoosingPreferredSource || isCompleting}
            type="button"
            onClick={onChoosePreferredSource}
          >
            <div className="onboarding-source-icon onboarding-source-icon--dim">
              <Folder aria-hidden="true" size={18} />
            </div>
            <div className="onboarding-source-copy">
              <div className="onboarding-source-title">Choose a folder...</div>
              <p>A repo you author skills in - overrides the universal home for those skills only.</p>
            </div>
            <span className="onboarding-small-button">
              {isChoosingPreferredSource ? 'Choosing...' : 'Browse...'}
            </span>
          </button>
        )}
      </div>

      <div className="onboarding-note">
        <Info aria-hidden="true" size={14} />
        <span>Manage these later in <strong>Settings {'->'} Custom scan paths</strong>. Skill Index never moves files without your approval.</span>
      </div>

      <div className="onboarding-pane-spacer" />

      <footer className="onboarding-footer">
        <button className="onboarding-button onboarding-button--ghost" disabled={isCompleting} type="button" onClick={onBack}>
          Back
        </button>
        <div className="onboarding-footer-spacer" />
        <button className="onboarding-button onboarding-button--primary" disabled={isCompleting} type="button" onClick={onComplete}>
          <Check aria-hidden="true" size={14} />
          {isCompleting ? 'Scanning...' : 'Scan my machine'}
        </button>
      </footer>
    </>
  );
}

function StepHeader({
  children,
  label,
  step,
  title,
}: {
  children: ReactNode;
  label: string;
  step: 1 | 2;
  title: string;
}) {
  return (
    <>
      <div className="onboarding-step-header">
        <span>Step {step} / 2</span>
        <div className="onboarding-progress" aria-hidden="true">
          <div style={{ width: `${(step / 2) * 100}%` }} />
        </div>
        <span>{label}</span>
      </div>
      <h1 className="onboarding-pane-title">{title}</h1>
      <p className="onboarding-pane-copy">{children}</p>
    </>
  );
}

function KnowledgeDiagram() {
  return (
    <div className="onboarding-diagram">
      <div className="onboarding-canonical">
        <div className="onboarding-canonical-card">
          <span>Universal home</span>
          <code>~/.agents/skills</code>
        </div>
      </div>

      <svg aria-hidden="true" className="onboarding-flow-lines" preserveAspectRatio="none" viewBox="0 0 600 88">
        <path d="M 300 0 L 300 30 L 100 30 L 100 80" />
        <path d="M 300 0 L 300 80" />
        <path d="M 300 0 L 300 30 L 500 30 L 500 80" />
        <circle cx="100" cy="82" r="3" />
        <circle cx="300" cy="82" r="3" />
        <circle cx="500" cy="82" r="3" />
      </svg>

      <div className="onboarding-agent-row">
        <AgentCard mark="C" name="Claude" path="~/.claude" />
        <AgentCard mark="X" name="Codex" path="~/.codex" />
        <AgentCard future mark="+" name="Future agent" path="picked up automatically" />
      </div>

      <div className="onboarding-diagram-foot">
        <span>symlink</span>
        <p>or direct read - each agent stays in sync without copying files</p>
      </div>
    </div>
  );
}

function AgentCard({
  future = false,
  mark,
  name,
  path,
}: {
  future?: boolean;
  mark: string;
  name: string;
  path: string;
}) {
  return (
    <div className={`onboarding-agent-card${future ? ' onboarding-agent-card--future' : ''}`}>
      <div className="onboarding-agent-mark">{mark}</div>
      <div>
        <strong>{name}</strong>
        <code>{path}</code>
      </div>
    </div>
  );
}
