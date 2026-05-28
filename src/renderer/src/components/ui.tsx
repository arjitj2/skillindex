import type { AgentRecord } from '@shared/contracts';
import { Check, Plug, Search, X } from 'lucide-react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import { NavIcon, type NavIconName } from './NavIcon';

export const PLUGIN_SKILL_TOOLTIP = 'This skill was installed via one or more plugins';
export const PLUGIN_MCP_TOOLTIP = PLUGIN_SKILL_TOOLTIP;

const PLUGIN_TOOLTIP_MARGIN = 12;
const PLUGIN_TOOLTIP_FALLBACK_WIDTH = 360;

type PluginTooltipPosition = {
  arrowLeft: number;
  left: number;
  placement: 'bottom' | 'top';
  top: number;
};

export function PluginTooltipIndicator({
  className,
  focusable = false,
  tooltip,
}: {
  className: string;
  focusable?: boolean;
  tooltip: string;
}) {
  const tooltipId = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const [position, setPosition] = useState<PluginTooltipPosition | null>(null);

  useLayoutEffect(() => {
    if (!isTooltipOpen) {
      setPosition(null);
      return;
    }

    const updatePosition = () => {
      const anchor = anchorRef.current;
      const tooltipElement = tooltipRef.current;
      if (!anchor || !tooltipElement) {
        return;
      }

      const anchorRect = anchor.getBoundingClientRect();
      const tooltipWidth = tooltipElement.offsetWidth || PLUGIN_TOOLTIP_FALLBACK_WIDTH;
      const tooltipHeight = tooltipElement.offsetHeight;
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const anchorCenter = anchorRect.left + anchorRect.width / 2;
      const minLeft = PLUGIN_TOOLTIP_MARGIN;
      const maxLeft = Math.max(minLeft, viewportWidth - tooltipWidth - PLUGIN_TOOLTIP_MARGIN);
      const left = Math.min(Math.max(anchorCenter - tooltipWidth / 2, minLeft), maxLeft);
      const bottomTop = anchorRect.bottom + 8;
      const canFitBelow = bottomTop + tooltipHeight + PLUGIN_TOOLTIP_MARGIN <= viewportHeight;
      const shouldPlaceAbove = !canFitBelow && anchorRect.top >= tooltipHeight + PLUGIN_TOOLTIP_MARGIN + 8;
      const top = shouldPlaceAbove ? anchorRect.top - tooltipHeight - 8 : bottomTop;

      setPosition({
        arrowLeft: Math.min(Math.max(anchorCenter - left, 10), Math.max(10, tooltipWidth - 10)),
        left,
        placement: shouldPlaceAbove ? 'top' : 'bottom',
        top,
      });
    };

    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isTooltipOpen]);

  const tooltipStyle = {
    '--plugin-tooltip-arrow-left': position ? `${position.arrowLeft}px` : '50%',
    left: position?.left ?? 0,
    top: position?.top ?? 0,
    visibility: position ? 'visible' : 'hidden',
  } as CSSProperties;

  return (
    <>
      <span
        aria-describedby={isTooltipOpen ? tooltipId : undefined}
        aria-label={tooltip}
        className={className}
        ref={anchorRef}
        tabIndex={focusable ? 0 : undefined}
        onBlur={() => setIsTooltipOpen(false)}
        onFocus={() => setIsTooltipOpen(true)}
        onMouseEnter={() => setIsTooltipOpen(true)}
        onMouseLeave={() => setIsTooltipOpen(false)}
      >
        <Plug />
      </span>
      {isTooltipOpen
        ? createPortal(
            <div
              className="plugin-tooltip"
              data-placement={position?.placement ?? 'bottom'}
              id={tooltipId}
              ref={tooltipRef}
              role="tooltip"
              style={tooltipStyle}
            >
              {tooltip}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export function HeaderSearch({
  inputRef,
  label,
  onChange,
  placeholder,
  query,
}: {
  inputRef?: RefObject<HTMLInputElement | null>;
  label: string;
  onChange: (query: string) => void;
  placeholder: string;
  query: string;
}) {
  return (
    <label className="search-input-shell search-input--header">
      <span className="search-input-icon" aria-hidden="true">
        <Search />
      </span>
      <input
        aria-label={label}
        className="search-input"
        ref={inputRef}
        type="search"
        value={query}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
      <span className="search-input-shortcut" aria-hidden="true">⌘F</span>
    </label>
  );
}

export function DetailValue({ value }: { value: string }) {
  return <code className="detail-value">{value}</code>;
}

export function PageTopBar({
  actions,
  search,
  subtitle,
  title,
}: {
  actions?: ReactNode;
  search?: ReactNode;
  subtitle?: string;
  title: string;
}) {
  return (
    <header className={`page-topbar${search ? ' page-topbar--with-search' : ' page-topbar--simple'}`}>
      <div className="page-topbar-title">
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {search ? <div className="page-topbar-search">{search}</div> : null}
      {actions ? <div className="page-topbar-actions">{actions}</div> : null}
    </header>
  );
}

export function ToolbarButton({
  cancelLoadingLabel,
  disabled = false,
  icon,
  isLoading = false,
  label,
  loadingLabel,
  onCancelLoading,
  onClick,
  subtle = false,
  variant = 'default',
}: {
  cancelLoadingLabel?: string;
  disabled?: boolean;
  icon?: Extract<NavIconName, 'rescan'>;
  isLoading?: boolean;
  label: string;
  loadingLabel?: string;
  onCancelLoading?: () => void;
  onClick?: () => void;
  subtle?: boolean;
  variant?: 'default' | 'strong';
}) {
  const visibleLabel = isLoading && loadingLabel ? loadingLabel : label;
  const className = `toolbar-button toolbar-button--${variant}${subtle ? ' toolbar-button--subtle' : ''}${isLoading ? ' toolbar-button--loading' : ''}`;

  if (isLoading && onCancelLoading) {
    return (
      <div
        aria-busy="true"
        aria-label={visibleLabel}
        className={`${className} toolbar-button--cancelable`}
        role="group"
      >
        {icon ? (
          <span className="toolbar-button-icon toolbar-button-icon--loading" aria-hidden="true">
            <NavIcon icon={icon} />
          </span>
        ) : null}
        <span>{variant === 'strong' ? `+ ${visibleLabel}` : visibleLabel}</span>
        <button
          aria-label={cancelLoadingLabel ?? `Cancel ${visibleLabel}`}
          className="toolbar-button-cancel"
          type="button"
          onClick={onCancelLoading}
        >
          <X aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <button
      aria-busy={isLoading || undefined}
      className={className}
      disabled={disabled || isLoading}
      type="button"
      onClick={onClick}
    >
      {icon ? (
        <span className={`toolbar-button-icon${isLoading ? ' toolbar-button-icon--loading' : ''}`} aria-hidden="true">
          <NavIcon icon={icon} />
        </span>
      ) : null}
      <span>{variant === 'strong' ? `+ ${visibleLabel}` : visibleLabel}</span>
    </button>
  );
}

export function RescanToolbarButton({
  isRescanning,
  onCancel,
  onRescan,
}: {
  isRescanning: boolean;
  onCancel?: () => void;
  onRescan: () => Promise<void>;
}) {
  return (
    <ToolbarButton
      cancelLoadingLabel="Cancel MCP connectivity test"
      icon="rescan"
      isLoading={isRescanning}
      label="Rescan"
      loadingLabel={onCancel ? 'Testing MCP connectivity…' : 'Rescanning…'}
      onCancelLoading={onCancel}
      onClick={() => {
        void onRescan();
      }}
    />
  );
}

function FilterPill({
  count,
  isActive,
  label,
  onClick,
  tone,
}: {
  count: number;
  isActive: boolean;
  label: string;
  onClick: () => void;
  tone: 'attention' | 'healthy' | 'muted' | 'neutral';
}) {
  return (
    <button
      aria-pressed={isActive}
      className={`filter-pill filter-pill--${tone}${isActive ? ' filter-pill--active' : ''}`}
      type="button"
      onClick={onClick}
    >
      <span>{label}</span>
      <strong>{count}</strong>
    </button>
  );
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: 'attention' | 'warning' | 'healthy' | 'muted';
}) {
  return <span className={`status-pill status-pill--${tone}`}>{label}</span>;
}

function StatusPillGroup({
  badges,
}: {
  badges: Array<{
    label: string;
    tone: 'attention' | 'warning' | 'healthy' | 'muted';
  }>;
}) {
  return (
    <div className="status-pill-group">
      {badges.map((badge) => (
        <StatusPill key={`${badge.tone}:${badge.label}`} label={badge.label} tone={badge.tone} />
      ))}
    </div>
  );
}

export function CalloutCard({
  children,
  title,
  tone,
}: {
  children: ReactNode;
  title: string;
  tone: 'attention' | 'healthy';
}) {
  const showAttentionIcon = tone === 'attention';

  return (
    <section className={`callout-card callout-card--${tone}${showAttentionIcon ? '' : ' callout-card--iconless'}`}>
      {showAttentionIcon ? (
        <div className={`callout-card-icon callout-card-icon--${tone}`} aria-hidden="true">
          !
        </div>
      ) : null}
      <div className="callout-card-copy">
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </section>
  );
}

export function StaticSwitch({ active }: { active: boolean }) {
  return <span className={`static-switch${active ? ' static-switch--active' : ''}`} aria-hidden="true" />;
}

export function AttentionGroupCard({
  actionLabel,
  count,
  emptyState,
  emptyMessage,
  items,
  onAction,
  title,
}: {
  actionLabel: string;
  count: number;
  emptyState?: {
    description: string;
    title: string;
  };
  emptyMessage: string;
  items: Array<{
    badges: Array<{
      label: string;
      tone: 'attention' | 'warning' | 'healthy' | 'muted';
    }>;
    description?: string;
    isLocked?: boolean;
    key: string;
    label: string;
    lockedTooltip?: string;
    onClick: () => void;
  }>;
  onAction: () => void;
  title: string;
}) {
  const isEmpty = items.length === 0;

  return (
    <section className={`attention-card${isEmpty && emptyState ? ' attention-card--clean' : ''}`}>
      <div className="attention-card-header">
        <div className="attention-card-title">
          <h3>{title}</h3>
          {count > 0 ? <span>{count}</span> : null}
        </div>
        {items.length > 0 ? (
          <button className="attention-card-link" type="button" onClick={onAction}>
            {actionLabel}
          </button>
        ) : null}
      </div>

      {!isEmpty ? (
        <div className="attention-card-list">
          {items.map((item) => (
            <button className="attention-card-row" key={item.key} type="button" onClick={item.onClick}>
              <div className="attention-card-copy">
                <strong>
                  <span>{item.label}</span>
                  {item.isLocked ? (
                    <PluginTooltipIndicator
                      className="attention-card-row__plugin-indicator"
                      tooltip={item.lockedTooltip ?? PLUGIN_SKILL_TOOLTIP}
                    />
                  ) : null}
                </strong>
                {item.description ? <p>{item.description}</p> : null}
              </div>
              <div className="attention-card-actions">
                <StatusPillGroup badges={item.badges} />
              </div>
            </button>
          ))}
        </div>
      ) : emptyState ? (
        <div className="attention-card-clean-state">
          <div className="attention-card-clean-icon" aria-hidden="true">
            <Check />
          </div>
          <div className="attention-card-clean-copy">
            <strong>{emptyState.title}</strong>
            <p>{emptyState.description}</p>
          </div>
        </div>
      ) : (
        <EmptyStatePanel message={emptyMessage} />
      )}
    </section>
  );
}

export function InventorySectionBlock({
  className,
  children,
  count,
  sortLabel,
  title,
}: {
  className?: string;
  children: ReactNode;
  count: number;
  sortLabel?: ReactNode;
  title: string;
}) {
  return (
    <section className={className ? `inventory-section-block ${className}` : 'inventory-section-block'}>
      <div className="inventory-section-header">
        <div className="inventory-section-title">
          <h3>{title}</h3>
          <span>{count}</span>
        </div>
        {sortLabel ? <span className="inventory-section-sort">{sortLabel}</span> : null}
      </div>
      <div className="inventory-section-list">{children}</div>
    </section>
  );
}

export function AgentStatusRow({
  agent,
}: {
  agent: AgentRecord;
}) {
  const isUnavailable = agent.installState !== 'installed';
  const skillsPath = getAgentSkillsDisplayPath(agent);
  const skillsTitle = getAgentSkillsTitle(agent);
  const isAccountManagedSkills = agent.skillsLocation.reason === 'account-managed';
  const mcpConfigPath = getAgentConfigDisplayPath(agent);
  const mcpConfigTitle = getAgentConfigTitle(agent);

  return (
    <div className="agent-status-row">
      <div className="agent-status-main">
        <AgentAvatar agent={agent} isUnavailable={isUnavailable} />
        <div className="agent-status-copy">
          <strong title={agent.label}>{agent.label}</strong>
        </div>
      </div>
      <div className="agent-location-column">
        <code
          className={`agent-location-path${isAccountManagedSkills ? ' agent-location-path--account-managed' : ''}`}
          title={skillsTitle}
        >
          {skillsPath}
        </code>
      </div>
      <div className="agent-location-column">
        <code className="agent-location-path" title={mcpConfigTitle}>{mcpConfigPath}</code>
      </div>
    </div>
  );
}

function getAgentSkillsDisplayPath(agent: AgentRecord): string {
  if (agent.skillsLocation.reason === 'account-managed') {
    return 'Cloud account managed';
  }

  return agent.defaultGlobalSkillsDir;
}

function getAgentSkillsTitle(agent: AgentRecord): string {
  if (agent.skillsLocation.reason === 'account-managed') {
    return "Skills are managed through this agent's cloud account; Skill Index cannot scan or install local skill files for it.";
  }

  return agent.defaultGlobalSkillsDir;
}

function AgentAvatar({
  agent,
  isUnavailable,
}: {
  agent: AgentRecord;
  isUnavailable: boolean;
}) {
  const [hasImageError, setHasImageError] = useState(false);
  const iconUrl = getRenderableAgentIconUrl(agent);

  useEffect(() => {
    setHasImageError(false);
  }, [iconUrl]);

  if (!iconUrl || hasImageError) {
    return (
      <span className={`agent-avatar${isUnavailable ? ' agent-avatar--ghost' : ''}`} aria-hidden="true">
        {agent.label.charAt(0)}
      </span>
    );
  }

  return (
    <span className={`agent-avatar agent-avatar--image${isUnavailable ? ' agent-avatar--ghost' : ''}`} aria-hidden="true">
      <img
        alt=""
        className="agent-avatar-image"
        loading="lazy"
        src={iconUrl}
        onError={() => setHasImageError(true)}
      />
    </span>
  );
}

function getRenderableAgentIconUrl(agent: AgentRecord): string | null {
  const assetUrl = agent.icon?.assetUrl?.trim();
  if (!assetUrl) {
    return null;
  }

  const normalizedFormat = agent.icon?.format?.trim().toLowerCase();
  if (!normalizedFormat) {
    return assetUrl;
  }

  return isRenderableAgentIconFormat(normalizedFormat) ? assetUrl : null;
}

function isRenderableAgentIconFormat(format: string): boolean {
  return format === 'png'
    || format === 'jpg'
    || format === 'jpeg'
    || format === 'svg'
    || format === 'ico'
    || format === 'webp'
    || format === 'gif'
    || format === 'avif';
}

function getAgentConfigDisplayPath(agent: AgentRecord): string {
  if (agent.mcpConfigLocation.displayPath) {
    return agent.mcpConfigLocation.displayPath;
  }

  if (agent.mcpConfigLocation.path) {
    return agent.mcpConfigLocation.path;
  }

  if (agent.configLocation?.displayPath) {
    return agent.configLocation.displayPath;
  }

  if (agent.configLocation?.path) {
    return agent.configLocation.path;
  }

  return '-';
}

function getAgentConfigTitle(agent: AgentRecord): string {
  return agent.mcpConfigLocation.path
    ?? agent.configLocation?.path
    ?? getAgentConfigDisplayPath(agent);
}

export function SettingsCard({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <section className="settings-card">
      <div className="settings-card-header">
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="settings-card-body">{children}</div>
    </section>
  );
}

export function SettingsRow({
  description,
  label,
  trailing,
}: {
  description: string;
  label: string;
  trailing: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
      <div className="settings-row-trailing">{trailing}</div>
    </div>
  );
}

export function EmptyStatePanel({ message }: { message: string }) {
  return <div className="empty-state-panel">{message}</div>;
}

export function WorkspaceFilterBar<T extends string>({
  activeFilter,
  ariaLabel,
  filters,
  onFilterChange,
  trailing,
}: {
  activeFilter: T;
  ariaLabel: string;
  filters: Array<{
    count: number;
    label: string;
    tone: 'attention' | 'healthy' | 'muted' | 'neutral';
    value: T;
  }>;
  onFilterChange: (value: T) => void;
  trailing?: ReactNode;
}) {
  return (
    <div className="inventory-filter-bar">
      <div className="inventory-pill-row" role="toolbar" aria-label={ariaLabel}>
        {filters.map((filter) => (
          <FilterPill
            count={filter.count}
            isActive={activeFilter === filter.value}
            key={filter.label}
            label={filter.label}
            onClick={() => onFilterChange(activeFilter === filter.value ? ('all' as T) : filter.value)}
            tone={filter.tone}
          />
        ))}
      </div>
      {trailing ? <div className="inventory-filter-bar-trailing">{trailing}</div> : null}
    </div>
  );
}

export function InventoryKeyboardHint() {
  return (
    <div className="inventory-keyboard-hint" aria-label="List keyboard shortcuts">
      <span><kbd>J</kbd><span aria-hidden="true">↑</span></span>
      <span><kbd>K</kbd><span aria-hidden="true">↓</span></span>
    </div>
  );
}

export function InventoryListRow({
  badges,
  description,
  isLocked = false,
  isSelected,
  lockedTooltip = PLUGIN_SKILL_TOOLTIP,
  name,
  onClick,
}: {
  badges: Array<{
    label: string;
    tone: 'attention' | 'warning' | 'healthy' | 'muted';
  }>;
  description?: string;
  isLocked?: boolean;
  isSelected: boolean;
  lockedTooltip?: string;
  name: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={isSelected}
      className={`master-list-row${isSelected ? ' master-list-row--selected' : ''}`}
      type="button"
      onClick={onClick}
    >
      <div className="master-list-row-copy">
        <strong>
          <span>{name}</span>
          {isLocked ? (
            <PluginTooltipIndicator
              className="master-list-row__plugin-indicator"
              tooltip={lockedTooltip}
            />
          ) : null}
        </strong>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="master-list-row-actions">
        <StatusPillGroup badges={badges} />
      </div>
    </button>
  );
}
