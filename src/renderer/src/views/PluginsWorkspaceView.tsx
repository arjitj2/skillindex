import type {
  PluginMcpRef,
  PluginRecord,
  PluginSkillRef,
  PluginUnsupportedAssetRef,
  SkillInventorySnapshot,
} from '@shared/contracts';
import { useEffect, useState, type RefObject } from 'react';

import { hasSearchQuery } from '../inventory-view-model';
import {
  EmptyStatePanel,
  HeaderSearch,
  InventorySectionBlock,
  PageTopBar,
  RescanToolbarButton,
} from '../components/ui';
import { formatInspectorDisplayPath } from '../lib/inventory-presentation';

export function PluginsWorkspaceView({
  errorMessage,
  inventorySnapshot,
  isRescanning,
  onCancelMcpConnectivityTest,
  onRescan,
  onSearchQueryChange,
  onSelectMcpAsset,
  onSelectPlugin,
  onSelectSkillAsset,
  onClearSelection,
  rows,
  sandboxRoot,
  searchInputRef,
  searchQuery,
  selectedPlugin,
  selectedPluginKey,
}: {
  errorMessage: string | null;
  inventorySnapshot: SkillInventorySnapshot | null;
  isRescanning: boolean;
  onCancelMcpConnectivityTest?: () => void;
  onRescan: () => Promise<void>;
  onSearchQueryChange: (query: string) => void;
  onSelectMcpAsset: (mcpName: string) => void;
  onSelectPlugin: (plugin: PluginRecord) => void;
  onSelectSkillAsset: (skillName: string) => void;
  onClearSelection: () => void;
  rows: PluginRecord[];
  sandboxRoot: string | null;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  selectedPlugin: PluginRecord | null;
  selectedPluginKey: string | null;
}) {
  const codexPlugins = rows.filter((plugin) => plugin.host === 'codex');
  const claudePlugins = rows.filter((plugin) => plugin.host === 'claude');
  const sections = [
    { title: 'CODEX', rows: codexPlugins },
    { title: 'CLAUDE', rows: claudePlugins },
  ].filter((section) => section.rows.length > 0);

  return (
    <main className="workspace-view">
      <PageTopBar
        actions={(
          <RescanToolbarButton isRescanning={isRescanning} onCancel={onCancelMcpConnectivityTest} onRescan={onRescan} />
        )}
        search={(
          <HeaderSearch
            inputRef={searchInputRef}
            label="Search plugins"
            onChange={onSearchQueryChange}
            placeholder="Search plugins by name, capability, or path..."
            query={searchQuery}
          />
        )}
        title="Plugins"
      />

      <div className="page-scroll page-scroll--split">
        <div className={`split-workspace split-workspace--detail${selectedPlugin ? '' : ' split-workspace--detail-collapsed'}`}>
          <section aria-label="Plugins list" className="master-list-panel">
            {errorMessage ? <p className="inline-error-banner">{errorMessage}</p> : null}
            {inventorySnapshot ? (
              sections.length > 0 ? (
                sections.map((section) => (
                  <InventorySectionBlock
                    className="inventory-section-block--plugins"
                    count={section.rows.length}
                    key={section.title}
                    title={section.title}
                  >
                    {section.rows.map((plugin) => (
                      <PluginInventoryRow
                        key={`${plugin.host}:${plugin.pluginId}:${plugin.version ?? plugin.rootPath}`}
                        isSelected={selectedPluginKey === getPluginSelectionKey(plugin)}
                        onSelect={() => onSelectPlugin(plugin)}
                        plugin={plugin}
                        sandboxRoot={sandboxRoot}
                      />
                    ))}
                  </InventorySectionBlock>
                ))
              ) : (
                <EmptyStatePanel
                  message={hasSearchQuery(searchQuery) ? `No plugins match "${searchQuery.trim()}".` : 'No installed plugins were found.'}
                />
              )
            ) : (
              <EmptyStatePanel message="Scanning your plugin inventory…" />
            )}
          </section>

          {selectedPlugin ? (
            <PluginDetailPanel
              inventorySnapshot={inventorySnapshot}
              onClose={onClearSelection}
              onSelectMcpAsset={onSelectMcpAsset}
              onSelectSkillAsset={onSelectSkillAsset}
              plugin={selectedPlugin}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}

function PluginInventoryRow({
  isSelected,
  onSelect,
  plugin,
  sandboxRoot,
}: {
  isSelected: boolean;
  onSelect: () => void;
  plugin: PluginRecord;
  sandboxRoot: string | null;
}) {
  const displayPath = formatInspectorDisplayPath(plugin.rootPath, { sandboxRoot });
  const unsupportedHooksCount = plugin.unsupportedHooksCount ?? 0;

  return (
    <button
      aria-pressed={isSelected}
      className={`master-list-row${isSelected ? ' master-list-row--selected' : ''}`}
      type="button"
      onClick={onSelect}
    >
      <div className="master-list-row-copy plugin-inventory-row__main">
        <strong className="plugin-inventory-row__heading">
          <span>{plugin.pluginName}</span>
          {plugin.version ? <span className="plugin-inventory-row__version">{plugin.version}</span> : null}
        </strong>
        <p className="plugin-inventory-row__source" title={plugin.source?.repository ?? displayPath}>
          {plugin.source?.repository ?? displayPath}
        </p>
      </div>

      <div className="master-list-row-actions plugin-inventory-row__stats" aria-label={`${plugin.pluginName} capabilities`}>
        <span className="plugin-inventory-row__stat">
          <strong>{plugin.bundledSkills.length}</strong>
          <span>skills</span>
        </span>
        <span className="plugin-inventory-row__stat">
          <strong>{plugin.bundledMcps.length}</strong>
          <span>MCPs</span>
        </span>
        <span className={`plugin-inventory-row__stat${unsupportedHooksCount > 0 ? ' plugin-inventory-row__stat--warn' : ''}`}>
          <strong>{unsupportedHooksCount}</strong>
          <span>hooks</span>
        </span>
      </div>
    </button>
  );
}

type PluginDetailTab = 'overview' | 'assets';

function PluginDetailPanel({
  inventorySnapshot,
  onClose,
  onSelectMcpAsset,
  onSelectSkillAsset,
  plugin,
}: {
  inventorySnapshot: SkillInventorySnapshot | null;
  onClose: () => void;
  onSelectMcpAsset: (mcpName: string) => void;
  onSelectSkillAsset: (skillName: string) => void;
  plugin: PluginRecord;
}) {
  const [activeTab, setActiveTab] = useState<PluginDetailTab>('assets');
  const unsupportedHooksCount = plugin.unsupportedHooksCount ?? 0;

  useEffect(() => {
    setActiveTab('assets');
  }, [plugin.host, plugin.pluginId, plugin.rootPath]);

  return (
    <aside aria-label={`${plugin.pluginName} plugin detail`} className="inspector-panel plugin-detail-panel">
      <section className="plugin-detail-panel__header">
        <div className="plugin-detail-panel__title-row">
          <div className="plugin-detail-panel__title-copy">
            <h3>
              {plugin.pluginName}
              {plugin.version ? <span>{plugin.version}</span> : null}
            </h3>
            <p>
              Bundles {plugin.bundledSkills.length} {pluralize('skill', plugin.bundledSkills.length)}
              {' '}and {plugin.bundledMcps.length} {pluralize('MCP', plugin.bundledMcps.length)}.
            </p>
          </div>
          <button className="detail-inspector-panel__close-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </section>

      <div className="plugin-detail-panel__tabs" role="tablist" aria-label={`${plugin.pluginName} detail sections`}>
        <button
          aria-selected={activeTab === 'assets'}
          className={activeTab === 'assets' ? 'is-active' : ''}
          role="tab"
          type="button"
          onClick={() => setActiveTab('assets')}
        >
          Bundled Assets
          <span>{plugin.bundledSkills.length + plugin.bundledMcps.length}</span>
        </button>
        <button
          aria-selected={activeTab === 'overview'}
          className={activeTab === 'overview' ? 'is-active' : ''}
          role="tab"
          type="button"
          onClick={() => setActiveTab('overview')}
        >
          Metadata
        </button>
      </div>

      <div className="plugin-detail-panel__body">
        {activeTab === 'overview' ? (
          <>
            <section className="plugin-detail-panel__metadata" aria-label="Plugin metadata">
              <PluginMetadataRow label="Host" value={formatPluginHost(plugin.host)} />
              <PluginMetadataRow label="State" value={formatPluginEnabledState(plugin.enabled)} />
              <PluginMetadataRow label="Install path" pathTarget={plugin.rootPath} value={plugin.rootPath} monospace />
              {plugin.manifestPath ? (
                <PluginMetadataRow label="Manifest" pathTarget={plugin.manifestPath} value={plugin.manifestPath} monospace />
              ) : null}
              {plugin.source?.repository ? (
                <PluginMetadataRow
                  href={getPluginRepositoryHref(plugin.source.repository)}
                  label="Source"
                  value={plugin.source.repository}
                />
              ) : null}
              <PluginMetadataRow label="Plugin ID" value={plugin.pluginId} monospace />
            </section>
          </>
        ) : (
          <section aria-label="Bundled plugin assets" className="plugin-detail-panel__assets">
            <PluginAssetList
              emptyLabel="No bundled skills found."
              items={plugin.bundledSkills.map((skill) => ({
                key: `${skill.sourceId}:${skill.path}:${skill.name}`,
                label: skill.name,
                onSelect: () => onSelectSkillAsset(resolveBundledSkillName(inventorySnapshot, skill)),
              }))}
              title="Bundled skills"
            />
            <PluginAssetList
              emptyLabel="No bundled MCPs found."
              items={plugin.bundledMcps.map((mcp) => ({
                key: `${mcp.sourceId}:${mcp.configPath}:${mcp.name}`,
                label: mcp.name,
                onSelect: () => onSelectMcpAsset(resolveBundledMcpName(inventorySnapshot, mcp)),
              }))}
              title="Bundled MCPs"
            />
            <div className="plugin-detail-panel__asset-section plugin-detail-panel__asset-section--unsupported">
              <div className="plugin-detail-panel__section-label">
                <span>Unsupported assets</span>
                <i />
                <strong>{unsupportedHooksCount}</strong>
              </div>
              {unsupportedHooksCount > 0 ? (
                <div className="plugin-detail-panel__unsupported-list">
                  {getUnsupportedHookAssets(plugin).map((hook) => (
                    <div className="plugin-detail-panel__unsupported-row" key={`${hook.sourceId}:${hook.path}:${hook.name}`}>
                      <div>
                        <span className="plugin-detail-panel__unsupported-heading">
                          <strong>{hook.name}</strong>
                          <em>Hook</em>
                        </span>
                        <span>Hook execution not yet supported by Skill Index</span>
                      </div>
                      <strong>Inert</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="plugin-detail-panel__empty-assets">No unsupported assets found.</p>
              )}
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}

function PluginMetadataRow({
  href,
  label,
  monospace = false,
  pathTarget,
  value,
}: {
  href?: string;
  label: string;
  monospace?: boolean;
  pathTarget?: string;
  value: string;
}) {
  return (
    <div className="plugin-detail-panel__metadata-row">
      <span>{label}</span>
      {pathTarget ? (
        <PluginPathButton displayPath={value} isMonospace={monospace} targetPath={pathTarget} />
      ) : href ? (
        <a className="plugin-detail-panel__metadata-link" href={href} rel="noreferrer" target="_blank" title={value}>{value}</a>
      ) : (
        <strong className={monospace ? 'is-monospace' : ''} title={value}>{value}</strong>
      )}
    </div>
  );
}

function PluginPathButton({
  className,
  displayPath,
  isMonospace = true,
  targetPath,
}: {
  className?: string;
  displayPath: string;
  isMonospace?: boolean;
  targetPath: string;
}) {
  return (
    <button
      className={[
        'plugin-detail-panel__path-button',
        isMonospace ? 'is-monospace' : '',
        className ?? '',
      ].filter(Boolean).join(' ')}
      title={displayPath}
      type="button"
      onClick={() => revealPluginPath(targetPath)}
  >
      {displayPath}
    </button>
  );
}

function getPluginRepositoryHref(repository: string): string | undefined {
  const trimmedRepository = repository.trim();
  if (trimmedRepository.startsWith('http://') || trimmedRepository.startsWith('https://')) {
    return trimmedRepository;
  }

  return undefined;
}

function PluginAssetList({
  emptyLabel,
  items,
  title,
}: {
  emptyLabel: string;
  items: Array<{
    key: string;
    label: string;
    onSelect?: () => void;
  }>;
  title: string;
}) {
  return (
    <div className="plugin-detail-panel__asset-section">
      <div className="plugin-detail-panel__section-label">
        <span>{title}</span>
        <i />
        <strong>{items.length}</strong>
      </div>
      {items.length > 0 ? (
        <div className="plugin-detail-panel__asset-list">
          {items.map((item) => (
            <button
              className="plugin-detail-panel__asset-row"
              key={item.key}
              type="button"
              onClick={item.onSelect}
            >
              <strong>{item.label}</strong>
            </button>
          ))}
        </div>
      ) : (
        <p className="plugin-detail-panel__empty-assets">{emptyLabel}</p>
      )}
    </div>
  );
}

function resolveBundledSkillName(snapshot: SkillInventorySnapshot | null, asset: PluginSkillRef): string {
  return snapshot?.skills.find((skill) =>
    skill.locations.some((location) =>
      location.sourceId === asset.sourceId
      && (location.path === asset.path || location.resolvedPath === asset.path || location.path === asset.entrypointPath || location.resolvedPath === asset.entrypointPath)))?.name
    ?? asset.name;
}

function resolveBundledMcpName(snapshot: SkillInventorySnapshot | null, asset: PluginMcpRef): string {
  return snapshot?.mcps?.find((mcp) =>
    mcp.locations.some((location) =>
      location.agentId === asset.sourceId
      && location.configPath === asset.configPath))?.name
    ?? asset.name;
}

function getUnsupportedHookAssets(plugin: PluginRecord): PluginUnsupportedAssetRef[] {
  const hooks = (plugin.unsupportedAssets ?? []).filter((asset) => asset.kind === 'hook');
  if (hooks.length > 0) {
    return hooks;
  }

  const count = plugin.unsupportedHooksCount ?? 0;
  return Array.from({ length: count }, (_, index) => ({
    kind: 'hook' as const,
    name: count === 1 ? 'hook' : `hook-${index + 1}`,
    path: plugin.rootPath,
    sourceId: `${plugin.host}:${plugin.pluginId}`,
  }));
}

function pluralize(label: string, count: number): string {
  return count === 1 ? label : `${label}s`;
}

function revealPluginPath(targetPath: string | undefined) {
  if (!targetPath) {
    return;
  }

  const revealPathPromise = window.skillIndex?.revealPathInFinder(targetPath);
  void revealPathPromise?.catch((error) => {
    console.error('Failed to reveal plugin path.', error);
  });
}

function getPluginSelectionKey(plugin: PluginRecord): string {
  return [
    plugin.host,
    plugin.scope ?? '',
    plugin.pluginId,
    plugin.version ?? '',
    plugin.rootPath,
  ].join(':');
}

function formatPluginHost(host: PluginRecord['host']): string {
  return host === 'codex' ? 'Codex' : 'Claude';
}

function formatPluginEnabledState(enabled: PluginRecord['enabled']): string {
  if (enabled === 'unknown') {
    return 'Unknown';
  }

  return enabled ? 'Enabled' : 'Disabled';
}
