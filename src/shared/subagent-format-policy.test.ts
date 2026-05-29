import { describe, expect, it } from 'vitest';

import {
  getSubagentFileNameForFormat,
  inferSubagentParserKindFromPath,
  isMarkdownSubagentSymlinkCompatible,
  isSubagentFormatRenderableFromUniversal,
  isSupportedSubagentDirectoryFormat,
} from './subagent-format-policy';

describe('subagent format policy', () => {
  it('treats YAML as a supported directory format', () => {
    expect(isSupportedSubagentDirectoryFormat('yaml')).toBe(true);
    expect(inferSubagentParserKindFromPath('/Users/tester/.kimi/agents/reviewer.yaml', 'unknown')).toBe('yaml');
    expect(inferSubagentParserKindFromPath('/Users/tester/.kimi/agents/reviewer.yml', 'unknown')).toBe('yaml');
    expect(getSubagentFileNameForFormat({ name: 'reviewer', format: 'yaml' })).toBe('reviewer.yaml');
  });

  it('centralizes renderability and Markdown symlink compatibility checks', () => {
    expect(isSubagentFormatRenderableFromUniversal('yaml', 'markdown-frontmatter')).toBe(true);
    expect(isSubagentFormatRenderableFromUniversal('yaml', 'json')).toBe(false);
    expect(isMarkdownSubagentSymlinkCompatible('claude')).toBe(true);
    expect(isMarkdownSubagentSymlinkCompatible('mux')).toBe(false);
    expect(isMarkdownSubagentSymlinkCompatible('iflow-cli')).toBe(false);
  });
});
